import { gmailRequest, refreshGmailAccessToken } from "@/lib/email/gmail";
import { textFromPdf } from "@/lib/email/pdfText";
import {
  pdfAttachments,
  textFromGmailMessage,
  type GmailFullMessage,
} from "@/lib/email/scanReport";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_PDF_BYTES = 8_000_000;
const UNREAD_PDF_QUERY = "is:unread filename:pdf";

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
  const response = await gmailRequest(fetchImpl, `${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("SCAN_MAIL_READ_FAILED");
  return response.json();
}

export async function listUnreadPdfMessageIds(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  ids: string[];
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
    `/messages?q=${encodeURIComponent(UNREAD_PDF_QUERY)}&maxResults=10`
  )) as { messages?: Array<{ id?: string }> };
  const ids = (listed.messages ?? []).flatMap((item) => (item.id ? [item.id] : []));
  return { ids, accessToken: token.accessToken, refreshToken: token.refreshToken };
}

export async function readUnreadScanMail(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  skipIds?: string[];
  accessToken?: string;
  messageIds?: string[];
}): Promise<{
  messages: UnreadScanMessage[];
  accessToken: string;
  refreshToken: string | null;
}> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let accessToken = input.accessToken ?? "";
  let refreshToken: string | null = null;
  let ids = input.messageIds;
  if (!ids) {
    const listed = await listUnreadPdfMessageIds(input);
    accessToken = listed.accessToken;
    refreshToken = listed.refreshToken;
    const skip = new Set(input.skipIds ?? []);
    ids = listed.ids.filter((id) => !skip.has(id));
  } else if (!accessToken) {
    const token = await refreshGmailAccessToken({
      refreshToken: input.refreshToken,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      fetchImpl,
    });
    accessToken = token.accessToken;
    refreshToken = token.refreshToken;
  }

  const messages: UnreadScanMessage[] = [];
  for (const id of ids) {
    const full = (await gmailGet(
      fetchImpl,
      accessToken,
      `/messages/${encodeURIComponent(id)}?format=full`
    )) as GmailFullMessage;
    const parsed = textFromGmailMessage(full);
    const attached = await textFromPdfAttachments(fetchImpl, accessToken, id, full);
    const text = [parsed.text.trim(), attached].filter(Boolean).join("\n");
    messages.push({
      id,
      subject: parsed.subject,
      from: parsed.from,
      text,
    });
  }
  return { messages, accessToken, refreshToken };
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
