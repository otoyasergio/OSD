import { describe, expect, it } from "vitest";
import type { FloorParkReason, JobStatus, WorkOrderStatus } from "@/lib/database/types";
import {
  deriveFloorWorkState,
  type FloorWorkStateInput,
} from "@/lib/technician/floorActionModel";

const TS = "2026-07-17T12:00:00Z";

const JOB_STATUSES: JobStatus[] = [
  "draft",
  "waiting_for_approval",
  "approved",
  "declined",
  "waiting_for_parts",
  "ready_to_start",
  "in_progress",
  "completed",
  "cancelled",
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

type ParkVariant = {
  name: string;
  floor_parked_at: string | null;
  floor_park_reason: FloorParkReason | null;
};

const PARK_VARIANTS: ParkVariant[] = [
  { name: "not parked", floor_parked_at: null, floor_park_reason: null },
  { name: "parked: parts", floor_parked_at: TS, floor_park_reason: "parts" },
  { name: "parked: approval", floor_parked_at: TS, floor_park_reason: "approval" },
  { name: "parked: tool", floor_parked_at: TS, floor_park_reason: "tool" },
  { name: "parked: other", floor_parked_at: TS, floor_park_reason: "other" },
  { name: "parked: swapped", floor_parked_at: TS, floor_park_reason: "swapped" },
  // Legacy rows parked before reasons/owners existed.
  { name: "legacy null-owner pause", floor_parked_at: TS, floor_park_reason: null },
];

function stateFor(overrides: Partial<FloorWorkStateInput>) {
  return deriveFloorWorkState({
    job_status: "in_progress",
    work_order_status: "in_progress",
    floor_acknowledged_at: TS,
    floor_parked_at: null,
    floor_park_reason: null,
    job_timer_running: true,
    ...overrides,
  });
}

function assertNoJargon(text: string | null) {
  if (text === null) return;
  expect(text).not.toMatch(/quality/i);
  expect(text).not.toMatch(/\bHOLD\b/);
  expect(text).not.toMatch(/\bPAUSED\b/);
}

describe("deriveFloorWorkState matrix", () => {
  it("never emits jargon and always names an owner for a wait, across the whole matrix", () => {
    for (const jobStatus of JOB_STATUSES) {
      for (const woStatus of WO_STATUSES) {
        for (const park of PARK_VARIANTS) {
          for (const timer of [false, true]) {
            const state = stateFor({
              job_status: jobStatus,
              work_order_status: woStatus,
              floor_parked_at: park.floor_parked_at,
              floor_park_reason: park.floor_park_reason,
              job_timer_running: timer,
            });
            const label = `${jobStatus} × ${woStatus} × ${park.name} × timer=${timer}`;

            assertNoJargon(state.stateLabel);
            assertNoJargon(state.waitReason);

            // An explicit wait always names its owner.
            if (state.waitReason !== null) {
              expect(state.waitOwner, label).not.toBeNull();
            }
            // held/terminal/waiting boards are always explicit waits.
            if (
              state.board === "held" ||
              state.board === "terminal" ||
              state.board === "waiting"
            ) {
              expect(state.waitReason, label).not.toBeNull();
              expect(state.waitOwner, label).not.toBeNull();
            }
          }
        }
      }
    }
  });

  it("treats completed/cancelled work orders as terminal regardless of job state", () => {
    for (const woStatus of ["completed", "cancelled"] as const) {
      for (const jobStatus of JOB_STATUSES) {
        const state = stateFor({
          job_status: jobStatus,
          work_order_status: woStatus,
        });
        expect(state.board).toBe("terminal");
        expect(state.resumable).toBe(false);
      }
    }
  });

  it("routes work-order hold to front desk for every live job state", () => {
    for (const jobStatus of ["approved", "ready_to_start", "in_progress"] as const) {
      for (const park of PARK_VARIANTS) {
        const state = stateFor({
          job_status: jobStatus,
          work_order_status: "on_hold",
          floor_parked_at: park.floor_parked_at,
          floor_park_reason: park.floor_park_reason,
        });
        expect(state.board).toBe("held");
        expect(state.waitOwner).toBe("front_desk");
        expect(state.waitReason).toBe("Bike is on hold — front desk owns it");
        expect(state.resumable).toBe(false);
      }
    }
  });

  it("maps park reasons to the right owner", () => {
    const ownerByReason: Record<string, string> = {
      parts: "parts",
      approval: "front_desk",
      tool: "technician",
      other: "technician",
      swapped: "technician",
    };
    for (const [reason, owner] of Object.entries(ownerByReason)) {
      const state = stateFor({
        floor_parked_at: TS,
        floor_park_reason: reason as FloorParkReason,
        job_timer_running: false,
      });
      expect(state.board).toBe("waiting");
      expect(state.waitOwner).toBe(owner);
    }
  });

  it("gives legacy null-owner pauses to the technician with a plain label", () => {
    const state = stateFor({
      floor_parked_at: TS,
      floor_park_reason: null,
      job_timer_running: false,
    });
    expect(state.board).toBe("waiting");
    expect(state.waitOwner).toBe("technician");
    expect(state.stateLabel).toBe("Paused — clock stopped");
    expect(state.resumable).toBe(true);
  });

  it("waits on the customer only when this job needs the approval", () => {
    const waiting = stateFor({ job_status: "waiting_for_approval" });
    expect(waiting.board).toBe("waiting");
    expect(waiting.waitOwner).toBe("front_desk");
    expect(waiting.stateLabel).toBe("Waiting for customer OK");
    expect(waiting.resumable).toBe(false);

    // A pending estimate on the WO never freezes an authorized job.
    const authorized = stateFor({
      job_status: "in_progress",
      work_order_status: "waiting_for_customer_approval",
    });
    expect(authorized.board).toBe("bench");

    const ready = stateFor({
      job_status: "ready_to_start",
      work_order_status: "waiting_for_customer_approval",
      job_timer_running: false,
    });
    expect(ready.board).toBe("next");
  });

  it("overlays WO parts waits as info without freezing bench work", () => {
    const benched = stateFor({
      job_status: "in_progress",
      work_order_status: "waiting_for_parts",
    });
    expect(benched.board).toBe("bench");
    expect(benched.waitOwner).toBe("parts");
    expect(benched.waitReason).toBe("Some parts still on order");

    const jobLevel = stateFor({ job_status: "waiting_for_parts" });
    expect(jobLevel.board).toBe("waiting");
    expect(jobLevel.waitOwner).toBe("parts");
    expect(jobLevel.resumable).toBe(true);
  });

  it("keeps quality/safety-stage jobs honest: completed job hands off to QC", () => {
    for (const woStatus of ["quality_check", "safety_check"] as const) {
      const state = stateFor({ job_status: "completed", work_order_status: woStatus });
      expect(state.board).toBe("done");
      expect(state.waitOwner).toBe("qc");
      assertNoJargon(state.stateLabel);
      assertNoJargon(state.waitReason);
    }
  });
});
