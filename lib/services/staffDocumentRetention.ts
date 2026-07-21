/** Ontario ESA-oriented retention guidance for staff EE documents (labels only; no auto-purge). */

export type StaffDocumentCategory =
  | "employment_agreement"
  | "excess_hours_agreement"
  | "overtime_averaging_agreement"
  | "wage_statement"
  | "leave_record"
  | "vacation_record"
  | "termination_statement"
  | "policy_ack"
  | "other";

export const STAFF_DOCUMENT_CATEGORY_LABELS: Record<StaffDocumentCategory, string> = {
  employment_agreement: "Employment agreement",
  excess_hours_agreement: "Excess hours agreement",
  overtime_averaging_agreement: "Overtime averaging agreement",
  wage_statement: "Wage statement",
  leave_record: "Leave record",
  vacation_record: "Vacation record",
  termination_statement: "Termination statement",
  policy_ack: "Policy acknowledgement",
  other: "Other",
};

/** Human-readable ESA retention guidance shown in the UI. */
export function retentionLabelForCategory(category: StaffDocumentCategory): string {
  switch (category) {
    case "vacation_record":
      return "Retain 5 years (Ontario ESA vacation records)";
    case "excess_hours_agreement":
    case "overtime_averaging_agreement":
      return "Retain 3 years after last day under the agreement";
    case "leave_record":
      return "Retain 3 years after the leave ends";
    case "wage_statement":
      return "Retain 3 years after the statement was given";
    case "employment_agreement":
    case "termination_statement":
      return "Retain at least 3 years after employment ends";
    default:
      return "Retain per Ontario ESA / CRA guidance (typically 3–6 years)";
  }
}

/**
 * Compute a suggested retention_until date.
 * Uses employment/leave end when provided; otherwise createdAt + default years.
 */
export function computeRetentionUntil(
  category: StaffDocumentCategory,
  createdAt: Date,
  opts?: {
    employmentEndDate?: Date | null;
    leaveEndDate?: Date | null;
    agreementLastWorkDate?: Date | null;
  }
): Date {
  const addYears = (base: Date, years: number) => {
    const d = new Date(base.getTime());
    d.setUTCFullYear(d.getUTCFullYear() + years);
    return d;
  };

  switch (category) {
    case "vacation_record":
      return addYears(createdAt, 5);
    case "leave_record":
      return addYears(opts?.leaveEndDate ?? createdAt, 3);
    case "excess_hours_agreement":
    case "overtime_averaging_agreement":
      return addYears(opts?.agreementLastWorkDate ?? createdAt, 3);
    case "employment_agreement":
    case "termination_statement":
      return addYears(opts?.employmentEndDate ?? createdAt, 3);
    case "wage_statement":
      return addYears(createdAt, 3);
    default:
      return addYears(createdAt, 3);
  }
}

export function isStaffDocumentCategory(value: string): value is StaffDocumentCategory {
  return value in STAFF_DOCUMENT_CATEGORY_LABELS;
}
