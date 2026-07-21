import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type {
  FloorParkReason,
  FloorWaitOwner,
  JobStatus,
  PartStatus,
  PitBoardStatus,
  WorkOrderStatus,
} from "@/lib/database/types";
import {
  JOB_STATUS_LABELS,
  PART_STATUS_LABELS,
  WORK_ORDER_STATUS_LABELS,
} from "@/lib/status/labels";
import { formatLabourComparison } from "@/lib/services/labour";
import { listJobChecklist, type JobChecklistItem } from "@/lib/services/jobChecklist";
import { evaluateJobCompleteGate } from "@/lib/status/jobCompleteGate";
import type { AdminFlag } from "@/lib/services/adminFlags";
import { canPerformSafetyCheck } from "@/lib/permissions";
import { canViewerAccessWorkOrder } from "@/lib/workOrders/assignmentVisibility";
import { techJobPacketHref } from "@/lib/technician/assignmentHref";
import { sortByDocketPosition } from "@/lib/technician/docketOrder";
import { groupAssignedJobsByWorkOrder } from "@/lib/technician/groupAssignedWorkOrders";
import {
  hasCompletedInspection,
  type InspectionCompletionRelation,
} from "@/lib/technician/inspectionState";
import {
  getOptionalColumnSupport,
  isUndefinedColumnError,
  OPTIONAL_COLUMNS,
  setOptionalColumnSupport,
} from "@/lib/database/schemaCompat";
import {
  buildPitBoardSteps,
  deriveGoAction,
  derivePitBoardStatus,
  parkReasonLabel,
  stampForBoard,
  waitOwnerLabel,
  type GoLabelResult,
  type PitBoardStamp,
  type PitBoardStep,
} from "@/lib/technician/pitBoard";
import { isTerminalWorkOrderStatus } from "@/lib/technician/floorActionModel";

export type FloorOsMode = "job" | "inspection" | "parts" | "qc" | "notes" | "safety";

export type FloorQueueItem = {
  key: string;
  kind: "job" | "qc" | "flag" | "safety";
  job_id: string | null;
  work_order_id: string;
  work_order_number: string;
  /** Primary scan signal on floor cards. */
  motorcycle_label: string;
  /** Supporting line (service / Peer QC / Safety / flag reason). */
  service_label: string;
  title: string;
  subtitle: string;
  status_label: string;
  lane: "priority" | "ready_to_pull" | "needs_qc" | "safeties" | "flagged";
  is_active: boolean;
};

export type FloorPartRow = {
  part_id: string;
  name: string;
  status: PartStatus;
  can_install: boolean;
};

export type FloorWorkBriefPart = {
  part_id: string;
  name: string;
  status: PartStatus;
  status_label: string;
  can_install: boolean;
  service_name: string;
};

export type FloorJobSummary = {
  job_id: string;
  service_name: string;
  status: JobStatus;
  status_label: string;
  assigned_to_me: boolean;
  is_selected: boolean;
};

export type FloorOsSurface = {
  mode: FloorOsMode;
  job_id: string | null;
  work_order_id: string;
  work_order_number: string;
  service_name: string | null;
  motorcycle_label: string;
  customer_label: string;
  job_status: JobStatus | null;
  job_status_label: string | null;
  wo_status: WorkOrderStatus;
  wo_status_label: string;
  inspection_complete: boolean;
  inspection_href: string;
  overview_href: string;
  started_at: string | null;
  completed_at: string | null;
  estimated_labour: number | null;
  labour_label: string | null;
  labour_over: boolean;
  /** Every non-cancelled service, including manager exceptions assigned elsewhere. */
  jobs: FloorJobSummary[];
  checklist: JobChecklistItem[];
  parts: FloorPartRow[];
  proof_count: number;
  has_proof_exception: boolean;
  complete_gate_ok: boolean;
  complete_gate_reason: string | null;
  can_start: boolean;
  can_complete: boolean;
  can_pull: boolean;
  /** True when this user has an open job_time_entry on the selected job. */
  job_timer_running: boolean;
  is_qc: boolean;
  qc_assignee_is_me: boolean;
  is_safety: boolean;
  can_safety: boolean;
  flags: AdminFlag[];
  /** Pit Board derived board state. */
  board_status: PitBoardStatus;
  board_stamp: PitBoardStamp;
  floor_acknowledged_at: string | null;
  floor_parked_at: string | null;
  floor_park_reason: FloorParkReason | null;
  floor_wait_owner: FloorWaitOwner | null;
  wait_owner_label: string;
  park_reason_label: string;
  steps: PitBoardStep[];
  go: GoLabelResult;
  /** Elapsed seconds from job_time_entry segments (for timer chip). */
  timer_secs: number;
  /** What’s required for the Perform work step. */
  work_brief: {
    service_name: string;
    job_notes: string | null;
    recommendation_description: string | null;
    recommendation_notes: string | null;
    estimated_labour: number | null;
    /** Open parts across the whole work order (for Perform work sheet). */
    parts: FloorWorkBriefPart[];
    technician_notes: Array<{
      technician_note_id: string;
      note: string;
      note_type: string;
      created_at: string;
      author_name: string | null;
    }>;
  } | null;
  /** Findings still waiting on the client before they become Perform work. */
  pending_recommendations: Array<{
    recommendation_id: string;
    description: string;
    severity: string;
  }>;
  /** Clocked-in peers the finishing tech can pick for peer QC. */
  peer_qc_candidates: Array<{ user_id: string; display_name: string }>;
};

export type TechnicianFloorOs = {
  priority: FloorQueueItem[];
  readyToPull: FloorQueueItem[];
  needsQc: FloorQueueItem[];
  safeties: FloorQueueItem[];
  flagged: FloorQueueItem[];
  selected: FloorOsSurface | null;
};

/** Idle home — skip DB fetch when no job/wo is selected. */
export function emptyFloorOs(): TechnicianFloorOs {
  return {
    priority: [],
    readyToPull: [],
    needsQc: [],
    safeties: [],
    flagged: [],
    selected: null,
  };
}

function bikeCustomerLabel(
  motorcycle: {
    year: number;
    make: string;
    model: string;
    customer?: { first_name: string; last_name: string } | null;
  } | null
): { motorcycle_label: string; customer_label: string } {
  return {
    motorcycle_label: motorcycle
      ? `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`
      : "—",
    // Technicians must not see client PII on the floor.
    customer_label: "",
  };
}

export async function getTechnicianFloorOs(input: {
  jobId?: string | null;
  workOrderId?: string | null;
  mode?: FloorOsMode | null;
}): Promise<TechnicianFloorOs> {
  const user = await requireUser();
  const supabase = await createClient();
  const locationId = user.active_location_id!;

  const jobFloorSelectWithPosition = `
        job_id, service_name_snapshot, status, started_at, completed_at,
        estimated_labour_snapshot, assigned_technician_id, created_at, docket_position,
        work_order:work_order_id (
          work_order_id, work_order_number, status, location_id,
          motorcycle:motorcycle_id (
            year, make, model,
            customer:customer_id ( first_name, last_name )
          ),
          inspection ( completed_at )
        )
      `;
  const jobFloorSelectWithoutPosition = `
        job_id, service_name_snapshot, status, started_at, completed_at,
        estimated_labour_snapshot, assigned_technician_id, created_at,
        work_order:work_order_id (
          work_order_id, work_order_number, status, location_id,
          motorcycle:motorcycle_id (
            year, make, model,
            customer:customer_id ( first_name, last_name )
          ),
          inspection ( completed_at )
        )
      `;

  type FloorJobRow = {
    job_id: string;
    service_name_snapshot: string;
    status: string;
    started_at: string | null;
    completed_at: string | null;
    estimated_labour_snapshot: number | null;
    assigned_technician_id: string | null;
    created_at: string;
    docket_position?: number | null;
    work_order: unknown;
  };

  let myJobsRaw: unknown[] | null = null;
  const docketSupport = getOptionalColumnSupport(OPTIONAL_COLUMNS.jobDocketPosition);

  const myJobsQuery =
    docketSupport === false
      ? supabase
          .from("job")
          .select(jobFloorSelectWithoutPosition)
          .eq("assigned_technician_id", user.user_id)
          .not("status", "in", '("completed","cancelled","declined")')
          .order("created_at", { ascending: true })
      : supabase
          .from("job")
          .select(jobFloorSelectWithPosition)
          .eq("assigned_technician_id", user.user_id)
          .not("status", "in", '("completed","cancelled","declined")')
          .order("created_at", { ascending: true });

  const [myJobsFirst, queueResults] = await Promise.all([
    myJobsQuery,
    Promise.all([
      supabase
        .from("work_order")
        .select(
          `
        work_order_id, work_order_number, status, quality_check_assigned_to, location_id,
        motorcycle:motorcycle_id (
          year, make, model,
          customer:customer_id ( first_name, last_name )
        )
      `
        )
        .eq("location_id", locationId)
        .eq("status", "quality_check")
        .eq("quality_check_assigned_to", user.user_id),
      canPerformSafetyCheck(user.role)
        ? supabase
            .from("work_order")
            .select(
              `
            work_order_id, work_order_number, status, location_id,
            motorcycle:motorcycle_id (
              year, make, model,
              customer:customer_id ( first_name, last_name )
            )
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
        .eq("created_by_user_id", user.user_id)
        .is("cleared_at", null),
    ]),
  ]);

  if (
    docketSupport !== false &&
    isUndefinedColumnError(myJobsFirst.error, "docket_position")
  ) {
    setOptionalColumnSupport(OPTIONAL_COLUMNS.jobDocketPosition, false);
    // Migration 043_job_docket_position not applied yet — fall back to created_at order.
    const withoutPosition = await supabase
      .from("job")
      .select(jobFloorSelectWithoutPosition)
      .eq("assigned_technician_id", user.user_id)
      .not("status", "in", '("completed","cancelled","declined")')
      .order("created_at", { ascending: true });
    if (withoutPosition.error) throw withoutPosition.error;
    myJobsRaw = withoutPosition.data;
  } else {
    if (myJobsFirst.error) throw myJobsFirst.error;
    if (docketSupport !== false) {
      setOptionalColumnSupport(OPTIONAL_COLUMNS.jobDocketPosition, true);
    }
    myJobsRaw = myJobsFirst.data;
  }

  const [
    { data: qcRows, error: qcError },
    { data: safetyRows, error: safetyError },
    { data: myFlags, error: flagsError },
  ] = queueResults;

  if (qcError) throw qcError;
  if (safetyError) throw safetyError;
  if (flagsError) throw flagsError;

  const myJobs = (myJobsRaw ?? []) as FloorJobRow[];

  type NestedWo = {
    work_order_id: string;
    work_order_number: string;
    status: WorkOrderStatus;
    location_id: string;
    internal_notes?: string | null;
    motorcycle:
      | {
          year: number;
          make: string;
          model: string;
          customer:
            | { first_name: string; last_name: string }
            | { first_name: string; last_name: string }[]
            | null;
        }
      | Array<{
          year: number;
          make: string;
          model: string;
          customer:
            | { first_name: string; last_name: string }
            | { first_name: string; last_name: string }[]
            | null;
        }>
      | null;
    inspection?: InspectionCompletionRelation;
  };

  const unwrapWo = (raw: unknown) => {
    const value = raw as NestedWo | NestedWo[] | null;
    return Array.isArray(value) ? value[0] : value;
  };

  const unwrapMoto = (wo: NestedWo | null | undefined) => {
    if (!wo?.motorcycle) return null;
    const m = Array.isArray(wo.motorcycle) ? wo.motorcycle[0] : wo.motorcycle;
    if (!m) return null;
    const customer = Array.isArray(m.customer) ? m.customer[0] : m.customer;
    return { ...m, customer };
  };

  // Advisor-set docket order is preserved within active and queued motorcycles.
  const orderedMyJobs = sortByDocketPosition(
    myJobs.map((row) => ({
      ...row,
      docket_position: row.docket_position ?? null,
    }))
  );

  const assignedJobs = orderedMyJobs.flatMap((row) => {
    const wo = unwrapWo(row.work_order);
    if (!wo || wo.location_id !== locationId) return [];
    if (wo.status === "completed" || wo.status === "cancelled") return [];
    return [{ ...row, work_order_id: wo.work_order_id, work_order: wo }];
  });

  const priority: FloorQueueItem[] = [];
  for (const group of groupAssignedJobsByWorkOrder(assignedJobs)) {
    const row = group.representative;
    const wo = row.work_order;
    const labels = bikeCustomerLabel(unwrapMoto(wo));
    const serviceNames = [...new Set(group.jobs.map((job) => job.service_name_snapshot))];
    const serviceLabel = serviceNames.join(" · ");
    const statusLabel = JOB_STATUS_LABELS[row.status as JobStatus] ?? row.status;
    priority.push({
      key: `work-order-${wo.work_order_id}`,
      kind: "job",
      job_id: row.job_id,
      work_order_id: wo.work_order_id,
      work_order_number: wo.work_order_number,
      motorcycle_label: labels.motorcycle_label,
      service_label: serviceLabel,
      title: `${labels.motorcycle_label} · ${serviceLabel}`,
      subtitle: wo.work_order_number,
      status_label:
        group.jobs.length === 1
          ? statusLabel
          : `${group.jobs.length} services · ${statusLabel}`,
      lane: "priority",
      is_active: group.is_active,
    });
  }

  /** Unassigned self-pull queue removed — techs only see assigned work. */
  const readyToPull: FloorQueueItem[] = [];

  const needsQc: FloorQueueItem[] = [];
  for (const wo of qcRows ?? []) {
    const moto = Array.isArray(wo.motorcycle) ? wo.motorcycle[0] : wo.motorcycle;
    const customerRaw = moto?.customer;
    const customer = Array.isArray(customerRaw) ? customerRaw[0] : customerRaw;
    const labels = bikeCustomerLabel(
      moto
        ? {
            year: moto.year,
            make: moto.make,
            model: moto.model,
            customer: customer ?? null,
          }
        : null
    );
    needsQc.push({
      key: `qc-${wo.work_order_id}`,
      kind: "qc",
      job_id: null,
      work_order_id: wo.work_order_id,
      work_order_number: wo.work_order_number,
      motorcycle_label: labels.motorcycle_label,
      service_label: "Peer QC",
      title: `${labels.motorcycle_label} · Peer QC`,
      subtitle: wo.work_order_number,
      status_label: WORK_ORDER_STATUS_LABELS.quality_check,
      lane: "needs_qc",
      is_active: false,
    });
  }

  const safeties: FloorQueueItem[] = [];
  for (const wo of safetyRows ?? []) {
    const row = wo as {
      work_order_id: string;
      work_order_number: string;
      motorcycle: unknown;
    };
    const motoRaw = row.motorcycle;
    const moto = Array.isArray(motoRaw) ? motoRaw[0] : motoRaw;
    const customerRaw = moto?.customer;
    const customer = Array.isArray(customerRaw) ? customerRaw[0] : customerRaw;
    const labels = bikeCustomerLabel(
      moto
        ? {
            year: moto.year,
            make: moto.make,
            model: moto.model,
            customer: customer ?? null,
          }
        : null
    );
    safeties.push({
      key: `safety-${row.work_order_id}`,
      kind: "safety",
      job_id: null,
      work_order_id: row.work_order_id,
      work_order_number: row.work_order_number,
      motorcycle_label: labels.motorcycle_label,
      service_label: "Safety",
      title: `${labels.motorcycle_label} · Safety`,
      subtitle: row.work_order_number,
      status_label: WORK_ORDER_STATUS_LABELS.safety_check,
      lane: "safeties",
      is_active: false,
    });
  }

  const flagged: FloorQueueItem[] = [];
  const flagRows = (myFlags ?? []) as AdminFlag[];
  if (flagRows.length > 0) {
    const woIds = [...new Set(flagRows.map((f) => f.work_order_id))];
    const { data: flagWos } = await supabase
      .from("work_order")
      .select(
        `
        work_order_id, work_order_number, status, location_id,
        motorcycle:motorcycle_id (
          year, make, model,
          customer:customer_id ( first_name, last_name )
        )
      `
      )
      .in("work_order_id", woIds)
      .eq("location_id", locationId);
    const byId = new Map((flagWos ?? []).map((wo) => [wo.work_order_id, wo]));
    for (const flag of flagRows) {
      const wo = byId.get(flag.work_order_id);
      if (!wo) continue;
      // Uncleared flags on completed/cancelled work orders are stale — skip.
      if (isTerminalWorkOrderStatus(wo.status)) continue;
      const moto = Array.isArray(wo.motorcycle) ? wo.motorcycle[0] : wo.motorcycle;
      const customerRaw = moto?.customer;
      const customer = Array.isArray(customerRaw) ? customerRaw[0] : customerRaw;
      const labels = bikeCustomerLabel(
        moto
          ? {
              year: moto.year,
              make: moto.make,
              model: moto.model,
              customer: customer ?? null,
            }
          : null
      );
      flagged.push({
        key: `flag-${flag.admin_flag_id}`,
        kind: "flag",
        job_id: flag.job_id,
        work_order_id: flag.work_order_id,
        work_order_number: wo.work_order_number,
        motorcycle_label: labels.motorcycle_label,
        service_label: flag.reason,
        title: `${labels.motorcycle_label} · ${flag.reason}`,
        subtitle: flag.note ?? "Flagged for admin",
        status_label: "Admin flag",
        lane: "flagged",
        is_active: false,
      });
    }
  }

  let selectedJobId = input.jobId ?? null;
  let selectedWoId = input.workOrderId ?? null;
  let mode: FloorOsMode = input.mode ?? "job";

  if (!selectedJobId && !selectedWoId) {
    const first =
      priority.find((item) => item.is_active) ??
      priority[0] ??
      safeties[0] ??
      needsQc[0] ??
      readyToPull[0] ??
      flagged[0] ??
      null;
    if (first) {
      selectedJobId = first.job_id;
      selectedWoId = first.work_order_id;
      mode = first.kind === "qc" ? "qc" : first.kind === "safety" ? "safety" : "job";
    }
  }

  // Flagged / WO-only selection: prefer the tech's open job on that WO.
  if (!selectedJobId && selectedWoId) {
    const mine = priority.find((item) => item.work_order_id === selectedWoId);
    if (mine?.job_id) selectedJobId = mine.job_id;
  }

  if (needsQc.some((item) => item.work_order_id === selectedWoId) && !selectedJobId) {
    mode = input.mode ?? "qc";
  }
  if (safeties.some((item) => item.work_order_id === selectedWoId) && !selectedJobId) {
    mode = input.mode ?? "safety";
  }

  let selected: FloorOsSurface | null = null;

  if (selectedJobId) {
    const floorSupport = getOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck);
    const jobSelectBase = `
        job_id, service_name_snapshot, status, started_at, completed_at,
        estimated_labour_snapshot, assigned_technician_id, notes`;
    const jobSelectFloor = `,
        floor_acknowledged_at, floor_acknowledged_by,
        floor_parked_at, floor_park_reason, floor_wait_owner`;
    const jobSelectWo = `,
        work_order:work_order_id (
          work_order_id, work_order_number, status, location_id,
          quality_check_assigned_to, internal_notes,
          motorcycle:motorcycle_id (
            year, make, model,
            customer:customer_id ( first_name, last_name )
          ),
          inspection ( completed_at )
        )
      `;
    let jobResult = await supabase
      .from("job")
      .select(
        floorSupport === false
          ? `${jobSelectBase}${jobSelectWo}`
          : `${jobSelectBase}${jobSelectFloor}${jobSelectWo}`
      )
      .eq("job_id", selectedJobId)
      .maybeSingle();
    if (
      floorSupport !== false &&
      isUndefinedColumnError(jobResult.error, "floor_acknowledged")
    ) {
      setOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck, false);
      jobResult = await supabase
        .from("job")
        .select(`${jobSelectBase}${jobSelectWo}`)
        .eq("job_id", selectedJobId)
        .maybeSingle();
    } else if (!jobResult.error && floorSupport !== false) {
      setOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck, true);
    }
    const { data: jobRaw, error: jobError } = jobResult;
    if (jobError) throw jobError;
    const job = jobRaw as unknown as {
      job_id: string;
      service_name_snapshot: string;
      status: string;
      started_at: string | null;
      completed_at: string | null;
      estimated_labour_snapshot: number | null;
      assigned_technician_id: string | null;
      notes: string | null;
      floor_acknowledged_at?: string | null;
      floor_parked_at?: string | null;
      floor_park_reason?: FloorParkReason | null;
      floor_wait_owner?: FloorWaitOwner | null;
      work_order: unknown;
    } | null;
    const wo = unwrapWo(job?.work_order);
    // Stale direct links (?job=&wo=) to completed/cancelled work orders show
    // the empty "Pick a bike" state instead of a dead surface.
    if (
      job &&
      wo &&
      wo.location_id === locationId &&
      !isTerminalWorkOrderStatus(wo.status) &&
      job.assigned_technician_id === user.user_id
    ) {
      const labels = bikeCustomerLabel(unwrapMoto(wo));
      const { listPeerQcPickerOptions } = await import("@/lib/services/peerQc");
      const [
        checklist,
        partsResult,
        proofsResult,
        exceptionsResult,
        openFlagsResult,
        workOrderJobsResult,
        recommendationResult,
        pendingRecommendationsResult,
        technicianNotesResult,
        peerQcCandidates,
      ] = await Promise.all([
        listJobChecklist(job.job_id, supabase),
        supabase
          .from("part")
          .select("part_id, part_name, status, job_id")
          .eq("job_id", job.job_id),
        supabase
          .from("intake_photo")
          .select("photo_id")
          .eq("job_id", job.job_id)
          .eq("category", "job_proof"),
        supabase
          .from("technician_note")
          .select("technician_note_id")
          .eq("job_id", job.job_id)
          .eq("note_type", "proof_exception")
          .limit(1),
        supabase
          .from("admin_flag")
          .select(
            "admin_flag_id, work_order_id, job_id, reason, note, created_by_user_id, created_at, cleared_at, cleared_by_user_id"
          )
          .eq("work_order_id", wo.work_order_id)
          .is("cleared_at", null),
        supabase
          .from("job")
          .select(
            "job_id, service_name_snapshot, status, assigned_technician_id, created_at"
          )
          .eq("work_order_id", wo.work_order_id)
          .not("status", "in", '("cancelled","declined")')
          .order("created_at", { ascending: true }),
        supabase
          .from("recommendation")
          .select("description, notes")
          .eq("converted_job_id", job.job_id)
          .maybeSingle(),
        supabase
          .from("recommendation")
          .select("recommendation_id, description, severity")
          .eq("work_order_id", wo.work_order_id)
          .eq("status", "pending")
          .order("created_at", { ascending: true }),
        supabase
          .from("technician_note")
          .select(
            `
            technician_note_id,
            note,
            note_type,
            created_at,
            created_by:created_by_user_id (
              first_name,
              last_name
            )
          `
          )
          .eq("work_order_id", wo.work_order_id)
          .eq("job_id", job.job_id)
          .order("created_at", { ascending: false })
          .limit(20),
        listPeerQcPickerOptions(user.user_id).catch(() => []),
      ]);
      const { data: parts } = partsResult;
      const { data: proofs } = proofsResult;
      const { data: exceptions } = exceptionsResult;
      const { data: openFlags } = openFlagsResult;
      const { data: workOrderJobs } = workOrderJobsResult;
      const recommendation = recommendationResult.data as {
        description: string;
        notes: string | null;
      } | null;
      const pendingRecommendations = (pendingRecommendationsResult.data ?? []) as Array<{
        recommendation_id: string;
        description: string;
        severity: string;
      }>;
      const technicianNotes = (technicianNotesResult.data ?? []).map((row) => {
        const createdByRaw = row.created_by as
          | { first_name: string; last_name: string }
          | { first_name: string; last_name: string }[]
          | null;
        const createdBy = Array.isArray(createdByRaw) ? createdByRaw[0] : createdByRaw;
        return {
          technician_note_id: row.technician_note_id as string,
          note: row.note as string,
          note_type: row.note_type as string,
          created_at: row.created_at as string,
          author_name: createdBy
            ? `${createdBy.first_name} ${createdBy.last_name}`.trim()
            : null,
        };
      });

      const inspectionComplete = hasCompletedInspection(wo.inspection);
      const gate = evaluateJobCompleteGate({
        checklistItems: checklist,
        parts: (parts as Array<{ status: string }>) ?? [],
        proofPhotoCount: (proofs ?? []).length,
        hasProofException: (exceptions ?? []).length > 0,
        inspectionComplete,
      });
      const { sumJobTimeMs, getOpenJobTimeEntry } =
        await import("@/lib/services/jobTimeClock");
      const { data: jobTimeRows } = await supabase
        .from("job_time_entry")
        .select("started_at, ended_at, user_id, job_id")
        .eq("job_id", job.job_id);
      const segmentMs = sumJobTimeMs(jobTimeRows ?? []);
      const openJobTimer = await getOpenJobTimeEntry(user.user_id).catch(() => null);
      const labour = formatLabourComparison(
        job.estimated_labour_snapshot as number | null,
        job.started_at,
        job.completed_at,
        {
          actualMsFromSegments: (jobTimeRows ?? []).length > 0 ? segmentMs : null,
        }
      );
      const returnTo = encodeURIComponent(
        `/technician?job=${job.job_id}&wo=${wo.work_order_id}`
      );

      const floorAck =
        (job as { floor_acknowledged_at?: string | null }).floor_acknowledged_at ?? null;
      const floorParked =
        (job as { floor_parked_at?: string | null }).floor_parked_at ?? null;
      const floorParkReason = ((job as { floor_park_reason?: FloorParkReason | null })
        .floor_park_reason ?? null) as FloorParkReason | null;
      const floorWaitOwner = ((job as { floor_wait_owner?: FloorWaitOwner | null })
        .floor_wait_owner ?? null) as FloorWaitOwner | null;
      const timerRunning = Boolean(
        openJobTimer && openJobTimer.job_id === job.job_id && !openJobTimer.ended_at
      );
      const awaitingClient = job.status === "waiting_for_approval";
      const boardStatus = derivePitBoardStatus({
        kind: "job",
        job_status: job.status as JobStatus,
        floor_acknowledged_at: floorAck,
        floor_parked_at: floorParked,
        job_timer_running: timerRunning,
        is_bench: job.status === "in_progress" && !floorParked && !awaitingClient,
      });
      const effectiveParkReason = awaitingClient
        ? ("approval" as FloorParkReason)
        : floorParkReason;
      const effectiveWaitOwner = awaitingClient
        ? ("front_desk" as FloorWaitOwner)
        : floorWaitOwner;
      const partsRows = (
        (parts as Array<{
          part_id: string;
          part_name: string;
          status: PartStatus;
        }> | null) ?? []
      ).map((part) => ({
        part_id: part.part_id,
        name: part.part_name,
        status: part.status,
        can_install:
          part.status !== "installed" &&
          part.status !== "cancelled" &&
          part.status !== "not_required",
      }));

      const workOrderJobRows = (workOrderJobs ?? []) as Array<{
        job_id: string;
        service_name_snapshot: string;
      }>;
      const serviceNameByJobId = new Map(
        workOrderJobRows.map((workOrderJob) => [
          workOrderJob.job_id,
          workOrderJob.service_name_snapshot,
        ])
      );
      const workOrderJobIds = workOrderJobRows.map((workOrderJob) => workOrderJob.job_id);
      let woOpenParts: FloorWorkBriefPart[] = [];
      if (workOrderJobIds.length > 0) {
        const { data: woPartsRaw } = await supabase
          .from("part")
          .select("part_id, part_name, status, job_id")
          .in("job_id", workOrderJobIds)
          .not("status", "in", '("installed","cancelled","not_required")')
          .order("created_at", { ascending: true });
        woOpenParts = (
          (woPartsRaw ?? []) as Array<{
            part_id: string;
            part_name: string;
            status: PartStatus;
            job_id: string;
          }>
        ).map((part) => ({
          part_id: part.part_id,
          name: part.part_name,
          status: part.status,
          status_label: PART_STATUS_LABELS[part.status] ?? part.status,
          can_install:
            part.status !== "installed" &&
            part.status !== "cancelled" &&
            part.status !== "not_required",
          service_name: serviceNameByJobId.get(part.job_id) ?? "Job",
        }));
      }
      const steps = buildPitBoardSteps({
        inspection_complete: inspectionComplete,
        service_name: job.service_name_snapshot,
        checklist,
        parts: partsRows,
        proof_count: (proofs ?? []).length,
        has_proof_exception: (exceptions ?? []).length > 0,
        complete_gate_ok: gate.ok,
      });
      const go = deriveGoAction({
        status: boardStatus,
        steps,
        complete_gate_ok: gate.ok,
        // Only this job awaiting approval freezes Go — WO-level pending
        // recommendations are informational and become separate docket jobs.
        awaiting_client_approval: awaitingClient,
      });
      const jobNotes =
        [job.notes?.trim(), wo.internal_notes?.trim()].filter(Boolean).join("\n\n") ||
        null;

      selected = {
        mode,
        job_id: job.job_id,
        work_order_id: wo.work_order_id,
        work_order_number: wo.work_order_number,
        service_name: job.service_name_snapshot,
        motorcycle_label: labels.motorcycle_label,
        customer_label: labels.customer_label,
        job_status: job.status as JobStatus,
        job_status_label: JOB_STATUS_LABELS[job.status as JobStatus] ?? job.status,
        wo_status: wo.status,
        wo_status_label:
          WORK_ORDER_STATUS_LABELS[wo.status as WorkOrderStatus] ?? wo.status,
        inspection_complete: inspectionComplete,
        inspection_href: `/work_orders/${wo.work_order_id}/inspection?returnTo=${returnTo}`,
        overview_href: techJobPacketHref(wo.work_order_id, {
          jobId: job.job_id,
          section: "notes",
        }),
        started_at: job.started_at,
        completed_at: job.completed_at,
        estimated_labour: job.estimated_labour_snapshot as number | null,
        labour_label: labour?.label ?? null,
        labour_over: labour?.overEstimate ?? false,
        jobs: (workOrderJobs ?? []).map((workOrderJob) => ({
          job_id: workOrderJob.job_id,
          service_name: workOrderJob.service_name_snapshot,
          status: workOrderJob.status as JobStatus,
          status_label:
            JOB_STATUS_LABELS[workOrderJob.status as JobStatus] ?? workOrderJob.status,
          assigned_to_me: workOrderJob.assigned_technician_id === user.user_id,
          is_selected: workOrderJob.job_id === job.job_id,
        })),
        checklist,
        parts: partsRows,
        proof_count: (proofs ?? []).length,
        has_proof_exception: (exceptions ?? []).length > 0,
        complete_gate_ok: gate.ok,
        complete_gate_reason: gate.ok ? null : gate.reason,
        can_start:
          job.assigned_technician_id === user.user_id &&
          (job.status === "approved" || job.status === "ready_to_start"),
        can_complete:
          job.assigned_technician_id === user.user_id && job.status === "in_progress",
        can_pull: false,
        job_timer_running: timerRunning,
        is_qc: false,
        qc_assignee_is_me: false,
        is_safety: wo.status === "safety_check",
        can_safety: canPerformSafetyCheck(user.role) && wo.status === "safety_check",
        flags: (openFlags as AdminFlag[]) ?? [],
        board_status: boardStatus,
        board_stamp: stampForBoard({
          status: boardStatus,
          floor_parked_at: floorParked,
          job_timer_running: timerRunning,
        }),
        floor_acknowledged_at: floorAck,
        floor_parked_at: floorParked,
        floor_park_reason: effectiveParkReason,
        floor_wait_owner: effectiveWaitOwner,
        wait_owner_label: waitOwnerLabel(effectiveWaitOwner),
        park_reason_label: parkReasonLabel(effectiveParkReason),
        steps,
        go,
        timer_secs: Math.floor(segmentMs / 1000),
        peer_qc_candidates: peerQcCandidates,
        work_brief: {
          service_name: job.service_name_snapshot,
          job_notes: jobNotes,
          recommendation_description: recommendation?.description ?? null,
          recommendation_notes: recommendation?.notes ?? null,
          estimated_labour: job.estimated_labour_snapshot as number | null,
          parts: woOpenParts,
          technician_notes: technicianNotes,
        },
        pending_recommendations: pendingRecommendations,
      };
    }
  } else if (selectedWoId) {
    const { data: wo, error: woError } = await supabase
      .from("work_order")
      .select(
        `
        work_order_id, work_order_number, status, location_id,
        primary_technician_id, quality_check_assigned_to,
        motorcycle:motorcycle_id (
          year, make, model,
          customer:customer_id ( first_name, last_name )
        ),
        inspection ( completed_at ),
        job (
          job_id, service_name_snapshot, status, assigned_technician_id, created_at
        )
      `
      )
      .eq("work_order_id", selectedWoId)
      .maybeSingle();
    if (woError) throw woError;
    if (
      wo &&
      wo.location_id === locationId &&
      !isTerminalWorkOrderStatus(wo.status) &&
      canViewerAccessWorkOrder(
        {
          primary_technician_id: wo.primary_technician_id,
          quality_check_assigned_to: wo.quality_check_assigned_to,
          status: wo.status,
          jobs: (wo.job as Array<{ assigned_technician_id: string | null }> | null) ?? [],
        },
        user.role,
        user.user_id
      )
    ) {
      const moto = Array.isArray(wo.motorcycle) ? wo.motorcycle[0] : wo.motorcycle;
      const customerRaw = moto?.customer;
      const customer = Array.isArray(customerRaw) ? customerRaw[0] : customerRaw;
      const labels = bikeCustomerLabel(
        moto
          ? {
              year: moto.year,
              make: moto.make,
              model: moto.model,
              customer: customer ?? null,
            }
          : null
      );
      const [{ data: openFlags }, { data: pendingRecs }] = await Promise.all([
        supabase
          .from("admin_flag")
          .select(
            "admin_flag_id, work_order_id, job_id, reason, note, created_by_user_id, created_at, cleared_at, cleared_by_user_id"
          )
          .eq("work_order_id", wo.work_order_id)
          .is("cleared_at", null),
        supabase
          .from("recommendation")
          .select("recommendation_id, description, severity")
          .eq("work_order_id", wo.work_order_id)
          .eq("status", "pending")
          .order("created_at", { ascending: true }),
      ]);
      const returnTo = encodeURIComponent(`/technician?wo=${wo.work_order_id}`);
      const isSafety = wo.status === "safety_check";
      const isQc = wo.status === "quality_check";
      // A work-order-only selection is only a QC surface when the WO is
      // actually in quality_check — everything else is a view-only wait.
      const boardStatus = derivePitBoardStatus({
        kind: isSafety ? "safety" : isQc ? "qc" : "flag",
        job_status: null,
        floor_acknowledged_at: null,
        floor_parked_at: null,
        job_timer_running: false,
        is_bench: false,
      });
      const go = deriveGoAction({
        status: boardStatus,
        steps: [],
        complete_gate_ok: false,
        qc_checks_done: false,
      });
      selected = {
        mode: mode === "job" && (isSafety || isQc) ? (isSafety ? "safety" : "qc") : mode,
        job_id: null,
        work_order_id: wo.work_order_id,
        work_order_number: wo.work_order_number,
        service_name: null,
        motorcycle_label: labels.motorcycle_label,
        customer_label: labels.customer_label,
        job_status: null,
        job_status_label: null,
        wo_status: wo.status,
        wo_status_label:
          WORK_ORDER_STATUS_LABELS[wo.status as WorkOrderStatus] ?? wo.status,
        inspection_complete: hasCompletedInspection(
          wo.inspection as InspectionCompletionRelation
        ),
        inspection_href: `/work_orders/${wo.work_order_id}/inspection?returnTo=${returnTo}`,
        overview_href: techJobPacketHref(wo.work_order_id, { section: "notes" }),
        started_at: null,
        completed_at: null,
        estimated_labour: null,
        labour_label: null,
        labour_over: false,
        jobs: (
          (wo.job as Array<{
            job_id: string;
            service_name_snapshot: string;
            status: JobStatus;
            assigned_technician_id: string | null;
            created_at: string;
          }> | null) ?? []
        )
          .filter(
            (workOrderJob) => !["cancelled", "declined"].includes(workOrderJob.status)
          )
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((workOrderJob) => ({
            job_id: workOrderJob.job_id,
            service_name: workOrderJob.service_name_snapshot,
            status: workOrderJob.status,
            status_label: JOB_STATUS_LABELS[workOrderJob.status] ?? workOrderJob.status,
            assigned_to_me: workOrderJob.assigned_technician_id === user.user_id,
            is_selected: false,
          })),
        checklist: [],
        parts: [],
        proof_count: 0,
        has_proof_exception: false,
        complete_gate_ok: false,
        complete_gate_reason: null,
        can_start: false,
        can_complete: false,
        can_pull: false,
        job_timer_running: false,
        is_qc: isQc,
        qc_assignee_is_me: wo.quality_check_assigned_to === user.user_id,
        is_safety: isSafety,
        can_safety: canPerformSafetyCheck(user.role) && isSafety,
        flags: (openFlags as AdminFlag[]) ?? [],
        board_status: boardStatus,
        board_stamp: stampForBoard({
          status: boardStatus,
          floor_parked_at: null,
          job_timer_running: false,
        }),
        floor_acknowledged_at: null,
        floor_parked_at: null,
        floor_park_reason: null,
        floor_wait_owner: null,
        wait_owner_label: "",
        park_reason_label: "",
        steps: [],
        go,
        timer_secs: 0,
        work_brief: null,
        peer_qc_candidates: [],
        pending_recommendations: (pendingRecs ?? []) as Array<{
          recommendation_id: string;
          description: string;
          severity: string;
        }>,
      };
    }
  }

  return { priority, readyToPull, needsQc, safeties, flagged, selected };
}
