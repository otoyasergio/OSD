import { strToU8, zipSync } from "fflate";
import { formatCalendarDate, formatDateTime } from "@/lib/datetime/format";
import {
  STAFF_FEEDBACK_ARCHIVE_MAX_BYTES,
  STAFF_FEEDBACK_SUMMARY_MAX,
} from "@/lib/staffFeedback/constants";
import { staffFeedbackRoleLabel } from "@/lib/staffFeedback/fields";

const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHOP_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHARACTERS_FOR_NOTE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export type StaffFeedbackArchiveReport = {
  reportId: string;
  createdAt: string;
  actorName: string;
  role: string;
  pagePath: string;
  note: string;
  screenshot: Uint8Array | null;
};

export type StaffFeedbackArchive = {
  bytes: Uint8Array;
  summary: string;
  archivePath: string;
  reportCount: number;
  reportIds: string[];
};

export type StaffFeedbackSquashPlan =
  { action: "already_squashed" } | { action: "nothing_to_squash" } | { action: "squash" };

export function staffFeedbackArchivePath(shopDate: string): string {
  if (!SHOP_DATE.test(shopDate)) throw new Error("STAFF_FEEDBACK_DATE_INVALID");
  return `digests/${shopDate}.zip`;
}

export function planStaffFeedbackSquash(input: {
  digestExists: boolean;
  reportCount: number;
}): StaffFeedbackSquashPlan {
  if (input.digestExists) return { action: "already_squashed" };
  if (input.reportCount <= 0) return { action: "nothing_to_squash" };
  return { action: "squash" };
}

function assertReportId(id: string): string {
  const normalized = id.trim().toLowerCase();
  if (!REPORT_ID.test(normalized)) throw new Error("STAFF_FEEDBACK_REPORT_INVALID");
  return normalized;
}

function oneLine(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function squishStaffFeedbackReports(
  reports: StaffFeedbackArchiveReport[],
  shopDate: string
): StaffFeedbackArchive {
  const archivePath = staffFeedbackArchivePath(shopDate);
  if (reports.length === 0) throw new Error("STAFF_FEEDBACK_NOTHING_TO_SQUASH");

  const ordered = [...reports].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const seen = new Set<string>();
  const files: Record<string, Uint8Array> = {};
  const reportIds: string[] = [];
  const blocks = [
    `${ordered.length} ${ordered.length === 1 ? "note" : "notes"} packed on ${formatCalendarDate(shopDate)}.`,
  ];

  for (const report of ordered) {
    const reportId = assertReportId(report.reportId);
    if (seen.has(reportId)) throw new Error("STAFF_FEEDBACK_REPORT_INVALID");
    seen.add(reportId);
    reportIds.push(reportId);

    const note = report.note.replace(CONTROL_CHARACTERS_FOR_NOTE, "").trim();
    if (!note) throw new Error("STAFF_FEEDBACK_NOTE_REQUIRED");

    const who = oneLine(report.actorName, 120) || "Staff";
    const when = formatDateTime(report.createdAt) || report.createdAt;
    const page = oneLine(report.pagePath, 300) || "/";
    const screenshot =
      report.screenshot && report.screenshot.byteLength > 0 ? report.screenshot : null;
    blocks.push(
      `${who}, ${staffFeedbackRoleLabel(report.role)}, ${when}, ${page}${
        screenshot ? "" : ", no picture"
      }\n${note}`
    );
    if (screenshot) files[`reports/${reportId}.jpg`] = screenshot;
  }

  let summary = blocks.join("\n\n");
  if (summary.length > STAFF_FEEDBACK_SUMMARY_MAX) {
    summary = `${summary.slice(0, STAFF_FEEDBACK_SUMMARY_MAX - 1)}…`;
  }
  files["manifest.txt"] = strToU8(summary);

  return {
    bytes: zipSync(files, { level: 9 }),
    summary,
    archivePath,
    reportCount: reportIds.length,
    reportIds,
  };
}

/** Drop reports from the end until the zip fits in one storage object. */
export function buildStaffFeedbackArchive(
  reports: StaffFeedbackArchiveReport[],
  shopDate: string,
  maxBytes = STAFF_FEEDBACK_ARCHIVE_MAX_BYTES
): StaffFeedbackArchive {
  let batch = reports;
  let archive = squishStaffFeedbackReports(batch, shopDate);
  while (archive.bytes.byteLength > maxBytes && batch.length > 1) {
    batch = batch.slice(0, Math.floor(batch.length / 2));
    archive = squishStaffFeedbackReports(batch, shopDate);
  }
  if (archive.bytes.byteLength > maxBytes) {
    throw new Error("STAFF_FEEDBACK_SQUASH_FAILED");
  }
  return archive;
}
