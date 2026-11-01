import { describe, expect, it } from "vitest";
import {
  advisoriesInBucket,
  photosLinkedToAdvisory,
  type AdvisoryReviewItem,
} from "@/lib/recommendations/advisoryReview";

function advisory(
  overrides: Partial<AdvisoryReviewItem> & Pick<AdvisoryReviewItem, "recommendation_id">
): AdvisoryReviewItem {
  return {
    inspection_result_id: null,
    description: overrides.recommendation_id,
    severity: "future_attention",
    status: "pending",
    notes: null,
    ...overrides,
  };
}

const photos = [
  { photo_id: "front", inspection_result_id: "result-immediate" },
  { photo_id: "pads", inspection_result_id: "result-immediate" },
  { photo_id: "rear", inspection_result_id: null },
  { photo_id: "chain", inspection_result_id: "result-future" },
];

describe("advisory review buckets", () => {
  const items = [
    advisory({
      recommendation_id: "immediate",
      severity: "immediate_attention",
      status: "pending",
      inspection_result_id: "result-immediate",
    }),
    advisory({
      recommendation_id: "safety",
      severity: "safety_critical",
      status: "deferred",
      inspection_result_id: "result-safety",
    }),
    advisory({
      recommendation_id: "future",
      severity: "future_attention",
      status: "pending",
      inspection_result_id: "result-future",
    }),
    advisory({
      recommendation_id: "approved",
      severity: "immediate_attention",
      status: "approved",
    }),
    advisory({
      recommendation_id: "converted",
      severity: "future_attention",
      status: "converted_to_job",
    }),
    advisory({
      recommendation_id: "declined",
      severity: "immediate_attention",
      status: "declined",
    }),
  ];

  it("keeps the summary groups: open red, open yellow, approved, declined", () => {
    expect(
      advisoriesInBucket(items, "all").map((item) => item.recommendation_id)
    ).toEqual(["immediate", "safety", "future", "approved", "converted", "declined"]);
    expect(
      advisoriesInBucket(items, "immediate").map((item) => item.recommendation_id)
    ).toEqual(["immediate", "safety"]);
    expect(
      advisoriesInBucket(items, "future").map((item) => item.recommendation_id)
    ).toEqual(["future"]);
    expect(
      advisoriesInBucket(items, "approved").map((item) => item.recommendation_id)
    ).toEqual(["approved", "converted"]);
    expect(
      advisoriesInBucket(items, "declined").map((item) => item.recommendation_id)
    ).toEqual(["declined"]);
  });
});

describe("photos linked to an advisory", () => {
  it("returns every photo attached to that inspection result", () => {
    expect(
      photosLinkedToAdvisory(photos, "result-immediate").map((photo) => photo.photo_id)
    ).toEqual(["front", "pads"]);
  });

  it("returns nothing when the advisory has no inspection result", () => {
    expect(photosLinkedToAdvisory(photos, null)).toEqual([]);
  });
});
