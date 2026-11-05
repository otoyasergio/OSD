import {
  STAFF_FEEDBACK_HOURLY_LIMIT,
  STAFF_FEEDBACK_NOTE_MAX,
  STAFF_FEEDBACK_PAGE_MAX,
} from "@/lib/staffFeedback/constants";

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  service_advisor: "Service advisor",
  technician: "Technician",
  head_tech: "Head tech",
  admin: "Admin",
};

export function staffFeedbackRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? "Staff";
}

export function normalizeStaffFeedbackNote(input: string): string {
  const cleaned = input.replace(CONTROL_CHARACTERS, "").trim();
  if (!cleaned) throw new Error("STAFF_FEEDBACK_NOTE_REQUIRED");
  if (cleaned.length > STAFF_FEEDBACK_NOTE_MAX) {
    throw new Error("STAFF_FEEDBACK_NOTE_TOO_LONG");
  }
  return cleaned;
}

/** App path only. Query strings and hashes are dropped so notes don't store customer data from the URL. */
export function normalizeStaffFeedbackPath(input: string): string {
  const trimmed = input.trim();
  const withoutHash = trimmed.split("#")[0] ?? "";
  const path = (withoutHash.split("?")[0] ?? "").trim();
  if (
    path.length < 1 ||
    path.length > STAFF_FEEDBACK_PAGE_MAX ||
    !path.startsWith("/") ||
    path.includes("..") ||
    !/^\/[A-Za-z0-9_./~%-]*$/.test(path)
  ) {
    throw new Error("STAFF_FEEDBACK_PAGE_INVALID");
  }
  return path;
}

export function normalizeStaffFeedbackViewport(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  if (value == null) return null;
  const raw = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  if (rounded < 1 || rounded > 10000) return null;
  return rounded;
}

export function assertStaffFeedbackRate(recentCount: number): void {
  if (recentCount >= STAFF_FEEDBACK_HOURLY_LIMIT) {
    throw new Error("STAFF_FEEDBACK_RATE_LIMITED");
  }
}
