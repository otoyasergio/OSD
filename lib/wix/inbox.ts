import "server-only";

import { getWixConfig, isWixInboxSmsConfigured } from "@/lib/wix/config";

const WIX_API_BASE = "https://www.wixapis.com";
const WIX_INBOX_TIMEOUT_MS = 20_000;
const PREVIEW_TEXT_MAX_LENGTH = 256;

type WixConversationResponse = {
  conversation?: {
    id?: unknown;
  };
};

type WixMessageResponse = {
  message?: {
    id?: unknown;
  };
};

export type WixInboxSmsResult = {
  messageId: string;
  conversationId: string;
};

function requireNonEmptyId(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(errorCode);
  return value;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

async function wixInboxFetch<T>(path: string, body: unknown): Promise<T> {
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
    return (await response.json()) as T;
  } catch {
    throw new Error("WIX_INBOX_API_ERROR");
  }
}

export async function getOrCreateWixInboxConversation(
  contactId: string
): Promise<{ conversationId: string }> {
  const validContactId = requireNonEmptyId(contactId, "WIX_INBOX_INVALID_CONTACT_ID");
  const response = await wixInboxFetch<WixConversationResponse>(
    "/inbox/v2/conversations",
    { participantId: { contactId: validContactId } }
  );

  return {
    conversationId: requireNonEmptyId(
      response.conversation?.id,
      "WIX_INBOX_INVALID_CONVERSATION_ID"
    ),
  };
}

async function sendWixInboxMessage(input: {
  conversationId: string;
  body: string;
}): Promise<string> {
  const conversationId = requireNonEmptyId(
    input.conversationId,
    "WIX_INBOX_INVALID_CONVERSATION_ID"
  );
  if (!input.body) throw new Error("WIX_INBOX_INVALID_MESSAGE_BODY");

  const response = await wixInboxFetch<WixMessageResponse>("/inbox/v2/messages", {
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

  return requireNonEmptyId(response.message?.id, "WIX_INBOX_INVALID_MESSAGE_ID");
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
