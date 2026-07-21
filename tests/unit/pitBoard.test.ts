import { describe, expect, it } from "vitest";
import {
  buildPitBoardSteps,
  deriveGoAction,
  derivePitBoardStatus,
  isFloorJobFinished,
  isPitBoardStepActionableWhileParked,
  isPitBoardStepTappable,
  isPitBoardStepViewableWhileParked,
  parkReasonLabel,
  stampForBoard,
  waitOwnerForParkReason,
} from "@/lib/technician/pitBoard";
import { evaluateJobCompleteGate } from "@/lib/status/jobCompleteGate";

describe("pitBoard", () => {
  it("maps park reasons to wait owners", () => {
    expect(waitOwnerForParkReason("parts")).toBe("front_desk");
    expect(waitOwnerForParkReason("approval")).toBe("front_desk");
    expect(waitOwnerForParkReason("tool")).toBe("front_desk");
    expect(waitOwnerForParkReason("swapped")).toBe("front_desk");
    expect(waitOwnerForParkReason("other")).toBe("technician");
  });

  it("derives offered → next → bench → waiting stamps", () => {
    expect(
      derivePitBoardStatus({
        kind: "job",
        job_status: "ready_to_start",
        floor_acknowledged_at: null,
        floor_parked_at: null,
        job_timer_running: false,
        is_bench: false,
      })
    ).toBe("offered");

    expect(
      derivePitBoardStatus({
        kind: "job",
        job_status: "ready_to_start",
        floor_acknowledged_at: "2026-07-17T12:00:00Z",
        floor_parked_at: null,
        job_timer_running: false,
        is_bench: false,
      })
    ).toBe("next");

    expect(
      derivePitBoardStatus({
        kind: "job",
        job_status: "in_progress",
        floor_acknowledged_at: "2026-07-17T12:00:00Z",
        floor_parked_at: null,
        job_timer_running: true,
        is_bench: true,
      })
    ).toBe("bench");

    expect(
      derivePitBoardStatus({
        kind: "job",
        job_status: "in_progress",
        floor_acknowledged_at: "2026-07-17T12:00:00Z",
        floor_parked_at: "2026-07-17T13:00:00Z",
        job_timer_running: false,
        is_bench: false,
      })
    ).toBe("waiting");

    expect(
      stampForBoard({
        status: "waiting",
        floor_parked_at: null,
        job_timer_running: false,
      })
    ).toBe("PAUSED");
  });

  it("builds Go labels for acknowledge, pull, resume, complete", () => {
    expect(
      deriveGoAction({
        status: "offered",
        steps: [],
        complete_gate_ok: false,
      }).action
    ).toBe("acknowledge");

    expect(
      deriveGoAction({
        status: "next",
        steps: [],
        complete_gate_ok: false,
      }).label
    ).toContain("Pull onto the bench");

    expect(
      deriveGoAction({
        status: "waiting",
        steps: [],
        complete_gate_ok: false,
      }).action
    ).toBe("resume");

    const steps = buildPitBoardSteps({
      inspection_complete: true,
      checklist: [
        {
          job_checklist_item_id: "c1",
          title: "Drain oil",
          checked_at: "2026-07-17T12:00:00Z",
        },
      ],
      parts: [],
      proof_count: 1,
      has_proof_exception: false,
      complete_gate_ok: true,
    });
    const go = deriveGoAction({
      status: "bench",
      steps,
      complete_gate_ok: true,
    });
    expect(go.action).toBe("complete");
    expect(go.enabled).toBe(true);
  });

  it("holds jobs waiting for client approval", () => {
    expect(
      derivePitBoardStatus({
        kind: "job",
        job_status: "waiting_for_approval",
        floor_acknowledged_at: "2026-07-17T12:00:00Z",
        floor_parked_at: null,
        job_timer_running: false,
        is_bench: false,
      })
    ).toBe("waiting");
  });

  it("opens Perform work as a work step with required service in the sub", () => {
    const steps = buildPitBoardSteps({
      inspection_complete: true,
      service_name: "Oil change",
      checklist: [
        {
          job_checklist_item_id: "c1",
          title: "Perform work per SOP",
          checked_at: null,
        },
      ],
      parts: [],
      proof_count: 0,
      has_proof_exception: false,
      complete_gate_ok: false,
    });
    const work = steps.find((s) => s.kind === "work");
    expect(work).toMatchObject({
      label: "Perform work",
      sub: "Oil change",
      state: "open",
      photo: true,
    });
    expect(
      deriveGoAction({
        status: "bench",
        steps,
        complete_gate_ok: false,
      }).label
    ).toContain("Perform work");
  });

  it("keeps completed inspection tappable for report review", () => {
    const steps = buildPitBoardSteps({
      inspection_complete: true,
      checklist: [
        {
          job_checklist_item_id: "c1",
          title: "Drain oil",
          checked_at: "2026-07-17T12:00:00Z",
        },
      ],
      parts: [],
      proof_count: 0,
      has_proof_exception: false,
      complete_gate_ok: false,
    });
    const inspect = steps.find((s) => s.kind === "inspect");
    expect(inspect).toMatchObject({
      state: "done",
      sub: "Complete — tap to view report",
    });
    expect(isPitBoardStepTappable(inspect!)).toBe(true);
    expect(isPitBoardStepTappable(steps.find((s) => s.kind === "checklist")!)).toBe(
      false
    );
  });

  it("allows inspection and perform work browsing while parked", () => {
    const steps = buildPitBoardSteps({
      inspection_complete: true,
      service_name: "Oil change",
      checklist: [
        {
          job_checklist_item_id: "c1",
          title: "Perform work per SOP",
          checked_at: null,
        },
      ],
      parts: [],
      proof_count: 0,
      has_proof_exception: false,
      complete_gate_ok: false,
    });
    expect(
      isPitBoardStepViewableWhileParked(steps.find((s) => s.kind === "inspect")!)
    ).toBe(true);
    expect(isPitBoardStepViewableWhileParked(steps.find((s) => s.kind === "work")!)).toBe(
      true
    );
    expect(
      isPitBoardStepViewableWhileParked(steps.find((s) => s.kind === "proof")!)
    ).toBe(false);
  });

  it("allows open verify checklist rows while parked or waiting on client", () => {
    const steps = buildPitBoardSteps({
      inspection_complete: true,
      service_name: "Oil change",
      checklist: [
        {
          job_checklist_item_id: "c1",
          title: "Perform work",
          checked_at: "2026-07-17T12:00:00Z",
        },
        {
          job_checklist_item_id: "c2",
          title: "Verify fasteners/fluids/function",
          checked_at: null,
        },
        {
          job_checklist_item_id: "c3",
          title: "Area clean / ready for QC",
          checked_at: null,
        },
      ],
      parts: [],
      proof_count: 0,
      has_proof_exception: false,
      complete_gate_ok: false,
    });
    const verify = steps.find((s) => s.label.includes("Verify"))!;
    const clean = steps.find((s) => s.label.includes("Area clean"))!;
    expect(isPitBoardStepActionableWhileParked(verify)).toBe(true);
    expect(isPitBoardStepActionableWhileParked(clean)).toBe(true);
    expect(
      isPitBoardStepActionableWhileParked(steps.find((s) => s.kind === "proof")!)
    ).toBe(false);
    expect(isPitBoardStepActionableWhileParked({ ...verify, state: "done" })).toBe(false);
  });

  it("keeps Go disabled while waiting on client without forcing resume", () => {
    expect(
      deriveGoAction({
        status: "waiting",
        steps: [],
        complete_gate_ok: false,
        awaiting_client_approval: true,
      })
    ).toMatchObject({
      action: "none",
      label: "Waiting on client",
      enabled: false,
    });
  });

  it("keeps Complete enabled on the bench even when other findings await client", () => {
    const steps = buildPitBoardSteps({
      inspection_complete: true,
      checklist: [
        {
          job_checklist_item_id: "c1",
          title: "Perform work",
          checked_at: "2026-07-17T12:00:00Z",
        },
        {
          job_checklist_item_id: "c2",
          title: "Verify fasteners/fluids/function",
          checked_at: "2026-07-17T12:01:00Z",
        },
        {
          job_checklist_item_id: "c3",
          title: "Area clean / ready for QC",
          checked_at: "2026-07-17T12:02:00Z",
        },
      ],
      parts: [],
      proof_count: 1,
      has_proof_exception: false,
      complete_gate_ok: true,
    });
    // Pending WO recommendations must not set awaiting_client_approval on an
    // in-progress original job — only the current job's waiting_for_approval does.
    const go = deriveGoAction({
      status: "bench",
      steps,
      complete_gate_ok: true,
      awaiting_client_approval: false,
    });
    expect(go.action).toBe("complete");
    expect(go.enabled).toBe(true);
  });

  it("does not advance Go to inspection when perform work is next", () => {
    const steps = buildPitBoardSteps({
      inspection_complete: true,
      service_name: "Oil change",
      checklist: [
        {
          job_checklist_item_id: "c1",
          title: "Perform work per SOP",
          checked_at: null,
        },
      ],
      parts: [],
      proof_count: 0,
      has_proof_exception: false,
      complete_gate_ok: false,
    });
    const go = deriveGoAction({
      status: "bench",
      steps,
      complete_gate_ok: false,
    });
    expect(go.action).toBe("advance_step");
    expect(go.step?.kind).toBe("work");
    expect(go.label).toContain("Perform work");
  });

  it("treats proof skip (exception) as complete-gate satisfied", () => {
    const gate = evaluateJobCompleteGate({
      checklistItems: [{ checked_at: "2026-07-17T12:00:00Z" }],
      parts: [],
      proofPhotoCount: 0,
      hasProofException: true,
      inspectionComplete: true,
    });
    expect(gate.ok).toBe(true);
  });

  it("stamps parked bikes HOLD and keeps park reason labels plain", () => {
    expect(
      stampForBoard({
        status: "waiting",
        floor_parked_at: "2026-07-17T13:00:00Z",
        job_timer_running: false,
      })
    ).toBe("HOLD");
    expect(parkReasonLabel("parts")).toBe("Parts not here");
    expect(parkReasonLabel("tool")).toBe("Tool or lift busy");
    expect(parkReasonLabel(null)).toBe("Parked");
  });

  it("flags finished wrench work from board status, job status, or timestamps", () => {
    expect(
      isFloorJobFinished({
        board_status: "done",
        job_status: "in_progress",
        completed_at: null,
      })
    ).toBe(true);
    expect(
      isFloorJobFinished({
        board_status: "bench",
        job_status: "completed",
        completed_at: null,
      })
    ).toBe(true);
    expect(
      isFloorJobFinished({
        board_status: "bench",
        job_status: "in_progress",
        completed_at: "2026-07-17T15:00:00Z",
      })
    ).toBe(true);
    expect(
      isFloorJobFinished({
        board_status: "bench",
        job_status: "in_progress",
        completed_at: null,
      })
    ).toBe(false);
  });
});
