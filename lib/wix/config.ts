export type WixContactsConfig = {
  apiKey: string;
  siteId: string;
  accountId: string | null;
  currency: string;
};

export type WixInvoiceBridgeConfig = {
  httpUrl: string;
  httpSecret: string;
  currency: string;
};

export function isWixContactsConfigured(): boolean {
  return Boolean(
    process.env.WIX_API_KEY?.trim() && process.env.WIX_SITE_ID?.trim()
  );
}

export function isWixInvoiceConfigured(): boolean {
  return Boolean(
    process.env.WIX_INVOICE_HTTP_URL?.trim() &&
      process.env.WIX_INVOICE_HTTP_SECRET?.trim()
  );
}

export function isWixWebhookConfigured(): boolean {
  return Boolean(process.env.WIX_WEBHOOK_SECRET?.trim());
}

export function getWixContactsConfig(): WixContactsConfig {
  const apiKey = process.env.WIX_API_KEY?.trim() ?? "";
  const siteId = process.env.WIX_SITE_ID?.trim() ?? "";
  const accountId = process.env.WIX_ACCOUNT_ID?.trim() || null;
  const currency = (process.env.WIX_CURRENCY?.trim() || "CAD").toUpperCase();

  if (!apiKey || !siteId) {
    throw new Error("WIX_NOT_CONFIGURED");
  }

  return { apiKey, siteId, accountId, currency };
}

export function getWixInvoiceBridgeConfig(): WixInvoiceBridgeConfig {
  const httpUrl = process.env.WIX_INVOICE_HTTP_URL?.trim() ?? "";
  const httpSecret = process.env.WIX_INVOICE_HTTP_SECRET?.trim() ?? "";
  const currency = (process.env.WIX_CURRENCY?.trim() || "CAD").toUpperCase();

  if (!httpUrl || !httpSecret) {
    throw new Error("WIX_INVOICE_NOT_CONFIGURED");
  }

  return { httpUrl, httpSecret, currency };
}

export function getWixWebhookSecret(): string {
  const secret = process.env.WIX_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) throw new Error("WIX_WEBHOOK_NOT_CONFIGURED");
  return secret;
}
