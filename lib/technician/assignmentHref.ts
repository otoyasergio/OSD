import {
  isFloorStage,
  technicianFloorHref,
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

export type FloorInspectionHrefs = {
  back: string;
  complete: string;
  inspectPage: string;
};

export function floorInspectionHrefs(input: {
  workOrderId: string;
  jobId?: string | null;
}): FloorInspectionHrefs {
  const back = technicianFloorHref({
    workOrderId: input.workOrderId,
    jobId: input.jobId ?? null,
    stage: "inspect",
  });
  const complete = technicianFloorHref({
    workOrderId: input.workOrderId,
    jobId: input.jobId ?? null,
    stage: "work",
  });
  return {
    back,
    complete,
    inspectPage: `/work_orders/${encodeURIComponent(input.workOrderId)}/inspection?returnTo=${encodeURIComponent(back)}`,
  };
}

/** Allow only same-origin /technician returns (no protocol-relative or off-floor paths). */
export function safeFloorReturnTo(
  raw: string | string[] | null | undefined
): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  try {
    const url = new URL(trimmed, "https://example.invalid");
    if (url.pathname !== "/technician") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function floorTechWorkOrderRedirect(workOrderId: string, tab?: string): string {
  if (tab === "inspection") {
    return floorInspectionHrefs({ workOrderId }).inspectPage;
  }
  if (tab === "notes" || tab === "photos") {
    return techJobPacketHref(workOrderId, { section: tab });
  }
  return techJobPacketHref(workOrderId);
}

/** Swap an inspect-stage floor URL to the Work stage after the report is done. */
export function floorWorkReturnFromInspectBack(back: string): string | null {
  const safe = safeFloorReturnTo(back);
  if (!safe) return null;
  const url = new URL(safe, "https://example.invalid");
  url.searchParams.set("stage", "work");
  return `${url.pathname}?${url.searchParams.toString()}${url.hash}`;
}
