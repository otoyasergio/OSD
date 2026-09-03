import {
  VIN_LENGTH,
  hasValidCheckDigit,
  isNorthAmericanVin,
  normalizeVin,
  validateVinFormat,
} from "@/lib/vin/validate";

export type ExtractVinOk = {
  ok: true;
  vin: string;
  /** True when more than one strong candidate remains after ranking. */
  ambiguous: boolean;
  candidates: string[];
};

export type ExtractVinFail = {
  ok: false;
  error: string;
  candidates: string[];
};

export type ExtractVinResult = ExtractVinOk | ExtractVinFail;

const VIN_CHAR = /[A-HJ-NPR-Z0-9]/;

/**
 * Common OCR confusions: I/l → 1, O → 0, Q → 0.
 * Applied when building OCR-corrected candidates only.
 */
function ocrCorrectChar(ch: string): string {
  switch (ch) {
    case "I":
    case "i":
    case "l":
    case "|":
      return "1";
    case "O":
    case "o":
      return "0";
    case "Q":
    case "q":
      return "0";
    default:
      return ch.toUpperCase();
  }
}

/** Drop leading "VIN" / OCR-mangled "V1N" labels from barcode text. */
function stripLeadingLabels(text: string): string {
  return text.replace(/^(V1N|VIN)+/i, "");
}

function collectWindows(text: string): Array<{ vin: string; index: number }> {
  const found: Array<{ vin: string; index: number }> = [];
  const seen = new Set<string>();

  const push = (candidate: string, index: number) => {
    if (candidate.length !== VIN_LENGTH) return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    found.push({ vin: candidate, index });
  };

  if (text.length === VIN_LENGTH) {
    push(text, 0);
  }

  const run = /[A-HJ-NPR-Z0-9]{17,}/g;
  let match: RegExpExecArray | null;
  while ((match = run.exec(text)) !== null) {
    const slice = match[0];
    const base = match.index;
    if (slice.length === VIN_LENGTH) {
      push(slice, base);
    } else {
      for (let i = 0; i <= slice.length - VIN_LENGTH; i += 1) {
        push(slice.slice(i, i + VIN_LENGTH), base + i);
      }
    }
  }

  for (let i = 0; i <= text.length - VIN_LENGTH; i += 1) {
    const window = text.slice(i, i + VIN_LENGTH);
    if ([...window].every((c) => VIN_CHAR.test(c))) {
      push(window, i);
    }
  }

  return found;
}

function scoreCandidate(vin: string, index: number): number {
  let score = 0;
  // Strong signal: passes the North American check digit.
  if (hasValidCheckDigit(vin)) score += 100;
  if (isNorthAmericanVin(vin)) score += 25;
  // Prefer earlier occurrence after label strip (real VIN usually follows "VIN:").
  score -= index;
  return score;
}

function validateWindows(
  windows: Array<{ vin: string; index: number }>
): Array<{ vin: string; index: number; score: number }> {
  const valid: Array<{ vin: string; index: number; score: number }> = [];
  const seen = new Set<string>();
  for (const { vin, index } of windows) {
    const result = validateVinFormat(vin);
    if (!result.ok || seen.has(result.vin)) continue;
    seen.add(result.vin);
    valid.push({
      vin: result.vin,
      index,
      score: scoreCandidate(result.vin, index),
    });
  }
  valid.sort((a, b) => b.score - a.score || a.index - b.index);
  return valid;
}

/**
 * Pull a validated VIN out of barcode or OCR text.
 * Prefers a single high-confidence match; when several strong VINs remain,
 * marks the result ambiguous so the UI can ask staff to confirm.
 */
export function extractVinFromScanText(raw: string): ExtractVinResult {
  const cleaned = stripLeadingLabels(
    normalizeVin(raw).replace(/[^A-Z0-9]/gi, "").toUpperCase()
  );

  if (!cleaned) {
    return {
      ok: false,
      error: "No VIN characters found in the scan.",
      candidates: [],
    };
  }

  let valid = validateWindows(collectWindows(cleaned));

  // OCR path: correct I/O/Q confusions, then re-extract.
  if (valid.length === 0) {
    const corrected = stripLeadingLabels(
      Array.from(cleaned, ocrCorrectChar).join("")
    );
    valid = validateWindows(collectWindows(corrected));
  }

  if (valid.length === 0) {
    const nearMisses = collectWindows(cleaned)
      .map((w) => w.vin)
      .slice(0, 5);
    return {
      ok: false,
      error:
        "Could not read a valid 17-character VIN. Try again or type it manually.",
      candidates: nearMisses,
    };
  }

  const best = valid[0];
  // Treat as ambiguous only when another candidate is close in score
  // (e.g. two check-digit-valid VINs), not when a junk non-NA window trails.
  const strong = valid.filter((v) => best.score - v.score <= 30);
  const candidates = strong.map((v) => v.vin);

  return {
    ok: true,
    vin: best.vin,
    ambiguous: candidates.length > 1,
    candidates,
  };
}
