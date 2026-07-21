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

export type FloorWaitOwnerKind = "technician" | "front_desk" | "parts" | "qc";

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
      return "QC";
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
        resumable: true,
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
        stateLabel: "Paused — tool busy",
        waitReason: "Tool or lift busy",
        waitOwner: "technician",
        resumable: true,
      };
    case "swapped":
      return {
        stateLabel: "Parked — swapped bikes",
        waitReason: "You swapped onto another bike",
        waitOwner: "technician",
        resumable: true,
      };
    case "other":
      return {
        stateLabel: "Paused",
        waitReason: "Paused by you",
        waitOwner: "technician",
        resumable: true,
      };
    default:
      // Legacy park rows without a reason/owner — the tech owns resuming.
      return {
        stateLabel: "Paused — clock stopped",
        waitReason: "Paused — clock stopped",
        waitOwner: "technician",
        resumable: true,
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
      waitReason: "With QC, then safety, then pickup",
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

  if (input.job_status === "waiting_for_parts") {
    return {
      board: "waiting",
      stateLabel: "Waiting for parts",
      waitReason: "Waiting for parts",
      waitOwner: "parts",
      resumable: true,
    };
  }

  if (input.floor_parked_at) {
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
    is_bench: input.job_status === "in_progress",
  });

  // WO-level parts wait is honest info but never freezes authorized work.
  const partsPending = input.work_order_status === "waiting_for_parts";
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
      waitReason: "With QC, then safety, then pickup",
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
            label: "Pass QC — vouch for it ✓",
            enabled: checksDone,
            disabledReason: checksDone
              ? undefined
              : "Tick all three judgement checks first",
            hint: "Hands it to head-tech safety — your clock is not running.",
          },
          secondary: [
            {
              action: "fail_qc",
              label: "Fail — send back for rework",
              enabled: true,
            },
          ],
          stateLabel: "Ready for QC",
          waitReason: checksDone ? null : "Tick all three judgement checks first",
          waitOwner: checksDone ? null : "technician",
        },
        pending
      );
    }
    return {
      primary: nonePrimary("Assigned to another tech for QC"),
      secondary: [],
      stateLabel: "With peer QC",
      waitReason: "Waiting for peer QC",
      waitOwner: "qc",
    };
  }

  if (input.surface === "safety") {
    if (input.can_safety) {
      return applyPending(
        {
          primary: {
            action: "pass_safety",
            label: "Pass safety ✓",
            enabled: true,
            hint: "Front desk books pickup after pass.",
          },
          secondary: [{ action: "fail_safety", label: "Fail safety", enabled: true }],
          stateLabel: "Final safety check",
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
      waitReason: "Waiting on head-tech safety",
      waitOwner: "qc",
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

  if (state.board === "offered") {
    return applyPending(
      {
        ...base,
        primary: {
          action: "acknowledge",
          label: "Got it — it's in my line →",
          enabled: true,
          hint: "No clock starts until you pull it onto the bench.",
        },
        secondary: [],
      },
      pending
    );
  }

  if (state.board === "next") {
    return applyPending(
      {
        ...base,
        primary: {
          action: "pull_onto_bench",
          label: "Pull onto the bench ▶",
          enabled: true,
          hint: "Starts your job clock. Anything on the bench parks itself.",
        },
        secondary: [],
      },
      pending
    );
  }

  if (state.board === "waiting") {
    if (!state.resumable) {
      return {
        ...base,
        primary: {
          action: "resume",
          label: "Resume ▶",
          enabled: false,
          disabledReason: "Waiting for customer OK — front desk will release it",
        },
        secondary: [],
      };
    }
    return applyPending(
      {
        ...base,
        primary: {
          action: "resume",
          label: "Resume ▶",
          enabled: true,
          hint: "Puts this bike back on the bench and restarts the clock.",
        },
        secondary: [],
      },
      pending
    );
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
      secondary: [
        { action: "park", label: "Park", enabled: true },
        {
          action: "swap",
          label: "Swap",
          enabled: Boolean(input.has_swap_targets),
          disabledReason: input.has_swap_targets
            ? undefined
            : "No other bike in your line",
        },
      ],
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
