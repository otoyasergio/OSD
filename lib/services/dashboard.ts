import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { WorkOrderStatus } from "@/lib/database/types";
import {
  buildWorkOrderFlags,
  isOverdue,
} from "@/lib/status/flags";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";

export type DashboardCounts = {
  open: number;
  waiting_approval: number;
  waiting_parts: number;
  ready_for_technician: number;
  in_progress: number;
  quality_check: number;
  ready_for_pickup: number;
  overdue: number;
  incomplete_inspections: number;
  unassigned_jobs: number;
};

export type DashboardCardKey = keyof DashboardCounts;

export type DashboardFilters = {
  status?: WorkOrderStatus | "" | null;
  technician_id?: string | null;
  flag?: string | null;
  q?: string | null;
  card?: DashboardCardKey | "" | null;
};

export type DashboardRow = {
  work_order_id: string;
  work_order_number: string;
  external_invoice_number: string | null;
  status: WorkOrderStatus;
  date_created: string;
  estimated_completion: string | null;
  motorcycle: {
    motorcycle_id: string;
    year: number;
    make: string;
    model: string;
    vin: string | null;
    customer: {
      customer_id: string;
      first_name: string;
      last_name: string;
      phone: string | null;
      email: string | null;
    } | null;
  } | null;
  primary_technician: {
    user_id: string;
    first_name: string;
    last_name: string;
  } | null;
  flags: string[];
};

export type DashboardData = {
  counts: DashboardCounts;
  rows: DashboardRow[];
  filters: DashboardFilters;
  technicians: Array<{
    user_id: string;
    first_name: string;
    last_name: string;
  }>;
  statusOptions: Array<{ value: WorkOrderStatus; label: string }>;
  flagOptions: string[];
};

const ACTIVE_STATUSES: WorkOrderStatus[] = [
  "draft",
  "open",
  "inspection_in_progress",
  "waiting_for_customer_approval",
  "waiting_for_parts",
  "ready_for_technician",
  "in_progress",
  "quality_check",
  "ready_for_pickup",
  "on_hold",
];

const FLAG_OPTIONS = [
  "Missing VIN",
  "Missing invoice #",
  "No intake photos",
  "Incomplete inspection",
  "Needs approval",
  "Waiting for parts",
  "Safety-critical",
  "Overdue",
  "On hold",
];

type RawRow = {
  work_order_id: string;
  work_order_number: string;
  external_invoice_number: string | null;
  status: WorkOrderStatus;
  date_created: string;
  estimated_completion: string | null;
  primary_technician_id: string | null;
  motorcycle: DashboardRow["motorcycle"];
  primary_technician: DashboardRow["primary_technician"];
  job: Array<{
    job_id: string;
    status: string;
    assigned_technician_id: string | null;
  }> | null;
  recommendation: Array<{ severity: string; status: string }> | null;
  intake_photo: Array<{ photo_id: string }> | null;
  inspection: Array<{ completed_at: string | null }> | null;
};

function emptyCounts(): DashboardCounts {
  return {
    open: 0,
    waiting_approval: 0,
    waiting_parts: 0,
    ready_for_technician: 0,
    in_progress: 0,
    quality_check: 0,
    ready_for_pickup: 0,
    overdue: 0,
    incomplete_inspections: 0,
    unassigned_jobs: 0,
  };
}

function isActiveJob(status: string) {
  return status !== "cancelled" && status !== "declined" && status !== "completed";
}

function matchesCard(row: RawRow, card: DashboardCardKey, now: Date): boolean {
  const inspection = row.inspection?.[0] ?? null;
  const jobs = row.job ?? [];

  switch (card) {
    case "open":
      return ACTIVE_STATUSES.includes(row.status);
    case "waiting_approval":
      return row.status === "waiting_for_customer_approval";
    case "waiting_parts":
      return row.status === "waiting_for_parts";
    case "ready_for_technician":
      return row.status === "ready_for_technician";
    case "in_progress":
      return row.status === "in_progress";
    case "quality_check":
      return row.status === "quality_check";
    case "ready_for_pickup":
      return row.status === "ready_for_pickup";
    case "overdue":
      return isOverdue(row.estimated_completion, row.status, now);
    case "incomplete_inspections":
      return (
        ACTIVE_STATUSES.includes(row.status) &&
        Boolean(inspection) &&
        !inspection?.completed_at
      );
    case "unassigned_jobs":
      return jobs.some(
        (job) => isActiveJob(job.status) && !job.assigned_technician_id
      );
    default:
      return true;
  }
}

function toDashboardRow(row: RawRow, now: Date): DashboardRow {
  const jobs = row.job ?? [];
  const recommendations = row.recommendation ?? [];
  const photos = row.intake_photo ?? [];
  const inspection = row.inspection?.[0] ?? null;

  return {
    work_order_id: row.work_order_id,
    work_order_number: row.work_order_number,
    external_invoice_number: row.external_invoice_number,
    status: row.status,
    date_created: row.date_created,
    estimated_completion: row.estimated_completion,
    motorcycle: row.motorcycle,
    primary_technician: row.primary_technician,
    flags: buildWorkOrderFlags({
      status: row.status,
      vin: row.motorcycle?.vin,
      external_invoice_number: row.external_invoice_number,
      estimated_completion: row.estimated_completion,
      jobs,
      recommendations,
      photoCount: photos.length,
      inspectionComplete: inspection ? Boolean(inspection.completed_at) : null,
      now,
    }),
  };
}

export async function getDashboardData(
  filters: DashboardFilters = {}
): Promise<DashboardData> {
  const user = await requireUser();
  const supabase = await createClient();
  const now = new Date();
  const locationId = user.active_location_id!;

  // Single nested select for board cards (no per-card fetches). Exclude
  // completed/cancelled so the 300-row window stays on operational WOs.
  // Technician filter options load in parallel with the board query.
  const [woResult, membershipResult] = await Promise.all([
    supabase
      .from("work_order")
      .select(
        `
      work_order_id,
      work_order_number,
      external_invoice_number,
      status,
      date_created,
      estimated_completion,
      primary_technician_id,
      motorcycle:motorcycle_id (
        motorcycle_id,
        year,
        make,
        model,
        vin,
        customer:customer_id (
          customer_id,
          first_name,
          last_name,
          phone,
          email
        )
      ),
      primary_technician:primary_technician_id (
        user_id,
        first_name,
        last_name
      ),
      job ( job_id, status, assigned_technician_id ),
      recommendation ( severity, status ),
      intake_photo ( photo_id ),
      inspection ( completed_at )
    `
      )
      .eq("location_id", locationId)
      .in("status", ACTIVE_STATUSES)
      .order("date_created", { ascending: false })
      .limit(300),
    supabase
      .from("user_location")
      .select("user_id")
      .eq("location_id", locationId),
  ]);

  if (woResult.error) throw woResult.error;
  if (membershipResult.error) throw membershipResult.error;

  const rawRows = (woResult.data ?? []) as unknown as RawRow[];
  const counts = emptyCounts();

  for (const row of rawRows) {
    counts.open += 1;
    if (row.status === "waiting_for_customer_approval") counts.waiting_approval += 1;
    if (row.status === "waiting_for_parts") counts.waiting_parts += 1;
    if (row.status === "ready_for_technician") counts.ready_for_technician += 1;
    if (row.status === "in_progress") counts.in_progress += 1;
    if (row.status === "quality_check") counts.quality_check += 1;
    if (row.status === "ready_for_pickup") counts.ready_for_pickup += 1;
    if (isOverdue(row.estimated_completion, row.status, now)) counts.overdue += 1;

    const inspection = row.inspection?.[0] ?? null;
    if (inspection && !inspection.completed_at) {
      counts.incomplete_inspections += 1;
    }

    for (const job of row.job ?? []) {
      if (isActiveJob(job.status) && !job.assigned_technician_id) {
        counts.unassigned_jobs += 1;
      }
    }
  }

  const statusFilter = filters.status?.trim() || "";
  const technicianId = filters.technician_id?.trim() || "";
  const flagFilter = filters.flag?.trim() || "";
  const query = filters.q?.trim().toLowerCase() || "";
  const card = (filters.card?.trim() || "") as DashboardCardKey | "";

  let filtered = rawRows;

  if (card) {
    filtered = filtered.filter((row) => matchesCard(row, card, now));
  }
  if (statusFilter) {
    filtered = filtered.filter((row) => row.status === statusFilter);
  }
  if (technicianId) {
    filtered = filtered.filter(
      (row) =>
        row.primary_technician_id === technicianId ||
        (row.job ?? []).some((job) => job.assigned_technician_id === technicianId)
    );
  }

  const rows = filtered
    .map((row) => toDashboardRow(row, now))
    .filter((row) => {
      if (flagFilter && !row.flags.includes(flagFilter)) return false;
      if (!query) return true;
      const customer = row.motorcycle?.customer;
      const haystack = [
        row.work_order_number,
        row.external_invoice_number,
        customer?.first_name,
        customer?.last_name,
        customer?.phone,
        customer?.email,
        row.motorcycle?.make,
        row.motorcycle?.model,
        row.motorcycle?.vin,
        row.primary_technician?.first_name,
        row.primary_technician?.last_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });

  const userIds = (membershipResult.data ?? []).map(
    (row: { user_id: string }) => row.user_id
  );

  let technicians: DashboardData["technicians"] = [];
  if (userIds.length > 0) {
    const { data: techRows, error: techError } = await supabase
      .from("app_user")
      .select("user_id, first_name, last_name")
      .eq("role", "technician")
      .eq("status", "active")
      .in("user_id", userIds)
      .order("last_name")
      .order("first_name");
    if (techError) throw techError;
    technicians = (techRows ?? []) as DashboardData["technicians"];
  }

  return {
    counts,
    rows,
    filters: {
      status: statusFilter as WorkOrderStatus | "",
      technician_id: technicianId,
      flag: flagFilter,
      q: filters.q?.trim() || "",
      card,
    },
    technicians,
    statusOptions: (Object.keys(WORK_ORDER_STATUS_LABELS) as WorkOrderStatus[]).map(
      (value) => ({ value, label: WORK_ORDER_STATUS_LABELS[value] })
    ),
    flagOptions: FLAG_OPTIONS,
  };
}

export const DASHBOARD_CARDS: Array<{
  key: DashboardCardKey;
  label: string;
}> = [
  { key: "open", label: "Open" },
  { key: "waiting_approval", label: "Waiting approval" },
  { key: "waiting_parts", label: "Waiting parts" },
  { key: "ready_for_technician", label: "Ready for tech" },
  { key: "in_progress", label: "In progress" },
  { key: "quality_check", label: "Quality check" },
  { key: "ready_for_pickup", label: "Ready pickup" },
  { key: "overdue", label: "Overdue" },
  { key: "incomplete_inspections", label: "Incomplete inspections" },
  { key: "unassigned_jobs", label: "Unassigned jobs" },
];
