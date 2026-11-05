import "server-only";

import { createAdminClient } from "@/lib/database/supabase-admin";
import { createClient } from "@/lib/database/supabase-server";
import { requireUser } from "@/lib/auth/session";
import { canCompleteInspection } from "@/lib/permissions";
import { normalizeMileageUnit, type MileageUnit } from "@/lib/mileage/format";
import { assertViewerCanAccessWorkOrderLocation } from "@/lib/workOrders/assignmentVisibility";
import {
  mileageDecision,
  readOdometer,
  readTopGuruReport,
  SCAN_NO_CONNECTION_LINE,
  type InspectionScanView,
  type ScanCode,
  type ScanOutcome,
} from "@/lib/email/scanReport";

type ScanRow = {
  scan_report_id: string;
  outcome: ScanOutcome;
  codes: ScanCode[] | null;
  vin_in_report: string | null;
  report_text: string | null;
  mileage_choice: string | null;
};

export type InspectionScanReading = {
  scan: InspectionScanView | null;
  mileage: number | null;
  mileageUnit: MileageUnit;
};

function asView(row: ScanRow): InspectionScanView {
  return {
    scanReportId: row.scan_report_id,
    outcome: row.outcome,
    codes: Array.isArray(row.codes) ? row.codes : [],
    vin: row.vin_in_report,
    reportText: row.report_text ?? "",
    mileageChoice: row.mileage_choice === "keep" ? "keep" : null,
  };
}

async function scanRowForWorkOrder(workOrderId: string): Promise<ScanRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("scan_report")
    .select(
      "scan_report_id, outcome, codes, vin_in_report, report_text, mileage_choice, received_at"
    )
    .eq("work_order_id", workOrderId)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ScanRow | null) ?? null;
}

export async function latestInspectionScan(
  workOrderId: string
): Promise<InspectionScanView | null> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: workOrder, error } = await supabase
    .from("work_order")
    .select("location_id")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!workOrder) return null;
  assertViewerCanAccessWorkOrderLocation(user, workOrder.location_id);
  const row = await scanRowForWorkOrder(workOrderId);
  return row ? asView(row) : null;
}

export async function inspectionScanReading(
  workOrderId: string
): Promise<InspectionScanReading> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: workOrder, error } = await supabase
    .from("work_order")
    .select("location_id, mileage, mileage_unit")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  assertViewerCanAccessWorkOrderLocation(user, workOrder.location_id);
  const row = await scanRowForWorkOrder(workOrderId);
  return {
    scan: row ? asView(row) : null,
    mileage: (workOrder.mileage as number | null) ?? null,
    mileageUnit: normalizeMileageUnit(workOrder.mileage_unit),
  };
}

type AdminClient = ReturnType<typeof createAdminClient>;

/** Fill a blank work-order mileage from the report. A disagreement is left for the tech. */
export async function applyEmptyReportedMileage(
  admin: AdminClient,
  workOrderId: string,
  reportText: string
): Promise<void> {
  const reported = readOdometer(reportText);
  if (!reported) return;
  const { data, error } = await admin
    .from("work_order")
    .select("mileage, mileage_unit")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  const decision = mileageDecision({
    reported,
    current: (data?.mileage as number | null) ?? null,
    currentUnit: normalizeMileageUnit(data?.mileage_unit),
  });
  if (decision.action !== "fill") return;
  const { error: updateError } = await admin
    .from("work_order")
    .update({
      mileage: decision.value,
      mileage_unit: decision.unit,
      updated_at: new Date().toISOString(),
    })
    .eq("work_order_id", workOrderId);
  if (updateError) throw updateError;
}

async function openUnsignedInspection(workOrderId: string) {
  const user = await requireUser();
  if (!canCompleteInspection(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();
  const { data: workOrder, error } = await supabase
    .from("work_order")
    .select("work_order_id, location_id, status, motorcycle_id")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  assertViewerCanAccessWorkOrderLocation(user, workOrder.location_id);
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }
  const { data: inspection, error: inspectionError } = await supabase
    .from("inspection")
    .select("inspection_id, completed_at")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (inspectionError) throw inspectionError;
  if (!inspection) throw new Error("INSPECTION_NOT_FOUND");
  if (inspection.completed_at) throw new Error("INSPECTION_ALREADY_COMPLETE");
  return {
    locationId: workOrder.location_id as string,
    inspectionId: inspection.inspection_id as string,
    motorcycleId: workOrder.motorcycle_id as string,
  };
}

async function insertManualScan(input: {
  workOrderId: string;
  locationId: string;
  inspectionId: string;
  motorcycleId: string;
  subject: string;
  outcome: ScanOutcome;
  vin: string | null;
  codes: ScanCode[];
  reportText: string;
}) {
  const admin = createAdminClient();
  if (input.outcome !== "no_connection") {
    await applyEmptyReportedMileage(admin, input.workOrderId, input.reportText);
  }
  const { error } = await admin.from("scan_report").insert({
    location_id: input.locationId,
    gmail_message_id: `manual:${crypto.randomUUID()}`,
    subject: input.subject,
    from_address: "",
    outcome: input.outcome,
    vin_in_report: input.vin,
    codes: input.codes,
    report_text: input.reportText.slice(0, 20_000),
    inspection_id: input.inspectionId,
    work_order_id: input.workOrderId,
    motorcycle_id: input.motorcycleId,
  });
  if (error) throw error;
}

export async function pasteInspectionScan(
  workOrderId: string,
  text: string
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("SCAN_REPORT_REQUIRED");
  const open = await openUnsignedInspection(workOrderId);
  const parsed = readTopGuruReport(trimmed);
  await insertManualScan({
    workOrderId,
    locationId: open.locationId,
    inspectionId: open.inspectionId,
    motorcycleId: open.motorcycleId,
    subject: "Pasted scan",
    outcome: parsed.outcome,
    vin: parsed.vin,
    codes: parsed.codes,
    reportText: trimmed,
  });
}

export async function markInspectionNoConnection(workOrderId: string): Promise<void> {
  const open = await openUnsignedInspection(workOrderId);
  await insertManualScan({
    workOrderId,
    locationId: open.locationId,
    inspectionId: open.inspectionId,
    motorcycleId: open.motorcycleId,
    subject: "No connection",
    outcome: "no_connection",
    vin: null,
    codes: [],
    reportText: SCAN_NO_CONNECTION_LINE,
  });
}

export async function confirmInspectionScan(
  workOrderId: string,
  scanReportId: string,
  outcome: "codes" | "no_codes" | "no_connection"
): Promise<void> {
  const open = await openUnsignedInspection(workOrderId);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("scan_report")
    .select("scan_report_id, outcome, report_text, work_order_id")
    .eq("scan_report_id", scanReportId)
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("SCAN_REPORT_NOT_FOUND");
  if (data.outcome !== "needs_confirmation")
    throw new Error("SCAN_REPORT_ALREADY_CONFIRMED");

  let codes: ScanCode[] = [];
  if (outcome === "codes") {
    codes = readTopGuruReport(String(data.report_text ?? "")).codes;
    if (codes.length === 0) throw new Error("SCAN_CODES_REQUIRED");
  }

  const { error: updateError } = await admin
    .from("scan_report")
    .update({ outcome, codes })
    .eq("scan_report_id", scanReportId)
    .eq("location_id", open.locationId);
  if (updateError) throw updateError;
}

export async function chooseInspectionMileage(
  workOrderId: string,
  scanReportId: string,
  choice: "report" | "keep"
): Promise<void> {
  const open = await openUnsignedInspection(workOrderId);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("scan_report")
    .select("scan_report_id, report_text")
    .eq("scan_report_id", scanReportId)
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("SCAN_REPORT_NOT_FOUND");

  if (choice === "keep") {
    const { error: updateError } = await admin
      .from("scan_report")
      .update({ mileage_choice: "keep" })
      .eq("scan_report_id", scanReportId)
      .eq("location_id", open.locationId);
    if (updateError) throw updateError;
    return;
  }

  const reported = readOdometer(String(data.report_text ?? ""));
  if (!reported) throw new Error("SCAN_MILEAGE_MISSING");
  const { data: workOrder, error: workOrderError } = await admin
    .from("work_order")
    .select("mileage_unit")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (workOrderError) throw workOrderError;
  const unit = reported.unit ?? normalizeMileageUnit(workOrder?.mileage_unit);
  const { error: mileageError } = await admin
    .from("work_order")
    .update({
      mileage: reported.value,
      mileage_unit: unit,
      updated_at: new Date().toISOString(),
    })
    .eq("work_order_id", workOrderId);
  if (mileageError) throw mileageError;
}
