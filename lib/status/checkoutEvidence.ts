export const CHECKOUT_PHOTO_CATEGORIES = [
  "checkout_front",
  "checkout_rear",
  "checkout_left_side",
  "checkout_right_side",
  "checkout_odometer",
] as const;

export type CheckoutPhotoCategory = (typeof CHECKOUT_PHOTO_CATEGORIES)[number];

export type CheckoutCoverage = {
  covered: CheckoutPhotoCategory[];
  missing: CheckoutPhotoCategory[];
  complete: boolean;
};

export function isCheckoutPhotoCategory(
  category: string | null | undefined
): category is CheckoutPhotoCategory {
  return (
    typeof category === "string" &&
    (CHECKOUT_PHOTO_CATEGORIES as readonly string[]).includes(category)
  );
}

/** Covered/missing checkout categories from mixed photo rows. One or more of each is complete. */
export function checkoutCoverageFromPhotos(
  photos: Array<{ category?: string | null }>
): CheckoutCoverage {
  const present = new Set<CheckoutPhotoCategory>();
  for (const photo of photos) {
    if (isCheckoutPhotoCategory(photo.category)) {
      present.add(photo.category);
    }
  }
  const covered = CHECKOUT_PHOTO_CATEGORIES.filter((category) => present.has(category));
  const missing = CHECKOUT_PHOTO_CATEGORIES.filter((category) => !present.has(category));
  return {
    covered,
    missing,
    complete: missing.length === 0,
  };
}

export const CHECKOUT_EVIDENCE_OVERRIDE_REASON_MAX_LENGTH = 500;

export function checkoutCapturePreconditions(input: {
  jobs: Array<{ status: string }>;
  qualityCheckedAt?: string | null;
  qualityCheckedByUserId?: string | null;
}): { jobsComplete: boolean; qcComplete: boolean } {
  const active = input.jobs.filter(
    (job) => job.status !== "cancelled" && job.status !== "declined"
  );
  return {
    jobsComplete: active.length > 0 && active.every((job) => job.status === "completed"),
    qcComplete: Boolean(input.qualityCheckedAt && input.qualityCheckedByUserId),
  };
}

export function checkoutEvidenceOverridden(input: {
  checkout_evidence_override_at?: string | null;
  checkout_evidence_override_by_user_id?: string | null;
  checkout_evidence_override_reason?: string | null;
}): boolean {
  return Boolean(
    input.checkout_evidence_override_at &&
    input.checkout_evidence_override_by_user_id &&
    input.checkout_evidence_override_reason?.trim()
  );
}

export function checkoutEvidenceSatisfied(input: {
  required: boolean;
  complete: boolean;
  overridden: boolean;
}): boolean {
  return !input.required || input.complete || input.overridden;
}
