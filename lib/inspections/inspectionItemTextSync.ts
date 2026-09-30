/**
 * Inspection note/measurement autosave revalidates the page. While the tech is
 * still typing, server props can be older than local draft state — never clobber
 * the draft in that window.
 */
export function shouldApplyServerInspectionText(input: {
  focused: boolean;
  dirty: boolean;
}): boolean {
  return !input.focused && !input.dirty;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * After a text save completes, clear the dirty flag only when local draft still
 * matches what we persisted (user hasn't typed further).
 */
export function textSaveStillMatchesLocal(input: {
  localNotes: string;
  localMeasurement: string;
  savedNotes: string | null | undefined;
  savedMeasurement: string | null | undefined;
}): boolean {
  if (
    input.savedNotes !== undefined &&
    normalizeText(input.localNotes) !== normalizeText(input.savedNotes)
  ) {
    return false;
  }
  if (
    input.savedMeasurement !== undefined &&
    normalizeText(input.localMeasurement) !== normalizeText(input.savedMeasurement)
  ) {
    return false;
  }
  return true;
}
