import { describe, expect, it } from "vitest";
import { deriveDefaultStage } from "@/lib/technician/floorStage";
import type { FloorOsSurface } from "@/lib/services/technicianFloor";

function base(overrides: Partial<FloorOsSurface> = {}): FloorOsSurface {
  return {
    mode: "job",
    job_id: "j1",
    work_order_id: "w1",
    work_order_number: "WO-1",
    service_name: "Oil",
    motorcycle_label: "Yamaha R3",
    customer_label: "Ada",
    job_status: "in_progress",
    job_status_label: "In Progress",
    wo_status: "in_progress",
    wo_status_label: "In Progress",
    inspection_complete: true,
    inspection_href: "/x",
    overview_href: "/y",
    started_at: null,
    completed_at: null,
    estimated_labour: null,
    labour_label: null,
    labour_over: false,
    jobs: [
      {
        job_id: "j1",
        service_name: "Oil",
        status: "in_progress",
        status_label: "In Progress",
        assigned_to_me: true,
        is_selected: true,
      },
    ],
    checklist: [
      {
        job_checklist_item_id: "c1",
        job_id: "j1",
        title: "A",
        sort_order: 0,
        checked_at: "2026-01-01",
        checked_by_user_id: null,
      },
    ],
    parts: [],
    proof_count: 1,
    has_proof_exception: false,
    complete_gate_ok: true,
    complete_gate_reason: null,
    can_start: false,
    can_complete: true,
    can_pull: false,
    job_timer_running: false,
    is_qc: false,
    qc_assignee_is_me: false,
    is_safety: false,
    can_safety: false,
    flags: [],
    board_status: "bench",
    board_stamp: "NOW",
    floor_acknowledged_at: "2026-01-01T00:00:00Z",
    floor_parked_at: null,
    floor_park_reason: null,
    floor_wait_owner: null,
    wait_owner_label: "",
    park_reason_label: "",
    steps: [],
    go: {
      action: "none",
      label: "Nothing to do",
      sub: "",
      enabled: false,
    },
    timer_secs: 0,
    work_brief: {
      service_name: "Oil",
      job_notes: null,
      recommendation_description: null,
      recommendation_notes: null,
      estimated_labour: null,
      parts: [],
      technician_notes: [],
    },
    pending_recommendations: [],
    peer_qc_candidates: [],
    ...overrides,
  };
}

describe("deriveDefaultStage", () => {
  it("starts at inspect when inspection incomplete", () => {
    expect(deriveDefaultStage(base({ inspection_complete: false }))).toBe("inspect");
  });

  it("stays on work when checklist open", () => {
    expect(
      deriveDefaultStage(
        base({
          checklist: [
            {
              job_checklist_item_id: "c1",
              job_id: "j1",
              title: "A",
              sort_order: 0,
              checked_at: null,
              checked_by_user_id: null,
            },
          ],
          proof_count: 0,
        })
      )
    ).toBe("work");
  });

  it("moves to proof when work done but no proof", () => {
    expect(deriveDefaultStage(base({ proof_count: 0, has_proof_exception: false }))).toBe(
      "proof"
    );
  });

  it("lands on done when gates satisfied", () => {
    expect(deriveDefaultStage(base())).toBe("done");
  });

  it("uses qc for peer QC without a job", () => {
    expect(
      deriveDefaultStage(
        base({
          job_id: null,
          is_qc: true,
          qc_assignee_is_me: true,
          can_complete: false,
        })
      )
    ).toBe("qc");
  });

  it("uses safety for head tech safety queue without a job", () => {
    expect(
      deriveDefaultStage(
        base({
          job_id: null,
          is_safety: true,
          can_safety: true,
          can_complete: false,
          wo_status: "safety_check",
        })
      )
    ).toBe("safety");
  });
});
