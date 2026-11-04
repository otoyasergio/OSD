import { createAdminClient } from "@/lib/database/supabase-admin";
import { revokeGmailRefreshToken } from "@/lib/email/gmail";
import { getShopMailboxAddress } from "@/lib/email/mailbox";
import { scanAddressAllowed, type ScanOutcome } from "@/lib/email/scanReport";

export type ScanMailbox = {
  locationId: string;
  emailAddress: string;
  refreshToken: string;
};

type MailboxRow = {
  location_id: string;
  email_address: string;
  refresh_token: string;
};

export async function listScanMailboxes(): Promise<ScanMailbox[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("scan_mailbox")
    .select("location_id, email_address, refresh_token");
  if (error) throw error;
  return ((data ?? []) as MailboxRow[])
    .filter((row) => row.email_address && row.refresh_token)
    .map((row) => ({
      locationId: row.location_id,
      emailAddress: row.email_address,
      refreshToken: row.refresh_token,
    }));
}

export async function getScanMailboxAddress(locationId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("scan_mailbox")
    .select("email_address")
    .eq("location_id", locationId)
    .maybeSingle();
  if (error) throw error;
  const email = (data as { email_address?: string } | null)?.email_address?.trim() ?? "";
  return email || null;
}

export async function saveScanMailbox(input: {
  locationId: string;
  emailAddress: string;
  refreshToken: string;
  userId: string;
}): Promise<void> {
  const customerAddress = await getShopMailboxAddress(input.locationId);
  if (!scanAddressAllowed(input.emailAddress, customerAddress)) {
    throw new Error("SCAN_MAILBOX_IS_CUSTOMER");
  }
  const admin = createAdminClient();
  const { error } = await admin.from("scan_mailbox").upsert({
    location_id: input.locationId,
    email_address: input.emailAddress,
    refresh_token: input.refreshToken,
    connected_by_user_id: input.userId,
    connected_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function updateScanMailboxRefreshToken(
  locationId: string,
  refreshToken: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("scan_mailbox")
    .update({ refresh_token: refreshToken })
    .eq("location_id", locationId);
  if (error) throw error;
}

export async function deleteScanMailbox(locationId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("scan_mailbox")
    .select("refresh_token")
    .eq("location_id", locationId)
    .maybeSingle();
  const refreshToken = (data as { refresh_token?: string } | null)?.refresh_token;
  const { error } = await admin.from("scan_mailbox").delete().eq("location_id", locationId);
  if (error) throw error;
  if (!refreshToken) return;
  try {
    await revokeGmailRefreshToken(refreshToken);
  } catch {
    // The row is gone. Google may honor the token until the owner removes access.
  }
}

export type ScanReportSummary = {
  subject: string;
  outcome: ScanOutcome;
  workOrderNumber: string | null;
};

export async function listRecentScanReports(locationId: string): Promise<ScanReportSummary[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("scan_report")
    .select("subject, outcome, work_order:work_order_id(work_order_number)")
    .eq("location_id", locationId)
    .order("received_at", { ascending: false })
    .limit(8);
  if (error) throw error;
  return ((data ?? []) as Array<{
    subject: string | null;
    outcome: ScanOutcome;
    work_order: { work_order_number?: string } | { work_order_number?: string }[] | null;
  }>).map((row) => {
    const workOrder = Array.isArray(row.work_order) ? row.work_order[0] : row.work_order;
    return {
      subject: row.subject?.trim() || "Scan report",
      outcome: row.outcome,
      workOrderNumber: workOrder?.work_order_number ?? null,
    };
  });
}
