import { describe, it, expect } from "vitest";
import {
  shouldAutoCreateRecommendation,
  severityFromInspectionStatus,
  shouldSkipDuplicateRecommendation,
} from "@/lib/services/autoRecommendationFromInspection";

describe("autoRecommendationFromInspection", () => {
  it("creates for yellow (future_attention)", () => {
    expect(shouldAutoCreateRecommendation("future_attention")).toBe(true);
    expect(severityFromInspectionStatus("future_attention")).toBe(
      "future_attention"
    );
  });

  it("creates for red (immediate_attention) with immediate severity", () => {
    expect(shouldAutoCreateRecommendation("immediate_attention")).toBe(true);
    expect(severityFromInspectionStatus("immediate_attention")).toBe(
      "immediate_attention"
    );
  });

  it("does not create for ok", () => {
    expect(shouldAutoCreateRecommendation("ok")).toBe(false);
  });

  it("does not create for not_applicable", () => {
    expect(shouldAutoCreateRecommendation("not_applicable")).toBe(false);
  });

  it("does not create for null / incomplete", () => {
    expect(shouldAutoCreateRecommendation(null)).toBe(false);
    expect(shouldAutoCreateRecommendation(undefined)).toBe(false);
  });

  it("skips duplicate when inspection_result_id already linked", () => {
    const existing = ["aaa-1", "bbb-2"];
    expect(shouldSkipDuplicateRecommendation(existing, "bbb-2")).toBe(true);
    expect(shouldSkipDuplicateRecommendation(existing, "ccc-3")).toBe(false);
  });
});
