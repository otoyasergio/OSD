import { createHmac, timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Square signs: HMAC-SHA256(notificationUrl + rawBody) → base64
 * Header: x-square-hmacsha256-signature
 */
export function verifySquareWebhookSignature(params: {
  rawBody: string;
  signatureHeader: string | null;
  signatureKey: string;
  notificationUrl: string;
}): boolean {
  const { rawBody, signatureHeader, signatureKey, notificationUrl } = params;
  if (!signatureHeader || !signatureKey || !notificationUrl) return false;

  const expected = createHmac("sha256", signatureKey)
    .update(notificationUrl + rawBody)
    .digest("base64");

  return safeEqual(signatureHeader, expected);
}

/**
 * Twilio signs: HMAC-SHA1(url + sorted form params as key=value) → base64
 * Header: X-Twilio-Signature
 */
export function verifyTwilioWebhookSignature(params: {
  url: string;
  params: Record<string, string>;
  signatureHeader: string | null;
  authToken: string;
}): boolean {
  const { url, params: formParams, signatureHeader, authToken } = params;
  if (!signatureHeader || !authToken) return false;

  const sortedKeys = Object.keys(formParams).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + formParams[key];
  }

  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  return safeEqual(signatureHeader, expected);
}

export function getPublicRequestUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) {
    const path = new URL(request.url).pathname;
    return `${configured}${path}`;
  }
  return request.url.split("?")[0] ?? request.url;
}
