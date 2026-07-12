import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { canAdminHelpCreateRecords } from "@/lib/permissions";
import {
  isWixContactsConfigured,
} from "@/lib/wix/config";
import {
  createWixContact,
  findWixContactByEmailOrPhone,
  getWixContact,
  listAllWixContacts,
  updateWixContact,
} from "@/lib/wix/client";
import {
  extractWixContactFields,
  findMatchingCustomer,
  firstNonEmpty,
  normalizeOptional,
  type CustomerMatchRow,
  type WixContactMatchFields,
} from "@/lib/wix/contactNormalize";
import type { WixWebhookContactPayload } from "@/lib/wix/types";

const CUSTOMER_COLUMNS =
  "customer_id, first_name, last_name, phone, email, notes, wix_contact_id, created_at, updated_at";

const MATCH_COLUMNS = "customer_id, email, phone, wix_contact_id";

export type CustomerWithWix = {
  customer_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  wix_contact_id: string | null;
  created_at: string;
  updated_at: string;
};

export function isWixSyncAvailable(): boolean {
  return isWixContactsConfigured();
}

async function loadCustomer(
  customerId: string,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<CustomerWithWix | null> {
  const { data, error } = await supabase
    .from("customer")
    .select(CUSTOMER_COLUMNS)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) throw error;
  return (data as CustomerWithWix) ?? null;
}

type AdminClient = ReturnType<typeof createAdminClient>;

function fieldsFromWebhookPayload(
  payload: WixWebhookContactPayload
): WixContactMatchFields {
  const contact = payload.contact;
  if (!contact?.id?.trim()) throw new Error("WIX_WEBHOOK_INVALID");

  const email = normalizeOptional(contact.email);
  const phone = normalizeOptional(contact.phone);
  if (!email && !phone) {
    throw new Error("WIX_WEBHOOK_CONTACT_REQUIRED");
  }

  return {
    wixContactId: contact.id.trim(),
    firstName: firstNonEmpty(contact.firstName, "Wix"),
    lastName: firstNonEmpty(contact.lastName, "Contact"),
    email,
    phone,
  };
}

async function applyWixContactUpsert(
  supabase: AdminClient,
  fields: WixContactMatchFields,
  existing: CustomerMatchRow | null
): Promise<{ customer_id: string; created: boolean }> {
  if (existing) {
    const { data, error } = await supabase
      .from("customer")
      .update({
        first_name: fields.firstName,
        last_name: fields.lastName,
        email: fields.email ?? existing.email,
        phone: fields.phone ?? existing.phone,
        wix_contact_id: fields.wixContactId,
        updated_at: new Date().toISOString(),
      })
      .eq("customer_id", existing.customer_id)
      .select("customer_id")
      .single();
    if (error) throw error;
    return { customer_id: data.customer_id as string, created: false };
  }

  const { data, error } = await supabase
    .from("customer")
    .insert({
      first_name: fields.firstName,
      last_name: fields.lastName,
      email: fields.email,
      phone: fields.phone,
      wix_contact_id: fields.wixContactId,
    })
    .select("customer_id")
    .single();

  if (error) throw error;
  return { customer_id: data.customer_id as string, created: true };
}

/**
 * Push a local customer to Wix Contacts and store wix_contact_id.
 * Matches existing Wix contacts by email, then phone, before creating.
 */
export async function syncCustomerToWix(
  customerId: string
): Promise<CustomerWithWix> {
  const user = await requireUser();
  if (!canAdminHelpCreateRecords(user.role)) throw new Error("FORBIDDEN");
  if (!isWixContactsConfigured()) throw new Error("WIX_NOT_CONFIGURED");

  const supabase = await createClient();
  const customer = await loadCustomer(customerId, supabase);
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

  const profile = {
    firstName: customer.first_name,
    lastName: customer.last_name,
    email: customer.email,
    phone: customer.phone,
  };

  let wixContactId = customer.wix_contact_id;

  try {
    if (wixContactId) {
      await updateWixContact(wixContactId, profile);
    } else {
      const existing = await findWixContactByEmailOrPhone({
        email: customer.email,
        phone: customer.phone,
      });
      if (existing?.id) {
        wixContactId = existing.id;
        await updateWixContact(wixContactId, {
          ...profile,
          revision: existing.revision,
        });
      } else {
        const created = await createWixContact(profile);
        wixContactId = created.id;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "WIX_CONTACT_NOT_FOUND") {
      const created = await createWixContact(profile);
      wixContactId = created.id;
    } else {
      throw error;
    }
  }

  if (!wixContactId) throw new Error("WIX_CONTACT_SYNC_FAILED");

  const { data, error } = await supabase
    .from("customer")
    .update({
      wix_contact_id: wixContactId,
      updated_at: new Date().toISOString(),
    })
    .eq("customer_id", customerId)
    .select(CUSTOMER_COLUMNS)
    .single();

  if (error) throw error;
  const updated = data as CustomerWithWix;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "customer_wix_synced",
    entity_type: "customer",
    entity_id: customerId,
    description: `Customer synced to Wix contact ${wixContactId}`,
    new_value: { wix_contact_id: wixContactId },
  });

  return updated;
}

/**
 * Best-effort push after local create/update. Never throws to the caller.
 */
export async function maybeSyncCustomerToWix(customerId: string): Promise<void> {
  if (!isWixContactsConfigured()) return;
  try {
    await syncCustomerToWix(customerId);
  } catch {
    // Contact save already succeeded; Wix can be synced manually.
  }
}

/**
 * Upsert a local customer from a Wix webhook / automation payload.
 * Matches on wix_contact_id, then email, then phone.
 */
export async function upsertCustomerFromWixWebhook(
  payload: WixWebhookContactPayload
): Promise<{ customer_id: string; created: boolean }> {
  const fields = fieldsFromWebhookPayload(payload);

  let supabase: AdminClient;
  try {
    supabase = createAdminClient();
  } catch {
    throw new Error("WIX_SYNC_MISCONFIGURED");
  }

  const { data: byWixId } = await supabase
    .from("customer")
    .select(MATCH_COLUMNS)
    .eq("wix_contact_id", fields.wixContactId)
    .maybeSingle();

  let existing = (byWixId as CustomerMatchRow | null) ?? null;

  if (!existing && fields.email) {
    const { data } = await supabase
      .from("customer")
      .select(MATCH_COLUMNS)
      .ilike("email", fields.email)
      .limit(1)
      .maybeSingle();
    existing = (data as CustomerMatchRow) ?? null;
  }

  if (!existing && fields.phone) {
    const { data } = await supabase
      .from("customer")
      .select(MATCH_COLUMNS)
      .eq("phone", fields.phone)
      .limit(1)
      .maybeSingle();
    existing = (data as CustomerMatchRow) ?? null;
  }

  return applyWixContactUpsert(supabase, fields, existing);
}

export type WixContactsReconcileStats = {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  triggered_by: string;
};

/**
 * Bulk pull: list all Wix contacts and upsert into local `customer`.
 * Skips contacts with neither email nor phone.
 */
export async function reconcileWixContactsToApp(options?: {
  triggeredBy?: string;
}): Promise<WixContactsReconcileStats> {
  if (!isWixContactsConfigured()) throw new Error("WIX_NOT_CONFIGURED");

  let supabase: AdminClient;
  try {
    supabase = createAdminClient();
  } catch {
    throw new Error("WIX_SYNC_MISCONFIGURED");
  }

  const stats: WixContactsReconcileStats = {
    scanned: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    triggered_by: options?.triggeredBy ?? "manual",
  };

  const wixContacts = await listAllWixContacts();
  stats.scanned = wixContacts.length;

  const localRows: CustomerMatchRow[] = [];
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("customer")
      .select(MATCH_COLUMNS)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data as CustomerMatchRow[]) ?? [];
    localRows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  for (const contact of wixContacts) {
    const fields = extractWixContactFields(contact);
    if (!fields) {
      stats.skipped += 1;
      continue;
    }

    try {
      const existing = findMatchingCustomer(localRows, {
        wixContactId: fields.wixContactId,
        email: fields.email,
        phone: fields.phone,
      });
      const result = await applyWixContactUpsert(supabase, fields, existing);

      if (result.created) {
        stats.created += 1;
        localRows.push({
          customer_id: result.customer_id,
          email: fields.email,
          phone: fields.phone,
          wix_contact_id: fields.wixContactId,
        });
      } else {
        stats.updated += 1;
        const idx = localRows.findIndex(
          (row) => row.customer_id === result.customer_id
        );
        if (idx >= 0) {
          localRows[idx] = {
            ...localRows[idx],
            email: fields.email ?? localRows[idx].email,
            phone: fields.phone ?? localRows[idx].phone,
            wix_contact_id: fields.wixContactId,
          };
        }
      }
    } catch {
      stats.failed += 1;
    }
  }

  return stats;
}

/** Pull latest name/email/phone from Wix onto the local customer. */
export async function pullCustomerFromWix(
  customerId: string
): Promise<CustomerWithWix> {
  const user = await requireUser();
  if (!canAdminHelpCreateRecords(user.role)) throw new Error("FORBIDDEN");
  if (!isWixContactsConfigured()) throw new Error("WIX_NOT_CONFIGURED");

  const supabase = await createClient();
  const customer = await loadCustomer(customerId, supabase);
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
  if (!customer.wix_contact_id) throw new Error("WIX_CONTACT_NOT_LINKED");

  const remote = await getWixContact(customer.wix_contact_id);
  const firstName =
    remote.info?.name?.first?.trim() ||
    customer.first_name;
  const lastName =
    remote.info?.name?.last?.trim() ||
    customer.last_name;
  const email =
    normalizeOptional(remote.primaryInfo?.email) ??
    normalizeOptional(remote.info?.emails?.items?.[0]?.email) ??
    customer.email;
  const phone =
    normalizeOptional(remote.primaryInfo?.phone) ??
    normalizeOptional(remote.info?.phones?.items?.[0]?.phone) ??
    customer.phone;

  const { data, error } = await supabase
    .from("customer")
    .update({
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      updated_at: new Date().toISOString(),
    })
    .eq("customer_id", customerId)
    .select(CUSTOMER_COLUMNS)
    .single();

  if (error) throw error;
  const updated = data as CustomerWithWix;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "customer_wix_pulled",
    entity_type: "customer",
    entity_id: customerId,
    description: `Customer updated from Wix contact ${customer.wix_contact_id}`,
    old_value: customer,
    new_value: updated,
  });

  return updated;
}
