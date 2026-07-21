import { describe, expect, it } from "vitest";
import {
  isAttentionInspectionStatus,
  pickAssigneeForRecommendationJob,
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
