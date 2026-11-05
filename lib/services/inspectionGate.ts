/** Item name that skips unanswered Brakes & Tires lines when marked OK with a reason. */
export const BRAKE_INSPECTION_SKIP_ITEM = "Brake Inspection Not Performed This Visit";

const BRAKE_CATEGORY_PREFIX = "Brakes & Tires";

export type InspectionPhotoCategory =
  "inspection_tires" | "inspection_brakes" | "inspection_forks" | "inspection_item";

export type InspectionPhotoSurface = "grid" | "inline";

export type InspectionPhotoRequirement = {
  kind: "section" | "item";
  category: InspectionPhotoCategory;
  label: string;
  /** Short instruction shown on the photo slot. */
  detail?: string;
  /** grid = evidence block at the top. inline = on the checklist row. */
  surface: InspectionPhotoSurface;
  /** For item-level requirements */
  inspection_result_id?: string;
  item_name?: string;
  /**
   * An older section photo that still satisfies this slot.
   * One combined tire or brake photo does not cover both ends.
   */
  legacy_category?: InspectionPhotoCategory;
};

export type InspectionGateResult = {
  inspection_result_id?: string;
  status: string | null;
  category_snapshot: string;
  item_name_snapshot: string;
  notes?: string | null;
  measurement?: string | null;
  requires_measurement?: boolean;
};

export type InspectionGapKind = "unchecked" | "measurement" | "reason";

export type InspectionGap = {
  key: string;
  kind: InspectionGapKind;
  item_name: string;
  detail: string;
};

const LAZY_NOTE_WORDS = new Set([
  "na",
  "n",
  "none",
  "ok",
  "okay",
  "yes",
  "no",
  "pass",
  "passed",
  "good",
  "fine",
  "done",
  "same",
  "test",
  "x",
  "xx",
  "xxx",
  "skip",
  "skipped",
  "later",
  "idk",
  "unknown",
  "tbd",
  "todo",
  "asdf",
  "nothing",
  "nope",
  "yep",
  "k",
  "looksgood",
  "looksok",
  "normal",
  "checked",
  "seeabove",
  "asabove",
  "nil",
  "null",
  "naa",
  "goodtogo",
]);

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

function isFrontTireItem(item: InspectionGateResult): boolean {
  if (/^front tire\b/i.test(item.item_name_snapshot)) return true;
  return (
    item.category_snapshot.startsWith("Brakes & Tires — Front") &&
    isTireItem(item.item_name_snapshot)
  );
}

function isRearTireItem(item: InspectionGateResult): boolean {
  if (/^rear tire\b/i.test(item.item_name_snapshot)) return true;
  return (
    item.category_snapshot.startsWith("Brakes & Tires — Rear") &&
    isTireItem(item.item_name_snapshot)
  );
}

function isFrontBrakeItem(item: InspectionGateResult): boolean {
  if (/^front (brake|rotor|caliper)\b/i.test(item.item_name_snapshot)) return true;
  return (
    item.category_snapshot.startsWith("Brakes & Tires — Front") &&
    isBrakeItem(item.item_name_snapshot)
  );
}

function isRearBrakeItem(item: InspectionGateResult): boolean {
  if (/^rear (brake|rotor|caliper)\b/i.test(item.item_name_snapshot)) return true;
  return (
    item.category_snapshot.startsWith("Brakes & Tires — Rear") &&
    isBrakeItem(item.item_name_snapshot)
  );
}

function isForksItem(item: InspectionGateResult): boolean {
  return /front forks/i.test(item.item_name_snapshot);
}

function isChainItem(item: InspectionGateResult): boolean {
  return /chain or belt|^chain condition|^belt condition/i.test(item.item_name_snapshot);
}

function isLeaksItem(item: InspectionGateResult): boolean {
  return /^leaks\b|visible leaks/i.test(item.item_name_snapshot);
}

function isBatteryItem(item: InspectionGateResult): boolean {
  return /condition of battery|^battery condition/i.test(item.item_name_snapshot);
}

function isLeftDamageItem(item: InspectionGateResult): boolean {
  return /damage — left side/i.test(item.item_name_snapshot);
}

function isRightDamageItem(item: InspectionGateResult): boolean {
  return /damage — right side/i.test(item.item_name_snapshot);
}

function isAcknowledgmentItem(itemName: string): boolean {
  return /acknowledgment/i.test(itemName);
}

/** A note a tech could not satisfy by typing "n/a", "ok", or a dot. */
export function isSubstantiveNote(notes: string | null | undefined): boolean {
  const trimmed = notes?.trim() ?? "";
  const words = trimmed
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  if (words.every((word) => LAZY_NOTE_WORDS.has(word))) return false;
  const joined = words.join("");
  if (joined.length < 4) return false;
  if (/^(.)\1+$/.test(joined)) return false;
  return true;
}

/** Measured lines need a real number, not "good" or "n/a". */
export function measurementIsRecorded(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  if (!/\d/.test(trimmed)) return false;
  if (/^(n\/?a|none|ok|okay|good|fine|pass|passed)$/i.test(trimmed)) return false;
  return true;
}

export function itemGateKey(result: InspectionGateResult): string {
  return (
    result.inspection_result_id ??
    `${result.category_snapshot}::${result.item_name_snapshot}`
  );
}

/** Brake hardware that has to be answered on every visit. */
export function isVisitBrakeItem(itemName: string): boolean {
  return /brake lining|rotor|caliper|brake pad/i.test(itemName);
}

/** Every motorcycle has friction material at both ends. */
export function brakeLiningRequiredEveryVisit(itemName: string): boolean {
  return /brake lining/i.test(itemName);
}

/**
 * Skip only counts when the tech marks it OK and writes why the tire lines are
 * not being inspected. It never waives the front or rear brakes.
 */
export function isBrakeInspectionWaived(results: InspectionGateResult[]): boolean {
  const skip = results.find(
    (result) => result.item_name_snapshot === BRAKE_INSPECTION_SKIP_ITEM
  );
  return skip?.status === "ok" && isSubstantiveNote(skip.notes);
}

/** Yellow/red findings stay open until the tech describes them. */
export function attentionItemNeedsDescription(result: {
  status: string | null;
  notes?: string | null;
}): boolean {
  if (result.status !== "future_attention" && result.status !== "immediate_attention") {
    return false;
  }
  return !isSubstantiveNote(result.notes);
}

/**
 * Checklist lines that still block sign-off. One line can produce more than
 * one gap (a measurement and a description).
 */
export function inspectionResultGaps(results: InspectionGateResult[]): InspectionGap[] {
  const waived = isBrakeInspectionWaived(results);
  const gaps: InspectionGap[] = [];

  for (const result of results) {
    const key = itemGateKey(result);
    const unansweredTire =
      waived &&
      result.status == null &&
      isBrakeSectionItem(result.category_snapshot, result.item_name_snapshot) &&
      result.item_name_snapshot !== BRAKE_INSPECTION_SKIP_ITEM &&
      !isVisitBrakeItem(result.item_name_snapshot);

    if (unansweredTire) continue;

    if (
      brakeLiningRequiredEveryVisit(result.item_name_snapshot) &&
      result.status === "not_applicable"
    ) {
      gaps.push({
        key,
        kind: "reason",
        item_name: result.item_name_snapshot,
        detail: "Inspect this brake on every visit.",
      });
    }

    if (result.status == null) {
      gaps.push({
        key,
        kind: "unchecked",
        item_name: result.item_name_snapshot,
        detail: "Choose a result.",
      });
      continue;
    }

    if (
      result.item_name_snapshot === BRAKE_INSPECTION_SKIP_ITEM &&
      result.status === "ok" &&
      !isSubstantiveNote(result.notes)
    ) {
      gaps.push({
        key,
        kind: "reason",
        item_name: result.item_name_snapshot,
        detail: "Say why the tires were not inspected this visit.",
      });
    }

    if (
      result.status === "not_applicable" &&
      !brakeLiningRequiredEveryVisit(result.item_name_snapshot) &&
      !isSubstantiveNote(result.notes)
    ) {
      gaps.push({
        key,
        kind: "reason",
        item_name: result.item_name_snapshot,
        detail: "Say why this does not apply to this motorcycle.",
      });
    }

    if (attentionItemNeedsDescription(result)) {
      gaps.push({
        key,
        kind: "reason",
        item_name: result.item_name_snapshot,
        detail: "Describe what you found.",
      });
    }

    if (
      isAcknowledgmentItem(result.item_name_snapshot) &&
      !isSubstantiveNote(result.notes) &&
      !gaps.some((gap) => gap.key === key && gap.kind === "reason")
    ) {
      gaps.push({
        key,
        kind: "reason",
        item_name: result.item_name_snapshot,
        detail: "Write who acknowledged it and how.",
      });
    }

    if (
      result.requires_measurement &&
      result.status !== "not_applicable" &&
      result.item_name_snapshot !== BRAKE_INSPECTION_SKIP_ITEM &&
      !measurementIsRecorded(result.measurement)
    ) {
      gaps.push({
        key,
        kind: "measurement",
        item_name: result.item_name_snapshot,
        detail: "Enter the measurement.",
      });
    }
  }

  return gaps;
}

export function countIncompleteInspectionResults(
  results: InspectionGateResult[],
  options?: { within?: InspectionGateResult[] }
): number {
  const gaps = inspectionResultGaps(results);
  const scope = new Set(
    (options?.within ?? results).map((result) => itemGateKey(result))
  );
  const keys = new Set<string>();
  for (const gap of gaps) {
    if (scope.has(gap.key)) keys.add(gap.key);
  }
  return keys.size;
}

type EvidenceSpec = {
  label: string;
  detail: string;
  surface: InspectionPhotoSurface;
  legacy_category?: InspectionPhotoCategory;
  /** Photo required only after the line is marked OK or needs attention. */
  whenAnswered?: boolean;
  match: (item: InspectionGateResult) => boolean;
  anchorPreference: RegExp[];
};

const EVIDENCE_SPECS: EvidenceSpec[] = [
  {
    label: "Front tire photo",
    detail: "Tread and sidewall, close enough to see the wear bars.",
    surface: "grid",
    match: isFrontTireItem,
    anchorPreference: [/tire tread/i, /tire condition/i, /tread depth/i],
  },
  {
    label: "Rear tire photo",
    detail: "Tread and sidewall, close enough to see the wear bars.",
    surface: "grid",
    match: isRearTireItem,
    anchorPreference: [/tire tread/i, /tire condition/i, /tread depth/i],
  },
  {
    label: "Front brake photo",
    detail: "Pads and rotor, or the drum if that is what this bike has.",
    surface: "grid",
    match: isFrontBrakeItem,
    anchorPreference: [/brake lining/i, /brake pad/i, /rotor/i],
  },
  {
    label: "Rear brake photo",
    detail: "Pads and rotor, or the drum if that is what this bike has.",
    surface: "grid",
    match: isRearBrakeItem,
    anchorPreference: [/brake lining/i, /brake pad/i, /rotor/i],
  },
  {
    label: "Forks photo",
    detail: "Both fork legs, including the seals.",
    surface: "grid",
    legacy_category: "inspection_forks",
    match: isForksItem,
    anchorPreference: [/front forks/i],
  },
  {
    label: "Chain or belt photo",
    detail: "The chain or belt and the sprockets or pulleys.",
    surface: "inline",
    whenAnswered: true,
    match: isChainItem,
    anchorPreference: [/chain or belt/i, /chain condition/i, /belt condition/i],
  },
  {
    label: "Leaks photo",
    detail: "Under the engine, plus any wet spots you found.",
    surface: "inline",
    match: isLeaksItem,
    anchorPreference: [/^leaks\b/i, /visible leaks/i],
  },
  {
    label: "Battery photo",
    detail: "Battery, terminals, and how it is mounted.",
    surface: "inline",
    match: isBatteryItem,
    anchorPreference: [/condition of battery/i, /^battery condition/i],
  },
  {
    label: "Left side photo",
    detail: "The whole left side, including any paint or trim damage.",
    surface: "inline",
    match: isLeftDamageItem,
    anchorPreference: [/left side/i],
  },
  {
    label: "Right side photo",
    detail: "The whole right side, including any paint or trim damage.",
    surface: "inline",
    match: isRightDamageItem,
    anchorPreference: [/right side/i],
  },
];

function preferAnchor(
  items: InspectionGateResult[],
  patterns: RegExp[]
): InspectionGateResult | undefined {
  for (const pattern of patterns) {
    const match = items.find(
      (item) => item.inspection_result_id && pattern.test(item.item_name_snapshot)
    );
    if (match) return match;
  }
  return items.find((item) => item.inspection_result_id);
}

function evidenceGroupNeedsPhoto(
  items: InspectionGateResult[],
  spec: EvidenceSpec,
  brakeWaived: boolean
): boolean {
  if (items.length === 0) return false;
  const tireGroup =
    spec.label.startsWith("Front tire") || spec.label.startsWith("Rear tire");
  if (
    brakeWaived &&
    tireGroup &&
    items.every((item) => item.status == null || item.status === "not_applicable")
  ) {
    return false;
  }
  if (spec.label.startsWith("Front brake") || spec.label.startsWith("Rear brake")) {
    return true;
  }
  if (spec.whenAnswered) {
    return items.some(
      (item) =>
        item.status === "ok" ||
        item.status === "future_attention" ||
        item.status === "immediate_attention"
    );
  }
  return items.some((item) => item.status !== "not_applicable");
}

/**
 * Photos required before the inspection can be signed.
 * Front and rear brakes each need their own photo on every visit. Front and
 * rear tires do too, unless those lines were left blank with a real reason.
 * A single combined shot does not clear both ends. Forks, leaks, battery,
 * and both sides are required too. Chain or belt is required once that line
 * is answered and is not N/A. Yellow or red lines that are not already
 * covered need a photo of the finding.
 */
export function getRequiredInspectionPhotos(
  results: InspectionGateResult[]
): InspectionPhotoRequirement[] {
  const brakeWaived = isBrakeInspectionWaived(results);
  const required: InspectionPhotoRequirement[] = [];

  for (const spec of EVIDENCE_SPECS) {
    const items = results.filter((result) => spec.match(result));
    if (!evidenceGroupNeedsPhoto(items, spec, brakeWaived)) continue;
    const anchor = preferAnchor(items, spec.anchorPreference);
    if (!anchor?.inspection_result_id) continue;
    required.push({
      kind: "item",
      category: "inspection_item",
      label: spec.label,
      detail: spec.detail,
      surface: spec.surface,
      inspection_result_id: anchor.inspection_result_id,
      item_name: anchor.item_name_snapshot,
      legacy_category: spec.legacy_category,
    });
  }

  for (const result of results) {
    if (result.status !== "future_attention" && result.status !== "immediate_attention") {
      continue;
    }
    if (!result.inspection_result_id) continue;
    if (
      required.some(
        (requirement) => requirement.inspection_result_id === result.inspection_result_id
      )
    ) {
      continue;
    }
    required.push({
      kind: "item",
      category: "inspection_item",
      label: `Photo: ${result.item_name_snapshot}`,
      detail: "Photograph what needs attention.",
      surface: "inline",
      inspection_result_id: result.inspection_result_id,
      item_name: result.item_name_snapshot,
    });
  }

  return required;
}

export type InspectionPhotoPresence = {
  category: string;
  inspection_result_id?: string | null;
};

export function inspectionPhotoMatchesRequirement(
  photo: InspectionPhotoPresence,
  requirement: InspectionPhotoRequirement
): boolean {
  if (
    requirement.kind === "item" &&
    photo.category === "inspection_item" &&
    requirement.inspection_result_id &&
    photo.inspection_result_id === requirement.inspection_result_id
  ) {
    return true;
  }
  if (requirement.legacy_category && photo.category === requirement.legacy_category) {
    return true;
  }
  if (requirement.kind === "section" && photo.category === requirement.category) {
    return true;
  }
  return false;
}

export function getMissingInspectionPhotos(
  results: InspectionGateResult[],
  photos: InspectionPhotoPresence[]
): InspectionPhotoRequirement[] {
  return getRequiredInspectionPhotos(results).filter(
    (requirement) =>
      !photos.some((photo) => inspectionPhotoMatchesRequirement(photo, requirement))
  );
}

export function assertInspectionPhotosComplete(
  results: InspectionGateResult[],
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

/**
 * When the checklist renders as a read-only report instead of an editable
 * form. Terminal work orders reject inspection writes server-side, so they
 * must render read-only too.
 */
export function isInspectionReadOnly(input: {
  is_foreign_location: boolean;
  completed_at: string | null;
  work_order_status: string;
  canEdit: boolean;
}): boolean {
  return (
    input.is_foreign_location ||
    Boolean(input.completed_at) ||
    input.work_order_status === "completed" ||
    input.work_order_status === "cancelled" ||
    !input.canEdit
  );
}
