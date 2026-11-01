import type { RecommendationSeverity, RecommendationStatus } from "@/lib/database/types";

/** Same groups as the Client advisories counts on Estimate & Jobs. */
export type AdvisoryReviewBucket =
  "all" | "immediate" | "future" | "approved" | "declined";

export type AdvisoryReviewItem = {
  recommendation_id: string;
  inspection_result_id: string | null;
  description: string;
  severity: RecommendationSeverity;
  status: RecommendationStatus;
  notes: string | null;
  inspection_item_name?: string | null;
};

export type AdvisoryReviewPhoto = {
  photo_id: string;
  category: string;
  notes: string | null;
  inspection_result_id: string | null;
  signed_url?: string | null;
  thumb_url?: string | null;
  photo_url?: string | null;
};

const OPEN_STATUSES = new Set<RecommendationStatus>(["pending", "deferred"]);

export const ADVISORY_REVIEW_BUCKETS: AdvisoryReviewBucket[] = [
  "all",
  "immediate",
  "future",
  "approved",
  "declined",
];

export function advisoryReviewBucketLabel(bucket: AdvisoryReviewBucket): string {
  switch (bucket) {
    case "all":
      return "All";
    case "immediate":
      return "Immediate attention";
    case "future":
      return "Future attention";
    case "approved":
      return "On estimate / approved";
    case "declined":
      return "Declined";
  }
}

export function advisoryMatchesBucket(
  item: Pick<AdvisoryReviewItem, "severity" | "status">,
  bucket: AdvisoryReviewBucket
): boolean {
  if (bucket === "all") return true;
  if (bucket === "immediate") {
    return (
      OPEN_STATUSES.has(item.status) &&
      (item.severity === "immediate_attention" || item.severity === "safety_critical")
    );
  }
  if (bucket === "future") {
    return OPEN_STATUSES.has(item.status) && item.severity === "future_attention";
  }
  if (bucket === "approved") {
    return item.status === "converted_to_job" || item.status === "approved";
  }
  return item.status === "declined";
}

export function advisoriesInBucket<
  T extends Pick<AdvisoryReviewItem, "severity" | "status">,
>(items: T[], bucket: AdvisoryReviewBucket): T[] {
  return items.filter((item) => advisoryMatchesBucket(item, bucket));
}

/** Every photo the tech attached to this inspection finding. */
export function photosLinkedToAdvisory<
  T extends Pick<AdvisoryReviewPhoto, "inspection_result_id">,
>(photos: T[], inspectionResultId: string | null): T[] {
  if (!inspectionResultId) return [];
  return photos.filter((photo) => photo.inspection_result_id === inspectionResultId);
}
