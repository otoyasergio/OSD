import type { FloorStage } from "@/lib/technician/floorStage";

/** Packet sections. `null` section = packet overview (top summary). */
export type JobPacketSection = "notes" | "photos" | "jobs";

export const FLOOR_STAGES: readonly FloorStage[] = [
  "inspect",
  "work",
  "proof",
  "done",
  "qc",
  "safety",
];

const PACKET_SECTIONS: readonly JobPacketSection[] = ["notes", "photos", "jobs"];

export type TechnicianRouteState = {
  jobId: string | null;
  workOrderId: string | null;
  /** Validated requested stage; null means "derive the default for the surface". */
  stage: FloorStage | null;
  panel: "packet" | null;
  /** Validated packet section; null means the packet opens on its top summary. */
  packetSection: JobPacketSection | null;
};

export type TechnicianRouteParams = {
  job?: string;
  wo?: string;
  stage?: string;
  /** Legacy deep links used `mode`; still honoured as a stage hint. */
  mode?: string;
  panel?: string;
  packetSection?: string;
};

export function isFloorStage(value: string | null | undefined): value is FloorStage {
  return Boolean(value) && FLOOR_STAGES.includes(value as FloorStage);
}

export function isJobPacketSection(
  value: string | null | undefined
): value is JobPacketSection {
  return Boolean(value) && PACKET_SECTIONS.includes(value as JobPacketSection);
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
  input: TechnicianHrefInput & { section?: JobPacketSection | null }
): string {
  const params = new URLSearchParams();
  params.set("wo", input.workOrderId);
  params.set("panel", "packet");
  if (input.jobId) params.set("job", input.jobId);
  if (input.section) params.set("packetSection", input.section);
  if (input.stage) params.set("stage", input.stage);
  return `/technician?${params.toString()}`;
}

/** Close-packet link — drops panel/section but keeps selection AND stage. */
export function technicianClosePacketHref(input: TechnicianHrefInput): string {
  return technicianFloorHref(input);
}
