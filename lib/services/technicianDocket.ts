import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type {
  FloorParkReason,
  FloorWaitOwner,
  JobStatus,
  PitBoardStatus,
  UserRole,
  WorkOrderStatus,
} from "@/lib/database/types";
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
import { groupAssignedJobsByWorkOrder } from "@/lib/technician/groupAssignedWorkOrders";
import {
  isUndefinedColumnError,
  OPTIONAL_COLUMNS,
  getOptionalColumnSupport,
  setOptionalColumnSupport,
} from "@/lib/database/schemaCompat";
import {
  derivePitBoardStatus,
  parkReasonLabel,
  stampForBoard,
  waitOwnerLabel,
  type PitBoardStamp,
} from "@/lib/technician/pitBoard";
import { resolveBoardPrimaryPhotos } from "@/lib/services/photos";
import { techJobPacketHref } from "@/lib/technician/assignmentHref";
import type { DbClient } from "@/lib/database/types";

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
  /** Signed intake front/primary photo for the line-up thumb. */
  primary_photo_url: string | null;
  board_status: PitBoardStatus;
  board_stamp: PitBoardStamp;
  floor_park_reason: FloorParkReason | null;
  floor_wait_owner: FloorWaitOwner | null;
  wait_owner_label: string;
  park_reason_label: string;
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
  floor_acknowledged_at?: string | null;
  floor_parked_at?: string | null;
  floor_park_reason?: FloorParkReason | null;
  floor_wait_owner?: FloorWaitOwner | null;
  job_timer_running?: boolean;
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
  const workOrders = groupAssignedJobsByWorkOrder(orderedJobs);

  for (const group of workOrders) {
    const job = group.representative;
    const serviceNames = [...new Set(group.jobs.map((row) => row.service_name))];
    const serviceLabel = serviceNames.join(" · ");
    const hasOpenFlag = input.flags.some(
      (flag) => flag.work_order_id === job.work_order_id
    );
    const baseStatusLabel =
      group.jobs.length === 1
        ? job.status_label
        : `${group.jobs.length} services · ${job.status_label}`;
    // Only the surface job awaiting approval freezes this bike. Sibling jobs
    // (or pending recommendations that later become jobs) must not park an
    // in-progress / approved original job.
    const awaitingClient = job.status === "waiting_for_approval";
    const boardStatus = derivePitBoardStatus({
      kind: "job",
      job_status: job.status as JobStatus,
      floor_acknowledged_at: job.floor_acknowledged_at ?? null,
      floor_parked_at: job.floor_parked_at ?? null,
      job_timer_running: Boolean(job.job_timer_running),
      is_bench: group.is_active && !job.floor_parked_at && !awaitingClient,
    });
    const effectiveParkReason = awaitingClient
      ? ("approval" as const)
      : (job.floor_park_reason ?? null);
    const effectiveWaitOwner = awaitingClient
      ? ("front_desk" as const)
      : (job.floor_wait_owner ?? null);
    items.push({
      kind: group.is_active ? "now" : "assigned",
      key: `work-order-${job.work_order_id}`,
      motorcycle_label: job.motorcycle_label,
      service_label: serviceLabel,
      title: `${job.motorcycle_label} · ${serviceLabel}`,
      subtitle: job.work_order_number,
      status_label: hasOpenFlag ? `${baseStatusLabel} · Flagged` : baseStatusLabel,
      job_id: job.job_id,
      work_order_id: job.work_order_id,
      href: floorHref({ jobId: job.job_id, workOrderId: job.work_order_id }),
      overview_href: techJobPacketHref(job.work_order_id, {
        jobId: job.job_id,
        section: "notes",
      }),
      board_status: boardStatus,
      board_stamp: stampForBoard({
        status: boardStatus,
        floor_parked_at: job.floor_parked_at ?? null,
        job_timer_running: Boolean(job.job_timer_running),
      }),
      floor_park_reason: effectiveParkReason,
      floor_wait_owner: effectiveWaitOwner,
      wait_owner_label: waitOwnerLabel(effectiveWaitOwner),
      park_reason_label: parkReasonLabel(effectiveParkReason),
      primary_photo_url: null,
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
      overview_href: techJobPacketHref(qc.work_order_id, { section: "notes" }),
      board_status: "check",
      board_stamp: "CHECK",
      floor_park_reason: null,
      floor_wait_owner: null,
      wait_owner_label: "",
      park_reason_label: "",
      primary_photo_url: null,
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
        overview_href: techJobPacketHref(safety.work_order_id, {
          section: "notes",
        }),
        board_status: "safety",
        board_stamp: "CHECK",
        floor_park_reason: null,
        floor_wait_owner: null,
        wait_owner_label: "",
        park_reason_label: "",
        primary_photo_url: null,
      });
    }
  }

  const representedWorkOrders = new Set(items.map((item) => item.work_order_id));

  for (const flag of input.flags) {
    // The selected motorcycle surface shows its open flags; avoid duplicating the
    // same motorcycle as both an assigned card and a separate flag card.
    if (representedWorkOrders.has(flag.work_order_id)) continue;
    items.push({
      kind: "flag",
      key: `flag-${flag.admin_flag_id}`,
      motorcycle_label: flag.motorcycle_label,
      service_label: flag.reason,
      title: `${flag.motorcycle_label} · ${flag.reason}`,
      subtitle: flag.work_order_number,
      status_label: "Admin flag",
      job_id: flag.job_id,
      work_order_id: flag.work_order_id,
      href: floorHref({
        jobId: flag.job_id,
        workOrderId: flag.work_order_id,
      }),
      overview_href: techJobPacketHref(flag.work_order_id, { section: "notes" }),
      board_status: "waiting",
      board_stamp: "HOLD",
      floor_park_reason: null,
      floor_wait_owner: "front_desk",
      wait_owner_label: waitOwnerLabel("front_desk"),
      park_reason_label: flag.reason,
      primary_photo_url: null,
    });
    representedWorkOrders.add(flag.work_order_id);
  }

  return items.map((item, index) => ({ ...item, position: index + 1 }));
}

async function attachDocketPrimaryPhotos(
  supabase: DbClient,
  items: DocketItem[]
): Promise<DocketItem[]> {
  const woIds = [...new Set(items.map((item) => item.work_order_id))];
  if (woIds.length === 0) return items;

  const { urls } = await resolveBoardPrimaryPhotos(supabase, woIds);
  return items.map((item) => ({
    ...item,
    primary_photo_url: urls.get(item.work_order_id) ?? null,
  }));
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

  const floorCols = `
        floor_acknowledged_at, floor_parked_at, floor_park_reason, floor_wait_owner`;
  const jobDocketSelectWithPosition = `
        job_id, service_name_snapshot, status, created_at, docket_position,${floorCols},
        work_order:work_order_id (
          work_order_id, work_order_number, status, location_id,
          motorcycle:motorcycle_id ( year, make, model )
        )
      `;
  const jobDocketSelectWithoutPosition = `
        job_id, service_name_snapshot, status, created_at,${floorCols},
        work_order:work_order_id (
          work_order_id, work_order_number, status, location_id,
          motorcycle:motorcycle_id ( year, make, model )
        )
      `;
  const jobDocketSelectLegacy = `
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
    floor_acknowledged_at?: string | null;
    floor_parked_at?: string | null;
    floor_park_reason?: FloorParkReason | null;
    floor_wait_owner?: FloorWaitOwner | null;
    work_order: unknown;
  };

  let myJobsRaw: unknown[] | null = null;
  const docketSupport = getOptionalColumnSupport(OPTIONAL_COLUMNS.jobDocketPosition);
  const myJobsQuery =
    docketSupport === false
      ? supabase
          .from("job")
          .select(jobDocketSelectWithoutPosition)
          .eq("assigned_technician_id", technicianUserId)
          .not("status", "in", '("completed","cancelled","declined")')
          .order("created_at", { ascending: true })
      : supabase
          .from("job")
          .select(jobDocketSelectWithPosition)
          .eq("assigned_technician_id", technicianUserId)
          .not("status", "in", '("completed","cancelled","declined")')
          .order("created_at", { ascending: true });

  const [first, queueResults] = await Promise.all([
    myJobsQuery,
    Promise.all([
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
    ]),
  ]);

  if (docketSupport !== false && isUndefinedColumnError(first.error, "docket_position")) {
    setOptionalColumnSupport(OPTIONAL_COLUMNS.jobDocketPosition, false);
    // Migration 043_job_docket_position not applied yet — fall back to created_at order.
    const withoutPosition = await supabase
      .from("job")
      .select(jobDocketSelectWithoutPosition)
      .eq("assigned_technician_id", technicianUserId)
      .not("status", "in", '("completed","cancelled","declined")')
      .order("created_at", { ascending: true });
    if (
      withoutPosition.error &&
      isUndefinedColumnError(withoutPosition.error, "floor_acknowledged")
    ) {
      setOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck, false);
      const legacy = await supabase
        .from("job")
        .select(jobDocketSelectLegacy)
        .eq("assigned_technician_id", technicianUserId)
        .not("status", "in", '("completed","cancelled","declined")')
        .order("created_at", { ascending: true });
      if (legacy.error) throw legacy.error;
      myJobsRaw = legacy.data;
    } else if (withoutPosition.error) {
      throw withoutPosition.error;
    } else {
      myJobsRaw = withoutPosition.data;
    }
  } else if (first.error && isUndefinedColumnError(first.error, "floor_acknowledged")) {
    setOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck, false);
    const legacy = await supabase
      .from("job")
      .select(
        docketSupport === false
          ? jobDocketSelectLegacy
          : `
        job_id, service_name_snapshot, status, created_at, docket_position,
        work_order:work_order_id (
          work_order_id, work_order_number, status, location_id,
          motorcycle:motorcycle_id ( year, make, model )
        )
      `
      )
      .eq("assigned_technician_id", technicianUserId)
      .not("status", "in", '("completed","cancelled","declined")')
      .order("created_at", { ascending: true });
    if (legacy.error) throw legacy.error;
    myJobsRaw = legacy.data;
  } else {
    if (first.error) throw first.error;
    if (docketSupport !== false) {
      setOptionalColumnSupport(OPTIONAL_COLUMNS.jobDocketPosition, true);
    }
    setOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck, true);
    myJobsRaw = first.data;
  }

  const [
    { data: qcRows, error: qcError },
    { data: safetyRows, error: safetyError },
    { data: myFlags, error: flagsError },
  ] = queueResults;

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
    // Job rows can linger after the WO is closed — keep those off the floor line.
    if (wo.status === "completed" || wo.status === "cancelled") continue;
    assignedJobs.push({
      job_id: row.job_id,
      work_order_id: wo.work_order_id,
      work_order_number: wo.work_order_number,
      service_name: row.service_name_snapshot,
      motorcycle_label: motorcycleLabel(unwrapMoto(wo)),
      status: row.status as JobStatus,
      status_label: JOB_STATUS_LABELS[row.status as JobStatus] ?? row.status,
      docket_position: row.docket_position ?? null,
      floor_acknowledged_at: row.floor_acknowledged_at ?? null,
      floor_parked_at: row.floor_parked_at ?? null,
      floor_park_reason: row.floor_park_reason ?? null,
      floor_wait_owner: row.floor_wait_owner ?? null,
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

  const bareItems = buildTechnicianDocketItems({
    assignedJobs,
    qcItems,
    safetyItems,
    flags,
    includeSafeties: canPerformSafetyCheck(tech.role as UserRole),
  });
  const items = await attachDocketPrimaryPhotos(supabase, bareItems);

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
