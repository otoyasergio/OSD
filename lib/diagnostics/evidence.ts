const TECHNICAL_VALUE_PATTERN =
  /(-?\d+(?:\.\d+)?)\s*(n\s*[·. -]?\s*m|ft[ -]?lb|lb[ -]?ft|psi|kpa|bar|mm|cm|in(?:ch(?:es)?)?|ml|lit(?:er|re)s?|l|qt|mv|v|mω|kω|ω|mohms?|kohms?|ohms?|ma|a)(?=$|[\s,.;:)\]])/gi;

const UNIT_ALIASES: Record<string, string> = {
  nm: "nm",
  ftlb: "ftlb",
  lbft: "ftlb",
  psi: "psi",
  kpa: "kpa",
  bar: "bar",
  mm: "mm",
  cm: "cm",
  in: "in",
  inch: "in",
  inches: "in",
  ml: "ml",
  l: "l",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  qt: "qt",
  mv: "mv",
  v: "v",
  ω: "ohm",
  mω: "mohm",
  kω: "kohm",
  ohm: "ohm",
  ohms: "ohm",
  mohm: "mohm",
  mohms: "mohm",
  kohm: "kohm",
  kohms: "kohm",
  ma: "ma",
  a: "a",
};

function normalizedNumber(value: string): string {
  return String(Number(value));
}

function normalizedUnit(value: string): string {
  const compact = value
    .toLowerCase()
    .replace(/[·.\s-]/g, "")
    .replace("nmm", "nm");
  return UNIT_ALIASES[compact] ?? compact;
}

export function extractDiagnosticsTechnicalValues(text: string): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(TECHNICAL_VALUE_PATTERN)) {
    if (!match[1] || !match[2]) continue;
    values.add(`${normalizedNumber(match[1])}:${normalizedUnit(match[2])}`);
  }
  return [...values].sort();
}

export function extractDiagnosticsPriceCents(text: string): number[] {
  const cents = new Set<number>();
  const pattern =
    /(?:\$\s*|(?:cad|usd)\s+)(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s+dollars?\b/gi;
  for (const match of text.matchAll(pattern)) {
    const raw = (match[1] ?? match[2])?.replace(/,/g, "");
    if (!raw) continue;
    const amount = Number(raw);
    if (Number.isFinite(amount)) cents.add(Math.round(amount * 100));
  }
  return [...cents].sort((a, b) => a - b);
}
