import { createAdminClient } from "@/lib/database/supabase-admin";
import { customerEmailLocationAllowed } from "@/lib/email/config";
import { revokeGmailRefreshToken } from "@/lib/email/gmail";

export type ShopMailbox = {
  emailAddress: string;
  refreshToken: string;
};

type MailboxRow = {
  email_address: string;
  refresh_token: string;
};

export async function getShopMailbox(locationId: string): Promise<ShopMailbox | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("shop_mailbox")
    .select("email_address, refresh_token")
    .eq("location_id", locationId)
    .maybeSingle();
  if (error) throw error;
  const row = data as MailboxRow | null;
  if (!row?.email_address || !row.refresh_token) return null;
  return { emailAddress: row.email_address, refreshToken: row.refresh_token };
}

export async function getShopMailboxAddress(locationId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("shop_mailbox")
    .select("email_address")
    .eq("location_id", locationId)
    .maybeSingle();
  if (error) throw error;
  const email = (data as { email_address?: string } | null)?.email_address?.trim() ?? "";
  return email || null;
}

export async function saveShopMailbox(input: {
  locationId: string;
  emailAddress: string;
  refreshToken: string;
  userId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("shop_mailbox").upsert({
    location_id: input.locationId,
    email_address: input.emailAddress,
    refresh_token: input.refreshToken,
    connected_by_user_id: input.userId,
    connected_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function updateShopMailboxRefreshToken(
  locationId: string,
  refreshToken: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("shop_mailbox")
    .update({ refresh_token: refreshToken })
    .eq("location_id", locationId);
  if (error) throw error;
}

export async function getLocationCode(locationId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("location")
    .select("code")
    .eq("location_id", locationId)
    .maybeSingle();
  if (error) throw error;
  return (data as { code?: string } | null)?.code ?? null;
}

export async function isCustomerEmailLocation(locationId: string): Promise<boolean> {
  return customerEmailLocationAllowed(await getLocationCode(locationId));
}

export async function deleteShopMailbox(locationId: string): Promise<void> {
  const existing = await getShopMailbox(locationId);
  const admin = createAdminClient();
  const { error } = await admin
    .from("shop_mailbox")
    .delete()
    .eq("location_id", locationId);
  if (error) throw error;
  if (!existing) return;
  try {
    await revokeGmailRefreshToken(existing.refreshToken);
  } catch {
    // The row is gone, so this app can no longer send. Google may still
    // honor the token until the owner removes app access on that account.
  }
}
