import type { PassportDraft } from "@/lib/passport/buildDraft";

export type PassportReview = {
  passportNumber: string;
  reportVersion: number;
  issuedAt: string;
  payloadSha256: string;
  sourceSha256: string;
  sourceWorkOrderIds: string[];
};

type ReviewablePassportDraft = PassportDraft & { sourceSha256: string };

export function createPassportReview(draft: ReviewablePassportDraft): PassportReview {
  return {
    passportNumber: draft.payload.passport_number,
    reportVersion: draft.payload.report_version,
    issuedAt: draft.payload.issued_at,
    payloadSha256: draft.payloadSha256,
    sourceSha256: draft.sourceSha256,
    sourceWorkOrderIds: [...draft.sourceWorkOrderIds],
  };
}

export function assertPassportReviewCurrent(
  review: PassportReview,
  current: ReviewablePassportDraft
): void {
  const sourcesMatch =
    review.sourceWorkOrderIds.length === current.sourceWorkOrderIds.length &&
    review.sourceWorkOrderIds.every(
      (sourceId, index) => sourceId === current.sourceWorkOrderIds[index]
    );

  if (
    review.passportNumber !== current.payload.passport_number ||
    review.reportVersion !== current.payload.report_version ||
    review.issuedAt !== current.payload.issued_at ||
    review.payloadSha256 !== current.payloadSha256 ||
    review.sourceSha256 !== current.sourceSha256 ||
    !sourcesMatch
  ) {
    throw new Error("PASSPORT_PREVIEW_STALE");
  }
}
