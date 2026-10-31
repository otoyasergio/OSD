import { beforeEach, describe, expect, it, vi } from "vitest";
import { TORONTO_SHOP } from "@/lib/shop/toronto";

const {
  requireUser,
  createClient,
  createPortalToken,
  sendCustomerSms,
  sendSms,
  addTimelineEvent,
  insertedLogs,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  createPortalToken: vi.fn(),
  sendCustomerSms: vi.fn(),
  sendSms: vi.fn(),
  addTimelineEvent: vi.fn(),
  insertedLogs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/database/supabase-server", () => ({ createClient }));
vi.mock("@/lib/services/portal", () => ({ createPortalToken }));
vi.mock("@/lib/services/customerSms", () => ({ sendCustomerSms }));
vi.mock("@/lib/twilio/client", () => ({
  sendSms,
  isTwilioConfigured: () => true,
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: vi.fn(),
  isEmailConfigured: () => true,
}));
vi.mock("@/lib/timeline/addTimelineEvent", () => ({ addTimelineEvent }));
vi.mock("@/lib/portal/tokens", () => ({
  portalUrl: (token: string) => `https://service.torontomoto.com/c/${token}`,
}));

import { sendWorkOrderMessage } from "@/lib/services/communications";

describe("sendWorkOrderMessage Wix SMS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedLogs.length = 0;
    requireUser.mockResolvedValue({
      user_id: "user-1",
      role: "service_advisor",
      active_location_id: "loc-1",
    });
    createPortalToken.mockResolvedValue({ token: "portal-token" });
    sendCustomerSms.mockResolvedValue("wix-message-1");
    sendSms.mockResolvedValue({ sid: "SM-legacy" });
    addTimelineEvent.mockResolvedValue(undefined);
    createClient.mockResolvedValue({
      from(table: string) {
        if (table === "work_order") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    work_order_id: "wo-1",
                    work_order_number: "WO-100",
                    location_id: "loc-1",
                    customer: {
                      customer_id: "cust-1",
                      first_name: "Ada",
                      last_name: "Lovelace",
                      phone: "6475550100",
                      email: "ada@example.com",
                      sms_opted_out_at: null,
                      wix_contact_id: "11111111-1111-4111-8111-111111111111",
                    },
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "communication_log") {
          return {
            insert(payload: Record<string, unknown>) {
              insertedLogs.push(payload);
              return {
                select: () => ({
                  single: async () => ({
                    data: {
                      ...payload,
                      log_id: "log-1",
                      created_at: "2026-10-31T12:00:00.000Z",
                    },
                    error: null,
                  }),
                }),
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    });
  });

  it("sends through Wix and logs the Wix message ID and shop number", async () => {
    await sendWorkOrderMessage({
      work_order_id: "wo-1",
      template_key: "approval_request",
      channel: "sms",
    });

    expect(sendCustomerSms).toHaveBeenCalledWith({
      customerId: "cust-1",
      wixContactId: "11111111-1111-4111-8111-111111111111",
      to: "6475550100",
      body: expect.stringContaining("Reply STOP to opt out."),
      localOptedOutAt: null,
    });
    expect(sendSms).not.toHaveBeenCalled();
    expect(insertedLogs).toEqual([
      expect.objectContaining({
        channel: "sms",
        status: "sent",
        external_id: "wix-message-1",
        from_address: TORONTO_SHOP.phoneE164,
      }),
    ]);
  });
});
