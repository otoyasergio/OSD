export function getWixConfig(): {
  apiKey: string;
  siteId: string;
  webhookSecret: string;
} {
  const apiKey = process.env.WIX_API_KEY ?? "";
  const siteId = process.env.WIX_SITE_ID ?? "";
  const webhookSecret = process.env.WIX_WEBHOOK_SECRET ?? "";

  if (!apiKey || !siteId) throw new Error("WIX_NOT_CONFIGURED");

  return { apiKey, siteId, webhookSecret };
}

export function isWixConfigured(): boolean {
  return Boolean(
    process.env.WIX_API_KEY?.trim() && process.env.WIX_SITE_ID?.trim()
  );
}

async function wixFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const config = getWixConfig();
  const response = await fetch(`https://www.wixapis.com${path}`, {
    ...init,
    headers: {
      Authorization: config.apiKey,
      "Content-Type": "application/json",
      "wix-site-id": config.siteId,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WIX_API_ERROR: ${text.slice(0, 200)}`);
  }

  return response.json() as Promise<T>;
}

export type WixBookingPayload = {
  bookingId: string;
  contactId?: string;
  serviceName?: string;
  startDate?: string;
  endDate?: string;
  contact?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  };
  formInfo?: Record<string, string>;
};

export async function getWixBooking(bookingId: string): Promise<WixBookingPayload> {
  const data = await wixFetch<{ booking: Record<string, unknown> }>(
    `/bookings/v2/bookings/${bookingId}`
  );
  const booking = data.booking;
  return {
    bookingId,
    contactId: booking.contactId as string | undefined,
    serviceName: (booking.bookedEntity as { name?: string })?.name,
    startDate: booking.startDate as string | undefined,
    endDate: booking.endDate as string | undefined,
  };
}

export { wixFetch };
