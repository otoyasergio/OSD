import { beforeEach, describe, expect, it, vi } from "vitest";
import { entersSafetyColumn, safetyReadyMessage } from "@/lib/status/safetyReadyText";

const {
  findWixContactByEmailOrPhone,
  createWixContact,
  sendWixInboxSms,
  isWixInboxSmsConfigured,
} = vi.hoisted(() => ({
  findWixContactByEmailOrPhone: vi.fn(),
  createWixContact: vi.fn(),
  sendWixInboxSms: vi.fn(),
  isWixInboxSmsConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/wix/client", () => ({
  findWixContactByEmailOrPhone,
  createWixContact,
}));
vi.mock("@/lib/wix/inbox", () => ({ sendWixInboxSms }));
vi.mock("@/lib/wix/config", () => ({ isWixInboxSmsConfigured }));

import { sendSafetyReadyText } from "@/lib/services/safetyReadySms";
import { PEDRAM_SAFETY_PHONE } from "@/lib/status/safetyReadyText";

const WO = "41111111-1111-4111-8111-111111111111";
const CONTACT = "51111111-1111-4111-8111-111111111111";

function client() {
  return {
    from(table: string) {
      const row =
        table === "work_order"
          ? { motorcycle_id: "bike-1" }
          : table === "motorcycle"
            ? { make: "Yamaha", year: 2022, model: "MT-07" }
            : null;
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return chain;
    },
  };
}

describe("safety ready text", () => {
  beforeEach(() => {
    findWixContactByEmailOrPhone.mockReset();
    createWixContact.mockReset();
    sendWixInboxSms.mockReset();
    isWixInboxSmsConfigured.mockReturnValue(true);
  });

  it("names the bike as make, year, and model", () => {
    expect(safetyReadyMessage({ make: "Yamaha", year: 2022, model: "MT-07" })).toBe(
      "Yamaha 2022 MT-07 is ready for safety"
    );
  });

  it("texts once each time a visit enters the safety column", () => {
    expect(entersSafetyColumn("quality_check", "safety_check")).toBe(true);
    expect(entersSafetyColumn("safety_check", "safety_check")).toBe(false);
    expect(entersSafetyColumn("safety_check", "ready_for_pickup")).toBe(false);
    expect(entersSafetyColumn("ready_for_pickup", "safety_check")).toBe(true);
  });

  it("sends one Wix Inbox text to Pedram and does not create a contact when one exists", async () => {
    findWixContactByEmailOrPhone.mockResolvedValue({ id: CONTACT });
    sendWixInboxSms.mockResolvedValue({ messageId: "m", conversationId: "c" });

    await sendSafetyReadyText(client() as never, WO);

    expect(findWixContactByEmailOrPhone).toHaveBeenCalledWith({
      phone: PEDRAM_SAFETY_PHONE,
    });
    expect(createWixContact).not.toHaveBeenCalled();
    expect(sendWixInboxSms).toHaveBeenCalledTimes(1);
    expect(sendWixInboxSms).toHaveBeenCalledWith({
      contactId: CONTACT,
      body: "Yamaha 2022 MT-07 is ready for safety",
    });
  });

  it("creates a Pedram contact when the phone is new", async () => {
    findWixContactByEmailOrPhone.mockResolvedValue(null);
    createWixContact.mockResolvedValue({ id: CONTACT });
    sendWixInboxSms.mockResolvedValue({ messageId: "m", conversationId: "c" });

    await sendSafetyReadyText(client() as never, WO);

    expect(createWixContact).toHaveBeenCalledWith({
      firstName: "Pedram",
      lastName: "Safety",
      phone: PEDRAM_SAFETY_PHONE,
    });
    expect(sendWixInboxSms).toHaveBeenCalledTimes(1);
  });

  it("lets a failed text surface so the status change can stay", async () => {
    findWixContactByEmailOrPhone.mockResolvedValue({ id: CONTACT });
    sendWixInboxSms.mockRejectedValue(new Error("WIX_INBOX_API_ERROR"));
    await expect(sendSafetyReadyText(client() as never, WO)).rejects.toThrow(
      "WIX_INBOX_API_ERROR"
    );
  });
});
