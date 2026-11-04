/**
 * AAMVA PDF417 payload from the back of an Ontario driver's licence.
 * The barcode has no photo. Staff confirm every field before save.
 */

export type LicenceScan = {
  firstName: string;
  lastName: string;
  address: string;
  dateOfBirth: string;
  licenceExpiry: string;
  licenceNumber: string;
};

const ELEMENT = /^([DZ][A-Z]{2})(.*)$/;
const SUBFILE = /^(?:DL|ID|ZO)(?=[A-Z]{3})/;

/**
 * AAMVA separates elements with LF, and ends the header with RS CR.
 * ZXing's default text mode prints those bytes as `<LF>`, `<RS>`, and `<CR>`.
 * The licence number is often glued to the header: `...DLDAQD1234-...`.
 */
function normalizePayload(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/<(?:LF|CR|RS)>/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/[\r\u001e]/g, "\n");
}

function remember(map: Map<string, string>, code: string, value: string) {
  if (!map.has(code)) map.set(code, value.trim());
}

function takeLine(line: string, map: Map<string, string>) {
  const trimmed = line.trim();
  if (!trimmed) return;
  const body = trimmed.replace(SUBFILE, "");
  const direct = body.match(ELEMENT);
  if (direct) {
    remember(map, direct[1], direct[2]);
    return;
  }
  const embedded = trimmed.match(/(?:DL|ID)([A-Z]{3}.*)$/);
  const inner = embedded?.[1].match(ELEMENT);
  if (inner) remember(map, inner[1], inner[2]);
}

function elements(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of normalizePayload(raw).split("\n")) takeLine(line, map);
  return map;
}

function personName(value: string): string {
  return value.replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

/** AAMVA dates are usually MMDDCCYY. Some cards use CCYYMMDD. */
export function aamvaDateToIso(value: string | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const asMonthFirst = `${digits.slice(4, 8)}-${digits.slice(0, 2)}-${digits.slice(2, 4)}`;
  const asYearFirst = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const monthFirstYear = Number(digits.slice(4, 8));
  if (monthFirstYear >= 1900 && monthFirstYear <= 2100) return asMonthFirst;
  const yearFirst = Number(digits.slice(0, 4));
  if (yearFirst >= 1900 && yearFirst <= 2100) return asYearFirst;
  return "";
}

export function parseAamvaLicence(raw: string): LicenceScan | null {
  const fields = elements(raw);
  const licenceNumber = fields.get("DAQ") ?? "";
  const lastName = personName(fields.get("DCS") ?? "");
  const firstName = personName(fields.get("DAC") ?? fields.get("DCT") ?? "");
  if (!licenceNumber || (!firstName && !lastName)) return null;

  const street = fields.get("DAG") ?? "";
  const city = fields.get("DAI") ?? "";
  const province = fields.get("DAJ") ?? "";
  const postal = (fields.get("DAK") ?? "").replace(/\s+/g, " ").trim();
  const address = [street, [city, province].filter(Boolean).join(", "), postal]
    .filter((part) => part.trim())
    .join(", ");

  return {
    firstName,
    lastName,
    address,
    dateOfBirth: aamvaDateToIso(fields.get("DBB")),
    licenceExpiry: aamvaDateToIso(fields.get("DBA")),
    licenceNumber: licenceNumber.trim(),
  };
}
