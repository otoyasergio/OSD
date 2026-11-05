import "server-only";

import { createAdminClient } from "@/lib/database/supabase-admin";
import { requireUser } from "@/lib/auth/session";
import { canViewClients } from "@/lib/permissions";
import type { ScanCode, ScanOutcome } from "@/lib/email/scanReport";

export type BikeScanReport = {
  scanReportId: string;
  receivedAt: string;
  outcome: ScanOutcome;
  codes: ScanCode[];
  reportText: string;
  workOrderId: string | null;
  workOrderNumber: string | null;
};

type ReportRow = {
  scan_report_id: string;
  received_at: string;
  outcome: ScanOutcome;
  codes: ScanCode[] | null;
  report_text: string | null;
  work_order_id: string | null;
  work_order: { work_order_number?: string } | { work_order_number?: string }[] | null;
};

export async function listScanReportsForMotorcycle(
  motorcycleId: string
): Promise<BikeScanReport[]> {
  const user = await requireUser();
  if (!canViewClients(user.role)) throw new Error("FORBIDDEN");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("scan_report")
    .select(
      "scan_report_id, received_at, outcome, codes, report_text, work_order_id, work_order:work_order_id(work_order_number)"
    )
    .eq("motorcycle_id", motorcycleId)
    .order("received_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return ((data ?? []) as ReportRow[]).map((row) => {
    const workOrder = Array.isArray(row.work_order) ? row.work_order[0] : row.work_order;
    return {
      scanReportId: row.scan_report_id,
      receivedAt: row.received_at,
      outcome: row.outcome,
      codes: Array.isArray(row.codes) ? row.codes : [],
      reportText: row.report_text ?? "",
      workOrderId: row.work_order_id,
      workOrderNumber: workOrder?.work_order_number ?? null,
    };
  });
}
