import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClient,
  getWixContactV5,
  sendWixInboxSms,
  syncCustomerToWix,
  isWixInboxSmsConfigured,
  customerUpdates,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  getWixContactV5: vi.fn(),
  sendWixInboxSms: vi.fn(),
  syncCustomerToWix: vi.fn(),
  isWixInboxSmsConfigured: vi.fn(),
  customerUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/database/supabase-server", () => ({ createClient }));
vi.mock("@/lib/wix/config", () => ({ isWixInboxSmsConfigured }));
vi.mock("@/lib/wix/client", () => ({ getWixContactV5 }));
vi.mock("@/lib/wix/inbox", () => ({ sendWixInboxSms }));
vi.mock("@/lib/services/wixContacts", () => ({ syncCustomerToWix }));

import { sendCustomerSms } from "@/lib/services/customerSms";

const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CONTACT_ID = "22222222-2222-4222-8222-222222222222";

function wixContact(
  overrides: {
    e164?: string | null;
    subscriptionStatus?:
      | "NO_SUBSCRIPTION_STATUS"
      | "NOT_SET"
      | "PENDING"
      | "SUBSCRIBED"
      | "UNSUBSCRIBED"
      | null;
    subscriptionUpdatedDate?: string | null;
    deliverabilityStatus?:
      "NO_PHONE_DELIVERABILITY_STATUS" | "NOT_SET" | "VALID" | "INVALID" | null;
  } = {}
) {
  return {
    id: CONTACT_ID,
    updatedDate: "2026-10-31T12:00:00.000Z",
    phone: {
      e164: overrides.e164 === undefined ? "+16475550100" : overrides.e164,
      subscriptionStatus: {
        status:
          overrides.subscriptionStatus === undefined
            ? "SUBSCRIBED"
            : overrides.subscriptionStatus,
        updatedDate:
          overrides.subscriptionUpdatedDate === undefined
            ? "2026-10-30T12:00:00.000Z"
            : overrides.subscriptionUpdatedDate,
      },
      deliverabilityStatus:
        overrides.deliverabilityStatus === undefined
          ? "VALID"
          : overrides.deliverabilityStatus,
    },
  };
}

describe("sendCustomerSms", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    customerUpdates.length = 0;
    isWixInboxSmsConfigured.mockReturnValue(true);
    createClient.mockResolvedValue({
      from: (table: string) => {
        expect(table).toBe("customer");
        return {
          update: (patch: Record<string, unknown>) => {
            customerUpdates.push(patch);
            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          },
        };
      },
    });
    getWixContactV5.mockResolvedValue(wixContact());
    sendWixInboxSms.mockResolvedValue({
      messageId: "wix-message-1",
      conversationId: "wix-conversation-1",
    });
    syncCustomerToWix.mockResolvedValue({ wix_contact_id: CONTACT_ID });
  });

  it("fails closed before sync or mutation when Wix SMS is disabled", async () => {
    isWixInboxSmsConfigured.mockReturnValue(false);

    await expect(
      sendCustomerSms({
        customerId: "cust-1",
        wixContactId: null,
        to: "6475550100",
        body: "Service update",
        localOptedOutAt: null,
      })
    ).rejects.toThrow("WIX_INBOX_SMS_NOT_CONFIGURED");

    expect(syncCustomerToWix).not.toHaveBeenCalled();
    expect(getWixContactV5).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(sendWixInboxSms).not.toHaveBeenCalled();
  });

  it("normalizes the recipient, checks Wix consent, and returns the Wix message ID", async () => {
    await expect(
      sendCustomerSms({
        customerId: "cust-1",
        wixContactId: CONTACT_ID,
        to: "(647) 555-0100",
        body: "Your motorcycle is ready.",
        localOptedOutAt: null,
      })
    ).resolves.toBe("wix-message-1");

    expect(getWixContactV5).toHaveBeenCalledWith(CONTACT_ID);
    expect(sendWixInboxSms).toHaveBeenCalledWith({
      contactId: CONTACT_ID,
      body: "Your motorcycle is ready.",
    });
    expect(customerUpdates).toEqual([]);
  });

  it("syncs and persists a Wix contact link before sending when none is linked", async () => {
    await sendCustomerSms({
      customerId: "cust-1",
      wixContactId: null,
      to: "6475550100",
      body: "Service update",
      localOptedOutAt: null,
    });

    expect(syncCustomerToWix).toHaveBeenCalledWith("cust-1");
    expect(getWixContactV5).toHaveBeenCalledWith(CONTACT_ID);
    expect(sendWixInboxSms).toHaveBeenCalledWith({
      contactId: CONTACT_ID,
      body: "Service update",
    });
  });

  it("does not sync again when a newly linked contact has a mismatched phone", async () => {
    getWixContactV5.mockResolvedValue(wixContact({ e164: "+14165550100" }));

    await expect(
      sendCustomerSms({
        customerId: "cust-1",
        wixContactId: null,
        to: "6475550100",
        body: "Service update",
        localOptedOutAt: null,
      })
    ).rejects.toThrow("WIX_SMS_PHONE_MISMATCH");

    expect(syncCustomerToWix).toHaveBeenCalledOnce();
    expect(syncCustomerToWix).toHaveBeenCalledWith("cust-1");
    expect(getWixContactV5).toHaveBeenCalledOnce();
    expect(getWixContactV5).toHaveBeenCalledWith(CONTACT_ID);
    expect(sendWixInboxSms).not.toHaveBeenCalled();
  });

  it("repairs a stale linked contact ID after Contacts V5 reports it missing", async () => {
    getWixContactV5
      .mockRejectedValueOnce(new Error("WIX_CONTACT_NOT_FOUND"))
      .mockResolvedValueOnce(wixContact());
    syncCustomerToWix.mockResolvedValue({ wix_contact_id: OTHER_CONTACT_ID });

    await expect(
      sendCustomerSms({
        customerId: "cust-1",
        wixContactId: CONTACT_ID,
        to: "6475550100",
        body: "Service update",
        localOptedOutAt: null,
      })
    ).resolves.toBe("wix-message-1");

    expect(syncCustomerToWix).toHaveBeenCalledOnce();
    expect(getWixContactV5.mock.calls).toEqual([[CONTACT_ID], [OTHER_CONTACT_ID]]);
    expect(sendWixInboxSms).toHaveBeenCalledWith({
      contactId: OTHER_CONTACT_ID,
      body: "Service update",
    });
  });

  it("does not sync twice when the repaired contact has a mismatched phone", async () => {
    getWixContactV5
      .mockRejectedValueOnce(new Error("WIX_CONTACT_NOT_FOUND"))
      .mockResolvedValueOnce(wixContact({ e164: "+14165550100" }));
    syncCustomerToWix.mockResolvedValue({ wix_contact_id: OTHER_CONTACT_ID });

    await expect(
      sendCustomerSms({
        customerId: "cust-1",
        wixContactId: CONTACT_ID,
        to: "6475550100",
        body: "Service update",
        localOptedOutAt: null,
      })
    ).rejects.toThrow("WIX_SMS_PHONE_MISMATCH");

    expect(syncCustomerToWix).toHaveBeenCalledOnce();
    expect(getWixContactV5.mock.calls).toEqual([[CONTACT_ID], [OTHER_CONTACT_ID]]);
    expect(sendWixInboxSms).not.toHaveBeenCalled();
  });

  it("fails closed without syncing for Contacts V5 errors other than not found", async () => {
    getWixContactV5.mockRejectedValue(new Error("WIX_CONTACT_API_ERROR"));

    await expect(
      sendCustomerSms({
        customerId: "cust-1",
        wixContactId: CONTACT_ID,
        to: "6475550100",
        body: "Service update",
        localOptedOutAt: null,
      })
    ).rejects.toThrow("WIX_CONTACT_API_ERROR");

    expect(syncCustomerToWix).not.toHaveBeenCalled();
    expect(getWixContactV5).toHaveBeenCalledOnce();
    expect(sendWixInboxSms).not.toHaveBeenCalled();
  });

  it("syncs once and re-reads Contacts V5 when the linked phone mismatches", async () => {
    getWixContactV5
      .mockResolvedValueOnce(wixContact({ e164: "+14165550100" }))
      .mockResolvedValueOnce(wixContact());
    syncCustomerToWix.mockResolvedValue({ wix_contact_id: OTHER_CONTACT_ID });

    await sendCustomerSms({
      customerId: "cust-1",
      wixContactId: CONTACT_ID,
      to: "6475550100",
      body: "Service update",
      localOptedOutAt: null,
    });

    expect(syncCustomerToWix).toHaveBeenCalledOnce();
    expect(getWixContactV5.mock.calls).toEqual([[CONTACT_ID], [OTHER_CONTACT_ID]]);
    expect(sendWixInboxSms).toHaveBeenCalledWith({
      contactId: OTHER_CONTACT_ID,
      body: "Service update",
    });
  });

  it("blocks a still-mismatched Wix phone after one sync", async () => {
    getWixContactV5.mockResolvedValue(wixContact({ e164: "+14165550100" }));

    await expect(
      sendCustomerSms({
        customerId: "cust-1",
        wixContactId: CONTACT_ID,
        to: "6475550100",
        body: "Service update",
        localOptedOutAt: null,
      })
    ).rejects.toThrow("WIX_SMS_PHONE_MISMATCH");

    expect(syncCustomerToWix).toHaveBeenCalledOnce();
    expect(sendWixInboxSms).not.toHaveBeenCalled();
  });

  it("blocks an invalid first Wix phone without attempting a sync or second read", async () => {
    getWixContactV5
      .mockResolvedValueOnce(wixContact({ e164: null }))
      .mockResolvedValueOnce(wixContact());

    await expect(
      sendCustomerSms({
        customerId: "cust-1",
        wixContactId: CONTACT_ID,
        to: "6475550100",
        body: "Service update",
        localOptedOutAt: null,
      })
    ).rejects.toThrow("WIX_SMS_PHONE_INVALID");

    expect(getWixContactV5).toHaveBeenCalledOnce();
    expect(syncCustomerToWix).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(sendWixInboxSms).not.toHaveBeenCalled();
  });

  it("reconciles a Wix unsubscribe locally and blocks the send", async () => {
    getWixContactV5.mockResolvedValue(
      wixContact({
        subscriptionStatus: "UNSUBSCRIBED",
        subscriptionUpdatedDate: "2026-10-29T12:00:00.000Z",
      })
    );

    await expect(
      sendCustomerSms({
        customerId: "cust-1",
        wixContactId: CONTACT_ID,
        to: "6475550100",
        body: "Service update",
        localOptedOutAt: null,
      })
    ).rejects.toThrow("SMS_OPTED_OUT");

    expect(customerUpdates).toEqual([{ sms_opted_out_at: "2026-10-29T12:00:00.000Z" }]);
    expect(sendWixInboxSms).not.toHaveBeenCalled();
  });

  it("clears a stale local opt-out when Wix says subscribed and sends", async () => {
    await sendCustomerSms({
      customerId: "cust-1",
      wixContactId: CONTACT_ID,
      to: "6475550100",
      body: "Service update",
      localOptedOutAt: "2026-10-01T12:00:00.000Z",
    });

    expect(customerUpdates).toEqual([{ sms_opted_out_at: null }]);
    expect(sendWixInboxSms).toHaveBeenCalledOnce();
  });

  it.each(["NOT_SET", "PENDING"] as const)(
    "allows %s for a transactional message only without a local opt-out",
    async (subscriptionStatus) => {
      getWixContactV5.mockResolvedValue(wixContact({ subscriptionStatus }));

      await expect(
        sendCustomerSms({
          customerId: "cust-1",
          wixContactId: CONTACT_ID,
          to: "6475550100",
          body: "Service update",
          localOptedOutAt: null,
        })
      ).resolves.toBe("wix-message-1");

      await expect(
        sendCustomerSms({
          customerId: "cust-1",
          wixContactId: CONTACT_ID,
          to: "6475550100",
          body: "Service update",
          localOptedOutAt: "2026-10-01T12:00:00.000Z",
        })
      ).rejects.toThrow("SMS_OPTED_OUT");
    }
  );

  it.each([
    [
      wixContact({ subscriptionStatus: "NO_SUBSCRIPTION_STATUS" }),
      "WIX_SMS_SUBSCRIPTION_REQUIRED",
    ],
    [wixContact({ subscriptionStatus: null }), "WIX_SMS_SUBSCRIPTION_REQUIRED"],
    [wixContact({ deliverabilityStatus: "INVALID" }), "WIX_SMS_UNDELIVERABLE"],
  ])("blocks ineligible Wix SMS state", async (contact, errorCode) => {
    getWixContactV5.mockResolvedValue(contact);

    await expect(
      sendCustomerSms({
        customerId: "cust-1",
        wixContactId: CONTACT_ID,
        to: "6475550100",
        body: "Service update",
        localOptedOutAt: null,
      })
    ).rejects.toThrow(errorCode);

    expect(sendWixInboxSms).not.toHaveBeenCalled();
  });

  it("rejects an invalid app phone before touching Wix", async () => {
    await expect(
      sendCustomerSms({
        customerId: "cust-1",
        wixContactId: CONTACT_ID,
        to: "5551234",
        body: "Service update",
        localOptedOutAt: null,
      })
    ).rejects.toThrow("INVALID_PHONE");

    expect(getWixContactV5).not.toHaveBeenCalled();
    expect(sendWixInboxSms).not.toHaveBeenCalled();
  });
});
