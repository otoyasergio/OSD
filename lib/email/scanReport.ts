import { saeJ2012System } from "@/lib/bikeLink/saeJ2012";

export type ScanOutcome = "codes" | "no_codes" | "no_connection" | "needs_confirmation";

export type ScanCode = { code: string; description: string };

export type WaitingInspection = {
  inspectionId: string;
  workOrderId: string;
  workOrderNumber: string;
  vin: string | null;
};

export const SCAN_REPORT_ADDRESS = "scans@torontomoto.com";

const SAE = /\b([PCBU][0-9A-F]{4})\b([^\n]{0,80})?/gi;
const VIN = /\b([A-HJ-NPR-Z0-9]{17})\b/;
const CODE_LINE = /^([0-9A-F]{5,8}|[PCBU][0-9A-F]{4})(?:[ \t]+(.*))?$/i;

function addCode(codes: ScanCode[], code: string, description: string): void {
  const normalized = code.toUpperCase();
  if (codes.some((row) => row.code === normalized)) return;
  const written = description.replace(/\s+/g, " ").trim();
  const fallback = /^[PCBU]/.test(normalized)
    ? saeJ2012System(normalized) || normalized
    : normalized;
  codes.push({ code: normalized, description: written || fallback });
}

function isStatusLine(line: string): boolean {
  return /^(?:fault not currently(?:\s+present)?|present|no fault|fault)$/i.test(line);
}

function isCodeLine(line: string): boolean {
  return CODE_LINE.test(line);
}

function nextBoundary(line: string): boolean {
  return (
    isCodeLine(line) ||
    isStatusLine(line) ||
    /\(\d+\s*fault codes?\)/i.test(line) ||
    /^(?:dtc description status|disclaimer|summary|full system report\b|page \d+)$/i.test(
      line
    )
  );
}

/** Topdon prints module DTCs such as 480682 and E11436, plus SAE J2012 codes. */
function readScanCodes(text: string): ScanCode[] {
  const codes: ScanCode[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(CODE_LINE);
    if (!match) continue;
    let description = match[2] ?? "";
    let historical = /fault not currently/i.test(description);
    description = description.replace(/\s*fault not currently(?:\s+present)?\s*$/i, "");
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (isCodeLine(line) || /\(\d+\s*fault codes?\)/i.test(line)) break;
      if (/^fault not currently/i.test(line)) {
        historical = true;
        continue;
      }
      if (nextBoundary(line)) break;
      description = `${description} ${line}`;
    }
    description = description.replace(/\s+/g, " ").trim();
    if (historical && description) description = `${description} (not currently present)`;
    addCode(codes, match[1], description);
  }
  for (const match of text.matchAll(SAE)) {
    const written = (match[2] ?? "")
      .replace(/^[\s:\-–]+/, "")
      .replace(/\s+/g, " ")
      .trim();
    addCode(codes, match[1], written);
  }
  return codes;
}

export function readTopGuruReport(text: string): {
  outcome: ScanOutcome;
  vin: string | null;
  codes: ScanCode[];
} {
  const vin = text.toUpperCase().match(VIN)?.[1] ?? null;
  const codes = readScanCodes(text);
  if (codes.length > 0) return { outcome: "codes", vin, codes };

  const folded = text.toLowerCase();
  if (/no connection|unable to connect|communication (error|failed)/.test(folded)) {
    return { outcome: "no_connection", vin, codes: [] };
  }
  if (
    /no (fault|dtc|trouble) codes?|0 faults?|altogether\s+0\s+dtcs|\b0\s+dtcs were found\b/.test(
      folded
    )
  ) {
    return { outcome: "no_codes", vin, codes: [] };
  }
  return { outcome: "needs_confirmation", vin, codes: [] };
}

function normalizeVin(value: string | null): string | null {
  if (!value) return null;
  const vin = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return vin.length === 17 ? vin : null;
}

export function chooseInspectionForScan(
  report: { vin: string | null },
  waiting: WaitingInspection[]
): WaitingInspection | null {
  const vin = normalizeVin(report.vin);
  if (vin) {
    const matches = waiting.filter((row) => normalizeVin(row.vin) === vin);
    return matches.length === 1 ? matches[0] : null;
  }
  return waiting.length === 1 ? waiting[0] : null;
}

export function scanAddressAllowed(
  scanAddress: string,
  customerMailboxAddress: string | null
): boolean {
  const scan = scanAddress.trim().toLowerCase();
  if (scan !== SCAN_REPORT_ADDRESS) return false;
  const customer = customerMailboxAddress?.trim().toLowerCase() ?? "";
  return scan !== customer;
}

type GmailHeader = { name: string; value: string };

type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailFullMessage = {
  id: string;
  snippet?: string;
  payload?: GmailPart;
};

function header(part: GmailPart | undefined, name: string): string {
  return (
    part?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

function decodeBody(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function collectText(part: GmailPart | undefined, plain: string[], html: string[]): void {
  if (!part) return;
  if (part.mimeType === "text/plain" && part.body?.data) {
    plain.push(decodeBody(part.body.data));
  } else if (part.mimeType === "text/html" && part.body?.data) {
    html.push(decodeBody(part.body.data));
  }
  for (const child of part.parts ?? []) collectText(child, plain, html);
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function pdfAttachments(
  message: GmailFullMessage
): Array<{ attachmentId: string | null; data: string | null }> {
  const found: Array<{ attachmentId: string | null; data: string | null }> = [];
  const walk = (part: GmailPart | undefined) => {
    if (!part || found.length >= 2) return;
    const filename = part.filename?.toLowerCase() ?? "";
    const isPdf = part.mimeType === "application/pdf" || filename.endsWith(".pdf");
    if (isPdf && (part.body?.attachmentId || part.body?.data)) {
      found.push({
        attachmentId: part.body?.attachmentId ?? null,
        data: part.body?.data ?? null,
      });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(message.payload);
  return found;
}

export function textFromGmailMessage(message: GmailFullMessage): {
  subject: string;
  from: string;
  text: string;
} {
  const plain: string[] = [];
  const html: string[] = [];
  collectText(message.payload, plain, html);
  const text =
    plain.join("\n").trim() || stripHtml(html.join("\n")) || (message.snippet ?? "");
  return {
    subject: header(message.payload, "Subject"),
    from: header(message.payload, "From"),
    text,
  };
}

export const SCAN_NO_CODES_LINE = "No fault codes were found.";
export const SCAN_NO_CONNECTION_LINE = "No connection established with the bike.";
export const SCAN_VIN_MISMATCH_NOTE = "The report VIN does not match this work order.";
export const SCAN_CLEAR_DTC_NOTE = "Tap Report in TopGuru and leave Clear DTCs alone.";

export type ReportedOdometer = { value: number; unit: "km" | "mi" | null };

export type MileageDecision =
  | { action: "none" }
  | { action: "fill"; value: number; unit: "km" | "mi" }
  | {
      action: "choose";
      reportedValue: number;
      reportedUnit: "km" | "mi" | null;
      current: number;
      currentUnit: "km" | "mi";
    };

export type InspectionScanView = {
  scanReportId: string;
  outcome: ScanOutcome;
  codes: ScanCode[];
  vin: string | null;
  reportText: string;
  mileageChoice: "keep" | null;
};

function codeLine(code: ScanCode): string {
  const description = code.description.trim();
  if (!description || description.toUpperCase() === code.code) return code.code;
  return `${code.code} ${description}`;
}

export function scanCustomerLines(input: {
  outcome: ScanOutcome;
  codes: ScanCode[];
}): string[] {
  if (input.outcome === "codes") return input.codes.map(codeLine);
  if (input.outcome === "no_codes") return [SCAN_NO_CODES_LINE];
  if (input.outcome === "no_connection") return [SCAN_NO_CONNECTION_LINE];
  return [];
}

const ODOMETER =
  /(?:odometer|\bmileage\b|\bodo\b|distance traveled)\s*[:#\-]?\s*(\d{1,3}(?:[, ]\d{3})+|\d{1,7})(?:\.(\d{1,3}))?(?:\s*(km|mi|miles|kilometers|kilometres))?\b/i;

function odometerUnit(raw: string | undefined): "km" | "mi" | null {
  if (!raw) return null;
  const value = raw.toLowerCase();
  if (value === "mi" || value === "miles") return "mi";
  return "km";
}

/** Odometer text only. Charging voltage is not a mileage. */
export function readOdometer(text: string): ReportedOdometer | null {
  const withoutVoltage = text.replace(/\b(?:charging\s+)?voltage\b[^.\n]*/gi, " ");
  const match = withoutVoltage.match(ODOMETER);
  if (!match) return null;
  const whole = match[1].replace(/[, ]/g, "");
  const reading = match[2] ? Number(`${whole}.${match[2]}`) : Number(whole);
  const value = Math.round(reading);
  if (!Number.isInteger(value) || value < 0 || value > 9_999_999) return null;
  return { value, unit: odometerUnit(match[3]) };
}

export function mileageDecision(input: {
  reported: ReportedOdometer | null;
  current: number | null;
  currentUnit: "km" | "mi";
}): MileageDecision {
  if (!input.reported) return { action: "none" };
  if (input.current == null) {
    return {
      action: "fill",
      value: input.reported.value,
      unit: input.reported.unit ?? input.currentUnit,
    };
  }
  const sameUnit = (input.reported.unit ?? input.currentUnit) === input.currentUnit;
  if (sameUnit && input.reported.value === input.current) return { action: "none" };
  return {
    action: "choose",
    reportedValue: input.reported.value,
    reportedUnit: input.reported.unit,
    current: input.current,
    currentUnit: input.currentUnit,
  };
}

export function vinMismatchNote(
  reportVin: string | null,
  workOrderVin: string | null
): string | null {
  const report = normalizeVin(reportVin);
  const workOrder = normalizeVin(workOrderVin);
  if (!report || !workOrder || report === workOrder) return null;
  return SCAN_VIN_MISMATCH_NOTE;
}

export function diagnosticFromScan(
  scan: { outcome: ScanOutcome; codes: ScanCode[] } | null
): {
  description: "Diagnostic";
  severity: "immediate_attention";
  notes: string;
} | null {
  if (!scan || scan.outcome !== "codes" || scan.codes.length === 0) return null;
  return {
    description: "Diagnostic",
    severity: "immediate_attention",
    notes: scanCustomerLines(scan).join("\n"),
  };
}

export function diagnosticToCreate(
  scan: { outcome: ScanOutcome; codes: ScanCode[] } | null,
  alreadyHasDiagnostic: boolean
): ReturnType<typeof diagnosticFromScan> {
  if (alreadyHasDiagnostic) return null;
  return diagnosticFromScan(scan);
}

export function filingsForUnreadMail(input: {
  messages: Array<{ id: string; text: string }>;
  waiting: WaitingInspection[];
  alreadyFiledIds: string[];
}): Array<{
  gmailMessageId: string;
  outcome: ScanOutcome;
  vin: string | null;
  codes: ScanCode[];
  inspectionId: string | null;
  workOrderId: string | null;
  reportText: string;
}> {
  const filed = new Set(input.alreadyFiledIds);
  const rows = [];
  for (const message of input.messages) {
    if (filed.has(message.id)) continue;
    const report = readTopGuruReport(message.text);
    const match = chooseInspectionForScan(report, input.waiting);
    rows.push({
      gmailMessageId: message.id,
      outcome: report.outcome,
      vin: report.vin,
      codes: report.codes,
      inspectionId: match?.inspectionId ?? null,
      workOrderId: match?.workOrderId ?? null,
      reportText: message.text.slice(0, 20_000),
    });
  }
  return rows;
}
