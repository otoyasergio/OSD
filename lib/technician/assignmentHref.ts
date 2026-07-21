export function staffAssignmentHref(workOrderId: string): string {
  return `/technician?wo=${encodeURIComponent(workOrderId)}`;
}

export type JobPacketSection = "notes" | "photos" | "jobs";

export function techJobPacketHref(
  workOrderId: string,
  options?: { jobId?: string; section?: JobPacketSection; stage?: string }
): string {
  const params = new URLSearchParams();
  params.set("wo", workOrderId);
  params.set("panel", "packet");
  if (options?.jobId) params.set("job", options.jobId);
  if (options?.section) params.set("packetSection", options.section);
  if (options?.stage) params.set("stage", options.stage);
  return `/technician?${params.toString()}`;
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
