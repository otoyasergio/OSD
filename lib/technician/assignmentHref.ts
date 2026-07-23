import {
  isFloorStage,
  technicianPacketHref,
  type JobPacketSection,
} from "@/lib/technician/routeState";

export type { JobPacketSection };

export function staffAssignmentHref(workOrderId: string): string {
  return `/technician?wo=${encodeURIComponent(workOrderId)}`;
}

export function techJobPacketHref(
  workOrderId: string,
  options?: { jobId?: string; section?: JobPacketSection; stage?: string }
): string {
  return technicianPacketHref({
    workOrderId,
    jobId: options?.jobId ?? null,
    section: options?.section ?? null,
    // Invalid stage strings are dropped rather than propagated into the URL.
    stage: isFloorStage(options?.stage) ? options.stage : null,
  });
}

export function floorTechWorkOrderRedirect(workOrderId: string, tab?: string): string {
  if (tab === "inspection") {
    const returnTo = `/technician?wo=${encodeURIComponent(workOrderId)}`;
    return `/work_orders/${encodeURIComponent(workOrderId)}/inspection?returnTo=${encodeURIComponent(returnTo)}`;
  }
  if (tab === "notes" || tab === "photos") {
    return techJobPacketHref(workOrderId, { section: tab });
  }
  return techJobPacketHref(workOrderId);
}
