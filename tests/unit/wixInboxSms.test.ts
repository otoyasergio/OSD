import { afterEach, describe, expect, it, vi } from "vitest";
import { getWixContactV5 } from "@/lib/wix/client";
import { isWixInboxSmsConfigured } from "@/lib/wix/config";
import { getOrCreateWixInboxConversation, sendWixInboxSms } from "@/lib/wix/inbox";
import { TORONTO_SHOP } from "@/lib/shop/toronto";

const WIX_ENV_KEYS = ["WIX_API_KEY", "WIX_SITE_ID", "WIX_INBOX_SMS_ENABLED"] as const;

function clearWixEnv() {
  for (const key of WIX_ENV_KEYS) delete process.env[key];
}

function configureWixInboxSms() {
  process.env.WIX_API_KEY = "test-api-key";
  process.env.WIX_SITE_ID = "test-site-id";
  process.env.WIX_INBOX_SMS_ENABLED = "1";
}

afterEach(() => {
  clearWixEnv();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isWixInboxSmsConfigured", () => {
  it("fails closed unless credentials and the exact server flag are present", () => {
    clearWixEnv();
    expect(isWixInboxSmsConfigured()).toBe(false);

    process.env.WIX_API_KEY = "key";
    process.env.WIX_SITE_ID = "site";
    expect(isWixInboxSmsConfigured()).toBe(false);

    process.env.WIX_INBOX_SMS_ENABLED = "true";
    expect(isWixInboxSmsConfigured()).toBe(false);

    process.env.WIX_API_KEY = " ";
    process.env.WIX_INBOX_SMS_ENABLED = "1";
    expect(isWixInboxSmsConfigured()).toBe(false);

    process.env.WIX_API_KEY = "key";
    expect(isWixInboxSmsConfigured()).toBe(true);
  });
});

describe("Wix Inbox SMS", () => {
  it("does not call Wix when the SMS feature is disabled", async () => {
    process.env.WIX_API_KEY = "test-api-key";
    process.env.WIX_SITE_ID = "test-site-id";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendWixInboxSms({ contactId: "contact-1", body: "Service update" })
    ).rejects.toThrow("WIX_INBOX_SMS_NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gets or creates the contact conversation with Wix API-key headers", async () => {
    configureWixInboxSms();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ conversation: { id: "conversation-1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOrCreateWixInboxConversation("contact-1")).resolves.toEqual({
      conversationId: "conversation-1",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.wixapis.com/inbox/v2/conversations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      participantId: { contactId: "contact-1" },
    });
    expect(new Headers(init.headers).get("Authorization")).toBe("test-api-key");
    expect(new Headers(init.headers).get("wix-site-id")).toBe("test-site-id");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends an SMS payload and maps Wix message and conversation IDs", async () => {
    configureWixInboxSms();
    const longBody = "x".repeat(300);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conversation: { id: "conversation-1" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { id: "message-1" } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendWixInboxSms({ contactId: "contact-1", body: longBody })
    ).resolves.toEqual({
      messageId: "message-1",
      conversationId: "conversation-1",
    });

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://www.wixapis.com/inbox/v2/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      conversationId: "conversation-1",
      sendAs: "CALLER",
      message: {
        direction: "BUSINESS_TO_PARTICIPANT",
        visibility: "BUSINESS_AND_PARTICIPANT",
        targetChannels: ["SMS"],
        content: {
          previewText: "x".repeat(256),
          basic: { items: [{ text: longBody }] },
        },
      },
    });
  });

  it("rejects missing input and malformed provider IDs", async () => {
    configureWixInboxSms();
    await expect(getOrCreateWixInboxConversation(" ")).rejects.toThrow(
      "WIX_INBOX_INVALID_CONTACT_ID"
    );

    const missingConversation = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ conversation: {} }),
    });
    vi.stubGlobal("fetch", missingConversation);
    await expect(getOrCreateWixInboxConversation("contact-1")).rejects.toThrow(
      "WIX_INBOX_INVALID_CONVERSATION_ID"
    );

    const missingMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conversation: { id: "conversation-1" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { id: 123 } }),
      });
    vi.stubGlobal("fetch", missingMessage);
    await expect(
      sendWixInboxSms({ contactId: "contact-1", body: "Service update" })
    ).rejects.toThrow("WIX_INBOX_INVALID_MESSAGE_ID");
  });

  it("maps provider failures without exposing credentials or message text", async () => {
    configureWixInboxSms();
    const secretBody = "private service update";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () =>
          `provider echoed test-api-key and ${secretBody} in its response`,
      })
    );

    const error = await sendWixInboxSms({
      contactId: "contact-1",
      body: secretBody,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("WIX_INBOX_API_ERROR");
    expect((error as Error).message).not.toContain("test-api-key");
    expect((error as Error).message).not.toContain(secretBody);
  });

  it("maps request timeouts to a stable sanitized error", async () => {
    configureWixInboxSms();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(new DOMException("provider included secrets", "TimeoutError"))
    );

    await expect(
      sendWixInboxSms({ contactId: "contact-1", body: "private body" })
    ).rejects.toThrow("WIX_INBOX_TIMEOUT");
  });
});

describe("getWixContactV5", () => {
  it("maps the main phone consent and deliverability fields", async () => {
    configureWixInboxSms();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        contact: {
          id: "contact-1",
          updatedDate: "2026-10-31T12:00:00.000Z",
          phone: {
            e164: "+14165550100",
            subscriptionStatus: {
              status: "UNSUBSCRIBED",
              updatedDate: "2026-10-30T12:00:00.000Z",
            },
            deliverabilityStatus: "VALID",
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getWixContactV5("contact-1")).resolves.toEqual({
      id: "contact-1",
      updatedDate: "2026-10-31T12:00:00.000Z",
      phone: {
        e164: "+14165550100",
        subscriptionStatus: {
          status: "UNSUBSCRIBED",
          updatedDate: "2026-10-30T12:00:00.000Z",
        },
        deliverabilityStatus: "VALID",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.wixapis.com/contacts/v5/contacts/contact-1",
      expect.objectContaining({ cache: "no-store" })
    );
  });
});

describe("Toronto shop phone", () => {
  it("publishes the Wix Business Phone Number in E.164 format", () => {
    expect(TORONTO_SHOP.phoneE164).toBe("+16474241088");
  });
});
