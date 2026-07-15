export type AamvaCustomerDraft = {
  first_name: string;
  last_name: string;
  address?: string;
  license_number?: string;
  raw_notes?: string;
};

/**
 * Parse AAMVA PDF417 / DL barcode text into customer draft fields.
 * Supports common element IDs (DAC, DCS, DAD, DAG, DAI, DAJ, DAK, DAQ).
 */
export function parseAamvaBarcode(raw: string): AamvaCustomerDraft | null {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return null;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const map = new Map<string, string>();

  for (const line of lines) {
    // ANSI header or @\n\u001e\rANSI... — skip
    if (/^@|^ANSI\s/i.test(line)) continue;
    const match = line.match(/^([A-Z]{3})(.+)$/);
    if (match) {
      map.set(match[1], match[2].trim());
    }
  }

  // Sometimes the whole payload is one line with concatenated DL elements
  if (map.size === 0) {
    const compact = text.replace(/\s+/g, " ");
    const re = /([A-Z]{3})([^A-Z]{0,3}.*?)(?=[A-Z]{3}|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(compact)) !== null) {
      map.set(m[1], m[2].trim());
    }
  }

  const first =
    map.get("DAC") ||
    map.get("DCT") ||
    map.get("DAD") ||
    "";
  const last = map.get("DCS") || map.get("DAB") || "";
  const middle = map.get("DAD") && map.get("DAC") ? map.get("DAD") : "";
  const license = map.get("DAQ") || map.get("DBJ") || "";
  const street = map.get("DAG") || "";
  const city = map.get("DAI") || "";
  const state = map.get("DAJ") || "";
  const zip = map.get("DAK") || "";

  if (!first && !last && !license) return null;

  const addressParts = [street, [city, state].filter(Boolean).join(", "), zip]
    .map((p) => p.trim())
    .filter(Boolean);

  const notesParts: string[] = [];
  if (license) notesParts.push(`DL #: ${license}`);
  if (addressParts.length) notesParts.push(`Address: ${addressParts.join(" ")}`);

  return {
    first_name: first,
    last_name: middle ? `${last}` : last,
    address: addressParts.join(" ") || undefined,
    license_number: license || undefined,
    raw_notes: notesParts.join("\n") || undefined,
  };
}
