import "server-only";

import { getWixConfig, isWixInboxSmsConfigured } from "@/lib/wix/config";

const WIX_API_BASE = "https://www.wixapis.com";
const WIX_INBOX_TIMEOUT_MS = 20_000;
const PREVIEW_TEXT_MAX_LENGTH = 256;
const WIX_GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WixInboxSmsResult = {
  messageId: string;
  conversationId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireTrimmedId(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(errorCode);
  return value.trim();
}

function requireWixGuid(value: unknown, errorCode: string): string {
  const id = requireTrimmedId(value, errorCode);
  if (!WIX_GUID_PATTERN.test(id)) throw new Error(errorCode);
  return id;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

async function wixInboxFetch(path: string, body: unknown): Promise<unknown> {
  if (!isWixInboxSmsConfigured()) {
    throw new Error("WIX_INBOX_SMS_NOT_CONFIGURED");
  }

  const { apiKey, siteId } = getWixConfig();
  let response: Response;

  try {
    response = await fetch(`${WIX_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        "wix-site-id": siteId,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(WIX_INBOX_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(isTimeoutError(error) ? "WIX_INBOX_TIMEOUT" : "WIX_INBOX_API_ERROR");
  }

  if (!response.ok) {
    // Do not include provider response text: it may echo credentials or message content.
    throw new Error("WIX_INBOX_API_ERROR");
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error("WIX_INBOX_MALFORMED_RESPONSE");
  }
}

export async function getOrCreateWixInboxConversation(
  contactId: string
): Promise<{ conversationId: string }> {
  const validContactId = requireWixGuid(contactId, "WIX_INBOX_INVALID_CONTACT_ID");
  const response = await wixInboxFetch("/inbox/v2/conversations", {
    participantId: { contactId: validContactId },
  });
  if (!isRecord(response) || !isRecord(response.conversation)) {
    throw new Error("WIX_INBOX_MALFORMED_RESPONSE");
  }

  return {
    conversationId: requireWixGuid(
      response.conversation?.id,
      "WIX_INBOX_INVALID_CONVERSATION_ID"
    ),
  };
}

async function sendWixInboxMessage(input: {
  conversationId: string;
  body: string;
}): Promise<string> {
  const conversationId = requireWixGuid(
    input.conversationId,
    "WIX_INBOX_INVALID_CONVERSATION_ID"
  );
  if (!input.body) throw new Error("WIX_INBOX_INVALID_MESSAGE_BODY");

  const response = await wixInboxFetch("/inbox/v2/messages", {
    conversationId,
    sendAs: "CALLER",
    message: {
      direction: "BUSINESS_TO_PARTICIPANT",
      visibility: "BUSINESS_AND_PARTICIPANT",
      targetChannels: ["SMS"],
      content: {
        previewText: input.body.slice(0, PREVIEW_TEXT_MAX_LENGTH),
        basic: { items: [{ text: input.body }] },
      },
    },
  });
  if (!isRecord(response) || !isRecord(response.message)) {
    throw new Error("WIX_INBOX_MALFORMED_RESPONSE");
  }

  return requireTrimmedId(response.message.id, "WIX_INBOX_INVALID_MESSAGE_ID");
}

export async function sendWixInboxSms(input: {
  contactId: string;
  body: string;
}): Promise<WixInboxSmsResult> {
  const { conversationId } = await getOrCreateWixInboxConversation(input.contactId);
  const messageId = await sendWixInboxMessage({
    conversationId,
    body: input.body,
  });

  return { messageId, conversationId };
}
