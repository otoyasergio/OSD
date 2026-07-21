import type {
  FloorParkReason,
  FloorWaitOwner,
  JobStatus,
  PitBoardStatus,
} from "@/lib/database/types";

export type PitBoardStamp = "NOW" | "PAUSED" | "NEXT" | "HOLD" | "CHECK" | "NEW" | "DONE";

export type PitBoardStepKind =
  "inspect" | "work" | "checklist" | "part" | "proof" | "complete";

/** First checklist row: opens the work brief (required work + optional photo). */
export function isPerformWorkChecklistTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return normalized === "perform work" || normalized.startsWith("perform work per");
}

export type PitBoardStepState = "open" | "done" | "skipped";

export type PitBoardStep = {
  id: string;
  kind: PitBoardStepKind;
  label: string;
  sub?: string | null;
  tag?: string | null;
  state: PitBoardStepState;
  /** Checklist item id or part id when actionable. */
  target_id?: string | null;
  photo?: boolean;
};

/** Done inspection stays tappable so techs can review the completed report. */
export function isPitBoardStepTappable(step: PitBoardStep): boolean {
  if (step.state === "open") return true;
  return step.kind === "inspect" && step.state === "done";
}

/** While parked/on hold, techs may browse inspection and perform-work (including marking work done). */
export function isPitBoardStepViewableWhileParked(step: PitBoardStep): boolean {
  return step.kind === "inspect" || step.kind === "work";
}

/** Post-work verify/cleanup checklist rows — no bench clock required while parked or waiting on client. */
export function isPitBoardStepActionableWhileParked(step: PitBoardStep): boolean {
  if (isPitBoardStepViewableWhileParked(step)) return true;
  return step.kind === "checklist" && step.state === "open";
}

export type DerivePitBoardStatusInput = {
  kind: "job" | "qc" | "safety" | "flag";
  job_status: JobStatus | null;
  floor_acknowledged_at: string | null;
  floor_parked_at: string | null;
  job_timer_running: boolean;
  /** True when this is the tech's active in-progress bench bike. */
  is_bench: boolean;
};

export function waitOwnerForParkReason(reason: FloorParkReason): FloorWaitOwner {
  return reason === "other" ? "technician" : "front_desk";
}

export function parkReasonLabel(reason: FloorParkReason | null | undefined): string {
  switch (reason) {
    case "parts":
      return "Parts not here";
    case "approval":
      return "Needs approval";
    case "tool":
      return "Tool or lift busy";
    case "swapped":
      return "Parked — swapped bikes";
    case "other":
      return "Other interruption";
    default:
      return "Parked";
  }
}

export function waitOwnerLabel(owner: FloorWaitOwner | null | undefined): string {
  if (owner === "technician") return "You own the wait — resume when ready";
  if (owner === "front_desk") return "Front desk owns the wait";
  return "";
}

export function derivePitBoardStatus(input: DerivePitBoardStatusInput): PitBoardStatus {
  if (input.kind === "qc") return "check";
  if (input.kind === "safety") return "safety";
  if (input.kind === "flag") return "waiting";

  if (input.job_status === "completed") return "done";

  // Client has not approved yet — nothing for the tech to wrench.
  if (input.job_status === "waiting_for_approval") {
    return "waiting";
  }

  if (input.is_bench || (input.job_status === "in_progress" && !input.floor_parked_at)) {
    return "bench";
  }

  if (
    input.floor_parked_at ||
    (input.job_status === "in_progress" && !input.job_timer_running)
  ) {
    return "waiting";
  }

  if (!input.floor_acknowledged_at) return "offered";

  return "next";
}

/** True when wrench work is finished — surface shows completion summary. */
export function isFloorJobFinished(input: {
  board_status: PitBoardStatus;
  job_status: JobStatus | null;
  completed_at: string | null;
}): boolean {
  return (
    input.board_status === "done" ||
    input.job_status === "completed" ||
    Boolean(input.completed_at)
  );
}

export function stampForStatus(status: PitBoardStatus): PitBoardStamp {
  switch (status) {
    case "bench":
      return "NOW";
    case "waiting":
      return "HOLD";
    case "check":
      return "CHECK";
    case "offered":
      return "NEW";
    case "done":
    case "qcpassed":
    case "qcfailed":
      return "DONE";
    case "safety":
      return "CHECK";
    case "next":
    default:
      return "NEXT";
  }
}

/** When parked but timer was paused without park fields, show PAUSED stamp. */
export function stampForBoard(input: {
  status: PitBoardStatus;
  floor_parked_at: string | null;
  job_timer_running: boolean;
}): PitBoardStamp {
  if (input.status === "waiting" && !input.floor_parked_at && !input.job_timer_running) {
    return "PAUSED";
  }
  return stampForStatus(input.status);
}

export type GoAction =
  | "acknowledge"
  | "pull_onto_bench"
  | "resume"
  | "advance_step"
  | "complete"
  | "pass_qc"
  | "pass_safety"
  | "none";

export type GoLabelResult = {
  action: GoAction;
  label: string;
  sub: string;
  enabled: boolean;
  /** Step to advance when action is advance_step. */
  step?: PitBoardStep | null;
};

export function deriveGoAction(input: {
  status: PitBoardStatus;
  steps: PitBoardStep[];
  complete_gate_ok: boolean;
  qc_checks_done?: boolean;
  /** Job/recommendation still needs a client yes — not resumable by the tech. */
  awaiting_client_approval?: boolean;
}): GoLabelResult {
  const { status, steps } = input;

  if (status === "offered") {
    return {
      action: "acknowledge",
      label: "Got it — it's in my line →",
      sub: "No clock starts until you pull it onto the bench.",
      enabled: true,
    };
  }

  if (status === "next") {
    return {
      action: "pull_onto_bench",
      label: "Pull onto the bench ▶",
      sub: "Starts your job clock. Anything on the bench parks itself.",
      enabled: true,
    };
  }

  if (status === "waiting") {
    if (input.awaiting_client_approval) {
      return {
        action: "none",
        label: "Waiting on client",
        sub: "Front desk will send approved work back to Perform work.",
        enabled: false,
      };
    }
    return {
      action: "resume",
      label: "Resume ▶",
      sub: "Puts this bike back on the bench and restarts the clock.",
      enabled: true,
    };
  }

  if (status === "check") {
    return {
      action: "pass_qc",
      label: "Pass QC — vouch for it ✓",
      sub: "Hands it to head-tech safety — your clock is not running.",
      enabled: Boolean(input.qc_checks_done),
    };
  }

  if (status === "bench") {
    const nextStep = steps.find((s) => s.state === "open");
    if (nextStep) {
      if (nextStep.kind === "complete") {
        return {
          action: "complete",
          label: "Complete job ✓✓",
          sub: "Pick who checks your work — your clock stops.",
          enabled: input.complete_gate_ok,
          step: nextStep,
        };
      }
      if (nextStep.kind === "proof") {
        return {
          action: "advance_step",
          label: "Add after photo ✓",
          sub: "Photo encouraged — you can skip with a reason.",
          enabled: true,
          step: nextStep,
        };
      }
      if (nextStep.kind === "inspect") {
        return {
          action: "advance_step",
          label: "Open inspection ▶",
          sub: "Fullscreen inspection — you return here when done.",
          enabled: true,
          step: nextStep,
        };
      }
      if (nextStep.kind === "work") {
        return {
          action: "advance_step",
          label: "Perform work ▶",
          sub: "See what's required — photo optional, then check done.",
          enabled: true,
          step: nextStep,
        };
      }
      return {
        action: "advance_step",
        label: `Done: ${nextStep.label} ✓`,
        sub: "Marks this step and moves to the next.",
        enabled: true,
        step: nextStep,
      };
    }
    return {
      action: "complete",
      label: "Complete job ✓✓",
      sub: "Pick who checks your work — your clock stops.",
      enabled: input.complete_gate_ok,
    };
  }

  return {
    action: "none",
    label: "Nothing to do",
    sub: "Pick another bike from your line.",
    enabled: false,
  };
}

export function buildPitBoardSteps(input: {
  inspection_complete: boolean;
  service_name?: string | null;
  checklist: Array<{
    job_checklist_item_id: string;
    title: string;
    checked_at: string | null;
  }>;
  parts: Array<{
    part_id: string;
    name: string;
    status: string;
    can_install: boolean;
  }>;
  proof_count: number;
  has_proof_exception: boolean;
  complete_gate_ok: boolean;
}): PitBoardStep[] {
  const steps: PitBoardStep[] = [];

  steps.push({
    id: "inspect",
    kind: "inspect",
    label: "Inspection report",
    sub: input.inspection_complete
      ? "Complete — tap to view report"
      : "Open the fullscreen inspection",
    state: input.inspection_complete ? "done" : "open",
  });

  for (const item of input.checklist) {
    if (isPerformWorkChecklistTitle(item.title)) {
      steps.push({
        id: `check-${item.job_checklist_item_id}`,
        kind: "work",
        label: "Perform work",
        sub: input.service_name?.trim() || "See what's required",
        state: item.checked_at ? "done" : "open",
        target_id: item.job_checklist_item_id,
        photo: true,
      });
      continue;
    }
    steps.push({
      id: `check-${item.job_checklist_item_id}`,
      kind: "checklist",
      label: item.title,
      state: item.checked_at ? "done" : "open",
      target_id: item.job_checklist_item_id,
    });
  }

  for (const part of input.parts) {
    const done = ["installed", "not_required", "cancelled"].includes(part.status);
    steps.push({
      id: `part-${part.part_id}`,
      kind: "part",
      label: part.name,
      tag:
        part.status === "in_stock"
          ? "PART · IN STOCK"
          : `PART · ${part.status.replaceAll("_", " ").toUpperCase()}`,
      state: done ? "done" : "open",
      target_id: part.part_id,
    });
  }

  const proofDone = input.proof_count >= 1 || input.has_proof_exception;
  steps.push({
    id: "proof",
    kind: "proof",
    label: "After photo",
    sub: proofDone
      ? input.has_proof_exception && input.proof_count < 1
        ? "Skipped with reason"
        : "Photo on file"
      : "Encouraged — easy to skip with a reason",
    tag: "PHOTO",
    state: proofDone
      ? input.has_proof_exception && input.proof_count < 1
        ? "skipped"
        : "done"
      : "open",
    photo: true,
  });

  steps.push({
    id: "complete",
    kind: "complete",
    label: "Complete job",
    sub: input.complete_gate_ok ? "Ready to hand off" : "Finish open steps first",
    state: "open",
  });

  return steps;
}

export const PARK_REASON_OPTIONS: Array<{
  reason: FloorParkReason;
  label: string;
}> = [
  { reason: "parts", label: "Parts not here" },
  { reason: "approval", label: "Needs approval" },
  { reason: "tool", label: "Tool or lift busy" },
  { reason: "other", label: "Other interruption" },
];

export const PROOF_SKIP_OPTIONS = [
  "Nothing visible to show",
  "Camera busy",
  "Customer in a hurry",
] as const;

export const QC_JUDGEMENT_LABELS = [
  "Work matches approval",
  "Proof photos tell the story",
  "Safe to ride out",
] as const;
