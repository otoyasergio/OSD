import { SCAN_REPORT_ADDRESS } from "@/lib/email/scanReport";
import { TORONTO_SHOP } from "@/lib/shop/toronto";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

export function gmailAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: `${GMAIL_SEND_SCOPE} ${GMAIL_EMAIL_SCOPE}`,
    access_type: "offline",
    prompt: "consent select_account",
    state: input.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Read-only consent for diagnostics@torontomoto.com. This token cannot send mail. */
export function scanGmailAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  loginHint?: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: `${GMAIL_READONLY_SCOPE} ${GMAIL_EMAIL_SCOPE}`,
    access_type: "offline",
    prompt: "consent select_account",
    login_hint: input.loginHint ?? SCAN_REPORT_ADDRESS,
    state: input.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodeSubject(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function encodeBody(value: string): string {
  const base64 = Buffer.from(value, "utf8").toString("base64");
  return base64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

/** RFC 5322 message. Gmail rejects a From address that is not the connected mailbox. */
export function buildGmailMime(input: {
  fromAddress: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  fromName?: string;
  boundary?: string;
}): string {
  const fromAddress = sanitizeHeader(input.fromAddress);
  const to = sanitizeHeader(input.to);
  const subject = sanitizeHeader(input.subject);
  const fromName = sanitizeHeader(input.fromName ?? TORONTO_SHOP.legalName).replaceAll(
    '"',
    ""
  );
  if (!fromAddress.includes("@") || !to.includes("@")) {
    throw new Error("EMAIL_ADDRESS_INVALID");
  }

  const boundary = input.boundary ?? `otomoto_${crypto.randomUUID().replaceAll("-", "")}`;
  return [
    `From: "${fromName}" <${fromAddress}>`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeBody(input.text),
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeBody(input.html),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export function toGmailRaw(mime: string): string {
  return Buffer.from(mime, "utf8").toString("base64url");
}

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  id?: string;
  email?: string;
  error?: string | { status?: string; message?: string };
};

const GMAIL_TIMEOUT_MS = 15_000;
const GMAIL_RETRY_TIMEOUT_MS = 45_000;
const RETRYABLE_GMAIL_STATUS = new Set([500, 502, 503, 504]);

function failureCode(payload: TokenPayload | null): string {
  const error = payload?.error;
  if (error === "invalid_grant") return "GMAIL_RECONNECT_REQUIRED";
  if (typeof error === "object" && error?.status === "UNAUTHENTICATED") {
    return "GMAIL_RECONNECT_REQUIRED";
  }
  return "EMAIL_SEND_FAILED";
}

function isGmailTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

/**
 * One extra try when Google hangs or returns a server error. The second
 * attempt gets a longer timeout so a large weekly report can finish.
 */
export async function gmailRequest(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const timeouts = [GMAIL_TIMEOUT_MS, GMAIL_RETRY_TIMEOUT_MS];
  let lastError: unknown;
  for (let attempt = 0; attempt < timeouts.length; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(timeouts[attempt]!),
      });
      if (RETRYABLE_GMAIL_STATUS.has(response.status) && attempt === 0) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!isGmailTimeout(error) || attempt === timeouts.length - 1) throw error;
    }
  }
  throw lastError;
}

async function readJson(response: Response): Promise<TokenPayload | null> {
  try {
    return (await response.json()) as TokenPayload;
  } catch {
    return null;
  }
}

export async function refreshGmailAccessToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl: typeof fetch;
}): Promise<{ accessToken: string; refreshToken: string | null }> {
  const response = await gmailRequest(
    input.fetchImpl,
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        refresh_token: input.refreshToken,
        grant_type: "refresh_token",
      }),
    }
  );
  const payload = await readJson(response);
  if (!response.ok || !payload?.access_token) {
    throw new Error(failureCode(payload));
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
  };
}

export async function exchangeGmailAuthorizationCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<{ refreshToken: string; emailAddress: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await readJson(response);
  if (!response.ok || !payload?.access_token) throw new Error(failureCode(payload));
  if (!payload.refresh_token) throw new Error("GMAIL_RECONNECT_REQUIRED");

  const profileResponse = await fetchImpl(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: { Authorization: `Bearer ${payload.access_token}` },
      signal: AbortSignal.timeout(15_000),
    }
  );
  const profile = await readJson(profileResponse);
  const emailAddress = profile?.email?.trim().toLowerCase() ?? "";
  if (!profileResponse.ok || !emailAddress.includes("@")) {
    throw new Error("EMAIL_ADDRESS_INVALID");
  }
  return { refreshToken: payload.refresh_token, emailAddress };
}

/** Best-effort. A failed revoke does not mean the stored row is still usable. */
export async function revokeGmailRefreshToken(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  await fetchImpl("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
    signal: AbortSignal.timeout(15_000),
  });
}

export async function sendGmailApiMessage(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fromAddress: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ id: string; refreshToken: string | null }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = await refreshGmailAccessToken({
    refreshToken: input.refreshToken,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    fetchImpl,
  });
  const raw = toGmailRaw(
    buildGmailMime({
      fromAddress: input.fromAddress,
      fromName: input.fromName,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    })
  );
  const response = await gmailRequest(
    fetchImpl,
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    }
  );
  const payload = await readJson(response);
  if (!response.ok || !payload?.id) {
    throw new Error(failureCode(payload));
  }
  return { id: payload.id, refreshToken: token.refreshToken };
}
