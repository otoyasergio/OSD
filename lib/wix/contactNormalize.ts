import type { WixContact, WixWebhookContactPayload } from "@/lib/wix/types";

export function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export type WixContactMatchFields = {
  wixContactId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
};

/** Extract match/upsert fields from a Wix Contacts API record. */
export function extractWixContactFields(
  contact: WixContact
): WixContactMatchFields | null {
  const wixContactId = contact.id?.trim();
  if (!wixContactId) return null;

  const email =
    normalizeOptional(contact.primaryInfo?.email) ??
    normalizeOptional(contact.info?.emails?.items?.[0]?.email);
  const phone =
    normalizeOptional(contact.primaryInfo?.phone) ??
    normalizeOptional(contact.info?.phones?.items?.[0]?.phone);

  if (!email && !phone) return null;

  return {
    wixContactId,
    firstName: firstNonEmpty(contact.info?.name?.first, "Wix"),
    lastName: firstNonEmpty(contact.info?.name?.last, "Contact"),
    email,
    phone,
  };
}

export function fieldsToWebhookPayload(
  fields: WixContactMatchFields,
  event = "contact.reconciled"
): WixWebhookContactPayload {
  return {
    event,
    contact: {
      id: fields.wixContactId,
      firstName: fields.firstName,
      lastName: fields.lastName,
      email: fields.email,
      phone: fields.phone,
    },
  };
}

export type CustomerMatchRow = {
  customer_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  wix_contact_id: string | null;
};

/**
 * Match order: wix_contact_id, then email (case-insensitive), then phone.
 */
export function findMatchingCustomer<T extends CustomerMatchRow>(
  rows: T[],
  input: { wixContactId: string; email: string | null; phone: string | null }
): T | null {
  const byWixId = rows.find((row) => row.wix_contact_id === input.wixContactId);
  if (byWixId) return byWixId;

  if (input.email) {
    const emailLower = input.email.toLowerCase();
    const byEmail = rows.find((row) => row.email?.trim().toLowerCase() === emailLower);
    if (byEmail) return byEmail;
  }

  if (input.phone) {
    const byPhone = rows.find((row) => row.phone === input.phone);
    if (byPhone) return byPhone;
  }

  return null;
}

function sameOptionalText(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  return (normalizeOptional(left) ?? null) === (normalizeOptional(right) ?? null);
}

/**
 * True when local customer already mirrors the Wix contact fields we sync.
 * Used to skip no-op updates so daily cron can finish under Vercel maxDuration.
 */
export function isCustomerInSyncWithWix(
  existing: CustomerMatchRow,
  fields: WixContactMatchFields
): boolean {
  if (existing.wix_contact_id !== fields.wixContactId) return false;
  if (existing.first_name !== fields.firstName) return false;
  if (existing.last_name !== fields.lastName) return false;

  const nextEmail = fields.email ?? existing.email;
  const nextPhone = fields.phone ?? existing.phone;
  return (
    sameOptionalText(existing.email, nextEmail) &&
    sameOptionalText(existing.phone, nextPhone)
  );
}
