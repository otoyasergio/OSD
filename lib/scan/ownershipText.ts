export type OwnershipDraft = {
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  plate?: string;
};

const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/i;
const YEAR_RE = /\b(19[7-9]\d|20[0-2]\d)\b/;
const PLATE_RE = /\b(?:PLATE|LIC(?:ENCE|ENSE)?|TAG)[:\s#-]*([A-Z0-9]{2,8})\b/i;

/**
 * Extract bike ownership candidates from OCR / plain text.
 */
export function parseOwnershipText(raw: string): OwnershipDraft {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return {};

  const vinMatch = text.match(VIN_RE);
  const yearMatch = text.match(YEAR_RE);
  const plateMatch = text.match(PLATE_RE);

  // Heuristic: "YYYY MAKE MODEL" near the top
  let make: string | undefined;
  let model: string | undefined;
  const ymm = text.match(
    /\b(19[7-9]\d|20[0-2]\d)\s+([A-Za-z][A-Za-z0-9\-]+)\s+([A-Za-z0-9][A-Za-z0-9\- ]{1,40})/
  );
  if (ymm) {
    make = ymm[2];
    model = ymm[3].trim().split(/\s{2,}|[,;]/)[0]?.trim();
  }

  return {
    year: yearMatch ? Number(yearMatch[1]) : undefined,
    make,
    model,
    vin: vinMatch ? vinMatch[1].toUpperCase() : undefined,
    plate: plateMatch ? plateMatch[1].toUpperCase() : undefined,
  };
}
