import { beforeEach, describe, expect, it, vi } from "vitest";
import { TORONTO_SHOP } from "@/lib/shop/toronto";

const {
  requireUser,
  createClient,
  createPortalToken,
  sendCustomerSms,
  addTimelineEvent,
  insertedLogs,
  logUpdates,
  operations,
  updateOutcomes,
  loggerWarn,
  persistedLogs,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  createPortalToken: vi.fn(),
  sendCustomerSms: vi.fn(),
  addTimelineEvent: vi.fn(),
  insertedLogs: [] as Array<Record<string, unknown>>,
  logUpdates: [] as Array<Record<string, unknown>>,
  operations: [] as string[],
  updateOutcomes: [] as Array<{ message: string } | Error | null>,
  loggerWarn: vi.fn(),
  persistedLogs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/database/supabase-server", () => ({ createClient }));
vi.mock("@/lib/services/portal", () => ({ createPortalToken }));
vi.mock("@/lib/services/customerSms", () => ({ sendCustomerSms }));
vi.mock("@/lib/email/send", () => ({
  sendEmail: vi.fn(),
  isEmailConfigured: () => true,
}));
vi.mock("@/lib/timeline/addTimelineEvent", () => ({ addTimelineEvent }));
vi.mock("@/lib/security/logger", () => ({ logger: { warn: loggerWarn } }));
vi.mock("@/lib/portal/tokens", () => ({
  portalUrl: (token: string) => `https://service.torontomoto.com/c/${token}`,
}));

import { sendWorkOrderMessage } from "@/lib/services/communications";

describe("sendWorkOrderMessage Wix SMS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedLogs.length = 0;
    logUpdates.length = 0;
    operations.length = 0;
    updateOutcomes.length = 0;
    persistedLogs.length = 0;
    requireUser.mockResolvedValue({
      user_id: "user-1",
      role: "service_advisor",
      active_location_id: "loc-1",
    });
    createPortalToken.mockResolvedValue({ token: "portal-token" });
    sendCustomerSms.mockImplementation(async () => {
      operations.push("provider");
      return "wix-message-1";
    });
    addTimelineEvent.mockResolvedValue(undefined);
    const lockedDedupeKeys = new Map<string, string>();
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
              operations.push("insert");
              const dedupeKey =
                typeof payload.dedupe_key === "string" ? payload.dedupe_key : null;
              if (
                dedupeKey &&
                Array.from(lockedDedupeKeys.values()).includes(dedupeKey)
              ) {
                return {
                  select: () => ({
                    single: async () => ({
                      data: null,
                      error: { code: "23505", message: "duplicate" },
                    }),
                  }),
                };
              }
              insertedLogs.push(payload);
              persistedLogs.push({ ...payload });
              const logId = `log-${insertedLogs.length}`;
              if (dedupeKey) lockedDedupeKeys.set(logId, dedupeKey);
              return {
                select: () => ({
                  single: async () => ({
                    data: {
                      ...payload,
                      log_id: logId,
                      created_at: "2026-10-31T12:00:00.000Z",
                    },
                    error: null,
                  }),
                }),
              };
            },
            update(payload: Record<string, unknown>) {
              logUpdates.push(payload);
              operations.push("update");
              return {
                eq: async (_column: string, logId: string) => {
                  const outcome = updateOutcomes.shift() ?? null;
                  if (outcome instanceof Error) throw outcome;
                  if (outcome) return { error: outcome };
                  const row = persistedLogs.find(
                    (_item, index) => `log-${index + 1}` === logId
                  );
                  if (row) Object.assign(row, payload);
                  if (payload.dedupe_key === null) lockedDedupeKeys.delete(logId);
                  return { error: null };
                },
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
    expect(operations).toEqual(["insert", "provider", "update"]);
    expect(insertedLogs).toEqual([
      expect.objectContaining({
        channel: "sms",
        status: "queued",
        external_id: null,
        dedupe_key: "work-order:wo-1:sms:approval_request",
        from_address: TORONTO_SHOP.phoneE164,
      }),
    ]);
    expect(logUpdates).toEqual([
      {
        status: "sent",
        external_id: "wix-message-1",
        error_message: null,
        dedupe_key: null,
      },
    ]);
  });

  it("marks a definite Wix rejection failed and propagates it", async () => {
    sendCustomerSms.mockImplementation(async () => {
      operations.push("provider");
      throw new Error("WIX_INBOX_API_ERROR");
    });

    await expect(
      sendWorkOrderMessage({
        work_order_id: "wo-1",
        template_key: "approval_request",
        channel: "sms",
      })
    ).rejects.toThrow("WIX_INBOX_API_ERROR");

    expect(operations).toEqual(["insert", "provider", "update"]);
    expect(insertedLogs[0]).toEqual(
      expect.objectContaining({ status: "queued", error_message: null })
    );
    expect(logUpdates).toEqual([
      {
        status: "failed",
        external_id: null,
        error_message: "WIX_INBOX_API_ERROR",
        dedupe_key: null,
      },
    ]);
    expect(persistedLogs[0]?.dedupe_key).toBeNull();
    expect(addTimelineEvent).not.toHaveBeenCalled();
  });

  it("leaves an uncertain Wix send queued and propagates it", async () => {
    sendCustomerSms.mockImplementation(async () => {
      operations.push("provider");
      throw new Error("WIX_INBOX_SEND_UNCERTAIN");
    });

    await expect(
      sendWorkOrderMessage({
        work_order_id: "wo-1",
        template_key: "approval_request",
        channel: "sms",
      })
    ).rejects.toThrow("WIX_INBOX_SEND_UNCERTAIN");

    expect(operations).toEqual(["insert", "provider", "update"]);
    expect(logUpdates).toEqual([
      {
        status: "queued",
        external_id: null,
        error_message: "WIX_INBOX_SEND_UNCERTAIN",
      },
    ]);
    expect(persistedLogs[0]?.dedupe_key).toBe("work-order:wo-1:sms:approval_request");
    expect(persistedLogs[0]?.status).toBe("queued");
    expect(persistedLogs[0]?.error_message).toBe("WIX_INBOX_SEND_UNCERTAIN");
    expect(addTimelineEvent).not.toHaveBeenCalled();
  });

  it("uses the queued row as an atomic lock across concurrent attempts", async () => {
    let acceptFirst: ((messageId: string) => void) | undefined;
    sendCustomerSms.mockImplementation(() => {
      operations.push("provider");
      return new Promise<string>((resolve) => {
        acceptFirst = resolve;
      });
    });

    const first = sendWorkOrderMessage({
      work_order_id: "wo-1",
      template_key: "approval_request",
      channel: "sms",
    });
    await vi.waitFor(() => expect(sendCustomerSms).toHaveBeenCalledOnce());

    await expect(
      sendWorkOrderMessage({
        work_order_id: "wo-1",
        template_key: "approval_request",
        channel: "sms",
      })
    ).rejects.toThrow("WIX_INBOX_SEND_UNCERTAIN");
    expect(sendCustomerSms).toHaveBeenCalledOnce();

    acceptFirst?.("wix-message-1");
    await expect(first).resolves.toEqual(expect.objectContaining({ status: "sent" }));
  });

  it("returns accepted when sent reconciliation fails and retains the lock", async () => {
    updateOutcomes.push({ message: "sent update failed" });

    await expect(
      sendWorkOrderMessage({
        work_order_id: "wo-1",
        template_key: "approval_request",
        channel: "sms",
      })
    ).resolves.toEqual(expect.objectContaining({ status: "sent" }));

    expect(persistedLogs[0]?.status).toBe("queued");
    expect(persistedLogs[0]?.dedupe_key).toBe("work-order:wo-1:sms:approval_request");
    expect(loggerWarn).toHaveBeenCalledWith(
      "Work-order SMS reconciliation failed",
      expect.objectContaining({ phase: "sent", error: "sent update failed" })
    );
  });

  it("returns accepted and logs a timeline reconciliation failure", async () => {
    addTimelineEvent.mockRejectedValue(new Error("timeline failed"));

    await expect(
      sendWorkOrderMessage({
        work_order_id: "wo-1",
        template_key: "approval_request",
        channel: "sms",
      })
    ).resolves.toEqual(expect.objectContaining({ status: "sent" }));

    expect(loggerWarn).toHaveBeenCalledWith(
      "Work-order SMS reconciliation failed",
      expect.objectContaining({ phase: "timeline", error: "timeline failed" })
    );
  });

  it("keeps an uncertain lock when writing the uncertainty code fails", async () => {
    sendCustomerSms.mockRejectedValue(new Error("WIX_INBOX_SEND_UNCERTAIN"));
    updateOutcomes.push({ message: "uncertain update failed" });

    await expect(
      sendWorkOrderMessage({
        work_order_id: "wo-1",
        template_key: "approval_request",
        channel: "sms",
      })
    ).rejects.toThrow("WIX_INBOX_SEND_UNCERTAIN");

    expect(persistedLogs[0]?.status).toBe("queued");
    expect(persistedLogs[0]?.error_message).toBeNull();
    expect(persistedLogs[0]?.dedupe_key).toBe("work-order:wo-1:sms:approval_request");
    expect(loggerWarn).toHaveBeenCalledWith(
      "Work-order SMS reconciliation failed",
      expect.objectContaining({
        phase: "uncertain",
        error: "uncertain update failed",
      })
    );
  });
});
