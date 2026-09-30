import type { PhotoCategory } from "@/lib/database/types";
import type { IntakePhoto } from "@/lib/services/photos";

export const DIAGNOSTICS_PHOTO_MAX_SELECTED = 3;
export const DIAGNOSTICS_PHOTO_PURPOSE_MAX = 500;
export const DIAGNOSTICS_PHOTO_FALLBACK_PURPOSE = "Work photo for analysis";

const ELIGIBLE_CATEGORIES: ReadonlySet<string> = new Set([
  "inspection_tires",
  "inspection_brakes",
  "inspection_forks",
  "inspection_item",
  "job_work",
  "job_proof",
]);
const JOB_SCOPED_CATEGORIES: ReadonlySet<string> = new Set(["job_work", "job_proof"]);

/**
 * Minimal, PII-free view of an intake photo for the picker. `IntakePhoto` rows
 * are assignable, but this shape carries no storage paths, notes, or uploader
 * identity so it is safe to hand to a client component.
 */
export type DiagnosticsPhotoSourceRow = {
  photo_id: string;
  work_order_id: string;
  job_id: string | null;
  category: PhotoCategory;
  created_at: string;
  thumb_url?: string | null;
};

export type DiagnosticsPhotoScope = {
  workOrderId: string;
  jobId: string | null;
};

export type DiagnosticsPhotoSelection = {
  photoId: string;
  purpose: string;
};

/** Mirrors the server-side eligibility in `prepareDiagnosticsImages`. */
export function isDiagnosticsPhotoEligible(
  photo: Pick<DiagnosticsPhotoSourceRow, "work_order_id" | "job_id" | "category">,
  scope: DiagnosticsPhotoScope
): boolean {
  if (photo.work_order_id !== scope.workOrderId) return false;
  if (!ELIGIBLE_CATEGORIES.has(photo.category)) return false;
  if (JOB_SCOPED_CATEGORIES.has(photo.category)) {
    if (!scope.jobId || photo.job_id !== scope.jobId) return false;
  }
  if (scope.jobId && photo.job_id && photo.job_id !== scope.jobId) return false;
  return true;
}

export function toDiagnosticsPhotoSourceRows(
  photos: readonly Pick<
    IntakePhoto,
    "photo_id" | "work_order_id" | "job_id" | "category" | "created_at" | "thumb_url"
  >[],
  scope: DiagnosticsPhotoScope
): DiagnosticsPhotoSourceRow[] {
  return photos
    .filter((photo) => isDiagnosticsPhotoEligible(photo, scope))
    .map((photo) => ({
      photo_id: photo.photo_id,
      work_order_id: photo.work_order_id,
      job_id: photo.job_id,
      category: photo.category,
      created_at: photo.created_at,
      thumb_url: photo.thumb_url ?? null,
    }));
}

/** Collapse every whitespace run (newlines, tabs, NBSP…) to one space and trim. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function defaultPhotoPurpose(prompt: string | null | undefined): string {
  const collapsed = collapseWhitespace(prompt ?? "");
  if (!collapsed) return DIAGNOSTICS_PHOTO_FALLBACK_PURPOSE;
  return collapsed.slice(0, DIAGNOSTICS_PHOTO_PURPOSE_MAX).trim();
}

export type AddPhotoSelectionResult = {
  selections: DiagnosticsPhotoSelection[];
  added: boolean;
  reason?: "limit" | "duplicate";
};

export function addPhotoSelection(
  selections: readonly DiagnosticsPhotoSelection[],
  photoId: string,
  purpose: string
): AddPhotoSelectionResult {
  if (selections.some((selection) => selection.photoId === photoId)) {
    return { selections: [...selections], added: false, reason: "duplicate" };
  }
  if (selections.length >= DIAGNOSTICS_PHOTO_MAX_SELECTED) {
    return { selections: [...selections], added: false, reason: "limit" };
  }
  return { selections: [...selections, { photoId, purpose }], added: true };
}

export function validatePhotoSelections(
  selections: readonly DiagnosticsPhotoSelection[]
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (selections.length > DIAGNOSTICS_PHOTO_MAX_SELECTED) {
    errors.push(`Select at most ${DIAGNOSTICS_PHOTO_MAX_SELECTED} photos.`);
  }
  selections.forEach((selection, index) => {
    const purpose = selection.purpose.trim();
    if (!purpose) {
      errors.push(`Describe what photo ${index + 1} should show.`);
    } else if (purpose.length > DIAGNOSTICS_PHOTO_PURPOSE_MAX) {
      errors.push(
        `Photo ${index + 1} purpose must be ${DIAGNOSTICS_PHOTO_PURPOSE_MAX} characters or fewer.`
      );
    }
  });
  return { ok: errors.length === 0, errors };
}

/** Exactly `{photoId, purpose}` — never URLs, paths, or bytes. */
export function buildPhotosPayload(
  selections: readonly DiagnosticsPhotoSelection[]
): DiagnosticsPhotoSelection[] {
  return selections.map((selection) => ({
    photoId: selection.photoId,
    purpose: selection.purpose.trim(),
  }));
}

type PromptMessage = {
  messageId?: string;
  role: string;
  generationStatus: string;
  requestedInput: unknown;
};

export type PhotoRequest = { key: string; prompt: string };

/**
 * The photo request the assistant is waiting on: only when the latest message
 * is a ready assistant reply that asked for a photo. Other input types
 * (measurement, question, test) are answered in the text box. `key` is the
 * message id, so a repeated prompt on a later message is a new request.
 */
export function photoRequestFromMessages(
  messages: readonly PromptMessage[]
): PhotoRequest | null {
  const latest = messages[messages.length - 1];
  if (!latest || latest.role !== "assistant" || latest.generationStatus !== "ready") {
    return null;
  }
  const input = latest.requestedInput;
  if (!input || typeof input !== "object") return null;
  const { type, prompt } = input as { type?: unknown; prompt?: unknown };
  if (type !== "photo" || typeof prompt !== "string") return null;
  const normalized = collapseWhitespace(prompt);
  if (!normalized) return null;
  return {
    key: latest.messageId ?? `index-${messages.length - 1}`,
    prompt: normalized,
  };
}

export function photoPromptFromMessages(
  messages: readonly PromptMessage[]
): string | null {
  return photoRequestFromMessages(messages)?.prompt ?? null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UploadedAssistantPhoto = {
  photoId: string;
  category: "job_work";
  createdAt: string;
};

/** Runtime check of the upload action's `data`; never trust it as typed. */
export function parseUploadedAssistantPhoto(
  data: unknown,
  scope: DiagnosticsPhotoScope
): UploadedAssistantPhoto | null {
  if (!data || typeof data !== "object" || !scope.jobId) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.photoId !== "string" || !UUID_PATTERN.test(record.photoId)) {
    return null;
  }
  if (record.category !== "job_work") return null;
  if (record.workOrderId !== scope.workOrderId) return null;
  if (record.jobId !== scope.jobId) return null;
  const createdAt =
    typeof record.createdAt === "string" && !Number.isNaN(Date.parse(record.createdAt))
      ? record.createdAt
      : new Date().toISOString();
  return { photoId: record.photoId, category: "job_work", createdAt };
}

export type ObjectUrlRegistry = {
  create: (blob: Blob, key: string) => string;
  get: (key: string) => string | null;
  revoke: (key: string) => void;
  revokeAll: () => void;
};

export function createObjectUrlRegistry(
  impl: {
    create: (blob: Blob) => string;
    revoke: (url: string) => void;
  } = {
    create: (blob) => URL.createObjectURL(blob),
    revoke: (url) => URL.revokeObjectURL(url),
  }
): ObjectUrlRegistry {
  const urls = new Map<string, string>();
  const revoke = (key: string) => {
    const url = urls.get(key);
    if (url === undefined) return;
    urls.delete(key);
    impl.revoke(url);
  };
  return {
    create(blob, key) {
      revoke(key);
      const url = impl.create(blob);
      urls.set(key, url);
      return url;
    },
    get: (key) => urls.get(key) ?? null,
    revoke,
    revokeAll() {
      for (const key of [...urls.keys()]) revoke(key);
    },
  };
}
