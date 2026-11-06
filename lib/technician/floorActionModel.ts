import type {
  FloorParkReason,
  JobStatus,
  PitBoardStatus,
  WorkOrderStatus,
} from "@/lib/database/types";
import {
  deriveGoAction,
  derivePitBoardStatus,
  type GoAction,
  type PitBoardStamp,
  type PitBoardStep,
} from "@/lib/technician/pitBoard";

/**
 * Floor Action Model — one honest "next move" per bike.
 *
 * Every state yields either exactly one enabled primary action or an explicit
 * wait with a plain-language reason and a named owner. No internal jargon
 * ("quality", "HOLD", "PAUSED") ever reaches these labels.
 */

export type FloorWaitOwnerKind =
  "technician" | "front_desk" | "parts" | "qc" | "head_tech";

export type FloorActionControl = {
  action: string;
  label: string;
  enabled: boolean;
  disabledReason?: string;
};

export type FloorActionModel = {
  primary: {
    action: GoAction;
    label: string;
    enabled: boolean;
    disabledReason?: string;
    /** Step to advance when action is advance_step. */
    step?: PitBoardStep | null;
    /** Helper line under the dock button. */
    hint?: string;
  };
  secondary: FloorActionControl[];
  stateLabel: string;
  waitReason: string | null;
  waitOwner: FloorWaitOwnerKind | null;
};

/** Closed work orders — nothing on the floor should act on these. */
export function isTerminalWorkOrderStatus(
  status: WorkOrderStatus | string | null | undefined
): boolean {
  return status === "completed" || status === "cancelled";
}

/**
 * The bike has left the bay. It stays in its category and comes off the
 * technician's docket and Control Center tech card.
 */
export function workOrderLeftTechDocket(
  status: WorkOrderStatus | string | null | undefined
): boolean {
  return (
    status === "safety_check" ||
    status === "ready_for_pickup" ||
    status === "in_storage" ||
    status === "insurance" ||
    status === "completed"
  );
}

/**
 * Bikes that still belong in the technician's line.
 * On hold, closed, and post-bay visits do not. The database start command
 * uses the same set.
 */
export function workOrderStillOnTechnicianFloor(
  status: WorkOrderStatus | string | null | undefined
): boolean {
  if (!status) return true;
  if (status === "on_hold") return false;
  return !isTerminalWorkOrderStatus(status) && !workOrderLeftTechDocket(status);
}

/** Swap and "other" stops were retired. Old rows must not freeze the bike. */
export function isRetiredFloorPark(reason: FloorParkReason | null | undefined): boolean {
  return reason === "swapped" || reason === "other";
}

/** Closed jobs — cancelled/declined rows must not linger on the floor. */
export function isTerminalJobStatus(
  status: JobStatus | string | null | undefined
): boolean {
  return status === "cancelled" || status === "declined";
}

export function waitOwnerDisplayLabel(owner: FloorWaitOwnerKind): string {
  switch (owner) {
    case "technician":
      return "You";
    case "front_desk":
      return "Front desk";
    case "parts":
      return "Parts";
    case "qc":
      return "Final inspection";
    case "head_tech":
      return "Head tech";
  }
}

type ParkWait = {
  stateLabel: string;
  waitReason: string;
  waitOwner: FloorWaitOwnerKind;
  /** The tech may resume on their own judgement. */
  resumable: boolean;
};

function parkWait(reason: FloorParkReason | null): ParkWait {
  switch (reason) {
    case "parts":
      return {
        stateLabel: "Waiting for parts",
        waitReason: "Waiting for parts",
        waitOwner: "parts",
        resumable: false,
      };
    case "approval":
      return {
        stateLabel: "Waiting for customer OK",
        waitReason: "Waiting for customer OK",
        waitOwner: "front_desk",
        resumable: false,
      };
    case "tool":
      return {
        stateLabel: "Tool or lift busy",
        waitReason: "Tool or lift busy",
        waitOwner: "technician",
        resumable: false,
      };
    case "swapped":
      return {
        stateLabel: "Parked — swapped bikes",
        waitReason: "You swapped onto another bike",
        waitOwner: "technician",
        resumable: false,
      };
    case "other":
      return {
        stateLabel: "Paused",
        waitReason: "Paused by you",
        waitOwner: "technician",
        resumable: false,
      };
    default:
      return {
        stateLabel: "Paused — clock stopped",
        waitReason: "Paused — clock stopped",
        waitOwner: "technician",
        resumable: false,
      };
  }
}

export type FloorWorkStateInput = {
  job_status: JobStatus | null;
  work_order_status: WorkOrderStatus;
  floor_acknowledged_at: string | null;
  floor_parked_at: string | null;
  floor_park_reason: FloorParkReason | null;
  job_timer_running: boolean;
};

export type FloorWorkState = {
  /**
   * Action-driving board state. Extends the pit-board vocabulary with
   * work-order level states the legacy derivation ignored.
   */
  board: PitBoardStatus | "terminal" | "held";
  stateLabel: string;
  waitReason: string | null;
  waitOwner: FloorWaitOwnerKind | null;
  /** True when the tech may resume this wait on their own. */
  resumable: boolean;
};

/**
 * Wraps derivePitBoardStatus with the work-order level inputs it ignored:
 * on_hold and terminal statuses gate everything; waiting_for_parts overlays
 * an honest wait without freezing authorized work;
 * waiting_for_customer_approval never freezes an approved/ready job.
 */
export function deriveFloorWorkState(input: FloorWorkStateInput): FloorWorkState {
  if (isTerminalWorkOrderStatus(input.work_order_status)) {
    const cancelled = input.work_order_status === "cancelled";
    return {
      board: "terminal",
      stateLabel: cancelled ? "Cancelled" : "Closed",
      waitReason: cancelled
        ? "Work order cancelled — nothing left to do"
        : "Work order closed",
      waitOwner: "front_desk",
      resumable: false,
    };
  }

  if (isTerminalJobStatus(input.job_status)) {
    return {
      board: "terminal",
      stateLabel: "Job cancelled",
      waitReason: "This job was cancelled — pick another bike",
      waitOwner: "front_desk",
      resumable: false,
    };
  }

  if (input.job_status === "completed") {
    return {
      board: "done",
      stateLabel: "Work complete",
      waitReason: "With final inspection, then safety, then pickup",
      waitOwner: "qc",
      resumable: false,
    };
  }

  if (input.work_order_status === "on_hold") {
    return {
      board: "held",
      stateLabel: "On hold",
      waitReason: "Bike is on hold — front desk owns it",
      waitOwner: "front_desk",
      resumable: false,
    };
  }

  if (input.job_status === "waiting_for_approval") {
    return {
      board: "waiting",
      stateLabel: "Waiting for customer OK",
      waitReason: "Waiting for customer OK",
      waitOwner: "front_desk",
      resumable: false,
    };
  }

  // A parts wait is a note. The tech can still start and keep the clock.
  // Retired swap and other parks are leftover rows, not a current stop.
  if (
    input.floor_parked_at &&
    input.floor_park_reason !== "parts" &&
    !isRetiredFloorPark(input.floor_park_reason)
  ) {
    const wait = parkWait(input.floor_park_reason);
    return {
      board: "waiting",
      stateLabel: wait.stateLabel,
      waitReason: wait.waitReason,
      waitOwner: wait.waitOwner,
      resumable: wait.resumable,
    };
  }

  const board = derivePitBoardStatus({
    kind: "job",
    job_status: input.job_status,
    floor_acknowledged_at: input.floor_acknowledged_at,
    floor_parked_at: null,
    job_timer_running: input.job_timer_running,
    is_bench:
      input.job_status === "in_progress" ||
      (input.job_status === "waiting_for_parts" && input.job_timer_running),
  });

  // Parts on the visit, the job, or a legacy parts park stay visible and do not freeze work.
  const partsPending =
    input.work_order_status === "waiting_for_parts" ||
    input.job_status === "waiting_for_parts" ||
    input.floor_park_reason === "parts";
  const partsOverlay = partsPending
    ? { waitReason: "Some parts still on order", waitOwner: "parts" as const }
    : { waitReason: null, waitOwner: null };

  if (board === "bench") {
    return {
      board,
      stateLabel: "On your bench",
      ...partsOverlay,
      resumable: false,
    };
  }
  if (board === "offered") {
    return {
      board,
      stateLabel: "New — in your line",
      ...partsOverlay,
      resumable: false,
    };
  }
  if (board === "done") {
    return {
      board,
      stateLabel: "Work complete",
      waitReason: "With final inspection, then safety, then pickup",
      waitOwner: "qc",
      resumable: false,
    };
  }
  return {
    board: "next",
    stateLabel: "Ready to pull",
    ...partsOverlay,
    resumable: false,
  };
}

const PENDING_REASON = "Another action is saving…";

export type FloorActionModelInput = {
  surface: "job" | "qc" | "safety";
  job_status: JobStatus | null;
  work_order_status: WorkOrderStatus;
  floor_acknowledged_at: string | null;
  floor_parked_at: string | null;
  floor_park_reason: FloorParkReason | null;
  job_timer_running: boolean;
  steps: PitBoardStep[];
  complete_gate_ok: boolean;
  qc_checks_done?: boolean;
  qc_assignee_is_me?: boolean;
  can_safety?: boolean;
  has_swap_targets?: boolean;
  /** False when a bike ahead of this one is still in the line. */
  can_start?: boolean;
  pending_action?: boolean;
};

function nonePrimary(disabledReason: string): FloorActionModel["primary"] {
  return { action: "none", label: "Nothing to do here", enabled: false, disabledReason };
}

function applyPending(model: FloorActionModel, pending: boolean): FloorActionModel {
  if (!pending) return model;
  return {
    ...model,
    primary: {
      ...model.primary,
      enabled: false,
      disabledReason: PENDING_REASON,
    },
    secondary: model.secondary.map((control) => ({
      ...control,
      enabled: false,
      disabledReason: PENDING_REASON,
    })),
  };
}

export function buildFloorActionModel(input: FloorActionModelInput): FloorActionModel {
  const pending = Boolean(input.pending_action);

  if (isTerminalWorkOrderStatus(input.work_order_status)) {
    const cancelled = input.work_order_status === "cancelled";
    return {
      primary: nonePrimary(cancelled ? "Work order cancelled" : "Work order closed"),
      secondary: [],
      stateLabel: cancelled ? "Cancelled" : "Closed",
      waitReason: cancelled
        ? "Work order cancelled — nothing left to do"
        : "Work order closed",
      waitOwner: "front_desk",
    };
  }

  if (input.surface === "qc") {
    if (input.qc_assignee_is_me) {
      const checksDone = Boolean(input.qc_checks_done);
      return applyPending(
        {
          primary: {
            action: "pass_qc",
            label: "Pass final inspection — vouch for it ✓",
            enabled: checksDone,
            disabledReason: checksDone
              ? undefined
              : "Tick all three judgement checks first",
            hint: "Sign off, then hands it to the safety check — your clock is not running.",
          },
          secondary: [
            {
              action: "fail_qc",
              label: "Fail — send back for rework",
              enabled: true,
            },
          ],
          stateLabel: "Ready for final inspection",
          waitReason: checksDone ? null : "Tick all three judgement checks first",
          waitOwner: checksDone ? null : "technician",
        },
        pending
      );
    }
    return {
      primary: nonePrimary("Assigned to another tech for final inspection"),
      secondary: [],
      stateLabel: "With final inspection",
      waitReason: "Waiting for final inspection",
      waitOwner: "qc",
    };
  }

  if (input.surface === "safety") {
    if (input.can_safety) {
      return applyPending(
        {
          primary: {
            action: "pass_safety",
            label: "Pass safety check ✓",
            enabled: true,
            hint: "Draw your signature to release the bike toward pickup.",
          },
          secondary: [
            { action: "fail_safety", label: "Fail safety check", enabled: true },
          ],
          stateLabel: "Safety check",
          waitReason: null,
          waitOwner: null,
        },
        pending
      );
    }
    return {
      primary: nonePrimary("Head tech makes this call"),
      secondary: [],
      stateLabel: "Safety check",
      waitReason: "Waiting on head-tech safety check",
      waitOwner: "head_tech",
    };
  }

  // Work-order-only selection with no job of mine — view only, never a
  // phantom acknowledge/pull button.
  if (input.job_status === null) {
    return {
      primary: nonePrimary("No job assigned to you on this bike"),
      secondary: [],
      stateLabel: "View only",
      waitReason: "Front desk assigns the work",
      waitOwner: "front_desk",
    };
  }

  const state = deriveFloorWorkState({
    job_status: input.job_status,
    work_order_status: input.work_order_status,
    floor_acknowledged_at: input.floor_acknowledged_at,
    floor_parked_at: input.floor_parked_at,
    floor_park_reason: input.floor_park_reason,
    job_timer_running: input.job_timer_running,
  });

  const base: Pick<FloorActionModel, "stateLabel" | "waitReason" | "waitOwner"> = {
    stateLabel: state.stateLabel,
    waitReason: state.waitReason,
    waitOwner: state.waitOwner,
  };

  if (state.board === "terminal") {
    return {
      ...base,
      primary: nonePrimary(state.waitReason ?? "Nothing left to do"),
      secondary: [],
    };
  }

  if (state.board === "held") {
    return {
      ...base,
      primary: nonePrimary("Bike is on hold — front desk owns it"),
      secondary: [],
    };
  }

  if (state.board === "done") {
    return {
      ...base,
      primary: nonePrimary("Job complete — nothing left here"),
      secondary: [],
    };
  }

  if (state.board === "offered" || state.board === "next") {
    const inspection = input.steps.find(
      (step) => step.kind === "inspect" && step.state === "open"
    );
    // Arrival inspection does not take the bench or the clock, so a bike
    // further up the line must not block it.
    if (inspection) {
      return applyPending(
        {
          ...base,
          primary: {
            action: "advance_step",
            label: "Open inspection ▶",
            enabled: true,
            step: inspection,
            hint: "Fullscreen arrival inspection. Your clock stays off.",
          },
          secondary: [],
        },
        pending
      );
    }
    const start = deriveGoAction({
      status: state.board,
      steps: input.steps,
      complete_gate_ok: input.complete_gate_ok,
    });
    return applyPending(
      {
        ...base,
        primary: {
          action: start.action,
          label: start.label,
          enabled: input.can_start === false ? false : start.enabled,
          disabledReason:
            input.can_start === false ? "The bike ahead of this one is next." : undefined,
          hint: start.sub,
        },
        secondary: [],
      },
      pending
    );
  }

  if (state.board === "waiting") {
    if (input.floor_park_reason === "tool") {
      return applyPending(
        {
          ...base,
          primary: {
            action: "clear_tool",
            label: "Mark clear",
            enabled: true,
            hint: "The bike returns to its place in line. The clock stays off.",
          },
          secondary: [],
        },
        pending
      );
    }
    return {
      ...base,
      primary: {
        action: "none",
        label: state.waitReason ?? "Waiting",
        enabled: false,
        disabledReason:
          state.waitReason ?? "This bike is waiting. It starts again only from the line.",
      },
      secondary: [],
    };
  }

  // On the bench — the pit-board step engine picks the next move.
  const go = deriveGoAction({
    status: "bench",
    steps: input.steps,
    complete_gate_ok: input.complete_gate_ok,
  });
  return applyPending(
    {
      ...base,
      primary: {
        action: go.action,
        label: go.label,
        enabled: go.enabled,
        disabledReason: go.enabled ? undefined : "Finish the required steps first",
        step: go.step ?? null,
        hint: go.sub,
      },
      secondary: [{ action: "park", label: "Tool or lift busy", enabled: true }],
    },
    pending
  );
}

/**
 * Split a docket into "Work now" vs "Waiting" — a bike appears in exactly one.
 * Waiting means the board says so (parked, customer gate, flags on hold).
 */
export function splitDocketByWait<
  T extends { board_status: PitBoardStatus; board_stamp: PitBoardStamp },
>(items: readonly T[]): { workNow: T[]; waiting: T[] } {
  const workNow: T[] = [];
  const waiting: T[] = [];
  for (const item of items) {
    if (
      item.board_status === "waiting" ||
      item.board_stamp === "HOLD" ||
      item.board_stamp === "PAUSED"
    ) {
      waiting.push(item);
    } else {
      workNow.push(item);
    }
  }
  return { workNow, waiting };
}
