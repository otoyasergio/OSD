import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import {
  isUndefinedColumnError,
  OPTIONAL_COLUMNS,
  getOptionalColumnSupport,
  setOptionalColumnSupport,
} from "@/lib/database/schemaCompat";
import type { UserRole, WorkOrderStatus } from "@/lib/database/types";
import { isControlCenterAtRisk, latestJobActivityAt } from "@/lib/control-center/atRisk";
import {
  deriveTechAvailability,
  type TechAvailability,
} from "@/lib/control-center/availability";
import type { ControlCenterCohortKey } from "@/lib/control-center/cohorts";
import { canViewReports, isFloorTech } from "@/lib/permissions";
import { listOpenAdminFlagsForWorkOrders } from "@/lib/services/adminFlags";
import { resolveBoardPrimaryPhotos } from "@/lib/services/photos";
import { getShopReportSummary } from "@/lib/services/reports";
import { buildWorkOrderFlags, isOverdue } from "@/lib/status/flags";
import { getGalleryStageForStatus } from "@/lib/status/pipeline";
import { scopeWorkOrdersForViewer } from "@/lib/workOrders/assignmentVisibility";

const ACTIVE_STATUSES: WorkOrderStatus[] = [
  "draft",
  "open",
  "inspection_in_progress",
  "waiting_for_customer_approval",
  "waiting_for_parts",
  "ready_for_technician",
  "in_progress",
  "quality_check",
  "safety_check",
  "ready_for_pickup",
  "on_hold",
];

function isActiveJob(status: string) {
  return status !== "cancelled" && status !== "declined" && status !== "completed";
}

export type ControlCenterBike = {
  work_order_id: string;
  work_order_number: string;
  status: WorkOrderStatus;
  date_created: string;
  opened_at: string | null;
  technician_id: string | null;
  customer_name: string;
  bike_title: string;
  primary_photo_url: string | null;
  stage_label: string;
  stage_tone: "teal" | "orange" | "muted" | "danger";
  flags: string[];
  flag_badge: string | null;
  at_risk: boolean;
  status_dot: "green" | "orange" | "red";
  last_job_activity_at: string | null;
};

export type ControlCenterTech = {
  user_id: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  availability: TechAvailability;
  assigned_bikes: ControlCenterBike[];
};

export type ControlCenterKpi = {
  label: string;
  value: string;
  danger?: boolean;
  /** When set, the KPI card links to `/control-center?cohort=…`. */
  cohort?: ControlCenterCohortKey;
};

export type ControlCenterData = {
  location_id: string;
  role: UserRole;
  subtitle: string;
  pool: ControlCenterBike[];
  techs: ControlCenterTech[];
  kpis: ControlCenterKpi[];
  live_summary: string;
};

type RawJob = {
  job_id: string;
  status: string;
  assigned_technician_id: string | null;
  started_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type RawRow = {
  work_order_id: string;
  work_order_number: string;
  status: WorkOrderStatus;
  date_created: string;
  estimated_completion: string | null;
  opened_at?: string | null;
  customer: {
    customer_id: string;
    first_name: string;
    last_name: string;
  } | null;
  motorcycle: {
    motorcycle_id: string;
    year: number;
    make: string;
    model: string;
    vin: string | null;
  } | null;
  job: RawJob[] | null;
  recommendation: Array<{ severity: string; status: string }> | null;
  drop_off_agreement: Array<{ agreement_id: string }> | null;
  inspection: Array<{ completed_at: string | null }> | null;
};

const FLAG_BADGE_PRIORITY = [
  "Safety-critical",
  "Overdue",
  "Needs approval",
  "Waiting for parts",
  "Admin flag",
  "On hold",
];

function pickFlagBadge(flags: string[]): string | null {
  for (const preferred of FLAG_BADGE_PRIORITY) {
    if (flags.includes(preferred)) return preferred;
  }
  return flags[0] ?? null;
}

function statusDotFor(bike: {
  at_risk: boolean;
  status: WorkOrderStatus;
  flags: string[];
}): "green" | "orange" | "red" {
  if (bike.at_risk) return "red";
  if (
    bike.status === "waiting_for_customer_approval" ||
    bike.status === "waiting_for_parts" ||
    bike.status === "on_hold" ||
    bike.flags.includes("Needs approval") ||
    bike.flags.includes("Waiting for parts")
  ) {
    return "orange";
  }
  return "green";
}

function assignedTechnicianId(jobs: RawJob[]): string | null {
  for (const job of jobs) {
    if (isActiveJob(job.status) && job.assigned_technician_id) {
      return job.assigned_technician_id;
    }
  }
  return null;
}

function toBike(
  row: RawRow,
  now: Date,
  primaryPhotoUrl: string | null,
  photoCount: number,
  hasOpenAdminFlag: boolean
): ControlCenterBike {
  const jobs = row.job ?? [];
  const recommendations = row.recommendation ?? [];
  const inspection = row.inspection?.[0] ?? null;
  const bike = row.motorcycle;
  const customer = row.customer;
  const flags = buildWorkOrderFlags({
    status: row.status,
    vin: bike?.vin,
    estimated_completion: row.estimated_completion,
    jobs,
    recommendations,
    photoCount,
    inspectionComplete: inspection ? Boolean(inspection.completed_at) : null,
    hasSignedAgreement: (row.drop_off_agreement?.length ?? 0) > 0,
    hasOpenAdminFlag,
    now,
  });
  const overdue = isOverdue(row.estimated_completion, row.status, now);
  const safetyCritical = flags.includes("Safety-critical");
  const lastJobActivityAt = latestJobActivityAt(
    jobs.flatMap((job) => [job.started_at, job.updated_at, job.created_at])
  );
  const at_risk = isControlCenterAtRisk({
    overdue,
    safetyCritical,
    lastJobActivityAt,
    now,
  });
  const stage = getGalleryStageForStatus(row.status);
  const customer_name = customer
    ? `${customer.first_name} ${customer.last_name}`.trim()
    : "Unknown customer";
  const bike_title = bike ? `${bike.year} ${bike.make} ${bike.model}` : "Unknown bike";

  const result: ControlCenterBike = {
    work_order_id: row.work_order_id,
    work_order_number: row.work_order_number,
    status: row.status,
    date_created: row.date_created,
    opened_at: row.opened_at ?? null,
    technician_id: assignedTechnicianId(jobs),
    customer_name,
    bike_title,
    primary_photo_url: primaryPhotoUrl,
    stage_label: stage.label,
    stage_tone: stage.tone,
    flags,
    flag_badge: pickFlagBadge(flags),
    at_risk,
    status_dot: "green",
    last_job_activity_at: lastJobActivityAt,
  };
  result.status_dot = statusDotFor(result);
  return result;
}

/** Exported for role-preview shaping tests. */
export function subtitleForRole(role: UserRole): string {
  if (role === "owner") {
    return "Shop pulse — revenue, throughput, and bikes that need attention.";
  }
  if (role === "manager") {
    return "Dispatch board — load balance techs and clear at-risk bikes.";
  }
  return "Dispatch unassigned bikes and keep approvals moving.";
}

function startOfTodayIso(): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

async function loadOwnerTodayMetrics(locationId: string): Promise<{
  revenueTodayCents: number;
  completedToday: number;
  avgDaysInShop: number | null;
}> {
  const supabase = await createClient();
  const since = startOfTodayIso();
  const [{ data, error }, report] = await Promise.all([
    supabase
      .from("work_order")
      .select("billing_collected_cents, completed_at")
      .eq("location_id", locationId)
      .eq("status", "completed")
      .gte("completed_at", since),
    getShopReportSummary("7d").catch(() => null),
  ]);
  if (error) throw error;
  let revenueTodayCents = 0;
  for (const row of data ?? []) {
    revenueTodayCents += Number(row.billing_collected_cents ?? 0);
  }
  return {
    revenueTodayCents,
    completedToday: (data ?? []).length,
    avgDaysInShop: report?.avg_days_in_shop ?? null,
  };
}

function formatMoneyCents(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Exported for role-preview shaping tests. */
export function buildKpis(input: {
  role: UserRole;
  bikes: ControlCenterBike[];
  techs: ControlCenterTech[];
  ownerMetrics: {
    revenueTodayCents: number;
    completedToday: number;
    avgDaysInShop: number | null;
  } | null;
}): ControlCenterKpi[] {
  const inShop = input.bikes.length;
  const atRisk = input.bikes.filter((b) => b.at_risk).length;
  const unassigned = input.bikes.filter((b) => !b.technician_id).length;
  const inBay = input.bikes.filter((b) => b.status === "in_progress").length;
  const waitingApproval = input.bikes.filter(
    (b) => b.status === "waiting_for_customer_approval"
  ).length;
  const readyPickup = input.bikes.filter((b) => b.status === "ready_for_pickup").length;
  const available = input.techs.filter((t) => t.availability === "available").length;
  const totalTechs = input.techs.length;
  const atRiskKpi: ControlCenterKpi = {
    label: "At risk",
    value: String(atRisk),
    danger: atRisk > 0,
    cohort: "at_risk",
  };

  if (input.role === "owner" && input.ownerMetrics) {
    return [
      {
        label: "Revenue today",
        value: formatMoneyCents(input.ownerMetrics.revenueTodayCents),
      },
      {
        label: "Completed today",
        value: String(input.ownerMetrics.completedToday),
        cohort: "completed_today",
      },
      {
        label: "Avg days in shop",
        value:
          input.ownerMetrics.avgDaysInShop == null
            ? "—"
            : String(input.ownerMetrics.avgDaysInShop),
      },
      { label: "In shop now", value: String(inShop), cohort: "in_shop" },
      atRiskKpi,
    ];
  }

  if (input.role === "manager" || input.role === "owner" || input.role === "admin") {
    return [
      { label: "In shop", value: String(inShop), cohort: "in_shop" },
      { label: "In bay", value: String(inBay), cohort: "in_bay" },
      { label: "Unassigned", value: String(unassigned), cohort: "unassigned" },
      {
        label: "Techs available",
        value: `${available}/${totalTechs}`,
      },
      atRiskKpi,
    ];
  }

  return [
    { label: "Unassigned", value: String(unassigned), cohort: "unassigned" },
    {
      label: "Waiting approval",
      value: String(waitingApproval),
      cohort: "waiting_approval",
    },
    {
      label: "Ready for pickup",
      value: String(readyPickup),
      cohort: "ready_for_pickup",
    },
    atRiskKpi,
    { label: "In shop", value: String(inShop), cohort: "in_shop" },
  ];
}

export async function getControlCenterData(options?: {
  /**
   * Presentation role from the owner's validated "view as" context.
   * Shapes subtitle, KPI selection, financial loading, and the returned
   * capability role; work-order visibility stays scoped to the real user.
   */
  presentationRole?: UserRole;
}): Promise<ControlCenterData> {
  const user = await requireUser();
  const supabase = await createClient();
  const now = new Date();
  const locationId = user.active_location_id!;
  // Floor techs never reach this surface and must not reshape it either.
  const presentationRole =
    options?.presentationRole && !isFloorTech(user.role)
      ? options.presentationRole
      : user.role;

  const selectWithOpened = `
      work_order_id,
      work_order_number,
      status,
      date_created,
      estimated_completion,
      opened_at,
      customer:customer_id (
        customer_id,
        first_name,
        last_name
      ),
      motorcycle:motorcycle_id (
        motorcycle_id,
        year,
        make,
        model,
        vin
      ),
      job ( job_id, status, assigned_technician_id, started_at, updated_at, created_at ),
      recommendation ( severity, status ),
      inspection ( completed_at ),
      drop_off_agreement ( agreement_id )
    `;

  const selectWithoutOpened = `
      work_order_id,
      work_order_number,
      status,
      date_created,
      estimated_completion,
      customer:customer_id (
        customer_id,
        first_name,
        last_name
      ),
      motorcycle:motorcycle_id (
        motorcycle_id,
        year,
        make,
        model,
        vin
      ),
      job ( job_id, status, assigned_technician_id, started_at, updated_at, created_at ),
      recommendation ( severity, status ),
      inspection ( completed_at ),
      drop_off_agreement ( agreement_id )
    `;

  const openedAtSupport = getOptionalColumnSupport(OPTIONAL_COLUMNS.workOrderOpenedAt);
  const woSelect = openedAtSupport === false ? selectWithoutOpened : selectWithOpened;

  const [woResult, membershipResult, clockResult] = await Promise.all([
    supabase
      .from("work_order")
      .select(woSelect)
      .eq("location_id", locationId)
      .in("status", ACTIVE_STATUSES)
      .order("date_created", { ascending: false })
      .limit(300),
    supabase.from("user_location").select("user_id").eq("location_id", locationId),
    supabase
      .from("time_clock_entry")
      .select("user_id")
      .eq("location_id", locationId)
      .is("clock_out_at", null)
      .is("voided_at", null),
  ]);

  let rawData: unknown[] | null = woResult.data as unknown[] | null;
  let woError = woResult.error;
  if (openedAtSupport !== false && isUndefinedColumnError(woResult.error, "opened_at")) {
    setOptionalColumnSupport(OPTIONAL_COLUMNS.workOrderOpenedAt, false);
    const fallback = await supabase
      .from("work_order")
      .select(selectWithoutOpened)
      .eq("location_id", locationId)
      .in("status", ACTIVE_STATUSES)
      .order("date_created", { ascending: false })
      .limit(300);
    rawData = fallback.data as unknown[] | null;
    woError = fallback.error;
  } else if (openedAtSupport !== false && !woResult.error) {
    setOptionalColumnSupport(OPTIONAL_COLUMNS.workOrderOpenedAt, true);
  }

  if (woError) throw woError;
  if (membershipResult.error) throw membershipResult.error;
  if (clockResult.error) throw clockResult.error;

  const rawRows = scopeWorkOrdersForViewer(
    ((rawData ?? []) as unknown as RawRow[]).map((row) => ({
      ...row,
      jobs: row.job,
    })),
    user.role,
    user.user_id
  ) as unknown as RawRow[];

  const workOrderIds = rawRows.map((row) => row.work_order_id);
  const [{ urls: primaryPhotoUrls, counts: photoCounts }, openFlags] = await Promise.all([
    resolveBoardPrimaryPhotos(supabase, workOrderIds),
    listOpenAdminFlagsForWorkOrders(supabase, workOrderIds),
  ]);

  const bikes = rawRows.map((row) =>
    toBike(
      row,
      now,
      primaryPhotoUrls.get(row.work_order_id) ?? null,
      photoCounts.get(row.work_order_id) ?? 0,
      (openFlags.get(row.work_order_id) ?? []).length > 0
    )
  );

  const userIds = (membershipResult.data ?? []).map(
    (row: { user_id: string }) => row.user_id
  );
  const clockedIn = new Set(
    (clockResult.data ?? []).map((row: { user_id: string }) => row.user_id)
  );

  let techRows: Array<{
    user_id: string;
    first_name: string;
    last_name: string;
    role: UserRole;
  }> = [];
  if (userIds.length > 0) {
    const { data, error } = await supabase
      .from("app_user")
      .select("user_id, first_name, last_name, role")
      .in("role", ["technician", "head_tech"])
      .eq("status", "active")
      .in("user_id", userIds)
      .order("last_name")
      .order("first_name");
    if (error) throw error;
    techRows = (data ?? []) as typeof techRows;
  }

  const assignedByTech = new Map<string, ControlCenterBike[]>();
  const pool: ControlCenterBike[] = [];
  for (const bike of bikes) {
    if (bike.technician_id) {
      const list = assignedByTech.get(bike.technician_id) ?? [];
      list.push(bike);
      assignedByTech.set(bike.technician_id, list);
    } else {
      pool.push(bike);
    }
  }

  const techs: ControlCenterTech[] = techRows.map((tech) => {
    const assigned_bikes = assignedByTech.get(tech.user_id) ?? [];
    return {
      user_id: tech.user_id,
      first_name: tech.first_name,
      last_name: tech.last_name,
      role: tech.role,
      availability: deriveTechAvailability({
        clockedIn: clockedIn.has(tech.user_id),
        activeAssignedJobCount: assigned_bikes.length,
      }),
      assigned_bikes,
    };
  });

  // Bikes assigned to a tech not in the location list still show under a ghost? Prefer pool.
  for (const [techId, orphanBikes] of assignedByTech) {
    if (techs.some((t) => t.user_id === techId)) continue;
    for (const bike of orphanBikes) {
      pool.push({ ...bike, technician_id: null });
    }
  }

  const canMoney = canViewReports(presentationRole) && !isFloorTech(presentationRole);
  const ownerMetrics =
    presentationRole === "owner" && canMoney
      ? await loadOwnerTodayMetrics(locationId)
      : null;

  // Owners without report access still get manager KPI strip.
  const kpiRole: UserRole =
    presentationRole === "owner" && !ownerMetrics ? "manager" : presentationRole;

  const kpis = buildKpis({
    role: kpiRole,
    bikes,
    techs,
    ownerMetrics,
  });

  const availableCount = techs.filter((t) => t.availability === "available").length;
  const live_summary = `${bikes.length} bikes · ${availableCount}/${techs.length} techs`;

  return {
    location_id: locationId,
    role: presentationRole,
    subtitle: subtitleForRole(presentationRole),
    pool,
    techs,
    kpis,
    live_summary,
  };
}

/**
 * Work orders completed since local midnight at the active location.
 * Used by Control Center “Completed today” cohort list.
 */
export async function listControlCenterCompletedToday(): Promise<ControlCenterBike[]> {
  const user = await requireUser();
  const supabase = await createClient();
  const locationId = user.active_location_id!;
  const since = startOfTodayIso();
  const now = new Date();

  const select = `
      work_order_id,
      work_order_number,
      status,
      date_created,
      estimated_completion,
      completed_at,
      customer:customer_id (
        customer_id,
        first_name,
        last_name
      ),
      motorcycle:motorcycle_id (
        motorcycle_id,
        year,
        make,
        model,
        vin
      ),
      job ( job_id, status, assigned_technician_id, started_at, updated_at, created_at ),
      recommendation ( severity, status ),
      inspection ( completed_at ),
      drop_off_agreement ( agreement_id )
    `;

  const { data, error } = await supabase
    .from("work_order")
    .select(select)
    .eq("location_id", locationId)
    .eq("status", "completed")
    .gte("completed_at", since)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) throw error;

  const rawRows = (data ?? []) as unknown as RawRow[];
  const workOrderIds = rawRows.map((row) => row.work_order_id);
  const [{ urls: primaryPhotoUrls, counts: photoCounts }, openFlags] = await Promise.all([
    resolveBoardPrimaryPhotos(supabase, workOrderIds),
    listOpenAdminFlagsForWorkOrders(supabase, workOrderIds),
  ]);

  return rawRows.map((row) =>
    toBike(
      row,
      now,
      primaryPhotoUrls.get(row.work_order_id) ?? null,
      photoCounts.get(row.work_order_id) ?? 0,
      (openFlags.get(row.work_order_id) ?? []).length > 0
    )
  );
}
