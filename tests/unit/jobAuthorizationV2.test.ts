import { describe, expect, it } from "vitest";
import {
  deriveWorkOrderRollup,
  type RollupJobFacts,
  type WorkOrderRollupInput,
} from "@/lib/jobs-v2/rollup";

function job(overrides: Partial<RollupJobFacts> = {}): RollupJobFacts {
  return {
    workState: "planned",
    authorization: null,
    presented: false,
    partsReady: true,
    hasOpenPartsBlocker: false,
    ...overrides,
  };
}

function input(overrides: Partial<WorkOrderRollupInput> = {}): WorkOrderRollupInput {
  return {
    lifecycleState: "active",
    jobs: [],
    estimateStatus: null,
    hasOpenFindings: false,
    qcRequired: false,
    safetyRequired: false,
    invoiceBalanceCents: 0,
    invoicePaid: false,
    ...overrides,
  };
}

describe("work order rollup — lifecycle precedence", () => {
  it("terminal and hold lifecycles dominate everything", () => {
    const busy = [job({ workState: "in_progress", authorization: "approved" })];
    expect(
      deriveWorkOrderRollup(input({ lifecycleState: "cancelled", jobs: busy }))
        .displayStage
    ).toBe("cancelled");
    expect(
      deriveWorkOrderRollup(input({ lifecycleState: "closed", jobs: busy })).displayStage
    ).toBe("closed");
    expect(
      deriveWorkOrderRollup(input({ lifecycleState: "on_hold", jobs: busy })).displayStage
    ).toBe("on_hold");
    expect(deriveWorkOrderRollup(input({ lifecycleState: "draft" })).displayStage).toBe(
      "intake"
    );
  });
});

describe("work order rollup — the mixed-state fix", () => {
  it("pending optional decisions never hide authorized work in progress", () => {
    const rollup = deriveWorkOrderRollup(
      input({
        jobs: [
          job({ workState: "in_progress", authorization: "approved", presented: true }),
          job({ presented: true, authorization: null }),
        ],
        estimateStatus: "presented",
      })
    );
    expect(rollup.displayStage).toBe("in_progress");
    expect(rollup.pendingDecisionCount).toBe(1);
    expect(rollup.inProgressCount).toBe(1);
  });

  it("ready authorized work outranks pending decisions and parts waits rank next", () => {
    const ready = deriveWorkOrderRollup(
      input({
        jobs: [
          job({ workState: "ready", authorization: "approved", presented: true }),
          job({ presented: true }),
        ],
        estimateStatus: "presented",
      })
    );
    expect(ready.displayStage).toBe("ready_to_work");
    expect(ready.readyJobCount).toBe(1);

    const parts = deriveWorkOrderRollup(
      input({
        jobs: [
          job({
            authorization: "approved",
            presented: true,
            partsReady: false,
          }),
          job({ presented: true }),
        ],
        estimateStatus: "presented",
      })
    );
    expect(parts.displayStage).toBe("parts_wait");
    expect(parts.waitingPartsCount).toBe(1);
  });

  it("an open parts blocker counts even when quantities look ready", () => {
    const rollup = deriveWorkOrderRollup(
      input({
        jobs: [
          job({
            authorization: "approved",
            presented: true,
            workState: "ready",
            partsReady: true,
            hasOpenPartsBlocker: true,
          }),
        ],
      })
    );
    expect(rollup.displayStage).toBe("parts_wait");
    expect(rollup.readyJobCount).toBe(0);
    expect(rollup.waitingPartsCount).toBe(1);
  });
});

describe("work order rollup — finish path", () => {
  const completed = [
    job({ workState: "completed", authorization: "approved", presented: true }),
  ];

  it("walks qc → safety → invoice_due → paid", () => {
    expect(
      deriveWorkOrderRollup(input({ jobs: completed, qcRequired: true })).displayStage
    ).toBe("qc");
    expect(
      deriveWorkOrderRollup(input({ jobs: completed, safetyRequired: true })).displayStage
    ).toBe("safety");
    expect(
      deriveWorkOrderRollup(input({ jobs: completed, invoiceBalanceCents: 40680 }))
        .displayStage
    ).toBe("invoice_due");
    expect(
      deriveWorkOrderRollup(input({ jobs: completed, invoicePaid: true })).displayStage
    ).toBe("paid");
  });

  it("declined siblings do not block the finish path", () => {
    const rollup = deriveWorkOrderRollup(
      input({
        jobs: [...completed, job({ authorization: "declined", presented: true })],
        qcRequired: true,
      })
    );
    expect(rollup.displayStage).toBe("qc");
  });

  it("cancelled jobs are excluded from every count", () => {
    const rollup = deriveWorkOrderRollup(
      input({
        jobs: [
          job({ workState: "cancelled", authorization: "approved", presented: true }),
          job({ presented: true }),
        ],
      })
    );
    expect(rollup.completedJobCount).toBe(0);
    expect(rollup.inProgressCount).toBe(0);
    expect(rollup.pendingDecisionCount).toBe(1);
  });
});

describe("work order rollup — pre-work stages", () => {
  it("authorization_pending when only undecided presented jobs exist", () => {
    const rollup = deriveWorkOrderRollup(
      input({
        jobs: [job({ presented: true }), job({ presented: true })],
        estimateStatus: "presented",
      })
    );
    expect(rollup.displayStage).toBe("authorization_pending");
    expect(rollup.pendingDecisionCount).toBe(2);
  });

  it("estimate_presented, estimate_draft, findings, then intake", () => {
    expect(
      deriveWorkOrderRollup(input({ estimateStatus: "presented" })).displayStage
    ).toBe("estimate_presented");
    expect(deriveWorkOrderRollup(input({ estimateStatus: "draft" })).displayStage).toBe(
      "estimate_draft"
    );
    expect(deriveWorkOrderRollup(input({ hasOpenFindings: true })).displayStage).toBe(
      "findings"
    );
    expect(deriveWorkOrderRollup(input()).displayStage).toBe("intake");
  });

  it("fully declined scope returns to estimate/findings stages instead of freezing", () => {
    const rollup = deriveWorkOrderRollup(
      input({
        jobs: [job({ authorization: "declined", presented: true })],
        estimateStatus: "confirmed",
        hasOpenFindings: true,
      })
    );
    expect(rollup.displayStage).toBe("findings");
    expect(rollup.pendingDecisionCount).toBe(0);
  });
});
