import "server-only";

import { createAdminClient } from "@/lib/database/supabase-admin";
import { requireUser } from "@/lib/auth/session";
import { canViewClients } from "@/lib/permissions/checks";

export type PrivateLicence = {
  licence_number: string | null;
  licence_expiry: string | null;
  scanned_at: string | null;
};

/** Licence number and expiry. Never copied onto a Wix contact or a promotion. */
export async function savePrivateLicence(
  customerId: string,
  input: { licenceNumber: string; licenceExpiry: string | null }
): Promise<void> {
  const user = await requireUser();
  if (!canViewClients(user.role)) throw new Error("FORBIDDEN");
  const number = input.licenceNumber.trim();
  if (!number) return;
  const admin = createAdminClient();
  const { error } = await admin.from("customer_private_profile").upsert(
    {
      customer_id: customerId,
      licence_number: number,
      licence_expiry: input.licenceExpiry || null,
      scanned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "customer_id" }
  );
  if (error) throw error;
}

export async function readPrivateLicence(customerId: string): Promise<PrivateLicence | null> {
  const user = await requireUser();
  if (!canViewClients(user.role)) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("customer_private_profile")
    .select("licence_number, licence_expiry, scanned_at")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    licence_number: (data.licence_number as string | null) ?? null,
    licence_expiry: (data.licence_expiry as string | null) ?? null,
    scanned_at: (data.scanned_at as string | null) ?? null,
  };
}
