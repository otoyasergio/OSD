"use client";

import Link from "next/link";
import { useActionState } from "react";
import type {
  TimeClockEntryWithUser,
  TimesheetStaffOption,
  TimesheetWeekRow,
} from "@/lib/services/timeClock";
import type { UserWeekSummary } from "@/lib/services/timeClockShared";
import type { ShopWeekRange } from "@/lib/datetime/format";
import {
  formatHoursDecimal,
  ONTARIO_OT_THRESHOLD_HOURS,
  punchDurationMs,
  unpaidBreakMsForEntry,
} from "@/lib/services/timeClockShared";
import {
  formatDate,
  formatDateTime,
  toShopDatetimeLocalValue,
} from "@/lib/datetime/format";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import {
  approveTimesheetAction,
  createPunchAction,
  deletePunchAction,
  rejectTimesheetAction,
  reopenTimesheetAction,
  updatePunchAction,
  type TimesheetFormState,
} from "@/app/(app)/settings/timesheets/actions";

type Props = {
  range: ShopWeekRange;
  open: TimeClockEntryWithUser[];
  entries: TimeClockEntryWithUser[];
  summaries: UserWeekSummary[];
  staff: TimesheetStaffOption[];
  weeksByUser: Record<string, TimesheetWeekRow>;
  weekParam: string;
};

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

function shortDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12));
  return utc.toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function CreatePunchForm({ staff }: { staff: TimesheetStaffOption[] }) {
  const [state, action] = useActionState(createPunchAction, {
    error: null,
  } satisfies TimesheetFormState);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="block">
        <span className="field-label">Staff</span>
        <select name="user_id" className="input" required defaultValue="">
          <option value="" disabled>
            Select…
          </option>
          {staff.map((person) => (
            <option key={person.user_id} value={person.user_id}>
              {person.first_name} {person.last_name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="field-label">Clock in</span>
        <input name="clock_in_at" type="datetime-local" className="input" required />
      </label>
      <label className="block">
        <span className="field-label">Clock out</span>
        <input name="clock_out_at" type="datetime-local" className="input" required />
      </label>
      <label className="block lg:col-span-1 sm:col-span-2">
        <span className="field-label">Notes</span>
        <input name="notes" className="input" placeholder="Missed punch, etc." />
      </label>
      <div className="flex items-end">
        <SubmitButton label="Add punch" pendingLabel="Saving…" />
      </div>
      <div className="sm:col-span-2 lg:col-span-5">
        <FormError message={state.error} />
        {state.ok ? (
          <p className="text-sm text-[var(--status-success)]">Punch added.</p>
        ) : null}
      </div>
    </form>
  );
}

function EditPunchForm({
  entry,
  locked,
}: {
  entry: TimeClockEntryWithUser;
  locked: boolean;
}) {
  const [updateState, updateAction] = useActionState(
    updatePunchAction.bind(null, entry.entry_id),
    { error: null } satisfies TimesheetFormState
  );
  const [deleteState, deleteAction] = useActionState(
    deletePunchAction.bind(null, entry.entry_id),
    { error: null } satisfies TimesheetFormState
  );

  if (locked) {
    return (
      <p className="mt-2 text-sm text-[var(--status-neutral)]">
        Week is approved — reopen to edit punches.
      </p>
    );
  }

  return (
    <div className="space-y-3 border-t border-[var(--chrome-border)] pt-3">
      <form action={updateAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="field-label">Clock in</span>
          <input
            name="clock_in_at"
            type="datetime-local"
            className="input"
            required
            defaultValue={toShopDatetimeLocalValue(entry.clock_in_at)}
          />
        </label>
        <label className="block">
          <span className="field-label">Clock out</span>
          <input
            name="clock_out_at"
            type="datetime-local"
            className="input"
            defaultValue={
              entry.clock_out_at ? toShopDatetimeLocalValue(entry.clock_out_at) : ""
            }
          />
          <span className="field-hint">Leave blank to keep open</span>
        </label>
        <label className="block sm:col-span-2">
          <span className="field-label">Notes</span>
          <input name="notes" className="input" defaultValue={entry.notes ?? ""} />
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <SubmitButton label="Save correction" pendingLabel="Saving…" />
        </div>
        <FormError message={updateState.error} />
      </form>
      <form action={deleteAction}>
        <SubmitButton label="Void punch" pendingLabel="Voiding…" variant="danger" />
        <FormError message={deleteState.error} />
      </form>
    </div>
  );
}

function ApprovalActions({
  userId,
  weekStart,
  status,
}: {
  userId: string;
  weekStart: string;
  status: string;
}) {
  const [approveState, approveAction] = useActionState(approveTimesheetAction, {
    error: null,
  } satisfies TimesheetFormState);
  const [rejectState, rejectAction] = useActionState(rejectTimesheetAction, {
    error: null,
  } satisfies TimesheetFormState);
  const [reopenState, reopenAction] = useActionState(reopenTimesheetAction, {
    error: null,
  } satisfies TimesheetFormState);

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      {status !== "approved" ? (
        <>
          <form action={approveAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="user_id" value={userId} />
            <input type="hidden" name="week_start_date" value={weekStart} />
            <label className="block">
              <span className="field-label">Note</span>
              <input name="note" className="input" placeholder="Optional" />
            </label>
            <SubmitButton label="Approve" pendingLabel="Saving…" />
          </form>
          <form action={rejectAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="user_id" value={userId} />
            <input type="hidden" name="week_start_date" value={weekStart} />
            <input type="hidden" name="note" value="Needs correction" />
            <SubmitButton label="Reject" pendingLabel="Saving…" variant="secondary" />
          </form>
        </>
      ) : (
        <form action={reopenAction}>
          <input type="hidden" name="user_id" value={userId} />
          <input type="hidden" name="week_start_date" value={weekStart} />
          <SubmitButton label="Reopen week" pendingLabel="Saving…" variant="secondary" />
        </form>
      )}
      <FormError message={approveState.error ?? rejectState.error ?? reopenState.error} />
    </div>
  );
}

export function TimesheetsPanel({
  range,
  open,
  entries,
  summaries,
  staff,
  weeksByUser,
  weekParam,
}: Props) {
  const prevWeek = addDaysToDateKey(range.startDateKey, -7);
  const nextWeek = addDaysToDateKey(range.startDateKey, 7);
  const exportHref = `/settings/timesheets/export?week=${encodeURIComponent(weekParam)}`;

  const grandTotalMs = summaries.reduce((sum, row) => sum + row.total_ms, 0);
  const grandOtMs = summaries.reduce((sum, row) => sum + row.ot_ms, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--status-neutral)]">
            Week of {formatDate(range.startUtc)} –{" "}
            {formatDate(new Date(range.endUtc.getTime() - 1))} (America/Toronto, Mon–Sun).
            OT after {ONTARIO_OT_THRESHOLD_HOURS}h.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/settings/timesheets?week=${prevWeek}`}
            className="btn btn-secondary"
          >
            Previous week
          </Link>
          <Link href="/settings/timesheets" className="btn btn-secondary">
            This week
          </Link>
          <Link
            href={`/settings/timesheets?week=${nextWeek}`}
            className="btn btn-secondary"
          >
            Next week
          </Link>
          <a href={exportHref} className="btn btn-primary">
            Export CSV
          </a>
        </div>
      </div>

      <section className="rounded-lg border border-[var(--chrome-border)] bg-[var(--surface)] p-4">
        <h2 className="text-lg font-semibold text-foreground">Punched in now</h2>
        {open.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--status-neutral)]">
            Nobody is clocked in.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--chrome-border)]">
            {open.map((entry) => (
              <li
                key={entry.entry_id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="font-medium text-foreground">
                  {entry.first_name} {entry.last_name}
                </span>
                <span className="text-[var(--status-neutral)]">
                  Since {formatDateTime(entry.clock_in_at)} ·{" "}
                  {formatHoursDecimal(punchDurationMs(entry.clock_in_at, null))} h so far
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-[var(--chrome-border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">Weekly summary</h2>
          <p className="text-sm text-[var(--status-neutral)]">
            Shop paid: {formatHoursDecimal(grandTotalMs)} h
            {grandOtMs > 0 ? ` · OT ${formatHoursDecimal(grandOtMs)} h` : ""}
          </p>
        </div>
        {summaries.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--status-neutral)]">
            No punches this week.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--chrome-border)] text-[var(--status-neutral)]">
                  <th className="py-2 pr-3 font-medium">Employee</th>
                  {range.dateKeys.map((key) => (
                    <th key={key} className="px-2 py-2 font-medium">
                      {shortDayLabel(key)}
                    </th>
                  ))}
                  <th className="py-2 pl-3 font-medium">Paid</th>
                  <th className="py-2 pl-3 font-medium">OT</th>
                  <th className="py-2 pl-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((row) => {
                  const approval =
                    weeksByUser[row.user_id]?.status ?? row.week_approval ?? "open";
                  return (
                    <tr
                      key={row.user_id}
                      className="border-b border-[var(--chrome-border)] align-top"
                    >
                      <td className="py-2 pr-3 font-medium text-foreground">
                        {row.display_name}
                        {row.open_entry_ids.length > 0 ? (
                          <span className="ml-2 text-xs font-semibold text-[var(--status-warning)]">
                            open
                          </span>
                        ) : null}
                        <ApprovalActions
                          userId={row.user_id}
                          weekStart={range.startDateKey}
                          status={approval}
                        />
                      </td>
                      {row.daily.map((day) => (
                        <td key={day.dateKey} className="px-2 py-2 tabular-nums">
                          {day.ms > 0 ? formatHoursDecimal(day.ms) : "—"}
                        </td>
                      ))}
                      <td className="py-2 pl-3 font-semibold tabular-nums">
                        {formatHoursDecimal(row.total_ms)}
                      </td>
                      <td className="py-2 pl-3 tabular-nums">
                        {formatHoursDecimal(row.ot_ms)}
                        {row.ot_ms > 0 ? (
                          <span className="ml-1 text-xs font-semibold text-[var(--status-warning)]">
                            OT
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pl-3 capitalize">{approval}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-[var(--chrome-border)] bg-[var(--surface)] p-4">
        <h2 className="text-lg font-semibold text-foreground">Add missed punch</h2>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Times are America/Toronto. Missed punches need both in and out.
        </p>
        <div className="mt-3">
          <CreatePunchForm staff={staff} />
        </div>
      </section>

      <section className="rounded-lg border border-[var(--chrome-border)] bg-[var(--surface)] p-4">
        <h2 className="text-lg font-semibold text-foreground">Punches</h2>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--status-neutral)]">
            No entries for this week.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--chrome-border)]">
            {entries.map((entry) => {
              const breakMs = unpaidBreakMsForEntry(
                (entry.breaks ?? []).map((b) => ({
                  entry_id: b.entry_id,
                  break_start_at: b.break_start_at,
                  break_end_at: b.break_end_at,
                })),
                entry.entry_id
              );
              const gross = punchDurationMs(entry.clock_in_at, entry.clock_out_at);
              const paid = Math.max(0, gross - breakMs);
              const locked =
                (weeksByUser[entry.user_id]?.status ?? "open") === "approved";
              return (
                <li key={entry.entry_id} className="py-3">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-foreground">
                        {entry.first_name} {entry.last_name}
                        {!entry.clock_out_at ? (
                          <span className="ml-2 text-xs font-semibold text-[var(--status-warning)]">
                            open
                          </span>
                        ) : null}
                      </span>
                      <span className="text-sm text-[var(--status-neutral)]">
                        {formatDateTime(entry.clock_in_at)}
                        {" → "}
                        {entry.clock_out_at
                          ? formatDateTime(entry.clock_out_at)
                          : "now"}{" "}
                        · {formatHoursDecimal(paid)} h paid
                        {breakMs > 0 ? ` (−${Math.round(breakMs / 60_000)}m break)` : ""}
                      </span>
                    </summary>
                    {entry.notes ? (
                      <p className="mt-2 text-sm text-[var(--status-neutral)]">
                        {entry.notes}
                      </p>
                    ) : null}
                    <EditPunchForm entry={entry} locked={locked} />
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
