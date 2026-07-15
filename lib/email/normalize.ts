/** Canonicalize email copied or typed into customer forms. */
export function normalizeEmailInput(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, "").toLowerCase();
}
