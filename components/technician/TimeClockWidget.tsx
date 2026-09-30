"use client";

import { useActionState } from "react";
import type { ClockFormState } from "@/app/(app)/technician/clock-actions";
import {
  clockInAction,
  clockOutAction,
  endBreakAction,
  startBreakAction,
} from "@/app/(app)/technician/clock-actions";
import type { TimeClockBreak, TimeClockEntry } from "@/lib/services/timeClock";
import { formatElapsedMs } from "@/lib/services/timeClockShared";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { formatTime } from "@/lib/datetime/format";
import { useNowTick } from "@/lib/client/useNowTick";

type Props = {
  openEntry: TimeClockEntry | null;
  openBreak?: TimeClockBreak | null;
  mealBreakNudge?: boolean;
};

export function TimeClockWidget({
  openEntry,
  openBreak = null,
  mealBreakNudge = false,
}: Props) {
  const [inState, inAction] = useActionState(clockInAction, {
    error: null,
  } satisfies ClockFormState);
  const [outState, outAction] = useActionState(clockOutAction, {
    error: null,
  } satisfies ClockFormState);
  const [startBreakState, startBreakFormAction] = useActionState(startBreakAction, {
    error: null,
  } satisfies ClockFormState);
  const [endBreakState, endBreakFormAction] = useActionState(endBreakAction, {
    error: null,
  } satisfies ClockFormState);

  const nowMs = useNowTick(Boolean(openEntry));

  const elapsed = openEntry
    ? nowMs > 0
      ? formatElapsedMs(openEntry.clock_in_at, nowMs)
      : "…"
    : "0:00";

  const formError =
    inState.error ?? outState.error ?? startBreakState.error ?? endBreakState.error;

  return (
    <section className="rounded-lg border border-[var(--chrome-border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Time clock</h2>
          <p className="text-sm text-[var(--status-neutral)]">
            {openEntry
              ? openBreak
                ? `On meal break since ${formatTime(openBreak.break_start_at)}`
                : `Clocked in since ${formatTime(openEntry.clock_in_at)}`
              : "Not clocked in"}
          </p>
        </div>
        {openEntry ? (
          <p
            className="font-mono text-2xl font-semibold tabular-nums text-foreground"
            aria-live="polite"
          >
            {elapsed}
          </p>
        ) : null}
      </div>

      {mealBreakNudge && openEntry && !openBreak ? (
        <p className="mt-3 rounded-md border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 px-3 py-2 text-sm text-foreground">
          You have been on the clock for 5+ hours without a meal break. Ontario requires a
          30-minute eating period after five consecutive hours.
        </p>
      ) : null}

      <FormError message={formError} />

      {openEntry ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {openBreak ? (
            <form action={endBreakFormAction}>
              <SubmitButton label="End meal break" pendingLabel="Ending…" />
            </form>
          ) : (
            <form action={startBreakFormAction}>
              <SubmitButton
                label="Start meal break"
                pendingLabel="Starting…"
                variant="secondary"
              />
            </form>
          )}
          <form action={outAction}>
            <SubmitButton label="Clock out" pendingLabel="Clocking out…" />
          </form>
        </div>
      ) : (
        <form
          action={inAction}
          className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <label className="block flex-1">
            <span className="field-label">Notes (optional)</span>
            <input name="notes" className="input" placeholder="Shift note" />
          </label>
          <SubmitButton label="Clock in" pendingLabel="Clocking in…" />
        </form>
      )}
    </section>
  );
}
