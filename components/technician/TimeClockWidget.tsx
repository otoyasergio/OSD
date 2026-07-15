"use client";

import { useActionState, useSyncExternalStore } from "react";
import type { ClockFormState } from "@/app/(app)/technician/clock-actions";
import { clockInAction, clockOutAction } from "@/app/(app)/technician/clock-actions";
import type { TimeClockEntry } from "@/lib/services/timeClock";
import { formatElapsedMs } from "@/lib/services/timeClockShared";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { formatTime } from "@/lib/datetime/format";

type Props = {
  openEntry: TimeClockEntry | null;
};

function subscribeClock(onStoreChange: () => void) {
  const id = window.setInterval(onStoreChange, 1000);
  return () => window.clearInterval(id);
}

function getClockNow() {
  return Date.now();
}

function getServerClockNow() {
  return 0;
}

export function TimeClockWidget({ openEntry }: Props) {
  const [inState, inAction] = useActionState(clockInAction, {
    error: null,
  } satisfies ClockFormState);
  const [outState, outAction] = useActionState(clockOutAction, {
    error: null,
  } satisfies ClockFormState);
  // Client-only clock via getServerSnapshot — avoids SSR Date.now() hydration drift.
  const nowMs = useSyncExternalStore(
    openEntry ? subscribeClock : () => () => {},
    getClockNow,
    getServerClockNow
  );

  const elapsed = openEntry
    ? nowMs > 0
      ? formatElapsedMs(openEntry.clock_in_at, nowMs)
      : "…"
    : "0:00";

  return (
    <section className="rounded-lg border border-[var(--chrome-border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Time clock</h2>
          <p className="text-sm text-[var(--status-neutral)]">
            {openEntry
              ? `Clocked in since ${formatTime(openEntry.clock_in_at)}`
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
