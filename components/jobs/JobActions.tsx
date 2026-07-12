"use client";

/**
 * Job action helpers used by JobCard (approve / decline / cancel / status).
 * Kept as a separate module so the Jobs tab can grow without bloating JobCard.
 */

export const APPROVAL_METHOD_OPTIONS = [
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "text", label: "Text" },
  { value: "in_person", label: "In person" },
  { value: "written_estimate", label: "Written estimate" },
  { value: "other", label: "Other" },
] as const;

export type ApprovalMethodValue =
  (typeof APPROVAL_METHOD_OPTIONS)[number]["value"];
