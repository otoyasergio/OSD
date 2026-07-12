import { getWixContactsConfig } from "@/lib/wix/config";
import type { WixContact, WixContactInfo } from "@/lib/wix/types";

const WIX_API_BASE = "https://www.wixapis.com";

type WixErrorBody = {
  message?: string;
  details?: { applicationError?: { code?: string; description?: string } };
};

async function wixFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
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

async function queryWixContactsPage(
  body: Record<string, unknown>
): Promise<WixContactsQueryResponse> {
  const response = await wixFetch("/contacts/v4/contacts/query", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readWixError(response));
  return (await response.json()) as WixContactsQueryResponse;
}

async function queryWixContacts(body: Record<string, unknown>): Promise<
  WixContact[]
> {
  const data = await queryWixContactsPage(body);
  return data.contacts ?? [];
}

const LIST_PAGE_SIZE = 100;

/** Page through all site contacts (offset paging). */
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
    if (batch.length < LIST_PAGE_SIZE) break;
    offset += batch.length;
  }

  return contacts;
}
