# Picked Up / Filed + Stage Timers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let front-office staff mark any active work order picked up / filed from the header or shop board (confirm + optional notes), and show live then frozen in-shop and pickup-wait timers with aging colors on cards and the work-order header.

**Architecture:** Reuse `completeWorkOrder` → `status: completed` with a relaxed ready gate. Add a board drop column that opens the same confirm UI instead of a silent status move. Derive stage timers from existing timestamps (`date_created`, `ready_for_pickup_at`, `completed_at`, `estimated_completion`) plus active job count in pure helpers under `lib/status/workOrderTimers.ts`, rendered by a shared client chip component.

**Tech Stack:** Next.js App Router, React 19, Supabase, Vitest, existing `@dnd-kit` shop board

**Specs:**

- `docs/superpowers/specs/2026-07-12-picked-up-filed-design.md`
- `docs/superpowers/specs/2026-07-12-work-order-stage-timers-design.md`

---

## File map

| File                                             | Responsibility                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `lib/status/workOrderTimers.ts`                  | Duration format, shop/pickup aging, timer view models                                              |
| `tests/unit/workOrderTimers.test.ts`             | Timer unit tests                                                                                   |
| `components/work_orders/WorkOrderTimerChips.tsx` | Live/frozen timer chips (client)                                                                   |
| `components/work_orders/FileWorkOrderButton.tsx` | Confirm + optional notes → complete action (header + board)                                        |
| `lib/services/quality.ts`                        | Relax `completeWorkOrder` gate; reject cancelled/completed                                         |
| `lib/services/errors.ts`                         | Update/remove obsolete ready-gate copy; add `ALREADY_COMPLETED` / `WORK_ORDER_CANCELLED` if needed |
| `lib/status/pipeline.ts`                         | Add `filed` board column (empty statuses)                                                          |
| `lib/status/transitions.ts`                      | Drop rules for `filed` (`canCompleteWorkOrder`)                                                    |
| `tests/unit/transitions.test.ts`                 | Filed column permission tests                                                                      |
| `components/work_orders/WorkOrderCard.tsx`       | Extend card data; render timer chips                                                               |
| `lib/services/dashboard.ts`                      | Select + map timer fields onto rows                                                                |
| `components/work_orders/WorkOrderHeader.tsx`     | Timer chips + file button slot                                                                     |
| `components/work_orders/OverviewTab.tsx`         | Replace primary Complete block with pointer                                                        |
| `components/work_orders/ShopBoard.tsx`           | Intercept drop onto `filed` → dialog                                                               |
| `app/(app)/work_orders/[work_order_id]/page.tsx` | Pass complete action / permissions into header                                                     |
| `app/(app)/work_orders/quality-actions.ts`       | Revalidate `/complete` on complete (if not already)                                                |

---

### Task 1: Stage timer helpers (TDD)

**Files:**

- Create: `lib/status/workOrderTimers.ts`
- Create: `tests/unit/workOrderTimers.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  formatCompactDuration,
  getShopTimer,
  getPickupTimer,
  type TimerTone,
} from "@/lib/status/workOrderTimers";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("formatCompactDuration", () => {
  it("formats hours and days", () => {
    expect(formatCompactDuration(3 * HOUR)).toBe("3h");
    expect(formatCompactDuration(DAY + 4 * HOUR)).toBe("1d 4h");
    expect(formatCompactDuration(45 * 60 * 1000)).toBe("45m");
  });
});

describe("getShopTimer", () => {
  const created = "2026-07-01T12:00:00.000Z";

  it("runs until ready_for_pickup_at then freezes", () => {
    const live = getShopTimer({
      dateCreated: created,
      readyForPickupAt: null,
      estimatedCompletion: null,
      activeJobCount: 1,
      nowMs: Date.parse(created) + 5 * HOUR,
    });
    expect(live.frozen).toBe(false);
    expect(live.label).toBe("In shop");
    expect(live.durationMs).toBe(5 * HOUR);

    const frozen = getShopTimer({
      dateCreated: created,
      readyForPickupAt: "2026-07-02T12:00:00.000Z",
      estimatedCompletion: null,
      activeJobCount: 1,
      nowMs: Date.parse("2026-07-10T12:00:00.000Z"),
    });
    expect(frozen.frozen).toBe(true);
    expect(frozen.durationMs).toBe(DAY);
  });

  it("uses ETA for yellow/red when present", () => {
    const eta = "2026-07-03T12:00:00.000Z"; // 2d window
    const yellow = getShopTimer({
      dateCreated: created,
      readyForPickupAt: null,
      estimatedCompletion: eta,
      activeJobCount: 1,
      nowMs: Date.parse("2026-07-03T10:00:00.000Z"), // 2h left ≤ 4h
    });
    expect(yellow.tone).toBe("warning");

    const red = getShopTimer({
      dateCreated: created,
      readyForPickupAt: null,
      estimatedCompletion: eta,
      activeJobCount: 1,
      nowMs: Date.parse("2026-07-03T13:00:00.000Z"),
    });
    expect(red.tone).toBe("danger");
  });

  it("falls back to job-count thresholds without ETA", () => {
    const red = getShopTimer({
      dateCreated: created,
      readyForPickupAt: null,
      estimatedCompletion: null,
      activeJobCount: 1,
      nowMs: Date.parse(created) + 3 * DAY + HOUR,
    });
    expect(red.tone).toBe("danger");
  });
});

describe("getPickupTimer", () => {
  it("is null before ready", () => {
    expect(
      getPickupTimer({
        readyForPickupAt: null,
        completedAt: null,
        nowMs: Date.now(),
      })
    ).toBeNull();
  });

  it("ages yellow at 24h and red at 72h", () => {
    const ready = "2026-07-01T12:00:00.000Z";
    const y = getPickupTimer({
      readyForPickupAt: ready,
      completedAt: null,
      nowMs: Date.parse(ready) + DAY + HOUR,
    });
    expect(y?.tone).toBe("warning");

    const r = getPickupTimer({
      readyForPickupAt: ready,
      completedAt: null,
      nowMs: Date.parse(ready) + 3 * DAY + HOUR,
    });
    expect(r?.tone).toBe("danger");
  });

  it("freezes at completed_at", () => {
    const ready = "2026-07-01T12:00:00.000Z";
    const done = "2026-07-02T12:00:00.000Z";
    const t = getPickupTimer({
      readyForPickupAt: ready,
      completedAt: done,
      nowMs: Date.parse("2026-07-10T12:00:00.000Z"),
    });
    expect(t?.frozen).toBe(true);
    expect(t?.durationMs).toBe(DAY);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/workOrderTimers.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement helpers**

Create `lib/status/workOrderTimers.ts`:

```ts
export type TimerTone = "neutral" | "warning" | "danger";

export type StageTimer = {
  label: string;
  durationMs: number;
  frozen: boolean;
  tone: TimerTone;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const SHOP_ETA_REMAINING_YELLOW_RATIO = 0.25;
export const SHOP_ETA_REMAINING_YELLOW_MAX_MS = 4 * HOUR_MS;

export const SHOP_JOB_THRESHOLDS = [
  { maxJobs: 1, yellowMs: 1 * DAY_MS, redMs: 3 * DAY_MS },
  { maxJobs: 3, yellowMs: 2 * DAY_MS, redMs: 5 * DAY_MS },
  { maxJobs: Infinity, yellowMs: 3 * DAY_MS, redMs: 7 * DAY_MS },
] as const;

export const PICKUP_YELLOW_MS = 1 * DAY_MS;
export const PICKUP_RED_MS = 3 * DAY_MS;

export function formatCompactDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function toneFromElapsed(elapsedMs: number, yellowMs: number, redMs: number): TimerTone {
  if (elapsedMs >= redMs) return "danger";
  if (elapsedMs >= yellowMs) return "warning";
  return "neutral";
}

function shopToneWithoutEta(elapsedMs: number, activeJobCount: number): TimerTone {
  const count = Math.max(0, activeJobCount);
  const row =
    SHOP_JOB_THRESHOLDS.find((t) => count <= t.maxJobs) ??
    SHOP_JOB_THRESHOLDS[SHOP_JOB_THRESHOLDS.length - 1];
  return toneFromElapsed(elapsedMs, row.yellowMs, row.redMs);
}

function shopToneWithEta(createdMs: number, etaMs: number, nowMs: number): TimerTone {
  if (nowMs >= etaMs) return "danger";
  const windowMs = Math.max(0, etaMs - createdMs);
  const remainingMs = etaMs - nowMs;
  if (
    remainingMs <= SHOP_ETA_REMAINING_YELLOW_MAX_MS ||
    (windowMs > 0 && remainingMs <= windowMs * SHOP_ETA_REMAINING_YELLOW_RATIO)
  ) {
    return "warning";
  }
  return "neutral";
}

export function getShopTimer(input: {
  dateCreated: string;
  readyForPickupAt: string | null;
  estimatedCompletion: string | null;
  activeJobCount: number;
  nowMs?: number;
}): StageTimer {
  const nowMs = input.nowMs ?? Date.now();
  const startMs = Date.parse(input.dateCreated);
  const endMs = input.readyForPickupAt ? Date.parse(input.readyForPickupAt) : nowMs;
  const durationMs = Math.max(0, endMs - startMs);
  const frozen = Boolean(input.readyForPickupAt);

  let tone: TimerTone = "neutral";
  if (input.estimatedCompletion) {
    tone = shopToneWithEta(
      startMs,
      Date.parse(input.estimatedCompletion),
      frozen ? endMs : nowMs
    );
  } else {
    tone = shopToneWithoutEta(durationMs, input.activeJobCount);
  }

  return { label: "In shop", durationMs, frozen, tone };
}

export function getPickupTimer(input: {
  readyForPickupAt: string | null;
  completedAt: string | null;
  nowMs?: number;
}): StageTimer | null {
  if (!input.readyForPickupAt) return null;
  const nowMs = input.nowMs ?? Date.now();
  const startMs = Date.parse(input.readyForPickupAt);
  const endMs = input.completedAt ? Date.parse(input.completedAt) : nowMs;
  const durationMs = Math.max(0, endMs - startMs);
  return {
    label: "Pickup wait",
    durationMs,
    frozen: Boolean(input.completedAt),
    tone: toneFromElapsed(durationMs, PICKUP_YELLOW_MS, PICKUP_RED_MS),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/workOrderTimers.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/status/workOrderTimers.ts tests/unit/workOrderTimers.test.ts
git commit -m "feat: add work order stage timer helpers"
```

---

### Task 2: Timer chips UI

**Files:**

- Create: `components/work_orders/WorkOrderTimerChips.tsx`
- Modify: `components/work_orders/WorkOrderHeader.tsx`

- [ ] **Step 1: Add chip component**

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  formatCompactDuration,
  getPickupTimer,
  getShopTimer,
  type StageTimer,
} from "@/lib/status/workOrderTimers";

const TONE_CLASS: Record<StageTimer["tone"], string> = {
  neutral: "bg-zinc-100 text-zinc-700",
  warning: "bg-amber-100 text-amber-900",
  danger: "bg-red-100 text-red-900",
};

export type WorkOrderTimerChipsProps = {
  dateCreated: string;
  readyForPickupAt: string | null;
  completedAt: string | null;
  estimatedCompletion: string | null;
  activeJobCount: number;
};

function Chip({ timer }: { timer: StageTimer }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold tabular-nums ${TONE_CLASS[timer.tone]}`}
      title={timer.frozen ? "Frozen" : "Live"}
    >
      {timer.label} · {formatCompactDuration(timer.durationMs)}
    </span>
  );
}

export function WorkOrderTimerChips(props: WorkOrderTimerChipsProps) {
  const needsTick = !props.completedAt;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!needsTick) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [needsTick]);

  const shop = getShopTimer({
    dateCreated: props.dateCreated,
    readyForPickupAt: props.readyForPickupAt,
    estimatedCompletion: props.estimatedCompletion,
    activeJobCount: props.activeJobCount,
    nowMs,
  });
  const pickup = getPickupTimer({
    readyForPickupAt: props.readyForPickupAt,
    completedAt: props.completedAt,
    nowMs,
  });

  return (
    <div className="flex flex-wrap gap-1.5">
      <Chip timer={shop} />
      {pickup ? <Chip timer={pickup} /> : null}
    </div>
  );
}
```

- [ ] **Step 2: Mount chips on the work-order header**

In `WorkOrderHeader.tsx`, import `WorkOrderTimerChips` and render under the status/flags block (or beside Next action):

```tsx
<WorkOrderTimerChips
  dateCreated={detail.date_created}
  readyForPickupAt={detail.ready_for_pickup_at}
  completedAt={detail.completed_at}
  estimatedCompletion={detail.estimated_completion}
  activeJobCount={
    detail.jobs.filter((job) => !INACTIVE_JOB_STATUSES.has(job.status)).length
  }
/>
```

Note: `INACTIVE_JOB_STATUSES` already includes `completed`/`cancelled`/`declined` — for timer job-count fallback, count jobs that are not `cancelled`/`declined` (include in-progress and completed active work). Prefer:

```ts
const activeJobCount = detail.jobs.filter(
  (job) => job.status !== "cancelled" && job.status !== "declined"
).length;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors from these files

- [ ] **Step 4: Commit**

```bash
git add components/work_orders/WorkOrderTimerChips.tsx components/work_orders/WorkOrderHeader.tsx
git commit -m "feat: show stage timer chips on work order header"
```

---

### Task 3: Timer data on board cards

**Files:**

- Modify: `lib/services/dashboard.ts`
- Modify: `components/work_orders/WorkOrderCard.tsx`

- [ ] **Step 1: Extend dashboard row + select**

Add to `RawRow` / `DashboardRow`:

```ts
ready_for_pickup_at: string | null;
completed_at: string | null;
active_job_count: number;
```

Include `ready_for_pickup_at, completed_at` in the board `.select(...)`.

In `toDashboardRow`, set:

```ts
ready_for_pickup_at: row.ready_for_pickup_at,
completed_at: row.completed_at,
active_job_count: (row.job ?? []).filter(
  (job) => job.status !== "cancelled" && job.status !== "declined"
).length,
```

(`completed_at` will usually be null on the active board query — fine.)

- [ ] **Step 2: Extend `WorkOrderCardData` and render chips**

```ts
export type WorkOrderCardData = {
  // ...existing
  date_created?: string | null;
  ready_for_pickup_at?: string | null;
  completed_at?: string | null;
  estimated_completion?: string | null;
  active_job_count?: number;
};
```

Inside `WorkOrderCard`, when `date_created` is present:

```tsx
{
  workOrder.date_created ? (
    <WorkOrderTimerChips
      dateCreated={workOrder.date_created}
      readyForPickupAt={workOrder.ready_for_pickup_at ?? null}
      completedAt={workOrder.completed_at ?? null}
      estimatedCompletion={workOrder.estimated_completion ?? null}
      activeJobCount={workOrder.active_job_count ?? 0}
    />
  ) : null;
}
```

Ensure dashboard → board mapping passes these fields through wherever `DashboardRow` is adapted to `WorkOrderCardData` (dashboard page / work orders page). Grep for `WorkOrderCardData` / `rows=` and extend the map.

- [ ] **Step 3: Commit**

```bash
git add lib/services/dashboard.ts components/work_orders/WorkOrderCard.tsx app/(app)/dashboard/page.tsx app/(app)/work_orders/page.tsx
git commit -m "feat: show stage timers on shop board cards"
```

---

### Task 4: Relax completeWorkOrder ready gate (TDD)

**Files:**

- Modify: `lib/services/quality.ts`
- Modify: `lib/services/errors.ts`
- Create: `tests/unit/completeWorkOrderGate.test.ts` (pure helper) **or** extract gate to testable function

Prefer extracting a pure helper so we do not need Supabase in unit tests:

- [ ] **Step 1: Write failing gate tests**

Create `lib/status/completeWorkOrderGate.ts` and `tests/unit/completeWorkOrderGate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assertCanCompleteWorkOrder } from "@/lib/status/completeWorkOrderGate";

describe("assertCanCompleteWorkOrder", () => {
  it("allows any active status without ready_for_pickup", () => {
    expect(() =>
      assertCanCompleteWorkOrder({ status: "in_progress", readyForPickupAt: null })
    ).not.toThrow();
  });

  it("rejects cancelled and completed", () => {
    expect(() =>
      assertCanCompleteWorkOrder({ status: "cancelled", readyForPickupAt: null })
    ).toThrow("WORK_ORDER_CANCELLED");
    expect(() =>
      assertCanCompleteWorkOrder({
        status: "completed",
        readyForPickupAt: "2026-07-01T00:00:00.000Z",
      })
    ).toThrow("ALREADY_COMPLETED");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- tests/unit/completeWorkOrderGate.test.ts`

- [ ] **Step 3: Implement gate + wire into `completeWorkOrder`**

```ts
import type { WorkOrderStatus } from "@/lib/database/types";

export function assertCanCompleteWorkOrder(input: {
  status: WorkOrderStatus | string;
  readyForPickupAt?: string | null;
}): void {
  if (input.status === "cancelled") throw new Error("WORK_ORDER_CANCELLED");
  if (input.status === "completed") throw new Error("ALREADY_COMPLETED");
}
```

In `completeWorkOrder` (`lib/services/quality.ts`), **remove** the ready-for-pickup / override block and call:

```ts
assertCanCompleteWorkOrder({
  status: workOrder.status,
  readyForPickupAt: workOrder.ready_for_pickup_at,
});
```

Keep `canCompleteWorkOrder(user.role)` check.

- [ ] **Step 4: Update error map**

In `lib/services/errors.ts`:

```ts
ALREADY_COMPLETED: "This work order is already picked up and filed.",
WORK_ORDER_CANCELLED: "Cancelled work orders cannot be filed.",
```

Remove or leave unused `NOT_READY_FOR_PICKUP` (safe to delete if no remaining references).

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/unit/completeWorkOrderGate.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/status/completeWorkOrderGate.ts tests/unit/completeWorkOrderGate.test.ts lib/services/quality.ts lib/services/errors.ts
git commit -m "feat: allow filing work orders from any active status"
```

---

### Task 5: Shared FileWorkOrderButton + header control

**Files:**

- Create: `components/work_orders/FileWorkOrderButton.tsx`
- Modify: `components/work_orders/WorkOrderHeader.tsx`
- Modify: `app/(app)/work_orders/[work_order_id]/page.tsx`
- Modify: `app/(app)/work_orders/quality-actions.ts` (revalidate `/complete`)

- [ ] **Step 1: Create confirm UI (same pattern as OverviewTab complete)**

`components/work_orders/FileWorkOrderButton.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import type { QualityFormState } from "@/app/(app)/work_orders/quality-actions";
import { FormError, TextAreaField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type CompleteAction = (
  state: QualityFormState,
  formData: FormData
) => Promise<QualityFormState>;

export function FileWorkOrderButton({
  completeAction,
  /** When true, skip the trigger and show the confirm form immediately (board drop). */
  forceOpen = false,
  onCancel,
}: {
  completeAction: CompleteAction;
  forceOpen?: boolean;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(forceOpen);
  const [state, formAction] = useActionState(completeAction, { error: null });

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-primary min-h-11"
        onClick={() => setOpen(true)}
      >
        Picked up / file…
      </button>
    );
  }

  return (
    <div
      className={
        forceOpen
          ? "fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          : undefined
      }
      role={forceOpen ? "dialog" : undefined}
      aria-modal={forceOpen ? true : undefined}
    >
      <form
        action={formAction}
        className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
      >
        <p className="text-sm font-semibold text-zinc-900">Mark as picked up and file?</p>
        <p className="mt-1 text-sm text-zinc-600">
          Moves this bike to Complete and filed. You can add a short note.
        </p>
        <FormError message={state.error} />
        <div className="mt-3">
          <TextAreaField label="Pickup notes (optional)" name="pickup_notes" rows={2} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <SubmitButton label="Confirm" pendingLabel="Filing…" />
          <button
            type="button"
            className="min-h-11 rounded border border-zinc-300 px-4 py-2 text-sm font-medium"
            onClick={() => {
              setOpen(false);
              onCancel?.();
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Wire header from detail page**

`WorkOrderHeader` is a server component — add an optional slot:

```tsx
fileSlot?: React.ReactNode;

// render near status badge row
{fileSlot}
```

On `app/(app)/work_orders/[work_order_id]/page.tsx`:

```tsx
<WorkOrderHeader
  detail={detail}
  photos={photos}
  fileSlot={
    canCompleteWo &&
    !detail.is_foreign_location &&
    detail.status !== "completed" &&
    detail.status !== "cancelled" ? (
      <FileWorkOrderButton
        completeAction={completeWorkOrderAction.bind(null, detail.work_order_id)}
      />
    ) : null
  }
/>
```

- [ ] **Step 3: Revalidate complete list**

In `revalidateWorkOrder` inside `quality-actions.ts`, add:

```ts
revalidatePath("/complete");
```

- [ ] **Step 4: Commit**

```bash
git add components/work_orders/FileWorkOrderButton.tsx components/work_orders/WorkOrderHeader.tsx "app/(app)/work_orders/[work_order_id]/page.tsx" "app/(app)/work_orders/quality-actions.ts"
git commit -m "feat: add picked up / file control on work order header"
```

---

### Task 6: Shop board “Picked up / filed” column

**Files:**

- Modify: `lib/status/pipeline.ts`
- Modify: `lib/status/transitions.ts`
- Modify: `tests/unit/transitions.test.ts`
- Modify: `components/work_orders/ShopBoard.tsx`
- Modify: `lib/services/workOrderTransitions.ts` (reject silent complete via board move)

- [ ] **Step 1: Failing transition tests**

```ts
it("maps filed column to completed target for drop metadata", () => {
  expect(getTargetStatusForColumn("filed")).toBe("completed");
});

it("allows service_advisor to drop into filed from in_progress", () => {
  expect(canDropInColumn("service_advisor", "filed", "in_progress")).toBe(true);
});

it("blocks technician from dropping into filed", () => {
  expect(canDropInColumn("technician", "filed", "ready_for_pickup")).toBe(false);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- tests/unit/transitions.test.ts`

- [ ] **Step 3: Pipeline + transitions**

In `SHOP_BOARD_COLUMNS` append:

```ts
{
  id: "filed",
  label: "Picked up / filed",
  statuses: [] as WorkOrderStatus[], // drop zone only — never lists cards
},
```

In `COLUMN_TARGET_STATUS`:

```ts
filed: "completed",
```

In `canDropInColumn`:

```ts
import { canCompleteWorkOrder } from "@/lib/permissions";

// after null/same-status checks:
if (columnId === "filed") {
  return canCompleteWorkOrder(role);
}
```

In `moveWorkOrderOnBoard`, reject filed early (board UI must confirm):

```ts
if (targetColumnId === "filed") {
  throw new Error("BOARD_CONFIRM_REQUIRED");
}
```

Add error copy:

```ts
BOARD_CONFIRM_REQUIRED:
  "Confirm pickup notes on the work order to file this bike.",
```

- [ ] **Step 4: ShopBoard intercept**

In `handleDragEnd`, before optimistic update / `moveWorkOrderOnBoardAction`:

```ts
if (targetColumnId === "filed") {
  if (!canDropInColumn(role, "filed", card.status)) {
    setErrorMessage("You do not have permission to file this work order.");
    return;
  }
  setPendingFileId(workOrderId);
  return;
}
```

Add state + confirm overlay:

```ts
const [pendingFileId, setPendingFileId] = useState<string | null>(null);

{pendingFileId ? (
  <FileWorkOrderButton
    forceOpen
    onCancel={() => setPendingFileId(null)}
    completeAction={completeWorkOrderAction.bind(null, pendingFileId)}
  />
) : null}
```

On successful file, `revalidatePath` removes the card from active rows (status no longer in `ACTIVE_STATUSES`). Do **not** optimistically set `completed` on the board list (card would have nowhere to sit); rely on revalidation, and clear `pendingFileId` after success via router refresh / unmount when rows update.

Import `completeWorkOrderAction` from `@/app/(app)/work_orders/quality-actions` and `FileWorkOrderButton` from `@/components/work_orders/FileWorkOrderButton`.

- [ ] **Step 5: Run transition tests**

Run: `npm test -- tests/unit/transitions.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/status/pipeline.ts lib/status/transitions.ts tests/unit/transitions.test.ts components/work_orders/ShopBoard.tsx lib/services/workOrderTransitions.ts lib/services/errors.ts
git commit -m "feat: add picked up / filed shop board drop column"
```

---

### Task 7: Overview tab — single primary path

**Files:**

- Modify: `components/work_orders/OverviewTab.tsx`

- [ ] **Step 1: Replace Complete / release primary UI**

Keep QC and Ready for pickup forms. Replace the Confirm complete block with:

```tsx
{
  canComplete && detail.status !== "completed" && detail.status !== "cancelled" ? (
    <div className="rounded border border-zinc-200 p-4 text-sm text-zinc-700">
      <h3 className="font-semibold text-zinc-900">Picked up / filed</h3>
      <p className="mt-1">
        Use <span className="font-medium">Picked up / file…</span> in the header (or drop
        the card onto <span className="font-medium">Picked up / filed</span> on the shop
        board).
      </p>
    </div>
  ) : null;
}
```

Remove `confirmComplete` state and the old complete form if unused. You may leave `completeAction` prop optional for a short transition, or remove it from Overview props and the page binding.

- [ ] **Step 2: Commit**

```bash
git add components/work_orders/OverviewTab.tsx "app/(app)/work_orders/[work_order_id]/page.tsx"
git commit -m "refactor: point overview complete flow to header file control"
```

---

### Task 8: Verification

- [ ] **Step 1: Unit suite**

Run: `npm test -- tests/unit/workOrderTimers.test.ts tests/unit/completeWorkOrderGate.test.ts tests/unit/transitions.test.ts`

Expected: all PASS

- [ ] **Step 2: Typecheck + lint touchpoints**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Manual checklist**

1. Create WO → header + board card show live **In shop** chip
2. Mark ready for pickup → shop chip freezes; **Pickup wait** starts
3. Header **Picked up / file…** → confirm + notes → status `completed`, appears under Complete and filed
4. Another WO: drag to **Picked up / filed** column → same confirm → card leaves board
5. Technician cannot drop onto filed; foreign-location WO has no file button

- [ ] **Step 4: Final commit if any fixes**

```bash
git add -u
git commit -m "fix: polish picked up / filed and stage timer edge cases"
```

---

## Spec coverage checklist

| Spec requirement                            | Task    |
| ------------------------------------------- | ------- |
| Header file button + confirm/notes          | 5       |
| Board filed column + confirm                | 6       |
| Reuse `completed` / Complete and filed      | 4–6     |
| Relax ready gate; block cancelled/completed | 4       |
| Overview primary path → header              | 7       |
| `canCompleteWorkOrder` only                 | 5–6     |
| In-shop + pickup timers, freeze points      | 1–3     |
| ETA + job-count aging; 24h/72h pickup       | 1       |
| Cards + header chips                        | 2–3     |
| No new DB columns                           | all     |
| Unit tests timers + transitions + gate      | 1, 4, 6 |

## Out of scope (do not implement)

- Un-file / reopen completed WOs
- Threshold settings UI / SMS alerts
- Pausing timers on hold
- Separate `picked_up` status
- Timer chips on Complete and filed list (optional later)
