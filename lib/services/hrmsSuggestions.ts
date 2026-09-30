import {
  ONTARIO_OT_THRESHOLD_HOURS,
  WEEKLY_HOURS_SUPERVISOR_WARNING_HOURS,
} from "@/lib/services/timeClockShared";

export type HrmsSuggestionSeverity = "info" | "watch" | "action";

export type HrmsSuggestion = {
  id: string;
  severity: HrmsSuggestionSeverity;
  title: string;
  detail: string;
  href?: string;
};

export type StaffAttendanceRow = {
  user_id: string;
  display_name: string;
  paid_hours: number;
  ot_hours: number;
  meal_misses: number;
  open_punch_hours: number | null;
  has_pin: boolean;
  has_employment_start_date: boolean;
  has_excess_hours_agreement_doc: boolean;
  has_vacation_record_doc: boolean;
  role: string;
};

export type HrmsSuggestionInput = {
  staff: StaffAttendanceRow[];
};

const PUNCHABLE = new Set(["technician", "head_tech", "service_advisor"]);

/** Pure rule engine for owner HRMS suggestion cards. */
export function buildHrmsSuggestions(input: HrmsSuggestionInput): HrmsSuggestion[] {
  const out: HrmsSuggestion[] = [];

  for (const s of input.staff) {
    const profileHref = `/settings/staff/${s.user_id}`;

    if (s.ot_hours > 0) {
      out.push({
        id: `ot-${s.user_id}`,
        severity: "action",
        title: `OT accrued — ${s.display_name}`,
        detail: `${s.ot_hours.toFixed(1)}h overtime this period (Ontario threshold ${ONTARIO_OT_THRESHOLD_HOURS}h/week). Review schedule or approval.`,
        href: profileHref,
      });
    } else if (
      s.paid_hours >= WEEKLY_HOURS_SUPERVISOR_WARNING_HOURS &&
      s.paid_hours < ONTARIO_OT_THRESHOLD_HOURS
    ) {
      out.push({
        id: `near-week-${s.user_id}`,
        severity: "watch",
        title: `Nearing ${WEEKLY_HOURS_SUPERVISOR_WARNING_HOURS}h — ${s.display_name}`,
        detail: `${s.paid_hours.toFixed(1)}h paid this period. Staff are warned on the kiosk to tell their supervisor.`,
        href: profileHref,
      });
    }

    if (s.meal_misses > 0) {
      out.push({
        id: `meal-${s.user_id}`,
        severity: "watch",
        title: `Meal-break gaps — ${s.display_name}`,
        detail: `${s.meal_misses} shift(s) ≥5h without a completed meal break. Reinforce kiosk Start meal break.`,
        href: profileHref,
      });
    }

    if (s.open_punch_hours != null && s.open_punch_hours > 12) {
      out.push({
        id: `open-${s.user_id}`,
        severity: "action",
        title: `Possible missed clock-out — ${s.display_name}`,
        detail: `Open punch for ${s.open_punch_hours.toFixed(1)}h. Correct in Timesheets if needed.`,
        href: "/settings/timesheets",
      });
    }

    if (PUNCHABLE.has(s.role) && !s.has_pin) {
      out.push({
        id: `pin-${s.user_id}`,
        severity: "info",
        title: `Set time-clock PIN — ${s.display_name}`,
        detail: "Staff need a 4-digit PIN to use the tablet kiosk.",
        href: profileHref,
      });
    }

    if (!s.has_employment_start_date) {
      out.push({
        id: `start-${s.user_id}`,
        severity: "info",
        title: `Missing employment start date — ${s.display_name}`,
        detail:
          "Ontario ESA employer records should include the start date of employment.",
        href: profileHref,
      });
    }

    if (s.ot_hours > 2 && !s.has_excess_hours_agreement_doc) {
      out.push({
        id: `excess-${s.user_id}`,
        severity: "watch",
        title: `No excess-hours agreement on file — ${s.display_name}`,
        detail:
          "Frequent OT without a written excess-hours agreement document in the EE vault.",
        href: profileHref,
      });
    }

    if (!s.has_vacation_record_doc) {
      out.push({
        id: `vac-${s.user_id}`,
        severity: "info",
        title: `Vacation records — ${s.display_name}`,
        detail:
          "ESA vacation time/pay records should be kept for 5 years. Add documents to the staff profile when available.",
        href: profileHref,
      });
    }
  }

  // Prefer action > watch > info; cap noise
  const rank = { action: 0, watch: 1, info: 2 } as const;
  out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return out.slice(0, 40);
}
