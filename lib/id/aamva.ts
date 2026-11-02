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

const ELEMENT = /^([A-Z]{3})(.*)$/;

function elements(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (const line of text.split("\n")) {
    const match = line.trim().match(ELEMENT);
    if (!match) continue;
    map.set(match[1], match[2].trim());
  }
  return map;
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
  const lastName = fields.get("DCS") ?? "";
  const firstName = fields.get("DAC") ?? fields.get("DCT") ?? "";
  if (!licenceNumber || (!firstName && !lastName)) return null;

  const street = fields.get("DAG") ?? "";
  const city = fields.get("DAI") ?? "";
  const province = fields.get("DAJ") ?? "";
  const postal = (fields.get("DAK") ?? "").replace(/\s+/g, " ").trim();
  const address = [street, [city, province].filter(Boolean).join(", "), postal]
    .filter((part) => part.trim())
    .join(", ");

  return {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    address,
    dateOfBirth: aamvaDateToIso(fields.get("DBB")),
    licenceExpiry: aamvaDateToIso(fields.get("DBA")),
    licenceNumber: licenceNumber.trim(),
  };
}
