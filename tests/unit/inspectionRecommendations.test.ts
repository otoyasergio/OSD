import { describe, expect, it } from "vitest";
import {
  isAttentionInspectionStatus,
  pickAssigneeForRecommendationJob,
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
