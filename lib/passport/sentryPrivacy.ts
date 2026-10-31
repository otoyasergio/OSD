const PASSPORT_TOKEN_PATH = /\/p\/[^/?#\s"]+/;
const PASSPORT_TOKEN_PATH_GLOBAL = /\/p\/[^/?#\s"]+/g;

export function redactPassportTokens(value: string): string {
  return value.replace(PASSPORT_TOKEN_PATH_GLOBAL, "/p/[redacted]");
}

function containsPassportToken(value: unknown): boolean {
  return typeof value === "string" && PASSPORT_TOKEN_PATH.test(value);
}

export function filterPassportSentryEvent<T>(event: T, currentUrl?: string): T | null {
  const record = event as {
    request?: { url?: string };
    transaction?: string;
  };
  if (
    containsPassportToken(currentUrl) ||
    containsPassportToken(record.request?.url) ||
    containsPassportToken(record.transaction)
  ) {
    return null;
  }

  try {
    const serialized = JSON.stringify(event);
    if (!serialized.includes("/p/")) return event;
    return JSON.parse(redactPassportTokens(serialized)) as T;
  } catch {
    // If an unexpected event cannot be inspected, dropping it is safer than
    // risking retention of a bearer token.
    return null;
  }
}
