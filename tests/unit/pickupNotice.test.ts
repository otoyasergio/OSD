import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderReadyForPickupMessage } from "@/lib/services/communications";
import {
  canSendPickupNotice,
  pickupNoticeBlockers,
  pickupNoticePromptBody,
  shouldPromptPickupNotice,
} from "@/lib/communications/pickupNotice";
import { TORONTO_SHOP } from "@/lib/shop/toronto";

const {
  requireUser,
  createClient,
  createAdminClient,
  sendCustomerSms,
  sendEmail,
  createPortalToken,
  addTimelineEvent,
  loggerWarn,
  updateErrors,
  lookupOutcomes,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  sendCustomerSms: vi.fn(),
  sendEmail: vi.fn(),
  createPortalToken: vi.fn(),
  addTimelineEvent: vi.fn(),
  loggerWarn: vi.fn(),
  updateErrors: [] as Array<{ message: string } | Error | null>,
  lookupOutcomes: [] as Array<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }>,
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/database/supabase-server", () => ({ createClient }));
vi.mock("@/lib/database/supabase-admin", () => ({ createAdminClient }));
vi.mock("@/lib/services/customerSms", () => ({ sendCustomerSms }));
vi.mock("@/lib/email/send", () => ({
  sendEmail,
  isEmailConfigured: () => true,
}));
vi.mock("@/lib/services/portal", () => ({ createPortalToken }));
vi.mock("@/lib/timeline/addTimelineEvent", () => ({ addTimelineEvent }));
vi.mock("@/lib/security/logger", () => ({
  logger: { warn: loggerWarn },
}));
vi.mock("@/lib/portal/tokens", () => ({
  portalUrl: (token: string) => `https://service.torontomoto.com/c/${token}`,
}));

import { sendReadyForPickupNotice } from "@/lib/services/pickupNotice";
import { PickupNoticeDialog } from "@/components/communications/PickupNoticeDialog";

type LogRow = Record<string, unknown> & { log_id: string };

const logs: LogRow[] = [];

function seedPickupSms(status: string, errorMessage: string | null = null) {
  logs.push({
    log_id: "existing-sms",
    work_order_id: "wo-1",
    customer_id: "cust-1",
    channel: "sms",
    direction: "outbound",
    template_key: "ready_for_pickup",
    to_address: "+16475550100",
    body: "Ready",
    status,
    error_message: errorMessage,
    dedupe_key: "2026-10-30T18:00:00.000Z",
  });
}

function workOrder(overrides: Record<string, unknown> = {}) {
  return {
    work_order_id: "wo-1",
    work_order_number: "WO-100",
    location_id: "loc-1",
    status: "ready_for_pickup",
    ready_for_pickup_at: "2026-10-30T18:00:00.000Z",
    updated_at: "2026-10-30T18:00:00.000Z",
    customer: {
      customer_id: "cust-1",
      first_name: "Ada",
      last_name: "Lovelace",
      phone: "6475550100",
      email: "ada@example.com",
      sms_opted_out_at: null,
      wix_contact_id: "11111111-1111-4111-8111-111111111111",
    },
    location: { code: "TOR" },
    ...overrides,
  };
}

function adminClient() {
  return {
    from(table: string) {
      if (table !== "communication_log") throw new Error(`unexpected table ${table}`);
      return {
        insert(payload: Record<string, unknown>) {
          return {
            select() {
              return {
                async single() {
                  const clash = logs.find(
                    (row) =>
                      row.work_order_id === payload.work_order_id &&
                      row.channel === payload.channel &&
                      row.template_key === payload.template_key &&
                      row.dedupe_key === payload.dedupe_key
                  );
                  if (clash) {
                    return { data: null, error: { code: "23505", message: "duplicate" } };
                  }
                  const row: LogRow = { ...payload, log_id: `log-${logs.length + 1}` };
                  logs.push(row);
                  return { data: { log_id: row.log_id }, error: null };
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_column: string, id: string) {
              const outcome = updateErrors.shift() ?? null;
              if (outcome instanceof Error) return Promise.reject(outcome);
              const error = outcome;
              const row = logs.find((item) => item.log_id === id);
              if (row && !error) Object.assign(row, patch);
              return Promise.resolve({ error });
            },
          };
        },
        select() {
          const filters: Array<[string, unknown]> = [];
          const chain = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return chain;
            },
            async maybeSingle() {
              const forced = lookupOutcomes.shift();
              if (forced) return forced;
              const match = logs.find((row) =>
                filters.every(([column, value]) => row[column] === value)
              );
              return { data: match ?? null, error: null };
            },
          };
          return chain;
        },
      };
    },
  };
}

describe("ready for pickup copy", () => {
  it("includes the Toronto address, hours, and SMS opt-out", () => {
    const message = renderReadyForPickupMessage({
      customerName: "Ada",
      workOrderNumber: "WO-100",
      portalLink: "https://service.torontomoto.com/c/token",
    });

    expect(message.sms).toContain(TORONTO_SHOP.streetAddress);
    expect(message.sms).toContain("Mon–Fri 12:00–19:00");
    expect(message.sms).toContain("Sat 10:00–16:00");
    expect(message.sms).toContain("Sun closed");
    expect(message.sms).toContain("Reply STOP to opt out.");
    expect(message.emailHtml).toContain(TORONTO_SHOP.fullAddress);
    expect(message.emailHtml).toContain(TORONTO_SHOP.phoneDisplay);
    expect(message.emailHtml).toContain(TORONTO_SHOP.legalName);
    expect(message.emailHtml).toContain("Mon–Fri 12:00–19:00");
    expect(message.emailText).toContain("Sat 10:00–16:00");
  });

  it("asks with the street address and shop hours", () => {
    expect(pickupNoticePromptBody("Ada Lovelace")).toBe(
      "Text and email Ada Lovelace that their motorcycle is ready at 99 River Street. Hours: Mon–Fri 12:00–19:00, Sat 10:00–16:00, Sun closed."
    );
  });
});

describe("pickup notice prompt", () => {
  it("asks only after a successful drop onto Ready", () => {
    expect(
      shouldPromptPickupNotice({ targetColumnId: "pickup", moveSucceeded: true })
    ).toBe(true);
    expect(
      shouldPromptPickupNotice({ targetColumnId: "gallery_ready", moveSucceeded: true })
    ).toBe(true);
    expect(
      shouldPromptPickupNotice({ targetColumnId: "pickup", moveSucceeded: false })
    ).toBe(false);
    expect(
      shouldPromptPickupNotice({ targetColumnId: "storage", moveSucceeded: true })
    ).toBe(false);
  });

  it("offers send only when both channels can go to the Toronto shop", () => {
    const ready = {
      phone: "6475550100",
      email: "ada@example.com",
      smsOptedOut: false,
      locationCode: "TOR",
    };
    expect(canSendPickupNotice(ready)).toBe(true);
    expect(pickupNoticeBlockers({ ...ready, email: null })).toEqual(["email"]);
    expect(pickupNoticeBlockers({ ...ready, phone: null })).toEqual(["phone"]);
    expect(pickupNoticeBlockers({ ...ready, smsOptedOut: true })).toEqual([]);
    expect(pickupNoticeBlockers({ ...ready, locationCode: "OTT" })).toEqual(["location"]);
    expect(canSendPickupNotice({ ...ready, email: " " })).toBe(false);
  });
});

describe("pickup notice dialog", () => {
  const contact = {
    workOrderId: "wo-1",
    customerName: "Ada Lovelace",
    phone: "6475550100",
    email: "ada@example.com",
    smsOptedOut: false,
  };

  it("offers both channels or nothing", () => {
    const html = renderToStaticMarkup(
      createElement(PickupNoticeDialog, {
        contact,
        locationCode: "TOR",
        onClose: () => undefined,
      })
    );
    expect(html).toContain("Notify the customer?");
    expect(html).toContain("Send SMS &amp; email");
    expect(html).toContain("Don&#x27;t send");
    expect(html).toContain("99 River Street");
    expect(html).toContain("ada@example.com");
    expect(html).toMatch(/Wix Contacts.*authoritative/i);
    expect(html).toMatch(/replies.*only.*Wix Inbox/i);
  });

  it("hides send when a channel is missing", () => {
    const html = renderToStaticMarkup(
      createElement(PickupNoticeDialog, {
        contact: { ...contact, email: null },
        locationCode: "TOR",
        onClose: () => undefined,
      })
    );
    expect(html).not.toContain("Send SMS");
    expect(html).toContain("Don&#x27;t send");
    expect(html).toContain("no email on file");
  });
});

describe("sendReadyForPickupNotice", () => {
  beforeEach(() => {
    logs.length = 0;
    updateErrors.length = 0;
    lookupOutcomes.length = 0;
    vi.clearAllMocks();
    requireUser.mockResolvedValue({
      user_id: "user-1",
      role: "service_advisor",
      active_location_id: "loc-1",
    });
    createClient.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: workOrder(), error: null }),
          }),
        }),
      }),
    });
    createAdminClient.mockReturnValue(adminClient());
    createPortalToken.mockResolvedValue({ token: "token" });
    sendCustomerSms.mockResolvedValue("wix-message-1");
    sendEmail.mockResolvedValue({ id: "email-1" });
    addTimelineEvent.mockResolvedValue(undefined);
  });

  it("sends SMS and email together and records both", async () => {
    const result = await sendReadyForPickupNotice("wo-1");

    expect(result.sms.status).toBe("sent");
    expect(result.email.status).toBe("sent");
    expect(sendCustomerSms).toHaveBeenCalledWith({
      customerId: "cust-1",
      wixContactId: "11111111-1111-4111-8111-111111111111",
      to: "+16475550100",
      body: expect.stringContaining("99 River Street"),
      localOptedOutAt: null,
    });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(logs.map((row) => row.channel).sort()).toEqual(["email", "sms"]);
    expect(logs.every((row) => row.status === "sent")).toBe(true);
    expect(logs.every((row) => row.dedupe_key === "2026-10-30T18:00:00.000Z")).toBe(true);
    expect(String(logs.find((row) => row.channel === "sms")?.body)).toContain(
      "99 River Street"
    );
    expect(logs.find((row) => row.channel === "sms")?.external_id).toBe("wix-message-1");
    expect(logs.find((row) => row.channel === "sms")?.from_address).toBe(
      TORONTO_SHOP.phoneE164
    );
  });

  it("sends nothing when email is missing", async () => {
    createClient.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: workOrder({
                customer: {
                  customer_id: "cust-1",
                  first_name: "Ada",
                  last_name: "Lovelace",
                  phone: "6475550100",
                  email: null,
                  sms_opted_out_at: null,
                },
              }),
              error: null,
            }),
          }),
        }),
      }),
    });

    await expect(sendReadyForPickupNotice("wo-1")).rejects.toThrow(/no email/i);
    expect(sendCustomerSms).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it("does not text again for the same Ready placement", async () => {
    await sendReadyForPickupNotice("wo-1");
    const second = await sendReadyForPickupNotice("wo-1");

    expect(sendCustomerSms).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(second.sms.detail).toMatch(/Already sent/);
    expect(second.email.detail).toMatch(/Already sent/);
    expect(logs.find((row) => row.channel === "sms")?.dedupe_key).toBe(
      "2026-10-30T18:00:00.000Z"
    );
  });

  it.each([
    ["lookup error", { data: null, error: { message: "lookup failed" } }],
    ["missing lookup row", { data: null, error: null }],
  ])("reports an uncertain pickup conflict on %s", async (_name, lookup) => {
    seedPickupSms("sent");
    lookupOutcomes.push(lookup);

    const result = await sendReadyForPickupNotice("wo-1");

    expect(result.sms.status).toBe("uncertain");
    expect(result.sms.detail).toMatch(/Wix Inbox/i);
    expect(result.sms.detail).not.toMatch(/Already sent/i);
    expect(sendCustomerSms).not.toHaveBeenCalled();
  });

  it.each(["queued", "processing"])(
    "reports an existing %s pickup row with no error as uncertain",
    async (status) => {
      seedPickupSms(status);

      const result = await sendReadyForPickupNotice("wo-1");

      expect(result.sms.status).toBe("uncertain");
      expect(result.sms.detail).toMatch(/Wix Inbox/i);
      expect(result.sms.detail).not.toMatch(/Already sent/i);
      expect(sendCustomerSms).not.toHaveBeenCalled();
    }
  );

  it("reports an explicit delivered pickup row as already sent", async () => {
    seedPickupSms("delivered");

    const result = await sendReadyForPickupNotice("wo-1");

    expect(result.sms.status).toBe("sent");
    expect(result.sms.detail).toMatch(/Already sent/i);
    expect(sendCustomerSms).not.toHaveBeenCalled();
  });

  it("still tries email when the text fails", async () => {
    sendCustomerSms.mockRejectedValue(new Error("WIX_INBOX_API_ERROR"));

    const result = await sendReadyForPickupNotice("wo-1");

    expect(result.sms.status).toBe("failed");
    expect(result.email.status).toBe("sent");
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(logs.find((row) => row.channel === "sms")?.status).toBe("failed");
  });

  it("releases a definite failure so the same pickup can retry the provider", async () => {
    let attempts = 0;
    sendCustomerSms.mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("WIX_INBOX_API_ERROR");
      return "wix-message-2";
    });

    const first = await sendReadyForPickupNotice("wo-1");
    const second = await sendReadyForPickupNotice("wo-1");

    expect(first.sms.status).toBe("failed");
    expect(second.sms.status).toBe("sent");
    expect(sendCustomerSms).toHaveBeenCalledTimes(2);
    expect(
      logs.find((row) => row.channel === "sms" && row.status === "failed")?.dedupe_key
    ).toBeNull();
  });

  it("leaves an uncertain text queued and tells staff to inspect Wix Inbox", async () => {
    sendCustomerSms.mockRejectedValue(new Error("WIX_INBOX_SEND_UNCERTAIN"));

    const result = await sendReadyForPickupNotice("wo-1");

    expect(result.sms.status).toBe("uncertain");
    expect(result.sms.detail).toMatch(/Wix Inbox/i);
    expect(result.sms.detail).toMatch(/before.*resend/i);
    expect(result.email.status).toBe("sent");
    expect(logs.find((row) => row.channel === "sms")).toEqual(
      expect.objectContaining({
        status: "queued",
        error_message: "WIX_INBOX_SEND_UNCERTAIN",
        dedupe_key: "2026-10-30T18:00:00.000Z",
      })
    );
  });

  it("blocks a pickup resend while a prior Wix outcome is uncertain", async () => {
    sendCustomerSms.mockRejectedValue(new Error("WIX_INBOX_SEND_UNCERTAIN"));

    await sendReadyForPickupNotice("wo-1");
    const second = await sendReadyForPickupNotice("wo-1");

    expect(second.sms.status).toBe("uncertain");
    expect(second.sms.detail).toMatch(/Wix Inbox/i);
    expect(sendCustomerSms).toHaveBeenCalledOnce();
  });

  it("treats a queued row with no error code as uncertain on the next attempt", async () => {
    updateErrors.push({ message: "sent update failed" }, null);

    const first = await sendReadyForPickupNotice("wo-1");

    expect(first.sms.status).toBe("sent");
    expect(first.sms.detail).toMatch(/reconciliation/i);
    expect(sendCustomerSms).toHaveBeenCalledOnce();
    expect(logs.find((row) => row.channel === "sms")?.status).toBe("queued");
    expect(loggerWarn).toHaveBeenCalledWith(
      "Pickup notice communication log reconciliation failed",
      expect.objectContaining({
        channel: "sms",
        phase: "sent",
        error: "sent update failed",
      })
    );

    const second = await sendReadyForPickupNotice("wo-1");
    expect(second.sms.status).toBe("uncertain");
    expect(second.sms.detail).toMatch(/reconciliation|Wix Inbox/i);
    expect(second.sms.detail).not.toMatch(/Already sent/i);
    expect(sendCustomerSms).toHaveBeenCalledOnce();
  });

  it("retains the provider failure when recording that failure also fails", async () => {
    sendCustomerSms.mockRejectedValue(new Error("WIX_INBOX_API_ERROR"));
    updateErrors.push({ message: "failed update failed" }, null);

    const result = await sendReadyForPickupNotice("wo-1");

    expect(result.sms).toEqual({
      status: "failed",
      detail: "Wix could not send that text message. Try again.",
    });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(loggerWarn).toHaveBeenCalledWith(
      "Pickup notice communication log reconciliation failed",
      expect.objectContaining({
        channel: "sms",
        phase: "failed",
        error: "failed update failed",
      })
    );
  });

  it("does not reclassify an accepted SMS when the log update throws", async () => {
    updateErrors.push(new Error("sent update threw"), null);

    const result = await sendReadyForPickupNotice("wo-1");

    expect(result.sms.status).toBe("sent");
    expect(result.sms.detail).toMatch(/reconciliation/i);
    expect(sendCustomerSms).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("retains the provider failure when the failure-log update throws", async () => {
    sendCustomerSms.mockRejectedValue(new Error("WIX_INBOX_API_ERROR"));
    updateErrors.push(new Error("failed update threw"), null);

    const result = await sendReadyForPickupNotice("wo-1");

    expect(result.sms).toEqual({
      status: "failed",
      detail: "Wix could not send that text message. Try again.",
    });
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("lets Wix reconcile a stale local SMS opt-out", async () => {
    createClient.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: workOrder({
                customer: {
                  customer_id: "cust-1",
                  first_name: "Ada",
                  last_name: "Lovelace",
                  phone: "6475550100",
                  email: "ada@example.com",
                  sms_opted_out_at: "2026-10-01T12:00:00.000Z",
                  wix_contact_id: "11111111-1111-4111-8111-111111111111",
                },
              }),
              error: null,
            }),
          }),
        }),
      }),
    });

    const result = await sendReadyForPickupNotice("wo-1");

    expect(result.sms.status).toBe("sent");
    expect(sendCustomerSms).toHaveBeenCalledWith(
      expect.objectContaining({
        localOptedOutAt: "2026-10-01T12:00:00.000Z",
      })
    );
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("rejects a technician before sending", async () => {
    requireUser.mockResolvedValue({
      user_id: "user-2",
      role: "technician",
      active_location_id: "loc-1",
    });

    await expect(sendReadyForPickupNotice("wo-1")).rejects.toThrow("FORBIDDEN");
    expect(sendCustomerSms).not.toHaveBeenCalled();
  });
});
