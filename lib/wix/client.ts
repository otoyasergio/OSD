import { getWixContactsConfig } from "@/lib/wix/config";
import type { WixContact, WixContactInfo } from "@/lib/wix/types";

const WIX_API_BASE = "https://www.wixapis.com";
const WIX_CONTACT_TIMEOUT_MS = 20_000;
const WIX_GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type WixErrorBody = {
  message?: string;
  details?: { applicationError?: { code?: string; description?: string } };
};

async function wixFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { apiKey, siteId, accountId } = getWixContactsConfig();
  const headers = new Headers(init.headers);
  headers.set("Authorization", apiKey);
  headers.set("wix-site-id", siteId);
  headers.set("Content-Type", "application/json");
  if (accountId) headers.set("wix-account-id", accountId);

  return fetch(`${WIX_API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    // A hung socket here would otherwise burn the whole 300s cron budget.
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
}

async function readWixError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as WixErrorBody;
    return (
      body.details?.applicationError?.description ||
      body.details?.applicationError?.code ||
      body.message ||
      `WIX_HTTP_${response.status}`
    );
  } catch {
    return `WIX_HTTP_${response.status}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/**
 * Contacts V5 is used for live SMS consent checks, so its failures must never
 * expose provider response bodies. Keep V4 on the existing transport above.
 */
async function wixV5Fetch(path: string): Promise<unknown> {
  const { apiKey, siteId, accountId } = getWixContactsConfig();
  const headers = new Headers();
  headers.set("Authorization", apiKey);
  headers.set("wix-site-id", siteId);
  headers.set("Content-Type", "application/json");
  if (accountId) headers.set("wix-account-id", accountId);

  let response: Response;
  try {
    response = await fetch(`${WIX_API_BASE}${path}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(WIX_CONTACT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      isTimeoutError(error) ? "WIX_CONTACT_TIMEOUT" : "WIX_CONTACT_API_ERROR"
    );
  }

  if (response.status === 404) throw new Error("WIX_CONTACT_NOT_FOUND");
  if (!response.ok) throw new Error("WIX_CONTACT_API_ERROR");

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error("WIX_CONTACT_MALFORMED_RESPONSE");
  }
}

export function buildWixContactInfo(input: {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
}): WixContactInfo {
  const info: WixContactInfo = {
    name: {
      first: input.firstName.trim(),
      last: input.lastName.trim(),
    },
  };

  const email = input.email?.trim();
  if (email) {
    info.emails = {
      items: [{ tag: "MAIN", email, primary: true }],
    };
  }

  const phone = input.phone?.trim();
  if (phone) {
    info.phones = {
      items: [{ tag: "MOBILE", phone, primary: true }],
    };
  }

  return info;
}

export async function createWixContact(input: {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  allowDuplicates?: boolean;
}): Promise<WixContact> {
  const response = await wixFetch("/contacts/v4/contacts", {
    method: "POST",
    body: JSON.stringify({
      info: buildWixContactInfo(input),
      allowDuplicates: input.allowDuplicates ?? false,
    }),
  });

  if (!response.ok) {
    throw new Error(await readWixError(response));
  }

  const body = (await response.json()) as { contact: WixContact };
  return body.contact;
}

export async function updateWixContact(
  contactId: string,
  input: {
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    revision?: number;
  }
): Promise<WixContact> {
  let revision = input.revision;
  if (revision == null) {
    const existing = await getWixContact(contactId);
    revision = existing.revision ?? 0;
  }

  const response = await wixFetch(`/contacts/v4/contacts/${contactId}`, {
    method: "PATCH",
    body: JSON.stringify({
      revision,
      info: buildWixContactInfo(input),
    }),
  });

  if (!response.ok) {
    throw new Error(await readWixError(response));
  }

  const body = (await response.json()) as { contact: WixContact };
  return body.contact;
}

export async function getWixContact(contactId: string): Promise<WixContact> {
  const response = await wixFetch(`/contacts/v4/contacts/${contactId}`);
  if (response.status === 404) throw new Error("WIX_CONTACT_NOT_FOUND");
  if (!response.ok) throw new Error(await readWixError(response));
  const body = (await response.json()) as { contact: WixContact };
  return body.contact;
}

export type WixContactV5SubscriptionStatus =
  "NO_SUBSCRIPTION_STATUS" | "NOT_SET" | "PENDING" | "SUBSCRIBED" | "UNSUBSCRIBED";

export type WixContactV5DeliverabilityStatus =
  "NO_PHONE_DELIVERABILITY_STATUS" | "NOT_SET" | "VALID" | "INVALID";

export type WixContactV5SmsDetails = {
  id: string;
  updatedDate: string | null;
  phone: {
    e164: string | null;
    subscriptionStatus: {
      status: WixContactV5SubscriptionStatus | null;
      updatedDate: string | null;
    };
    deliverabilityStatus: WixContactV5DeliverabilityStatus | null;
  } | null;
};

function requireWixGuid(value: unknown, errorCode: string): string {
  if (typeof value !== "string") throw new Error(errorCode);
  const id = value.trim();
  if (!WIX_GUID_PATTERN.test(id)) throw new Error(errorCode);
  return id;
}

function readOptionalString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("WIX_CONTACT_MALFORMED_RESPONSE");
  return value;
}

function readSubscriptionStatus(value: unknown): WixContactV5SubscriptionStatus | null {
  if (value == null) return null;
  if (
    value === "NO_SUBSCRIPTION_STATUS" ||
    value === "NOT_SET" ||
    value === "PENDING" ||
    value === "SUBSCRIBED" ||
    value === "UNSUBSCRIBED"
  ) {
    return value;
  }
  throw new Error("WIX_CONTACT_MALFORMED_RESPONSE");
}

function readDeliverabilityStatus(
  value: unknown
): WixContactV5DeliverabilityStatus | null {
  if (value == null) return null;
  if (
    value === "NO_PHONE_DELIVERABILITY_STATUS" ||
    value === "NOT_SET" ||
    value === "VALID" ||
    value === "INVALID"
  ) {
    return value;
  }
  throw new Error("WIX_CONTACT_MALFORMED_RESPONSE");
}

/** Read the linked contact's main SMS consent and deliverability fields. */
export async function getWixContactV5(
  contactId: string
): Promise<WixContactV5SmsDetails> {
  const validContactId = requireWixGuid(contactId, "WIX_CONTACT_INVALID_ID");
  const response = await wixV5Fetch(
    `/contacts/v5/contacts/${encodeURIComponent(validContactId)}`
  );
  if (!isRecord(response) || !isRecord(response.contact)) {
    throw new Error("WIX_CONTACT_MALFORMED_RESPONSE");
  }

  const contact = response.contact;
  const id = requireWixGuid(contact.id, "WIX_CONTACT_MALFORMED_RESPONSE");
  const updatedDate = readOptionalString(contact.updatedDate);

  if (contact.phone == null) {
    return { id, updatedDate, phone: null };
  }
  if (!isRecord(contact.phone)) throw new Error("WIX_CONTACT_MALFORMED_RESPONSE");

  const phone = contact.phone;
  if (phone.subscriptionStatus != null && !isRecord(phone.subscriptionStatus)) {
    throw new Error("WIX_CONTACT_MALFORMED_RESPONSE");
  }
  const subscriptionStatus = phone.subscriptionStatus;

  return {
    id,
    updatedDate,
    phone: {
      e164: readOptionalString(phone.e164),
      subscriptionStatus: {
        status: readSubscriptionStatus(subscriptionStatus?.status),
        updatedDate: readOptionalString(subscriptionStatus?.updatedDate),
      },
      deliverabilityStatus: readDeliverabilityStatus(phone.deliverabilityStatus),
    },
  };
}

/**
 * Find an existing Wix contact by exact email, then by phone.
 * Uses Query Contacts (filter).
 */
export async function findWixContactByEmailOrPhone(input: {
  email?: string | null;
  phone?: string | null;
}): Promise<WixContact | null> {
  const email = input.email?.trim().toLowerCase();
  if (email) {
    const byEmail = await queryWixContacts({
      filter: {
        "info.emails.email": { $eq: email },
      },
      paging: { limit: 1 },
    });
    if (byEmail[0]) return byEmail[0];
  }

  const phone = input.phone?.trim();
  if (phone) {
    const byPhone = await queryWixContacts({
      filter: {
        "info.phones.phone": { $eq: phone },
      },
      paging: { limit: 1 },
    });
    if (byPhone[0]) return byPhone[0];
  }

  return null;
}

type WixContactsQueryResponse = {
  contacts?: WixContact[];
  pagingMetadata?: {
    count?: number;
    offset?: number;
    total?: number;
    hasNext?: boolean;
  };
};

/**
 * Wix Contacts Query requires filter/paging under `query`.
 * Top-level `paging` is ignored (always page 0), which would infinite-loop a reconcile.
 */
async function queryWixContactsPage(
  query: Record<string, unknown>
): Promise<WixContactsQueryResponse> {
  const response = await wixFetch("/contacts/v4/contacts/query", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(await readWixError(response));
  return (await response.json()) as WixContactsQueryResponse;
}

async function queryWixContacts(query: Record<string, unknown>): Promise<WixContact[]> {
  const data = await queryWixContactsPage(query);
  return data.contacts ?? [];
}

const LIST_PAGE_SIZE = 100;

/** Page through all site contacts (offset paging under `query`). */
export async function listAllWixContacts(): Promise<WixContact[]> {
  const contacts: WixContact[] = [];
  let offset = 0;

  for (;;) {
    const page = await queryWixContactsPage({
      paging: { limit: LIST_PAGE_SIZE, offset },
    });
    const batch = page.contacts ?? [];
    if (!batch.length) break;
    contacts.push(...batch);
    const meta = page.pagingMetadata;
    if (meta?.hasNext === false) break;
    if (typeof meta?.total === "number" && contacts.length >= meta.total) break;
    if (batch.length < LIST_PAGE_SIZE) break;
    offset += batch.length;
  }

  return contacts;
}
