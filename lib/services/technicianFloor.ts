import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { JobStatus, PartStatus, WorkOrderStatus } from "@/lib/database/types";
import { JOB_STATUS_LABELS, WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";
import { formatLabourComparison } from "@/lib/services/labour";
import { listJobChecklist, type JobChecklistItem } from "@/lib/services/jobChecklist";
import { evaluateJobCompleteGate } from "@/lib/status/jobCompleteGate";
import type { AdminFlag } from "@/lib/services/adminFlags";

export type FloorOsMode = "job" | "inspection" | "parts" | "qc" | "notes";

export type FloorQueueItem = {
  key: string;
  kind: "job" | "qc" | "flag";
  job_id: string | null;
  work_order_id: string;
  work_order_number: string;
  title: string;
  subtitle: string;
  status_label: string;
  lane: "priority" | "ready_to_pull" | "needs_qc" | "flagged";
  is_active: boolean;
};

export type FloorPartRow = {
  part_id: string;
  name: string;
  status: PartStatus;
  can_install: boolean;
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
  checklist: JobChecklistItem[];
  parts: FloorPartRow[];
  proof_count: number;
  has_proof_exception: boolean;
  complete_gate_ok: boolean;
  complete_gate_reason: string | null;
  can_start: boolean;
  can_complete: boolean;
  can_pull: boolean;
  is_qc: boolean;
  qc_assignee_is_me: boolean;
  flags: AdminFlag[];
};

export type TechnicianFloorOs = {
  priority: FloorQueueItem[];
  readyToPull: FloorQueueItem[];
  needsQc: FloorQueueItem[];
  flagged: FloorQueueItem[];
  selected: FloorOsSurface | null;
};

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
    customer_label: motorcycle?.customer
      ? `${motorcycle.customer.first_name} ${motorcycle.customer.last_name}`
      : "—",
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

  const [
    { data: myJobs, error: myJobsError },
    { data: pullJobs, error: pullError },
    { data: qcRows, error: qcError },
    { data: myFlags, error: flagsError },
  ] = await Promise.all([
    supabase
      .from("job")
      .select(
        `
        job_id, service_name_snapshot, status, started_at, completed_at,
        estimated_labour_snapshot, assigned_technician_id,
        work_order:work_order_id (
          work_order_id, work_order_number, status, location_id,
          motorcycle:motorcycle_id (
            year, make, model,
            customer:customer_id ( first_name, last_name )
          ),
          inspection ( completed_at )
        )
      `
      )
      .eq("assigned_technician_id", user.user_id)
      .not("status", "in", '("completed","cancelled","declined")'),
    supabase
      .from("job")
      .select(
        `
        job_id, service_name_snapshot, status,
        work_order:work_order_id (
          work_order_id, work_order_number, status, location_id,
          motorcycle:motorcycle_id (
            year, make, model,
            customer:customer_id ( first_name, last_name )
          )
        )
      `
      )
      .is("assigned_technician_id", null)
      .in("status", ["approved", "ready_to_start"]),
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
    supabase
      .from("admin_flag")
      .select(
        "admin_flag_id, work_order_id, job_id, reason, note, created_by_user_id, created_at, cleared_at, cleared_by_user_id"
      )
      .eq("created_by_user_id", user.user_id)
      .is("cleared_at", null),
  ]);

  if (myJobsError) throw myJobsError;
  if (pullError) throw pullError;
  if (qcError) throw qcError;
  if (flagsError) throw flagsError;

  type NestedWo = {
    work_order_id: string;
    work_order_number: string;
    status: WorkOrderStatus;
    location_id: string;
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
    inspection?: Array<{ completed_at: string | null }> | null;
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

  const priority: FloorQueueItem[] = [];
  for (const row of myJobs ?? []) {
    const wo = unwrapWo(row.work_order);
    if (!wo || wo.location_id !== locationId) continue;
    const labels = bikeCustomerLabel(unwrapMoto(wo));
    priority.push({
      key: `job-${row.job_id}`,
      kind: "job",
      job_id: row.job_id,
      work_order_id: wo.work_order_id,
      work_order_number: wo.work_order_number,
      title: `${labels.motorcycle_label} · ${row.service_name_snapshot}`,
      subtitle: labels.customer_label,
      status_label: JOB_STATUS_LABELS[row.status as JobStatus] ?? row.status,
      lane: "priority",
      is_active: row.status === "in_progress",
    });
  }
  priority.sort((a, b) => Number(b.is_active) - Number(a.is_active));

  const readyToPull: FloorQueueItem[] = [];
  for (const row of pullJobs ?? []) {
    const wo = unwrapWo(row.work_order);
    if (!wo || wo.location_id !== locationId) continue;
    if (
      wo.status === "waiting_for_customer_approval" ||
      wo.status === "cancelled" ||
      wo.status === "completed"
    ) {
      continue;
    }
    const labels = bikeCustomerLabel(unwrapMoto(wo));
    readyToPull.push({
      key: `pull-${row.job_id}`,
      kind: "job",
      job_id: row.job_id,
      work_order_id: wo.work_order_id,
      work_order_number: wo.work_order_number,
      title: `${labels.motorcycle_label} · ${row.service_name_snapshot}`,
      subtitle: "Ready to pull",
      status_label: JOB_STATUS_LABELS[row.status as JobStatus] ?? row.status,
      lane: "ready_to_pull",
      is_active: false,
    });
  }

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
      title: `${labels.motorcycle_label} · Peer QC`,
      subtitle: labels.customer_label,
      status_label: WORK_ORDER_STATUS_LABELS.quality_check,
      lane: "needs_qc",
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
      needsQc[0] ??
      readyToPull[0] ??
      flagged[0] ??
      null;
    if (first) {
      selectedJobId = first.job_id;
      selectedWoId = first.work_order_id;
      mode = first.kind === "qc" ? "qc" : "job";
    }
  }

  if (needsQc.some((item) => item.work_order_id === selectedWoId) && !selectedJobId) {
    mode = input.mode ?? "qc";
  }

  let selected: FloorOsSurface | null = null;

  if (selectedJobId) {
    const { data: job, error: jobError } = await supabase
      .from("job")
      .select(
        `
        job_id, service_name_snapshot, status, started_at, completed_at,
        estimated_labour_snapshot, assigned_technician_id,
        work_order:work_order_id (
          work_order_id, work_order_number, status, location_id,
          quality_check_assigned_to,
          motorcycle:motorcycle_id (
            year, make, model,
            customer:customer_id ( first_name, last_name )
          ),
          inspection ( completed_at )
        )
      `
      )
      .eq("job_id", selectedJobId)
      .maybeSingle();
    if (jobError) throw jobError;
    const wo = unwrapWo(job?.work_order);
    if (job && wo && wo.location_id === locationId) {
      const labels = bikeCustomerLabel(unwrapMoto(wo));
      const checklist = await listJobChecklist(job.job_id);
      const { data: parts } = await supabase
        .from("part")
        .select("part_id, name, status")
        .eq("job_id", job.job_id);
      const { data: proofs } = await supabase
        .from("intake_photo")
        .select("photo_id")
        .eq("job_id", job.job_id)
        .eq("category", "job_proof");
      const { data: exceptions } = await supabase
        .from("technician_note")
        .select("technician_note_id")
        .eq("job_id", job.job_id)
        .eq("note_type", "proof_exception")
        .limit(1);
      const { data: openFlags } = await supabase
        .from("admin_flag")
        .select(
          "admin_flag_id, work_order_id, job_id, reason, note, created_by_user_id, created_at, cleared_at, cleared_by_user_id"
        )
        .eq("work_order_id", wo.work_order_id)
        .is("cleared_at", null);

      const gate = evaluateJobCompleteGate({
        checklistItems: checklist,
        parts: (parts as Array<{ status: string }>) ?? [],
        proofPhotoCount: (proofs ?? []).length,
        hasProofException: (exceptions ?? []).length > 0,
      });
      const labour = formatLabourComparison(
        job.estimated_labour_snapshot as number | null,
        job.started_at,
        job.completed_at
      );

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
        inspection_complete: Boolean(wo.inspection?.[0]?.completed_at),
        inspection_href: `/work_orders/${wo.work_order_id}/inspection?returnTo=/technician`,
        overview_href: `/work_orders/${wo.work_order_id}`,
        started_at: job.started_at,
        completed_at: job.completed_at,
        estimated_labour: job.estimated_labour_snapshot as number | null,
        labour_label: labour?.label ?? null,
        labour_over: labour?.overEstimate ?? false,
        checklist,
        parts: (
          (parts as Array<{
            part_id: string;
            name: string;
            status: PartStatus;
          }> | null) ?? []
        ).map((part) => ({
          part_id: part.part_id,
          name: part.name,
          status: part.status,
          can_install:
            part.status !== "installed" &&
            part.status !== "cancelled" &&
            part.status !== "not_required",
        })),
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
        is_qc: false,
        qc_assignee_is_me: false,
        flags: (openFlags as AdminFlag[]) ?? [],
      };
    }
  } else if (selectedWoId) {
    const { data: wo, error: woError } = await supabase
      .from("work_order")
      .select(
        `
        work_order_id, work_order_number, status, location_id, quality_check_assigned_to,
        motorcycle:motorcycle_id (
          year, make, model,
          customer:customer_id ( first_name, last_name )
        ),
        inspection ( completed_at )
      `
      )
      .eq("work_order_id", selectedWoId)
      .maybeSingle();
    if (woError) throw woError;
    if (wo && wo.location_id === locationId) {
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
      const pullItem = readyToPull.find((item) => item.work_order_id === selectedWoId);
      selected = {
        mode: mode === "job" && !pullItem ? "qc" : mode,
        job_id: pullItem?.job_id ?? null,
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
        inspection_complete: Boolean(
          (wo.inspection as Array<{ completed_at: string | null }> | null)?.[0]
            ?.completed_at
        ),
        inspection_href: `/work_orders/${wo.work_order_id}/inspection?returnTo=/technician`,
        overview_href: `/work_orders/${wo.work_order_id}`,
        started_at: null,
        completed_at: null,
        estimated_labour: null,
        labour_label: null,
        labour_over: false,
        checklist: [],
        parts: [],
        proof_count: 0,
        has_proof_exception: false,
        complete_gate_ok: false,
        complete_gate_reason: null,
        can_start: false,
        can_complete: false,
        can_pull: Boolean(pullItem),
        is_qc: wo.status === "quality_check",
        qc_assignee_is_me: wo.quality_check_assigned_to === user.user_id,
        flags: [],
      };
    }
  }

  return { priority, readyToPull, needsQc, flagged, selected };
}
