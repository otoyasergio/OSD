const TECHNICAL_VALUE_PATTERN =
  /(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(newton[ -]?metres?|newton[ -]?meters?|n\s*[·. -]?\s*m|foot[ -]?pounds?|feet[ -]?pounds?|ft[ -]?lb|lb[ -]?ft|inch[ -]?pounds?|in[ -]?lb|pounds?\s+per\s+square\s+inch|psi|kilopascals?|kpa|megapascals?|mpa|pascals?|pa|bar|inhg|millimetres?|millimeters?|mm|centimetres?|centimeters?|cm|metres?|meters?|kilometres?|kilometers?|km|miles?|mi|inches?|millilitres?|milliliters?|ml|litres?|liters?|quarts?|qt|gallons?|gal|fluid\s+ounces?|fl\s*oz|cc|millivolts?|mv|volts?|v|milliamps?|milliamperes?|ma|amps?|amperes?|a|milliohms?|mω|kiloohms?|kohms?|kω|megaohms?|mohms?|mΩ|ohms?|ω|rpm|revolutions?\s+per\s+minute|degrees?\s+celsius|°\s*c|celsius|degrees?\s+fahrenheit|°\s*f|fahrenheit|percent|%|l)(?=$|[\s,.;:)\]])/gi;

const UNIT_ALIASES: Record<string, string> = {
  nm: "nm",
  ftlb: "ftlb",
  lbft: "ftlb",
  newtonmetre: "nm",
  newtonmetres: "nm",
  newtonmeter: "nm",
  newtonmeters: "nm",
  footpound: "ftlb",
  footpounds: "ftlb",
  feetpound: "ftlb",
  feetpounds: "ftlb",
  inchpound: "inlb",
  inchpounds: "inlb",
  inlb: "inlb",
  poundpersquareinch: "psi",
  poundspersquareinch: "psi",
  psi: "psi",
  kpa: "kpa",
  kilopascal: "kpa",
  kilopascals: "kpa",
  mpa: "mpa",
  megapascal: "mpa",
  megapascals: "mpa",
  pa: "pa",
  pascal: "pa",
  pascals: "pa",
  bar: "bar",
  inhg: "inhg",
  mm: "mm",
  millimetre: "mm",
  millimetres: "mm",
  millimeter: "mm",
  millimeters: "mm",
  cm: "cm",
  centimetre: "cm",
  centimetres: "cm",
  centimeter: "cm",
  centimeters: "cm",
  inch: "in",
  inches: "in",
  metre: "m",
  metres: "m",
  meter: "m",
  meters: "m",
  km: "km",
  kilometre: "km",
  kilometres: "km",
  kilometer: "km",
  kilometers: "km",
  mi: "mi",
  mile: "mi",
  miles: "mi",
  ml: "ml",
  millilitre: "ml",
  millilitres: "ml",
  milliliter: "ml",
  milliliters: "ml",
  l: "l",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  qt: "qt",
  quart: "qt",
  quarts: "qt",
  gal: "gal",
  gallon: "gal",
  gallons: "gal",
  fluidounce: "floz",
  fluidounces: "floz",
  floz: "floz",
  cc: "cc",
  mv: "mv",
  millivolt: "mv",
  millivolts: "mv",
  v: "v",
  volt: "v",
  volts: "v",
  ω: "ohm",
  mω: "mohm",
  kω: "kohm",
  ohm: "ohm",
  ohms: "ohm",
  mohm: "mohm",
  mohms: "mohm",
  kohm: "kohm",
  kohms: "kohm",
  kiloohm: "kohm",
  kiloohms: "kohm",
  megaohm: "megohm",
  megaohms: "megohm",
  ma: "ma",
  milliamp: "ma",
  milliamps: "ma",
  milliampere: "ma",
  milliamperes: "ma",
  a: "a",
  amp: "a",
  amps: "a",
  ampere: "a",
  amperes: "a",
  rpm: "rpm",
  revolutionperminute: "rpm",
  revolutionsperminute: "rpm",
  degreescelsius: "c",
  celsius: "c",
  "°c": "c",
  degreesfahrenheit: "f",
  fahrenheit: "f",
  "°f": "f",
  percent: "percent",
  "%": "percent",
};

function normalizedNumber(value: string): string {
  return String(Number(value));
}

function normalizedUnit(value: string): string {
  if (value === "MΩ") return "megohm";
  if (value === "mΩ") return "mohm";
  const compact = value
    .toLowerCase()
    .replace(/[·.\s-]/g, "")
    .replace("nmm", "nm");
  return UNIT_ALIASES[compact] ?? compact;
}

export type DiagnosticsTechnicalValueMatch = {
  normalized: string;
  index: number;
  end: number;
};

export function extractDiagnosticsTechnicalValueMatches(
  text: string
): DiagnosticsTechnicalValueMatch[] {
  const values: DiagnosticsTechnicalValueMatch[] = [];
  for (const match of text.matchAll(TECHNICAL_VALUE_PATTERN)) {
    if (!match[1] || !match[2] || match.index === undefined) continue;
    if (
      (match[2] === "a" || match[2] === "l" || match[2].toLowerCase() === "in") &&
      match[2] !== "A" &&
      match[2] !== "L"
    ) {
      continue;
    }
    const end = match.index + match[0].length;
    if (
      /^(?:\s+)?(?:socket|wrench|spanner|hex|allen|key|bit)\b/i.test(
        text.slice(end, end + 30)
      )
    ) {
      continue;
    }
    values.push({
      normalized: `${normalizedNumber(match[1].replace(/,/g, ""))}:${normalizedUnit(
        match[2]
      )}`,
      index: match.index,
      end,
    });
  }
  return values;
}

export function extractDiagnosticsTechnicalValues(text: string): string[] {
  const values = new Set(
    extractDiagnosticsTechnicalValueMatches(text).map((item) => item.normalized)
  );
  return [...values].sort();
}

export function extractDiagnosticsPriceCents(text: string): number[] {
  const cents = new Set<number>();
  const pattern =
    /(?:\$\s*|(?:cad|usd)\s+)(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s+(?:dollars?|cad|usd)\b/gi;
  for (const match of text.matchAll(pattern)) {
    const raw = (match[1] ?? match[2])?.replace(/,/g, "");
    if (!raw) continue;
    const amount = Number(raw);
    if (Number.isFinite(amount)) cents.add(Math.round(amount * 100));
  }
  return [...cents].sort((a, b) => a - b);
}
