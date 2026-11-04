import { saeJ2012System } from "@/lib/bikeLink/saeJ2012";

export type ScanOutcome = "codes" | "no_codes" | "no_connection" | "needs_confirmation";

export type ScanCode = { code: string; description: string };

export type WaitingInspection = {
  inspectionId: string;
  workOrderId: string;
  workOrderNumber: string;
  vin: string | null;
};

const CODE = /\b([PCBU][0-9A-F]{4})\b([^\n]{0,80})?/gi;
const VIN = /\b([A-HJ-NPR-Z0-9]{17})\b/;

export function readTopGuruReport(text: string): {
  outcome: ScanOutcome;
  vin: string | null;
  codes: ScanCode[];
} {
  const vin = text.toUpperCase().match(VIN)?.[1] ?? null;
  const codes: ScanCode[] = [];
  for (const match of text.matchAll(CODE)) {
    const code = match[1].toUpperCase();
    if (codes.some((row) => row.code === code)) continue;
    const written = (match[2] ?? "").replace(/^[\s:\-–]+/, "").trim();
    codes.push({
      code,
      description: written || saeJ2012System(code) || code,
    });
  }
  if (codes.length > 0) return { outcome: "codes", vin, codes };

  const folded = text.toLowerCase();
  if (/no connection|unable to connect|communication (error|failed)/.test(folded)) {
    return { outcome: "no_connection", vin, codes: [] };
  }
  if (/no (fault|dtc|trouble) codes?|0 faults?/.test(folded)) {
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
  if (!scan.includes("@")) return false;
  const customer = customerMailboxAddress?.trim().toLowerCase() ?? "";
  return !customer || scan !== customer;
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
    part?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ??
    ""
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

export function textFromGmailMessage(message: GmailFullMessage): {
  subject: string;
  from: string;
  text: string;
} {
  const plain: string[] = [];
  const html: string[] = [];
  collectText(message.payload, plain, html);
  const text = plain.join("\n").trim() || stripHtml(html.join("\n")) || (message.snippet ?? "");
  return {
    subject: header(message.payload, "Subject"),
    from: header(message.payload, "From"),
    text,
  };
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
