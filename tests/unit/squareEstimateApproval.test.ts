import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUser,
  createClient,
  sendWorkOrderMessage,
  createPortalToken,
  addTimelineEvent,
  updates,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  sendWorkOrderMessage: vi.fn(),
  createPortalToken: vi.fn(),
  addTimelineEvent: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/database/supabase-server", () => ({ createClient }));
vi.mock("@/lib/services/communications", () => ({ sendWorkOrderMessage }));
vi.mock("@/lib/services/portal", () => ({ createPortalToken }));
vi.mock("@/lib/timeline/addTimelineEvent", () => ({ addTimelineEvent }));

import { sendWorkOrderEstimateApproval } from "@/lib/services/squareBilling";

describe("sendWorkOrderEstimateApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
    requireUser.mockResolvedValue({
      user_id: "user-1",
      role: "service_advisor",
      active_location_id: "loc-1",
    });
    createClient.mockResolvedValue({
      from(table: string) {
        if (table !== "work_order") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  work_order_id: "wo-1",
                  work_order_number: "WO-100",
                  location_id: "loc-1",
                  status: "new",
                  customer_id: "cust-1",
                  square_invoice_id: null,
                  square_payment_status: null,
                  square_invoice_public_url: null,
                  billing_stage: "draft",
                  billing_collected_cents: 0,
                  estimate_sent_at: null,
                  customer: {
                    customer_id: "cust-1",
                    first_name: "Ada",
                    last_name: "Lovelace",
                    email: "ada@example.com",
                    phone: "6475550100",
                    square_customer_id: null,
                  },
                },
                error: null,
              }),
            }),
          }),
          update(payload: Record<string, unknown>) {
            updates.push(payload);
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    });
  });

  it("propagates message failure without marking the estimate sent", async () => {
    sendWorkOrderMessage.mockRejectedValue(new Error("WIX_INBOX_SEND_UNCERTAIN"));

    await expect(sendWorkOrderEstimateApproval("wo-1", "sms")).rejects.toThrow(
      "WIX_INBOX_SEND_UNCERTAIN"
    );

    expect(updates).toEqual([]);
    expect(createPortalToken).not.toHaveBeenCalled();
    expect(addTimelineEvent).not.toHaveBeenCalled();
  });

  it("marks and records the estimate only after the message succeeds", async () => {
    sendWorkOrderMessage.mockResolvedValue({ log_id: "log-1" });

    await expect(sendWorkOrderEstimateApproval("wo-1", "sms")).resolves.toEqual({
      sent: true,
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual(
      expect.objectContaining({
        billing_stage: "awaiting_approval",
        estimate_sent_at: expect.any(String),
      })
    );
    expect(addTimelineEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        description: "Estimate approval sent for WO-100",
        new_value: { channel: "sms", message_sent: true },
      })
    );
  });
});
