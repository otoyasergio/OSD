import { afterEach, describe, expect, it, vi } from "vitest";
import { getWixContactV5 } from "@/lib/wix/client";
import { isWixInboxSmsConfigured } from "@/lib/wix/config";
import { getOrCreateWixInboxConversation, sendWixInboxSms } from "@/lib/wix/inbox";
import { TORONTO_SHOP } from "@/lib/shop/toronto";

const WIX_ENV_KEYS = ["WIX_API_KEY", "WIX_SITE_ID", "WIX_INBOX_SMS_ENABLED"] as const;
const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_ID = "1234567890";

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
      sendWixInboxSms({ contactId: CONTACT_ID, body: "Service update" })
    ).rejects.toThrow("WIX_INBOX_SMS_NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gets or creates the contact conversation with Wix API-key headers", async () => {
    configureWixInboxSms();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ conversation: { id: ` ${CONVERSATION_ID} ` } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOrCreateWixInboxConversation(` ${CONTACT_ID} `)).resolves.toEqual({
      conversationId: CONVERSATION_ID,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.wixapis.com/inbox/v2/conversations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      participantId: { contactId: CONTACT_ID },
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
        json: async () => ({ conversation: { id: CONVERSATION_ID } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { id: ` ${MESSAGE_ID} ` } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendWixInboxSms({ contactId: CONTACT_ID, body: longBody })
    ).resolves.toEqual({
      messageId: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
    });

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://www.wixapis.com/inbox/v2/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      conversationId: CONVERSATION_ID,
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
    await expect(getOrCreateWixInboxConversation("not-a-guid")).rejects.toThrow(
      "WIX_INBOX_INVALID_CONTACT_ID"
    );

    const missingConversation = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ conversation: {} }),
    });
    vi.stubGlobal("fetch", missingConversation);
    await expect(getOrCreateWixInboxConversation(CONTACT_ID)).rejects.toThrow(
      "WIX_INBOX_INVALID_CONVERSATION_ID"
    );

    const malformedConversation = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ conversation: { id: "not-a-guid" } }),
    });
    vi.stubGlobal("fetch", malformedConversation);
    await expect(getOrCreateWixInboxConversation(CONTACT_ID)).rejects.toThrow(
      "WIX_INBOX_INVALID_CONVERSATION_ID"
    );

    const missingMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conversation: { id: CONVERSATION_ID } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { id: 123 } }),
      });
    vi.stubGlobal("fetch", missingMessage);
    await expect(
      sendWixInboxSms({ contactId: CONTACT_ID, body: "Service update" })
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
      contactId: CONTACT_ID,
      body: secretBody,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("WIX_INBOX_API_ERROR");
    expect((error as Error).message).not.toContain("test-api-key");
    expect((error as Error).message).not.toContain(secretBody);
  });

  it("maps request timeouts to a stable sanitized error", async () => {
    configureWixInboxSms();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(new DOMException("provider included secrets", "AbortError"))
    );

    await expect(
      sendWixInboxSms({ contactId: CONTACT_ID, body: "private body" })
    ).rejects.toThrow("WIX_INBOX_TIMEOUT");
    expect(timeoutSpy).toHaveBeenCalledWith(20_000);
  });

  it.each([
    ["null", null, "WIX_INBOX_MALFORMED_RESPONSE"],
    ["an array", [], "WIX_INBOX_MALFORMED_RESPONSE"],
    ["a missing conversation", {}, "WIX_INBOX_MALFORMED_RESPONSE"],
    ["a null conversation", { conversation: null }, "WIX_INBOX_MALFORMED_RESPONSE"],
    [
      "a wrong conversation ID type",
      { conversation: { id: 42 } },
      "WIX_INBOX_INVALID_CONVERSATION_ID",
    ],
  ])(
    "sanitizes a successful conversation response containing %s",
    async (_, body, code) => {
      configureWixInboxSms();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => body,
        })
      );

      await expect(getOrCreateWixInboxConversation(CONTACT_ID)).rejects.toThrow(code);
    }
  );

  it.each([
    ["null", null, "WIX_INBOX_MALFORMED_RESPONSE"],
    ["an array", [], "WIX_INBOX_MALFORMED_RESPONSE"],
    ["a missing message", {}, "WIX_INBOX_MALFORMED_RESPONSE"],
    ["a null message", { message: null }, "WIX_INBOX_MALFORMED_RESPONSE"],
    ["a wrong message ID type", { message: { id: 42 } }, "WIX_INBOX_INVALID_MESSAGE_ID"],
  ])("sanitizes a successful message response containing %s", async (_, body, code) => {
    configureWixInboxSms();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conversation: { id: CONVERSATION_ID } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => body,
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendWixInboxSms({ contactId: CONTACT_ID, body: "Service update" })
    ).rejects.toThrow(code);
  });

  it("maps malformed successful JSON to a stable sanitized error", async () => {
    configureWixInboxSms();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("response included private provider data");
        },
      })
    );

    await expect(getOrCreateWixInboxConversation(CONTACT_ID)).rejects.toThrow(
      "WIX_INBOX_MALFORMED_RESPONSE"
    );
  });
});

describe("getWixContactV5", () => {
  it("maps the main phone consent and deliverability fields", async () => {
    configureWixInboxSms();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        contact: {
          id: CONTACT_ID,
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

    await expect(getWixContactV5(` ${CONTACT_ID} `)).resolves.toEqual({
      id: CONTACT_ID,
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
      `https://www.wixapis.com/contacts/v5/contacts/${CONTACT_ID}`,
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("maps HTTP failures without exposing the provider response", async () => {
    configureWixInboxSms();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          message: "provider echoed test-api-key and customer details",
        }),
      })
    );

    await expect(getWixContactV5(CONTACT_ID)).rejects.toThrow("WIX_CONTACT_API_ERROR");
  });

  it("rejects nonblank malformed linked contact IDs before fetching", async () => {
    configureWixInboxSms();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getWixContactV5("not-a-guid")).rejects.toThrow("WIX_CONTACT_INVALID_ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps network failures to a stable sanitized error", async () => {
    configureWixInboxSms();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network included test-api-key"))
    );

    await expect(getWixContactV5(CONTACT_ID)).rejects.toThrow("WIX_CONTACT_API_ERROR");
  });

  it("requests a 20 second timeout and maps timeout failures", async () => {
    configureWixInboxSms();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"))
    );

    await expect(getWixContactV5(CONTACT_ID)).rejects.toThrow("WIX_CONTACT_TIMEOUT");
    expect(timeoutSpy).toHaveBeenCalledWith(20_000);
  });

  it("maps malformed JSON to a stable malformed-response error", async () => {
    configureWixInboxSms();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("provider included private data");
        },
      })
    );

    await expect(getWixContactV5(CONTACT_ID)).rejects.toThrow(
      "WIX_CONTACT_MALFORMED_RESPONSE"
    );
  });

  it.each([
    null,
    [],
    {},
    { contact: null },
    { contact: { id: 42 } },
    { contact: { id: "not-a-guid" } },
  ])("maps malformed V5 envelopes to a stable error", async (body) => {
    configureWixInboxSms();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => body,
      })
    );

    await expect(getWixContactV5(CONTACT_ID)).rejects.toThrow(
      "WIX_CONTACT_MALFORMED_RESPONSE"
    );
  });
});

describe("Toronto shop phone", () => {
  it("publishes the Wix Business Phone Number in E.164 format", () => {
    expect(TORONTO_SHOP.phoneE164).toBe("+16474241088");
  });
});
