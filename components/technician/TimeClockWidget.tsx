"use client";

import { useActionState, useEffect, useState } from "react";
import type { ClockFormState } from "@/app/(app)/technician/clock-actions";
import {
  clockInAction,
  clockOutAction,
} from "@/app/(app)/technician/clock-actions";
import type { TimeClockEntry } from "@/lib/services/timeClock";
import { formatElapsedMs } from "@/lib/services/timeClockShared";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type Props = {
  openEntry: TimeClockEntry | null;
};

export function TimeClockWidget({ openEntry }: Props) {
  const [inState, inAction] = useActionState(clockInAction, {
    error: null,
  } satisfies ClockFormState);
  const [outState, outAction] = useActionState(clockOutAction, {
    error: null,
  } satisfies ClockFormState);
  const [elapsed, setElapsed] = useState(
    openEntry ? formatElapsedMs(openEntry.clock_in_at) : "0:00"
  );

  useEffect(() => {
    if (!openEntry) {
      setElapsed("0:00");
      return;
    }
    const tick = () => setElapsed(formatElapsedMs(openEntry.clock_in_at));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [openEntry]);

  return (
    <section className="rounded-lg border border-[var(--chrome-border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Time clock</h2>
          <p className="text-sm text-[var(--status-neutral)]">
            {openEntry
              ? `Clocked in since ${new Date(openEntry.clock_in_at).toLocaleTimeString()}`
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

      <FormError message={inState.error ?? outState.error} />

      {openEntry ? (
        <form action={outAction} className="mt-3">
          <SubmitButton label="Clock out" pendingLabel="Clocking out…" />
        </form>
      ) : (
        <form action={inAction} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
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
