import { describe, expect, it } from "vitest";
import { deriveDefaultStage } from "@/components/technician/TechnicianFloorShell";
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
    is_qc: false,
    qc_assignee_is_me: false,
    flags: [],
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
});
