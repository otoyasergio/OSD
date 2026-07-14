import Link from "next/link";
import type { TimeClockEntry } from "@/lib/services/timeClock";
import type { ShiftMonthCalendar as ShiftMonthCalendarModel } from "@/lib/services/timeClockShared";
import {
  allocatePunchMsByShopDay,
  shiftHoursLabel,
} from "@/lib/services/timeClockShared";
import { formatTime, shopDateKey } from "@/lib/datetime/format";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

type Props = {
  calendar: ShiftMonthCalendarModel;
  entries: TimeClockEntry[];
  currentMonthKey: string;
};

function dayNumber(dateKey: string): string {
  return String(Number(dateKey.slice(8, 10)));
}

function daySurfaceClass(ms: number, open: boolean, isToday: boolean): string {
  const parts = [
    "flex min-h-[4.25rem] flex-col rounded-md border p-1.5 sm:min-h-[5rem] sm:p-2",
  ];
  if (open) {
    parts.push(
      "border-[var(--status-warning)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]"
    );
  } else if (ms > 0) {
    const hours = ms / (60 * 60 * 1000);
    if (hours >= 8) {
      parts.push(
        "border-[var(--status-success)]/40 bg-[var(--status-success-bg)] text-[var(--status-success-fg)]"
      );
    } else if (hours >= 4) {
      parts.push(
        "border-[var(--chrome-border)] bg-[color-mix(in_srgb,var(--status-success-bg)_65%,var(--surface))]"
      );
    } else {
      parts.push(
        "border-[var(--chrome-border)] bg-[color-mix(in_srgb,var(--status-success-bg)_35%,var(--surface))]"
      );
    }
  } else {
    parts.push("border-[var(--chrome-border)] bg-[var(--surface)]");
  }
  if (isToday) {
    parts.push("ring-2 ring-[var(--chrome)] ring-offset-1");
  }
  return parts.join(" ");
}

export function ShiftMonthCalendar({ calendar, entries, currentMonthKey }: Props) {
  const todayKey = shopDateKey(new Date());
  const entriesByDay = new Map<string, TimeClockEntry[]>();
  for (const entry of entries) {
    const allocated = allocatePunchMsByShopDay(entry.clock_in_at, entry.clock_out_at);
    for (const dateKey of allocated.keys()) {
      const list = entriesByDay.get(dateKey) ?? [];
      list.push(entry);
      entriesByDay.set(dateKey, list);
    }
  }

  const workedDays = calendar.days.filter((d) => d.inMonth && d.ms > 0);

  return (
    <section className="rounded-lg border border-[var(--chrome-border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Shift calendar</h2>
          <p className="text-sm text-[var(--status-neutral)]">
            Your clocked hours for {calendar.label}
            {calendar.total_ms > 0
              ? ` · ${shiftHoursLabel(calendar.total_ms)} total`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/technician/clock?month=${calendar.prevMonthKey}`}
            className="rounded-md border border-[var(--chrome-border)] px-3 py-2 text-sm font-medium text-foreground hover:bg-[var(--surface-muted)]"
            aria-label="Previous month"
          >
            ←
          </Link>
          <span className="min-w-[8.5rem] text-center text-sm font-semibold tabular-nums text-foreground">
            {calendar.label}
          </span>
          <Link
            href={`/technician/clock?month=${calendar.nextMonthKey}`}
            className="rounded-md border border-[var(--chrome-border)] px-3 py-2 text-sm font-medium text-foreground hover:bg-[var(--surface-muted)]"
            aria-label="Next month"
          >
            →
          </Link>
          {calendar.monthKey !== currentMonthKey ? (
            <Link
              href="/technician/clock"
              className="rounded-md border border-[var(--chrome-border)] px-3 py-2 text-sm font-medium text-foreground hover:bg-[var(--surface-muted)]"
            >
              This month
            </Link>
          ) : null}
        </div>
      </div>

      <div
        className="mt-4 grid grid-cols-7 gap-1 sm:gap-1.5"
        role="grid"
        aria-label={`Shifts for ${calendar.label}`}
      >
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="px-1 pb-1 text-center text-[0.65rem] font-medium uppercase tracking-wide text-[var(--status-neutral)] sm:text-xs"
            role="columnheader"
          >
            {day}
          </div>
        ))}
        {calendar.days.map((day) => {
          if (!day.inMonth) {
            return (
              <div
                key={day.dateKey}
                className="min-h-[4.25rem] rounded-md bg-[var(--surface-muted)]/40 sm:min-h-[5rem]"
                aria-hidden
              />
            );
          }
          const label = shiftHoursLabel(day.ms);
          const isToday = day.dateKey === todayKey;
          return (
            <div
              key={day.dateKey}
              role="gridcell"
              aria-label={`${day.dateKey}${label ? `, ${label}` : ""}${day.open ? ", open shift" : ""}`}
              className={daySurfaceClass(day.ms, day.open, isToday)}
            >
              <span className="text-xs font-medium tabular-nums text-[var(--status-neutral)]">
                {dayNumber(day.dateKey)}
              </span>
              {label ? (
                <span className="mt-auto text-sm font-semibold tabular-nums leading-tight">
                  {label}
                </span>
              ) : (
                <span className="mt-auto" aria-hidden />
              )}
              {day.open ? (
                <span className="text-[0.65rem] font-medium uppercase tracking-wide">
                  Open
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--status-neutral)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[var(--status-success-bg)] ring-1 ring-[var(--status-success)]/40" />
          Worked
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[var(--status-warning-bg)] ring-1 ring-[var(--status-warning)]" />
          Open shift
        </span>
      </div>

      <div className="mt-4 border-t border-[var(--chrome-border)] pt-4">
        <h3 className="text-sm font-semibold text-foreground">Shift details</h3>
        {workedDays.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--status-neutral)]">
            No shifts clocked this month yet.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {workedDays.map((day) => {
              const dayEntries = entriesByDay.get(day.dateKey) ?? [];
              return (
                <li
                  key={day.dateKey}
                  className="rounded-md border border-[var(--chrome-border)] bg-[var(--surface-muted)]/40 px-3 py-2"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {day.dateKey}
                      {day.open ? (
                        <span className="ml-2 text-xs font-medium uppercase text-[var(--status-warning-fg)]">
                          Open
                        </span>
                      ) : null}
                    </p>
                    <p className="font-mono text-sm tabular-nums text-foreground">
                      {shiftHoursLabel(day.ms) || "0h"}
                    </p>
                  </div>
                  {dayEntries.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-sm text-[var(--status-neutral)]">
                      {dayEntries.map((entry) => (
                        <li key={entry.entry_id}>
                          {formatTime(entry.clock_in_at)}
                          {" → "}
                          {entry.clock_out_at ? formatTime(entry.clock_out_at) : "now"}
                          {entry.notes ? ` · ${entry.notes}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-[var(--status-neutral)]">
                      Hours from overnight shift
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
