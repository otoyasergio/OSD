import { describe, expect, it } from "vitest";
import {
  dispositionForLegacyRecommendationStatus,
  findingSeverityFromInspectionStatus,
  isAttentionInspectionStatus,
  isRecommendationOpenForEstimate,
  pickAssigneeForRecommendationJob,
  planFindingSyncForInspectionResult,
  planRecommendationSyncForFinding,
  severityFromInspectionStatus,
  workOrderNeedsReopenForNewRecommendationWork,
} from "@/lib/services/recommendations";

describe("inspection → recommendation mapping", () => {
  it("treats yellow and red as attention findings", () => {
    expect(isAttentionInspectionStatus("future_attention")).toBe(true);
    expect(isAttentionInspectionStatus("immediate_attention")).toBe(true);
    expect(isAttentionInspectionStatus("ok")).toBe(false);
    expect(isAttentionInspectionStatus("not_applicable")).toBe(false);
    expect(isAttentionInspectionStatus(null)).toBe(false);
  });

  it("maps yellow to future and red to immediate severity", () => {
    expect(severityFromInspectionStatus("future_attention")).toBe("future_attention");
    expect(severityFromInspectionStatus("immediate_attention")).toBe(
      "immediate_attention"
    );
  });
});

describe("live finding → recommendation sync plan", () => {
  it("creates a recommendation the moment a tech flags attention", () => {
    expect(planRecommendationSyncForFinding(null, "immediate_attention")).toEqual({
      action: "create",
      severity: "immediate_attention",
    });
    expect(planRecommendationSyncForFinding(null, "future_attention")).toEqual({
      action: "create",
      severity: "future_attention",
    });
  });

  it("does nothing for green / not-applicable findings with no recommendation", () => {
    expect(planRecommendationSyncForFinding(null, "ok")).toEqual({ action: "none" });
    expect(planRecommendationSyncForFinding(null, null)).toEqual({ action: "none" });
  });

  it("keeps an untouched pending recommendation in step with severity changes", () => {
    const pending = {
      status: "pending" as const,
      severity: "future_attention" as const,
      converted_job_id: null,
    };
    expect(planRecommendationSyncForFinding(pending, "immediate_attention")).toEqual({
      action: "update_severity",
      severity: "immediate_attention",
    });
    expect(planRecommendationSyncForFinding(pending, "future_attention")).toEqual({
      action: "none",
    });
  });

  it("withdraws only untouched pending recommendations when the flag clears", () => {
    expect(
      planRecommendationSyncForFinding(
        { status: "pending", severity: "future_attention", converted_job_id: null },
        "ok"
      )
    ).toEqual({ action: "withdraw" });
    expect(
      planRecommendationSyncForFinding(
        { status: "deferred", severity: "future_attention", converted_job_id: null },
        "ok"
      )
    ).toEqual({ action: "none" });
    expect(
      planRecommendationSyncForFinding(
        { status: "pending", severity: "future_attention", converted_job_id: "job-1" },
        "ok"
      )
    ).toEqual({ action: "none" });
  });

  it("never touches recommendations staff already decided on", () => {
    expect(
      planRecommendationSyncForFinding(
        {
          status: "converted_to_job",
          severity: "immediate_attention",
          converted_job_id: "job-1",
        },
        "immediate_attention"
      )
    ).toEqual({ action: "none" });
    expect(
      planRecommendationSyncForFinding(
        { status: "declined", severity: "future_attention", converted_job_id: null },
        "immediate_attention"
      )
    ).toEqual({ action: "none" });
  });
});

describe("approve recommendation → docket assignee", () => {
  it("prefers active tech, then who finished prior work, then primary", () => {
    expect(
      pickAssigneeForRecommendationJob({
        activeTechnicianId: "tech-a",
        completedTechnicianId: "tech-c",
        primaryTechnicianId: "tech-b",
      })
    ).toBe("tech-a");
    expect(
      pickAssigneeForRecommendationJob({
        activeTechnicianId: null,
        completedTechnicianId: "tech-c",
        primaryTechnicianId: "tech-b",
      })
    ).toBe("tech-c");
    expect(
      pickAssigneeForRecommendationJob({
        activeTechnicianId: null,
        completedTechnicianId: null,
        primaryTechnicianId: "tech-b",
      })
    ).toBe("tech-b");
    expect(
      pickAssigneeForRecommendationJob({
        activeTechnicianId: null,
        primaryTechnicianId: null,
      })
    ).toBeNull();
  });

  it("reopens finished visits on approve, not on in-progress wrench work", () => {
    expect(
      workOrderNeedsReopenForNewRecommendationWork({
        status: "ready_for_pickup",
        quality_checked_at: "2026-07-17T12:00:00Z",
      })
    ).toBe(true);
    expect(
      workOrderNeedsReopenForNewRecommendationWork({
        status: "in_progress",
        quality_checked_at: null,
        ready_for_pickup_at: null,
      })
    ).toBe(false);
  });
});

describe("durable finding severity mapping", () => {
  it("maps yellow to advisory and red to immediate", () => {
    expect(findingSeverityFromInspectionStatus("future_attention")).toBe("advisory");
    expect(findingSeverityFromInspectionStatus("immediate_attention")).toBe("immediate");
  });
});

describe("inspection result → durable finding sync plan", () => {
  it("creates a finding the first time an item is flagged", () => {
    expect(planFindingSyncForInspectionResult(null, "future_attention")).toEqual({
      action: "create",
      severity: "advisory",
    });
    expect(planFindingSyncForInspectionResult(null, "immediate_attention")).toEqual({
      action: "create",
      severity: "immediate",
    });
  });

  it("is idempotent under repeated saves of the same flag", () => {
    expect(
      planFindingSyncForInspectionResult({ severity: "advisory" }, "future_attention")
    ).toEqual({ action: "none" });
    expect(
      planFindingSyncForInspectionResult({ severity: "immediate" }, "immediate_attention")
    ).toEqual({ action: "none" });
  });

  it("updates severity when the flag colour changes", () => {
    expect(
      planFindingSyncForInspectionResult({ severity: "advisory" }, "immediate_attention")
    ).toEqual({ action: "update_severity", severity: "immediate" });
    expect(
      planFindingSyncForInspectionResult({ severity: "immediate" }, "future_attention")
    ).toEqual({ action: "update_severity", severity: "advisory" });
  });

  it("withdraws (never deletes) when the flag clears", () => {
    expect(planFindingSyncForInspectionResult({ severity: "advisory" }, "ok")).toEqual({
      action: "withdraw",
    });
    expect(planFindingSyncForInspectionResult({ severity: "immediate" }, null)).toEqual({
      action: "withdraw",
    });
  });

  it("does nothing when there is no open finding and no flag", () => {
    expect(planFindingSyncForInspectionResult(null, "ok")).toEqual({ action: "none" });
    expect(planFindingSyncForInspectionResult(null, "not_applicable")).toEqual({
      action: "none",
    });
  });

  it("re-creates after withdrawal (withdrawn findings count as absent)", () => {
    // The lookup only surfaces open findings; a withdrawn row yields null.
    expect(planFindingSyncForInspectionResult(null, "immediate_attention")).toEqual({
      action: "create",
      severity: "immediate",
    });
  });
});

describe("dispositions survive alongside legacy statuses", () => {
  it("projects every legacy status to a durable disposition", () => {
    expect(dispositionForLegacyRecommendationStatus("pending")).toBe("open");
    expect(dispositionForLegacyRecommendationStatus("deferred")).toBe("deferred");
    expect(dispositionForLegacyRecommendationStatus("declined")).toBe("declined");
    expect(dispositionForLegacyRecommendationStatus("approved")).toBe("scheduled");
    expect(dispositionForLegacyRecommendationStatus("converted_to_job")).toBe(
      "scheduled"
    );
  });

  it("treats a voided recommendation as absent so re-flagging recreates it", () => {
    const voided = {
      status: "pending" as const,
      severity: "future_attention" as const,
      converted_job_id: null,
      disposition: "void" as const,
    };
    expect(planRecommendationSyncForFinding(voided, "future_attention")).toEqual({
      action: "create",
      severity: "future_attention",
    });
    // And clearing an already-voided rec is a no-op, not a second withdrawal.
    expect(planRecommendationSyncForFinding(voided, "ok")).toEqual({ action: "none" });
  });

  it("keeps withdraw semantics for live pending recommendations", () => {
    expect(
      planRecommendationSyncForFinding(
        {
          status: "pending",
          severity: "future_attention",
          converted_job_id: null,
          disposition: "open",
        },
        "ok"
      )
    ).toEqual({ action: "withdraw" });
  });
});

describe("estimate inbox membership", () => {
  it("uses disposition when present, legacy status otherwise", () => {
    expect(
      isRecommendationOpenForEstimate({
        status: "pending",
        converted_job_id: null,
        disposition: "open",
      })
    ).toBe(true);
    expect(
      isRecommendationOpenForEstimate({
        status: "pending",
        converted_job_id: null,
        disposition: "deferred",
      })
    ).toBe(false);
    expect(
      isRecommendationOpenForEstimate({
        status: "pending",
        converted_job_id: null,
        disposition: null,
      })
    ).toBe(true);
    expect(
      isRecommendationOpenForEstimate({
        status: "deferred",
        converted_job_id: null,
        disposition: null,
      })
    ).toBe(false);
    expect(
      isRecommendationOpenForEstimate({
        status: "pending",
        converted_job_id: "job-1",
        disposition: "open",
      })
    ).toBe(false);
  });
});
