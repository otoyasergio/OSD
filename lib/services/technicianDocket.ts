import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { JobStatus, UserRole, WorkOrderStatus } from "@/lib/database/types";
import {
  canAssignTechnician,
  canPerformSafetyCheck,
  canViewTechnicianDocket,
  isFloorTech,
} from "@/lib/permissions";
import { JOB_STATUS_LABELS, WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";
import {
  moveDocketJob,
  sortByDocketPosition,
  type DocketMoveDirection,
} from "@/lib/technician/docketOrder";
import { isUndefinedColumnError } from "@/lib/database/schemaCompat";

export type DocketItemKind = "now" | "assigned" | "qc" | "safety" | "flag";

export type DocketItem = {
  position: number;
  kind: DocketItemKind;
  key: string;
  /** Primary scan signal — year/make/model. */
  motorcycle_label: string;
  /** Supporting line — service / Peer QC / Safety / flag reason. */
  service_label: string;
  title: string;
  subtitle: string;
  status_label: string;
  job_id: string | null;
  work_order_id: string;
  href: string;
  overview_href: string;
};

export type TechnicianDocket = {
  technician: {
    user_id: string;
    first_name: string;
    last_name: string;
    role: UserRole;
  };
  items: DocketItem[];
};

export type DocketAssignedJobInput = {
  job_id: string;
  work_order_id: string;
  work_order_number: string;
  service_name: string;
  motorcycle_label: string;
  status: string;
  status_label: string;
  /** Advisor-set order within this tech's docket; unpositioned jobs sort last. */
  docket_position?: number | null;
};

export type DocketQcInput = {
  work_order_id: string;
  work_order_number: string;
  motorcycle_label: string;
};

export type DocketSafetyInput = {
  work_order_id: string;
  work_order_number: string;
  motorcycle_label: string;
};

export type DocketFlagInput = {
  admin_flag_id: string;
  work_order_id: string;
  work_order_number: string;
  job_id: string | null;
  motorcycle_label: string;
  reason: string;
  note: string | null;
};

function floorHref(input: {
  jobId?: string | null;
  workOrderId: string;
  stage?: string;
}) {
  const params = new URLSearchParams();
  if (input.jobId) params.set("job", input.jobId);
  params.set("wo", input.workOrderId);
  if (input.stage) params.set("stage", input.stage);
  return `/technician?${params.toString()}`;
}

function motorcycleLabel(
  motorcycle: {
    year: number;
    make: string;
    model: string;
  } | null
): string {
  if (!motorcycle) return "—";
  return `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`;
}

/** Pure builder — numbered What’s next list for one tech’s load. */
export function buildTechnicianDocketItems(input: {
  assignedJobs: DocketAssignedJobInput[];
  qcItems: DocketQcInput[];
  safetyItems: DocketSafetyInput[];
  flags: DocketFlagInput[];
  includeSafeties: boolean;
}): DocketItem[] {
  const items: Omit<DocketItem, "position">[] = [];

  const orderedJobs = sortByDocketPosition(
    input.assignedJobs.map((job) => ({
      ...job,
      docket_position: job.docket_position ?? null,
    }))
  );
  const nowJobs = orderedJobs.filter((job) => job.status === "in_progress");
  const otherJobs = orderedJobs.filter((job) => job.status !== "in_progress");

  for (const job of nowJobs) {
    items.push({
      kind: "now",
      key: `now-${job.job_id}`,
      motorcycle_label: job.motorcycle_label,
      service_label: job.service_name,
      title: `${job.motorcycle_label} · ${job.service_name}`,
      subtitle: job.work_order_number,
      status_label: job.status_label,
      job_id: job.job_id,
      work_order_id: job.work_order_id,
      href: floorHref({ jobId: job.job_id, workOrderId: job.work_order_id }),
      overview_href: `/work_orders/${job.work_order_id}`,
    });
  }

  for (const job of otherJobs) {
    items.push({
      kind: "assigned",
      key: `job-${job.job_id}`,
      motorcycle_label: job.motorcycle_label,
      service_label: job.service_name,
      title: `${job.motorcycle_label} · ${job.service_name}`,
      subtitle: job.work_order_number,
      status_label: job.status_label,
      job_id: job.job_id,
      work_order_id: job.work_order_id,
      href: floorHref({ jobId: job.job_id, workOrderId: job.work_order_id }),
      overview_href: `/work_orders/${job.work_order_id}`,
    });
  }

  for (const qc of input.qcItems) {
    items.push({
      kind: "qc",
      key: `qc-${qc.work_order_id}`,
      motorcycle_label: qc.motorcycle_label,
      service_label: "Peer QC",
      title: `${qc.motorcycle_label} · Peer QC`,
      subtitle: qc.work_order_number,
      status_label: WORK_ORDER_STATUS_LABELS.quality_check,
      job_id: null,
      work_order_id: qc.work_order_id,
      href: floorHref({ workOrderId: qc.work_order_id, stage: "qc" }),
      overview_href: `/work_orders/${qc.work_order_id}`,
    });
  }

  if (input.includeSafeties) {
    for (const safety of input.safetyItems) {
      items.push({
        kind: "safety",
        key: `safety-${safety.work_order_id}`,
        motorcycle_label: safety.motorcycle_label,
        service_label: "Safety",
        title: `${safety.motorcycle_label} · Safety`,
        subtitle: safety.work_order_number,
        status_label: WORK_ORDER_STATUS_LABELS.safety_check,
        job_id: null,
        work_order_id: safety.work_order_id,
        href: floorHref({ workOrderId: safety.work_order_id, stage: "safety" }),
        overview_href: `/work_orders/${safety.work_order_id}`,
      });
    }
  }

  for (const flag of input.flags) {
    items.push({
      kind: "flag",
      key: `flag-${flag.admin_flag_id}`,
      motorcycle_label: flag.motorcycle_label,
      service_label: flag.reason,
      title: `${flag.motorcycle_label} · ${flag.reason}`,
      subtitle: flag.note?.trim() || flag.work_order_number,
      status_label: "Admin flag",
      job_id: flag.job_id,
      work_order_id: flag.work_order_id,
      href: floorHref({
        jobId: flag.job_id,
        workOrderId: flag.work_order_id,
      }),
      overview_href: `/work_orders/${flag.work_order_id}`,
    });
  }

  return items.map((item, index) => ({ ...item, position: index + 1 }));
}

export async function getTechnicianDocket(
  technicianUserId: string
): Promise<TechnicianDocket> {
  const viewer = await requireUser();
  if (!canViewTechnicianDocket(viewer.role, viewer.user_id, technicianUserId)) {
    throw new Error("FORBIDDEN");
  }

  const supabase = await createClient();
  const locationId = viewer.active_location_id!;

  const { data: tech, error: techError } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name, role, status")
    .eq("user_id", technicianUserId)
    .maybeSingle();
  if (techError) throw techError;
  if (!tech || tech.status !== "active" || !isFloorTech(tech.role as UserRole)) {
    throw new Error("TECHNICIAN_NOT_FOUND");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("user_location")
    .select("user_id")
    .eq("user_id", technicianUserId)
    .eq("location_id", locationId)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw new Error("TECHNICIAN_NOT_FOUND");

  const jobDocketSelectWithPosition = `
        job_id, service_name_snapshot, status, created_at, docket_position,
        work_order:work_order_id (
          work_order_id, work_order_number, status, location_id,
          motorcycle:motorcycle_id ( year, make, model )
        )
      `;
  const jobDocketSelectWithoutPosition = `
        job_id, service_name_snapshot, status, created_at,
        work_order:work_order_id (
          work_order_id, work_order_number, status, location_id,
          motorcycle:motorcycle_id ( year, make, model )
        )
      `;

  type DocketJobRow = {
    job_id: string;
    service_name_snapshot: string;
    status: string;
    created_at: string;
    docket_position?: number | null;
    work_order: unknown;
  };

  let myJobsRaw: unknown[] | null = null;
  {
    const withPosition = await supabase
      .from("job")
      .select(jobDocketSelectWithPosition)
      .eq("assigned_technician_id", technicianUserId)
      .not("status", "in", '("completed","cancelled","declined")')
      .order("created_at", { ascending: true });
    if (isUndefinedColumnError(withPosition.error, "docket_position")) {
      // Migration 043_job_docket_position not applied yet — fall back to created_at order.
      const withoutPosition = await supabase
        .from("job")
        .select(jobDocketSelectWithoutPosition)
        .eq("assigned_technician_id", technicianUserId)
        .not("status", "in", '("completed","cancelled","declined")')
        .order("created_at", { ascending: true });
      if (withoutPosition.error) throw withoutPosition.error;
      myJobsRaw = withoutPosition.data;
    } else {
      if (withPosition.error) throw withPosition.error;
      myJobsRaw = withPosition.data;
    }
  }

  const [
    { data: qcRows, error: qcError },
    { data: safetyRows, error: safetyError },
    { data: myFlags, error: flagsError },
  ] = await Promise.all([
    supabase
      .from("work_order")
      .select(
        `
        work_order_id, work_order_number, status, location_id,
        motorcycle:motorcycle_id ( year, make, model )
      `
      )
      .eq("location_id", locationId)
      .eq("status", "quality_check")
      .eq("quality_check_assigned_to", technicianUserId),
    canPerformSafetyCheck(tech.role as UserRole)
      ? supabase
          .from("work_order")
          .select(
            `
            work_order_id, work_order_number, status, location_id,
            motorcycle:motorcycle_id ( year, make, model )
          `
          )
          .eq("location_id", locationId)
          .eq("status", "safety_check")
      : Promise.resolve({ data: [] as unknown[], error: null }),
    supabase
      .from("admin_flag")
      .select(
        "admin_flag_id, work_order_id, job_id, reason, note, created_by_user_id, created_at, cleared_at, cleared_by_user_id"
      )
      .eq("created_by_user_id", technicianUserId)
      .is("cleared_at", null),
  ]);

  if (qcError) throw qcError;
  if (safetyError) throw safetyError;
  if (flagsError) throw flagsError;

  const myJobs = (myJobsRaw ?? []) as DocketJobRow[];

  type NestedWo = {
    work_order_id: string;
    work_order_number: string;
    status: WorkOrderStatus;
    location_id: string;
    motorcycle:
      | { year: number; make: string; model: string }
      | { year: number; make: string; model: string }[]
      | null;
  };

  const unwrapWo = (raw: unknown) => {
    const value = raw as NestedWo | NestedWo[] | null;
    return Array.isArray(value) ? value[0] : value;
  };
  const unwrapMoto = (wo: NestedWo | null | undefined) => {
    if (!wo?.motorcycle) return null;
    return Array.isArray(wo.motorcycle) ? wo.motorcycle[0] : wo.motorcycle;
  };

  const assignedJobs: DocketAssignedJobInput[] = [];
  for (const row of myJobs) {
    const wo = unwrapWo(row.work_order);
    if (!wo || wo.location_id !== locationId) continue;
    assignedJobs.push({
      job_id: row.job_id,
      work_order_id: wo.work_order_id,
      work_order_number: wo.work_order_number,
      service_name: row.service_name_snapshot,
      motorcycle_label: motorcycleLabel(unwrapMoto(wo)),
      status: row.status as JobStatus,
      status_label: JOB_STATUS_LABELS[row.status as JobStatus] ?? row.status,
      docket_position: row.docket_position ?? null,
    });
  }

  const qcItems: DocketQcInput[] = (qcRows ?? []).map((wo) => {
    const moto = Array.isArray(wo.motorcycle) ? wo.motorcycle[0] : wo.motorcycle;
    return {
      work_order_id: wo.work_order_id,
      work_order_number: wo.work_order_number,
      motorcycle_label: motorcycleLabel(moto ?? null),
    };
  });

  const safetyItems: DocketSafetyInput[] = (safetyRows ?? []).map((wo) => {
    const row = wo as {
      work_order_id: string;
      work_order_number: string;
      motorcycle: unknown;
    };
    const motoRaw = row.motorcycle;
    const moto = Array.isArray(motoRaw) ? motoRaw[0] : motoRaw;
    return {
      work_order_id: row.work_order_id,
      work_order_number: row.work_order_number,
      motorcycle_label: motorcycleLabel(
        moto as { year: number; make: string; model: string } | null
      ),
    };
  });

  const flagRows = myFlags ?? [];
  const flags: DocketFlagInput[] = [];
  if (flagRows.length > 0) {
    const woIds = [
      ...new Set(flagRows.map((f: { work_order_id: string }) => f.work_order_id)),
    ];
    const { data: flagWos } = await supabase
      .from("work_order")
      .select(
        `
        work_order_id, work_order_number, location_id,
        motorcycle:motorcycle_id ( year, make, model )
      `
      )
      .in("work_order_id", woIds)
      .eq("location_id", locationId);
    const byId = new Map((flagWos ?? []).map((wo) => [wo.work_order_id, wo]));
    for (const flag of flagRows) {
      const wo = byId.get(flag.work_order_id);
      if (!wo) continue;
      const moto = Array.isArray(wo.motorcycle) ? wo.motorcycle[0] : wo.motorcycle;
      flags.push({
        admin_flag_id: flag.admin_flag_id,
        work_order_id: flag.work_order_id,
        work_order_number: wo.work_order_number,
        job_id: flag.job_id,
        motorcycle_label: motorcycleLabel(moto ?? null),
        reason: flag.reason,
        note: flag.note,
      });
    }
  }

  const items = buildTechnicianDocketItems({
    assignedJobs,
    qcItems,
    safetyItems,
    flags,
    includeSafeties: canPerformSafetyCheck(tech.role as UserRole),
  });

  return {
    technician: {
      user_id: tech.user_id,
      first_name: tech.first_name,
      last_name: tech.last_name,
      role: tech.role as UserRole,
    },
    items,
  };
}

/**
 * Advisor-set reorder of one job within its tech's docket.
 * Renumbers the whole open docket 1..n so positions stay dense.
 */
export async function moveJobInDocket(
  jobId: string,
  direction: DocketMoveDirection
): Promise<void> {
  const user = await requireUser();
  if (!canAssignTechnician(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const locationId = user.active_location_id!;

  const { data: jobRow, error: jobError } = await supabase
    .from("job")
    .select("job_id, assigned_technician_id, work_order:work_order_id ( location_id )")
    .eq("job_id", jobId)
    .maybeSingle();
  if (jobError) throw jobError;
  const jobWo = jobRow
    ? ((Array.isArray(jobRow.work_order) ? jobRow.work_order[0] : jobRow.work_order) as {
        location_id: string;
      } | null)
    : null;
  if (!jobRow?.assigned_technician_id || jobWo?.location_id !== locationId) {
    throw new Error("JOB_NOT_FOUND");
  }

  const { data: rows, error } = await supabase
    .from("job")
    .select(
      "job_id, docket_position, created_at, work_order:work_order_id ( location_id )"
    )
    .eq("assigned_technician_id", jobRow.assigned_technician_id)
    .not("status", "in", '("completed","cancelled","declined")')
    .order("created_at", { ascending: true });
  if (isUndefinedColumnError(error, "docket_position")) {
    // Reorder persists only after migration 043; no-op until then.
    return;
  }
  if (error) throw error;

  const docket = (rows ?? [])
    .filter((row) => {
      const wo = (Array.isArray(row.work_order) ? row.work_order[0] : row.work_order) as {
        location_id: string;
      } | null;
      return wo?.location_id === locationId;
    })
    .map((row) => ({
      job_id: row.job_id as string,
      docket_position: (row.docket_position as number | null) ?? null,
    }));

  const updates = moveDocketJob(docket, jobId, direction);
  if (updates.length === 0) return;

  const timestamp = new Date().toISOString();
  const results = await Promise.all(
    updates.map((update) =>
      supabase
        .from("job")
        .update({
          docket_position: update.docket_position,
          updated_at: timestamp,
        })
        .eq("job_id", update.job_id)
    )
  );
  for (const result of results) {
    if (isUndefinedColumnError(result.error, "docket_position")) return;
    if (result.error) throw result.error;
  }
}

/** Prefer first clocked-in tech among candidates; otherwise first candidate. */
export async function resolveDefaultDocketTechnicianId(
  candidateUserIds: string[]
): Promise<string | null> {
  if (candidateUserIds.length === 0) return null;
  const user = await requireUser();
  const supabase = await createClient();
  const locationId = user.active_location_id!;

  const { data, error } = await supabase
    .from("time_clock_entry")
    .select("user_id")
    .eq("location_id", locationId)
    .is("clock_out_at", null)
    .in("user_id", candidateUserIds)
    .order("clock_in_at", { ascending: true });
  if (error) throw error;

  const clocked = (data ?? []).map((row: { user_id: string }) => row.user_id);
  for (const id of clocked) {
    if (candidateUserIds.includes(id)) return id;
  }
  return candidateUserIds[0] ?? null;
}
