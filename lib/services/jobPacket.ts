import { requireUser } from "@/lib/auth/session";
import { resolveReadSubject, type ReadView } from "@/lib/auth/role-preview-shared";
import { createClient } from "@/lib/database/supabase-server";
import type { JobStatus, WorkOrderStatus } from "@/lib/database/types";
import { JOB_STATUS_LABELS, WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";
import {
  JOB_ORIGIN_LABELS,
  isTechDoesThisStatus,
  jobAuthorizationLabel,
  jobWorkLabel,
  normalizeJobOrigin,
} from "@/lib/work-orders/visitWorkList";
import { listTechnicianNotes, type TechnicianNote } from "@/lib/services/notes";
import {
  assertViewerCanAccessWorkOrder,
  canViewerAccessWorkOrderLocation,
} from "@/lib/workOrders/assignmentVisibility";

export type JobPacketJob = {
  job_id: string;
  service_name: string;
  status: JobStatus;
  status_label: string;
  authorization_label: string | null;
  work_label: string;
  origin: import("@/lib/database/types").JobOrigin;
  origin_label: string;
  assigned_technician_id: string | null;
  assigned_to_me: boolean;
  is_tech_work: boolean;
  floor_href: string; // /technician?wo=&job=
};

export type JobPacket = {
  work_order_id: string;
  work_order_number: string;
  wo_status: WorkOrderStatus;
  wo_status_label: string;
  motorcycle_label: string;
  jobs: JobPacketJob[];
  notes: TechnicianNote[];
  /** Intentionally empty — photos load in a separate client/server action when section opens */
};

/** Floor deep-link that closes the packet (no `panel=packet`). */
export function jobFloorHref(workOrderId: string, jobId: string): string {
  const params = new URLSearchParams();
  params.set("wo", workOrderId);
  params.set("job", jobId);
  return `/technician?${params.toString()}`;
}

type PacketJobRow = {
  job_id: string;
  service_name_snapshot: string;
  status: JobStatus;
  origin?: string | null;
  assigned_technician_id: string | null;
  created_at: string;
};

/** Pure mapper for unit tests / loader. */
export function mapJobPacketJobs(
  jobs: PacketJobRow[],
  workOrderId: string,
  viewerUserId: string
): JobPacketJob[] {
  return jobs
    .filter((job) => !["cancelled", "declined"].includes(job.status))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((job) => {
      const origin = normalizeJobOrigin(job.origin);
      return {
        job_id: job.job_id,
        service_name: job.service_name_snapshot,
        status: job.status,
        status_label: JOB_STATUS_LABELS[job.status] ?? job.status,
        authorization_label: jobAuthorizationLabel(job.status),
        work_label: jobWorkLabel(job.status),
        origin,
        origin_label: JOB_ORIGIN_LABELS[origin],
        assigned_technician_id: job.assigned_technician_id,
        assigned_to_me: job.assigned_technician_id === viewerUserId,
        is_tech_work: isTechDoesThisStatus(job.status),
        floor_href: jobFloorHref(workOrderId, job.job_id),
      };
    });
}

function motorcycleLabel(
  motorcycle: { year: number; make: string; model: string } | null | undefined
): string {
  if (!motorcycle) return "—";
  return `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`;
}

/**
 * Lightweight work-order context for the in-floor Job packet.
 * Does not load intake/proof photos — those load when the photos section opens.
 */
export async function getJobPacket(
  workOrderId: string,
  options?: {
    /** Trusted presentation principal (owner "view as") — read shaping only. */
    view?: ReadView;
  }
): Promise<JobPacket | null> {
  const user = await requireUser();
  const subject = resolveReadSubject(user, options?.view);
  const supabase = await createClient();
  const locationId = user.active_location_id!;

  const { data: wo, error: woError } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id, work_order_number, status, location_id,
      primary_technician_id, quality_check_assigned_to,
      motorcycle:motorcycle_id (
        year, make, model
      ),
      job (
        job_id, service_name_snapshot, status, origin, assigned_technician_id, created_at
      )
    `
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (woError) throw woError;
  if (!wo) return null;
  if (
    !canViewerAccessWorkOrderLocation({
      role: user.role,
      workOrderLocationId: wo.location_id,
      activeLocationId: locationId,
      membershipLocationIds: user.location_ids,
    })
  ) {
    return null;
  }

  const jobRows = (wo.job as PacketJobRow[] | null) ?? [];

  assertViewerCanAccessWorkOrder(
    {
      primary_technician_id: wo.primary_technician_id,
      quality_check_assigned_to: wo.quality_check_assigned_to,
      status: wo.status,
      jobs: jobRows,
    },
    subject.role,
    subject.userId
  );

  const moto = Array.isArray(wo.motorcycle) ? wo.motorcycle[0] : wo.motorcycle;
  const notes = await listTechnicianNotes(workOrderId);

  return {
    work_order_id: wo.work_order_id,
    work_order_number: wo.work_order_number,
    wo_status: wo.status as WorkOrderStatus,
    wo_status_label: WORK_ORDER_STATUS_LABELS[wo.status as WorkOrderStatus] ?? wo.status,
    motorcycle_label: motorcycleLabel(
      moto ? { year: moto.year, make: moto.make, model: moto.model } : null
    ),
    jobs: mapJobPacketJobs(jobRows, wo.work_order_id, subject.userId),
    notes,
  };
}
