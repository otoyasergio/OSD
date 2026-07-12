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
  updateWixContact,
} from "@/lib/wix/client";
import type { WixWebhookContactPayload } from "@/lib/wix/types";

const CUSTOMER_COLUMNS =
  "customer_id, first_name, last_name, phone, email, notes, wix_contact_id, created_at, updated_at";

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

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

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
  const contact = payload.contact;
  if (!contact?.id?.trim()) throw new Error("WIX_WEBHOOK_INVALID");

  const wixContactId = contact.id.trim();
  const firstName = firstNonEmpty(contact.firstName, "Wix");
  const lastName = firstNonEmpty(contact.lastName, "Contact");
  const email = normalizeOptional(contact.email);
  const phone = normalizeOptional(contact.phone);

  if (!email && !phone) {
    throw new Error("WIX_WEBHOOK_CONTACT_REQUIRED");
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch {
    throw new Error("WIX_SYNC_MISCONFIGURED");
  }

  const { data: byWixId } = await supabase
    .from("customer")
    .select(CUSTOMER_COLUMNS)
    .eq("wix_contact_id", wixContactId)
    .maybeSingle();

  let existing = byWixId as CustomerWithWix | null;

  if (!existing && email) {
    const { data } = await supabase
      .from("customer")
      .select(CUSTOMER_COLUMNS)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    existing = (data as CustomerWithWix) ?? null;
  }

  if (!existing && phone) {
    const { data } = await supabase
      .from("customer")
      .select(CUSTOMER_COLUMNS)
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();
    existing = (data as CustomerWithWix) ?? null;
  }

  if (existing) {
    const { data, error } = await supabase
      .from("customer")
      .update({
        first_name: firstName,
        last_name: lastName,
        email: email ?? existing.email,
        phone: phone ?? existing.phone,
        wix_contact_id: wixContactId,
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
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      wix_contact_id: wixContactId,
    })
    .select("customer_id")
    .single();

  if (error) throw error;
  return { customer_id: data.customer_id as string, created: true };
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
