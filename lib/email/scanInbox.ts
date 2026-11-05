import { refreshGmailAccessToken } from "@/lib/email/gmail";
import { textFromPdf } from "@/lib/email/pdfText";
import {
  pdfAttachments,
  textFromGmailMessage,
  type GmailFullMessage,
} from "@/lib/email/scanReport";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_PDF_BYTES = 8_000_000;

export type UnreadScanMessage = {
  id: string;
  subject: string;
  from: string;
  text: string;
};

async function gmailGet(
  fetchImpl: typeof fetch,
  accessToken: string,
  path: string
): Promise<unknown> {
  const response = await fetchImpl(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("SCAN_MAIL_READ_FAILED");
  return response.json();
}

export async function readUnreadScanMail(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  messages: UnreadScanMessage[];
  accessToken: string;
  refreshToken: string | null;
}> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = await refreshGmailAccessToken({
    refreshToken: input.refreshToken,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    fetchImpl,
  });
  const listed = (await gmailGet(
    fetchImpl,
    token.accessToken,
    `/messages?q=${encodeURIComponent("is:unread")}&maxResults=10`
  )) as { messages?: Array<{ id?: string }> };

  const messages: UnreadScanMessage[] = [];
  for (const item of listed.messages ?? []) {
    if (!item.id) continue;
    const full = (await gmailGet(
      fetchImpl,
      token.accessToken,
      `/messages/${encodeURIComponent(item.id)}?format=full`
    )) as GmailFullMessage;
    const parsed = textFromGmailMessage(full);
    const attached = await textFromPdfAttachments(
      fetchImpl,
      token.accessToken,
      item.id,
      full
    );
    const text = [parsed.text.trim(), attached].filter(Boolean).join("\n");
    messages.push({
      id: item.id,
      subject: parsed.subject,
      from: parsed.from,
      text,
    });
  }
  return { messages, accessToken: token.accessToken, refreshToken: token.refreshToken };
}

async function textFromPdfAttachments(
  fetchImpl: typeof fetch,
  accessToken: string,
  messageId: string,
  message: GmailFullMessage
): Promise<string> {
  const chunks: string[] = [];
  for (const part of pdfAttachments(message)) {
    let encoded = part.data;
    if (!encoded && part.attachmentId) {
      const attachment = (await gmailGet(
        fetchImpl,
        accessToken,
        `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.attachmentId)}`
      )) as { data?: string };
      encoded = attachment.data ?? null;
    }
    if (!encoded) continue;
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.byteLength === 0 || decoded.byteLength > MAX_PDF_BYTES) continue;
    const bytes = Uint8Array.from(decoded);
    try {
      const text = await textFromPdf(bytes);
      if (text) chunks.push(text);
    } catch {
      // The message stays readable from its body when a PDF cannot be opened.
    }
  }
  return chunks.join("\n");
}

export async function markScanMailRead(input: {
  accessToken: string;
  messageId: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${GMAIL_API}/messages/${encodeURIComponent(input.messageId)}/modify`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!response.ok) throw new Error("SCAN_MAIL_READ_FAILED");
}
