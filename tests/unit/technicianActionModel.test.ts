import { describe, expect, it } from "vitest";
import type { FloorParkReason, JobStatus, WorkOrderStatus } from "@/lib/database/types";
import { buildPitBoardSteps } from "@/lib/technician/pitBoard";
import {
  buildFloorActionModel,
  splitDocketByWait,
  waitOwnerDisplayLabel,
  type FloorActionModel,
  type FloorActionModelInput,
} from "@/lib/technician/floorActionModel";

const TS = "2026-07-17T12:00:00Z";

const OPEN_WORK_STEPS = buildPitBoardSteps({
  inspection_complete: true,
  service_name: "Oil change",
  checklist: [
    { job_checklist_item_id: "c1", title: "Perform work per SOP", checked_at: null },
  ],
  parts: [],
  proof_count: 0,
  has_proof_exception: false,
  complete_gate_ok: false,
});

function modelFor(overrides: Partial<FloorActionModelInput>): FloorActionModel {
  return buildFloorActionModel({
    surface: "job",
    job_status: "in_progress",
    work_order_status: "in_progress",
    floor_acknowledged_at: TS,
    floor_parked_at: null,
    floor_park_reason: null,
    job_timer_running: true,
    steps: OPEN_WORK_STEPS,
    complete_gate_ok: false,
    ...overrides,
  });
}

function allModelText(model: FloorActionModel): string[] {
  return [
    model.primary.label,
    model.primary.disabledReason ?? "",
    model.primary.hint ?? "",
    model.stateLabel,
    model.waitReason ?? "",
    ...model.secondary.flatMap((control) => [
      control.label,
      control.disabledReason ?? "",
    ]),
  ];
}

function assertInvariant(model: FloorActionModel, label: string) {
  // Exactly one honest outcome: an enabled primary, or an explicit wait
  // (owner + reason) with the primary explaining why it is off.
  if (model.primary.enabled) {
    expect(model.primary.action, label).not.toBe("none");
  } else {
    expect(model.waitReason, label).not.toBeNull();
    expect(model.waitOwner, label).not.toBeNull();
    expect(model.primary.disabledReason, label).toBeTruthy();
  }
  for (const text of allModelText(model)) {
    expect(text, label).not.toMatch(/quality/i);
    expect(text, label).not.toMatch(/\bHOLD\b/);
    expect(text, label).not.toMatch(/\bPAUSED\b/);
  }
}

describe("buildFloorActionModel matrix", () => {
  const JOB_STATUSES: JobStatus[] = [
    "waiting_for_approval",
    "approved",
    "waiting_for_parts",
    "ready_to_start",
    "in_progress",
    "completed",
  ];
  const WO_STATUSES: WorkOrderStatus[] = [
    "on_hold",
    "waiting_for_parts",
    "waiting_for_customer_approval",
    "in_progress",
    "quality_check",
    "safety_check",
    "completed",
    "cancelled",
  ];
  const PARKS: Array<{
    name: string;
    floor_parked_at: string | null;
    floor_park_reason: FloorParkReason | null;
  }> = [
    { name: "unparked", floor_parked_at: null, floor_park_reason: null },
    { name: "parts", floor_parked_at: TS, floor_park_reason: "parts" },
    { name: "approval", floor_parked_at: TS, floor_park_reason: "approval" },
    { name: "tool", floor_parked_at: TS, floor_park_reason: "tool" },
    { name: "other", floor_parked_at: TS, floor_park_reason: "other" },
    { name: "swapped", floor_parked_at: TS, floor_park_reason: "swapped" },
    { name: "legacy pause", floor_parked_at: TS, floor_park_reason: null },
  ];

  it("yields exactly one enabled primary or an owned wait for every state", () => {
    for (const jobStatus of JOB_STATUSES) {
      for (const woStatus of WO_STATUSES) {
        for (const park of PARKS) {
          for (const timer of [false, true]) {
            const model = modelFor({
              job_status: jobStatus,
              work_order_status: woStatus,
              floor_parked_at: park.floor_parked_at,
              floor_park_reason: park.floor_park_reason,
              job_timer_running: timer,
            });
            assertInvariant(
              model,
              `${jobStatus} × ${woStatus} × ${park.name} × timer=${timer}`
            );
          }
        }
      }
    }
  });

  it("keeps QC and safety surfaces honest for both assignees and bystanders", () => {
    const qcMineReady = modelFor({
      surface: "qc",
      job_status: null,
      work_order_status: "quality_check",
      qc_assignee_is_me: true,
      qc_checks_done: true,
    });
    expect(qcMineReady.primary).toMatchObject({ action: "pass_qc", enabled: true });
    expect(qcMineReady.stateLabel).toBe("Ready for QC");
    expect(qcMineReady.secondary.map((control) => control.action)).toEqual(["fail_qc"]);
    assertInvariant(qcMineReady, "qc mine ready");

    const qcMineUnchecked = modelFor({
      surface: "qc",
      job_status: null,
      work_order_status: "quality_check",
      qc_assignee_is_me: true,
      qc_checks_done: false,
    });
    expect(qcMineUnchecked.primary.enabled).toBe(false);
    expect(qcMineUnchecked.primary.disabledReason).toBe(
      "Tick all three judgement checks first"
    );
    assertInvariant(qcMineUnchecked, "qc mine unchecked");

    const qcTheirs = modelFor({
      surface: "qc",
      job_status: null,
      work_order_status: "quality_check",
      qc_assignee_is_me: false,
    });
    expect(qcTheirs.primary.enabled).toBe(false);
    expect(qcTheirs.waitOwner).toBe("qc");
    assertInvariant(qcTheirs, "qc theirs");

    const safetyMine = modelFor({
      surface: "safety",
      job_status: null,
      work_order_status: "safety_check",
      can_safety: true,
    });
    expect(safetyMine.primary).toMatchObject({ action: "pass_safety", enabled: true });
    expect(safetyMine.secondary.map((control) => control.action)).toEqual([
      "fail_safety",
    ]);
    assertInvariant(safetyMine, "safety mine");

    const safetyTheirs = modelFor({
      surface: "safety",
      job_status: null,
      work_order_status: "safety_check",
      can_safety: false,
    });
    expect(safetyTheirs.primary.enabled).toBe(false);
    expect(safetyTheirs.waitOwner).toBe("qc");
    assertInvariant(safetyTheirs, "safety theirs");
  });

  it("hides park/swap everywhere except the bench, and never on QC/safety", () => {
    const bench = modelFor({ job_status: "in_progress", has_swap_targets: true });
    expect(bench.secondary.map((control) => control.action)).toEqual(["park", "swap"]);
    expect(bench.secondary.every((control) => control.enabled)).toBe(true);

    const benchNoTargets = modelFor({
      job_status: "in_progress",
      has_swap_targets: false,
    });
    const swap = benchNoTargets.secondary.find((control) => control.action === "swap");
    expect(swap).toMatchObject({
      enabled: false,
      disabledReason: "No other bike in your line",
    });

    for (const model of [
      modelFor({ job_status: "ready_to_start", job_timer_running: false }),
      modelFor({ floor_parked_at: TS, floor_park_reason: "tool" }),
      modelFor({ job_status: "completed" }),
      modelFor({ surface: "qc", job_status: null, qc_assignee_is_me: false }),
      modelFor({ surface: "safety", job_status: null, can_safety: true }),
    ]) {
      expect(
        model.secondary.filter(
          (control) => control.action === "park" || control.action === "swap"
        )
      ).toEqual([]);
    }
  });

  it("disables resume only for customer-owned waits", () => {
    const approvalParked = modelFor({
      floor_parked_at: TS,
      floor_park_reason: "approval",
      job_timer_running: false,
    });
    expect(approvalParked.primary).toMatchObject({ action: "resume", enabled: false });
    expect(approvalParked.waitOwner).toBe("front_desk");

    const jobAwaitingApproval = modelFor({
      job_status: "waiting_for_approval",
      floor_parked_at: null,
      job_timer_running: false,
    });
    expect(jobAwaitingApproval.primary.enabled).toBe(false);
    expect(jobAwaitingApproval.waitOwner).toBe("front_desk");

    for (const reason of ["parts", "tool", "other", "swapped"] as const) {
      const model = modelFor({
        floor_parked_at: TS,
        floor_park_reason: reason,
        job_timer_running: false,
      });
      expect(model.primary, reason).toMatchObject({ action: "resume", enabled: true });
    }
  });

  it("freezes everything with a per-control reason while an action is saving", () => {
    const model = modelFor({
      job_status: "in_progress",
      has_swap_targets: true,
      pending_action: true,
    });
    expect(model.primary.enabled).toBe(false);
    expect(model.primary.disabledReason).toBe("Another action is saving…");
    for (const control of model.secondary) {
      expect(control.enabled).toBe(false);
      expect(control.disabledReason).toBe("Another action is saving…");
    }
  });

  it("labels the held state with the front-desk reason", () => {
    const model = modelFor({ work_order_status: "on_hold" });
    expect(model.primary.enabled).toBe(false);
    expect(model.primary.disabledReason).toBe("Bike is on hold — front desk owns it");
    expect(model.waitOwner).toBe("front_desk");
    expect(model.stateLabel).toBe("On hold");
  });

  it("shows a view-only wait for a work-order-only selection with no job", () => {
    const model = modelFor({ job_status: null, work_order_status: "in_progress" });
    expect(model.primary.action).toBe("none");
    expect(model.primary.enabled).toBe(false);
    expect(model.waitOwner).toBe("front_desk");
    assertInvariant(model, "view only");
  });

  it("keeps owner display labels plain", () => {
    expect(waitOwnerDisplayLabel("technician")).toBe("You");
    expect(waitOwnerDisplayLabel("front_desk")).toBe("Front desk");
    expect(waitOwnerDisplayLabel("parts")).toBe("Parts");
    expect(waitOwnerDisplayLabel("qc")).toBe("QC");
  });
});

describe("splitDocketByWait", () => {
  it("puts every bike in exactly one list", () => {
    const items = [
      { key: "a", board_status: "bench", board_stamp: "NOW" },
      { key: "b", board_status: "waiting", board_stamp: "HOLD" },
      { key: "c", board_status: "next", board_stamp: "NEXT" },
      { key: "d", board_status: "waiting", board_stamp: "PAUSED" },
      { key: "e", board_status: "check", board_stamp: "CHECK" },
      { key: "f", board_status: "offered", board_stamp: "NEW" },
    ] as const;
    const { workNow, waiting } = splitDocketByWait([...items]);
    expect(workNow.map((item) => item.key)).toEqual(["a", "c", "e", "f"]);
    expect(waiting.map((item) => item.key)).toEqual(["b", "d"]);
    expect(workNow.length + waiting.length).toBe(items.length);
    const overlap = workNow.filter((item) => waiting.includes(item));
    expect(overlap).toEqual([]);
  });
});
