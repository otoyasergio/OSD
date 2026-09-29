import type { FloorStage } from "@/lib/technician/floorStage";

/** Packet sections. `null` section = packet overview (top summary). */
export type JobPacketSection = "notes" | "photos" | "jobs" | "assistant";

export const FLOOR_STAGES: readonly FloorStage[] = [
  "inspect",
  "work",
  "proof",
  "done",
  "qc",
  "safety",
];

const PACKET_SECTIONS: readonly JobPacketSection[] = [
  "notes",
  "photos",
  "jobs",
  "assistant",
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TechnicianRouteState = {
  jobId: string | null;
  workOrderId: string | null;
  /** Validated requested stage; null means "derive the default for the surface". */
  stage: FloorStage | null;
  panel: "packet" | null;
  /** Validated packet section; null means the packet opens on its top summary. */
  packetSection: JobPacketSection | null;
  /** Validated assistant thread selected inside the packet. */
  assistantThreadId: string | null;
};

export type TechnicianRouteParams = {
  job?: string;
  wo?: string;
  stage?: string;
  /** Legacy deep links used `mode`; still honoured as a stage hint. */
  mode?: string;
  panel?: string;
  packetSection?: string;
  assistantThread?: string;
};

export function isFloorStage(value: string | null | undefined): value is FloorStage {
  return Boolean(value) && FLOOR_STAGES.includes(value as FloorStage);
}

export function isJobPacketSection(
  value: string | null | undefined
): value is JobPacketSection {
  return Boolean(value) && PACKET_SECTIONS.includes(value as JobPacketSection);
}

export function isRouteUuid(value: string | null | undefined): value is string {
  return Boolean(value) && UUID_PATTERN.test(value as string);
}

function stageFromLegacyMode(mode: string | undefined): FloorStage | null {
  switch (mode) {
    case "inspection":
      return "inspect";
    case "parts":
    case "job":
      return "work";
    case "qc":
      return "qc";
    case "safety":
      return "safety";
    case "notes":
      return "done";
    default:
      return null;
  }
}

/** Validate every `/technician` search param; invalid values become null. */
export function parseTechnicianRouteState(
  params: TechnicianRouteParams
): TechnicianRouteState {
  const stage = isFloorStage(params.stage)
    ? params.stage
    : stageFromLegacyMode(params.mode);

  return {
    jobId: params.job?.trim() ? params.job : null,
    workOrderId: params.wo?.trim() ? params.wo : null,
    stage,
    panel: params.panel === "packet" ? "packet" : null,
    packetSection: isJobPacketSection(params.packetSection) ? params.packetSection : null,
    assistantThreadId: isRouteUuid(params.assistantThread)
      ? params.assistantThread
      : null,
  };
}

export type TechnicianHrefInput = {
  workOrderId: string;
  jobId?: string | null;
  stage?: FloorStage | null;
};

/** Floor deep link (`/technician?wo=&job=&stage=`), packet closed. */
export function technicianFloorHref(input: TechnicianHrefInput): string {
  const params = new URLSearchParams();
  if (input.jobId) params.set("job", input.jobId);
  params.set("wo", input.workOrderId);
  if (input.stage) params.set("stage", input.stage);
  return `/technician?${params.toString()}`;
}

/**
 * Packet deep link. Preserves the current stage so closing the packet lands
 * back on the same work-surface stage. Omitting `section` opens the summary.
 */
export function technicianPacketHref(
  input: TechnicianHrefInput & {
    section?: JobPacketSection | null;
    assistantThreadId?: string | null;
  }
): string {
  const params = new URLSearchParams();
  params.set("wo", input.workOrderId);
  params.set("panel", "packet");
  if (input.jobId) params.set("job", input.jobId);
  if (input.section) params.set("packetSection", input.section);
  if (input.stage) params.set("stage", input.stage);
  if (isRouteUuid(input.assistantThreadId)) {
    params.set("assistantThread", input.assistantThreadId);
  }
  return `/technician?${params.toString()}`;
}

/** Close-packet link — drops panel/section but keeps selection AND stage. */
export function technicianClosePacketHref(input: TechnicianHrefInput): string {
  return technicianFloorHref(input);
}
