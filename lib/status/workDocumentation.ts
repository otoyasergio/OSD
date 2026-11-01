import type { FloorParkReason } from "@/lib/database/types";

/** Saved when the tech confirms there is nothing useful to photograph. */
export const NOTHING_TO_PHOTOGRAPH_NOTE = "Nothing to photograph.";

/** Written automatically when Swap parks the bike that was on the bench. */
export const SWAP_BENCH_NOTE = "Swapped to another bike";

export type WorkDocumentationNote = {
  note: string;
  note_type: string;
};

export type WorkDocumentationPhoto = {
  category: string;
  notes?: string | null;
};

export type PerformWorkDocumentationResult =
  | { ok: true }
  | {
      ok: false;
      code: "WORK_LINE_REQUIRED" | "WORK_PHOTO_REQUIRED";
      reason: string;
    };

function written(text: string | null | undefined): boolean {
  return Boolean(text?.trim());
}

export function hasWrittenWorkLine(input: {
  notes: WorkDocumentationNote[];
  photos: WorkDocumentationPhoto[];
}): boolean {
  const fromNote = input.notes.some(
    (note) => note.note_type === "general" && written(note.note)
  );
  const fromCaption = input.photos.some(
    (photo) => photo.category === "job_work" && written(photo.notes)
  );
  return fromNote || fromCaption;
}

export function hasWorkPhotoChoice(input: {
  notes: WorkDocumentationNote[];
  photos: WorkDocumentationPhoto[];
}): boolean {
  const hasPhoto = input.photos.some((photo) => photo.category === "job_work");
  const waived = input.notes.some(
    (note) =>
      note.note_type === "general" && note.note.trim() === NOTHING_TO_PHOTOGRAPH_NOTE
  );
  return hasPhoto || waived;
}

/**
 * Perform work cannot be checked off until the job has a written line and
 * either a work photo or an explicit "nothing to photograph" line.
 * Proof photos and proof-exception notes do not count.
 */
export function evaluatePerformWorkDocumentation(input: {
  notes: WorkDocumentationNote[];
  photos: WorkDocumentationPhoto[];
}): PerformWorkDocumentationResult {
  if (!hasWrittenWorkLine(input)) {
    return {
      ok: false,
      code: "WORK_LINE_REQUIRED",
      reason: "Write what you found or did before marking this work done.",
    };
  }
  if (!hasWorkPhotoChoice(input)) {
    return {
      ok: false,
      code: "WORK_PHOTO_REQUIRED",
      reason: "Add a work photo or tap Nothing to photograph.",
    };
  }
  return { ok: true };
}

/** Work-brief photos are already job_work rows, so callers can omit category. */
export function journalFromWorkBrief(
  brief: {
    technician_notes: WorkDocumentationNote[];
    work_photos: Array<{ notes?: string | null }>;
  } | null
  | undefined
): {
  notes: WorkDocumentationNote[];
  photos: WorkDocumentationPhoto[];
} {
  return {
    notes: brief?.technician_notes ?? [],
    photos: (brief?.work_photos ?? []).map((photo) => ({
      category: "job_work",
      notes: photo.notes,
    })),
  };
}

export function journalCounts(input: {
  notes: WorkDocumentationNote[];
  photos: WorkDocumentationPhoto[];
}): { photos: number; notes: number } {
  return {
    photos: input.photos.filter((photo) => photo.category === "job_work").length,
    notes: input.notes.filter(
      (note) => note.note_type === "general" && written(note.note)
    ).length,
  };
}

/** Explicit parks need a sentence. Swap writes its own. */
export function parkNoteForReason(
  reason: FloorParkReason,
  note: string | null | undefined
): string {
  if (reason === "swapped") return SWAP_BENCH_NOTE;
  const trimmed = note?.trim() ?? "";
  if (!trimmed) throw new Error("PARK_NOTE_REQUIRED");
  return trimmed;
}
