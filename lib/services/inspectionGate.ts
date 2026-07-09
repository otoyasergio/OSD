/** Item name that skips the Brakes & Tires section when marked OK. */
export const BRAKE_INSPECTION_SKIP_ITEM =
  "Brake Inspection Not Performed This Visit";

const BRAKE_CATEGORY_PREFIX = "Brakes & Tires";

export type InspectionPhotoCategory =
  | "inspection_tires"
  | "inspection_brakes"
  | "inspection_forks"
  | "inspection_item";

export type InspectionPhotoRequirement = {
  kind: "section" | "item";
  category: InspectionPhotoCategory;
  label: string;
  /** For item-level requirements */
  inspection_result_id?: string;
  item_name?: string;
};

export function isBrakeSectionItem(category: string, itemName: string): boolean {
  if (itemName === BRAKE_INSPECTION_SKIP_ITEM) return true;
  return category.startsWith(BRAKE_CATEGORY_PREFIX);
}

function isTireItem(itemName: string): boolean {
  return /tire|tread|wear pattern|dry rot/i.test(itemName);
}

function isBrakeItem(itemName: string): boolean {
  if (itemName === BRAKE_INSPECTION_SKIP_ITEM) return false;
  return /brake|rotor|caliper|spokes|cast|rims|bearings|seals|wheel out of round/i.test(
    itemName
  );
}

function isForksItem(category: string, itemName: string): boolean {
  return (
    category.startsWith("Frame, Chassis") && /front forks/i.test(itemName)
  );
}

/**
 * Incomplete checklist items, honoring the paper-form skip for Brakes & Tires
 * when "Brake Inspection Not Performed This Visit" is marked OK.
 */
export function countIncompleteInspectionResults(
  results: Array<{
    status: string | null;
    category_snapshot: string;
    item_name_snapshot: string;
  }>
): number {
  const skip = results.find(
    (r) => r.item_name_snapshot === BRAKE_INSPECTION_SKIP_ITEM
  );
  const brakeSkipped = skip?.status === "ok";

  return results.filter((r) => {
    if (r.status != null) return false;
    if (
      brakeSkipped &&
      isBrakeSectionItem(r.category_snapshot, r.item_name_snapshot) &&
      r.item_name_snapshot !== BRAKE_INSPECTION_SKIP_ITEM
    ) {
      return false;
    }
    return true;
  }).length;
}

/**
 * Photos required before the inspection can be marked complete.
 * - Tires / Brakes: when any item in that subsection is answered (unless skip).
 * - Forks: when Front Forks is answered.
 * - Flagged items: yellow/red status needs a linked inspection_item photo.
 */
export function getRequiredInspectionPhotos(
  results: Array<{
    inspection_result_id: string;
    status: string | null;
    category_snapshot: string;
    item_name_snapshot: string;
  }>
): InspectionPhotoRequirement[] {
  const skip = results.find(
    (r) => r.item_name_snapshot === BRAKE_INSPECTION_SKIP_ITEM
  );
  const brakeSkipped = skip?.status === "ok";
  const required: InspectionPhotoRequirement[] = [];

  const answered = results.filter((r) => r.status != null);
  const tiresAnswered =
    !brakeSkipped &&
    answered.some(
      (r) =>
        isBrakeSectionItem(r.category_snapshot, r.item_name_snapshot) &&
        isTireItem(r.item_name_snapshot)
    );
  const brakesAnswered =
    !brakeSkipped &&
    answered.some(
      (r) =>
        isBrakeSectionItem(r.category_snapshot, r.item_name_snapshot) &&
        isBrakeItem(r.item_name_snapshot)
    );
  const forksAnswered = answered.some((r) =>
    isForksItem(r.category_snapshot, r.item_name_snapshot)
  );

  if (tiresAnswered) {
    required.push({
      kind: "section",
      category: "inspection_tires",
      label: "Tires photo",
    });
  }
  if (brakesAnswered) {
    required.push({
      kind: "section",
      category: "inspection_brakes",
      label: "Brakes photo",
    });
  }
  if (forksAnswered) {
    required.push({
      kind: "section",
      category: "inspection_forks",
      label: "Forks photo",
    });
  }

  for (const r of results) {
    if (
      r.status === "future_attention" ||
      r.status === "immediate_attention"
    ) {
      required.push({
        kind: "item",
        category: "inspection_item",
        label: `Photo: ${r.item_name_snapshot}`,
        inspection_result_id: r.inspection_result_id,
        item_name: r.item_name_snapshot,
      });
    }
  }

  return required;
}

export type InspectionPhotoPresence = {
  category: string;
  inspection_result_id?: string | null;
};

export function getMissingInspectionPhotos(
  results: Array<{
    inspection_result_id: string;
    status: string | null;
    category_snapshot: string;
    item_name_snapshot: string;
  }>,
  photos: InspectionPhotoPresence[]
): InspectionPhotoRequirement[] {
  const required = getRequiredInspectionPhotos(results);
  return required.filter((req) => {
    if (req.kind === "section") {
      return !photos.some((p) => p.category === req.category);
    }
    return !photos.some(
      (p) =>
        p.category === "inspection_item" &&
        p.inspection_result_id === req.inspection_result_id
    );
  });
}

export function assertInspectionPhotosComplete(
  results: Array<{
    inspection_result_id: string;
    status: string | null;
    category_snapshot: string;
    item_name_snapshot: string;
  }>,
  photos: InspectionPhotoPresence[]
): void {
  const missing = getMissingInspectionPhotos(results, photos);
  if (missing.length > 0) {
    throw new Error("INSPECTION_PHOTOS_REQUIRED");
  }
}

/**
 * Job completion requires the work-order inspection report to be finished
 * (`inspection.completed_at` set).
 */
export function assertInspectionCompletedForJobFinish(
  inspectionCompletedAt: string | null | undefined
): void {
  if (!inspectionCompletedAt) {
    throw new Error("INSPECTION_NOT_COMPLETED");
  }
}
