"use client";

import { useActionState } from "react";
import type { ClockFormState } from "@/app/(app)/technician/clock-actions";
import { submitMyTimesheetAction } from "@/app/(app)/technician/clock-actions";
import type { MyTimesheetWeekView } from "@/lib/services/timeClock";
import {
  formatHoursDecimal,
  ONTARIO_OT_THRESHOLD_HOURS,
} from "@/lib/services/timeClockShared";
import { formatDate } from "@/lib/datetime/format";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type Props = {
  view: MyTimesheetWeekView;
};

export function MyTimesheetCard({ view }: Props) {
  const [state, action] = useActionState(submitMyTimesheetAction, {
    error: null,
  } satisfies ClockFormState);

  const status = view.week?.status ?? "open";
  const canSubmit = status === "open" || status === "rejected";

  return (
    <section className="rounded-lg border border-[var(--chrome-border)] bg-[var(--surface)] p-4">
      <h2 className="text-lg font-semibold text-foreground">My timesheet</h2>
      <p className="mt-1 text-sm text-[var(--status-neutral)]">
        Week of {formatDate(view.range.startUtc)} –{" "}
        {formatDate(new Date(view.range.endUtc.getTime() - 1))} (Mon–Sun, America/Toronto)
      </p>

      {view.summary ? (
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-[var(--status-neutral)]">Paid hours</dt>
            <dd className="font-semibold tabular-nums">
              {formatHoursDecimal(view.summary.total_ms)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--status-neutral)]">
              Regular (≤{ONTARIO_OT_THRESHOLD_HOURS}h)
            </dt>
            <dd className="font-semibold tabular-nums">
              {formatHoursDecimal(view.summary.regular_ms)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--status-neutral)]">Overtime</dt>
            <dd className="font-semibold tabular-nums">
              {formatHoursDecimal(view.summary.ot_ms)}
              {view.summary.ot_ms > 0 ? (
                <span className="ml-2 text-xs font-semibold text-[var(--status-warning)]">
                  OT
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-sm text-[var(--status-neutral)]">
          No punches this week yet.
        </p>
      )}

      <p className="mt-3 text-sm text-foreground">
        Status: <span className="font-semibold capitalize">{status}</span>
        {view.week?.note ? (
          <span className="text-[var(--status-neutral)]"> — {view.week.note}</span>
        ) : null}
      </p>

      <FormError message={state.error} />

      {canSubmit ? (
        <form action={action} className="mt-3">
          <input type="hidden" name="week_start_date" value={view.range.startDateKey} />
          <SubmitButton label="Submit week for approval" pendingLabel="Submitting…" />
        </form>
      ) : status === "submitted" ? (
        <p className="mt-3 text-sm text-[var(--status-neutral)]">
          Waiting for owner/manager approval.
        </p>
      ) : (
        <p className="mt-3 text-sm text-[var(--status-success)]">
          This week is approved.
        </p>
      )}
    </section>
  );
}
