# Before-Arrival Process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can book phone/calendar visits that create an appointment + draft work order, see them on a location calendar, Arrive them into intake, and absorb Wix inbound bookings onto the same path—without cluttering the live shop board.

**Architecture:** New `appointment` table is the sync/calendar entity; booking creates a linked `work_order` with `status = draft` (motorcycle nullable until Arrive). Arrive requires motorcycle, promotes WO to `open`, creates inspection, then existing intake photos/contract apply. Dashboard excludes drafts. Wix webhook refactors to appointment + draft WO (motorcycle optional). Outbound Wix push deferred (`wix_sync_status` only).

**Tech Stack:** Next.js App Router, TypeScript, Tailwind, Zod, Supabase Postgres + RLS, Vitest; extend existing `lib/services/bookings.ts` and permissions.

**Spec:** `docs/superpowers/specs/2026-07-12-before-arrival-process-design.md`

---

## File structure

```
supabase/migrations/024_appointments.sql
lib/database/types.ts                          # AppointmentStatus, AppointmentChannel, …
lib/permissions/checks.ts                      # canManageAppointments, canViewCalendar
lib/validation/schemas.ts                      # bookAppointmentSchema, …
lib/timeline/events.ts                         # appointment + booking timeline types
lib/appointments/transitions.ts                # pure status helpers
lib/services/appointments.ts                   # CRUD + arrive/cancel/noShow + list range
lib/services/bookings.ts                       # refactor Wix → appointment path
lib/services/dashboard.ts                      # exclude draft from live board
lib/services/workOrders.ts                     # createDraftFromBooking helper; nullable motorcycle
app/(app)/calendar/page.tsx
app/(app)/calendar/actions.ts
components/calendar/CalendarView.tsx
components/calendar/AppointmentPanel.tsx
components/calendar/BookAppointmentForm.tsx
components/forms/CreateWorkOrderForm.tsx       # same-day appointment prompt + optional block
components/layout/SidebarNav.tsx               # Calendar link
tests/unit/appointmentTransitions.test.ts
tests/unit/appointmentsBoardFilter.test.ts
```

---

### Task 1: Migration — appointment + draft motorcycle nullability

**Files:**
- Create: `supabase/migrations/024_appointments.sql`

- [ ] **Step 1: Write migration**

```sql
-- Before-arrival appointments + draft WO without motorcycle

ALTER TABLE work_order
  ALTER COLUMN motorcycle_id DROP NOT NULL;

ALTER TABLE work_order
  DROP CONSTRAINT IF EXISTS work_order_motorcycle_required_when_not_draft;

ALTER TABLE work_order
  ADD CONSTRAINT work_order_motorcycle_required_when_not_draft
  CHECK (
    status = 'draft'
    OR status = 'cancelled'
    OR motorcycle_id IS NOT NULL
  );

CREATE TABLE appointment (
  appointment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES location(location_id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'arrived', 'cancelled', 'no_show')),
  channel text NOT NULL
    CHECK (channel IN ('phone', 'wix', 'walk_in', 'otomoto')),
  customer_id uuid NOT NULL REFERENCES customer(customer_id) ON DELETE RESTRICT,
  motorcycle_id uuid REFERENCES motorcycle(motorcycle_id) ON DELETE SET NULL,
  reason text,
  notes text,
  wix_booking_id text,
  wix_sync_status text NOT NULL DEFAULT 'n/a'
    CHECK (wix_sync_status IN ('synced', 'not_synced', 'n/a')),
  work_order_id uuid REFERENCES work_order(work_order_id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_ends_after_starts CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX appointment_wix_booking_id_uidx
  ON appointment (wix_booking_id)
  WHERE wix_booking_id IS NOT NULL;

CREATE INDEX appointment_location_starts_idx
  ON appointment (location_id, starts_at);

CREATE INDEX appointment_status_location_idx
  ON appointment (location_id, status)
  WHERE status = 'scheduled';

CREATE INDEX appointment_customer_idx ON appointment (customer_id);

ALTER TABLE appointment ENABLE ROW LEVEL SECURITY;

-- Mirror work_order location scoping: authenticated staff read/write own locations via user_location
CREATE POLICY appointment_select_authenticated ON appointment
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_location ul
      WHERE ul.user_id = auth.uid() AND ul.location_id = appointment.location_id
    )
  );

CREATE POLICY appointment_insert_authenticated ON appointment
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_location ul
      WHERE ul.user_id = auth.uid() AND ul.location_id = appointment.location_id
    )
  );

CREATE POLICY appointment_update_authenticated ON appointment
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_location ul
      WHERE ul.user_id = auth.uid() AND ul.location_id = appointment.location_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_location ul
      WHERE ul.user_id = auth.uid() AND ul.location_id = appointment.location_id
    )
  );

-- No DELETE policy (soft cancel via status)
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db push
```

Or apply via Supabase MCP / SQL editor on the linked project. Expected: migration `024_appointments` applied; `appointment` table exists.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/024_appointments.sql
git commit -m "feat: add appointment table and nullable draft motorcycle"
```

---

### Task 2: Types, permissions, validation, timeline events

**Files:**
- Modify: `lib/database/types.ts`
- Modify: `lib/permissions/checks.ts`
- Modify: `lib/permissions/index.ts` (re-export if needed)
- Modify: `lib/validation/schemas.ts`
- Modify: `lib/timeline/events.ts`

- [ ] **Step 1: Add types**

In `lib/database/types.ts`:

```ts
export type AppointmentStatus =
  | "scheduled"
  | "arrived"
  | "cancelled"
  | "no_show";

export type AppointmentChannel = "phone" | "wix" | "walk_in" | "otomoto";

export type WixSyncStatus = "synced" | "not_synced" | "n/a";
```

- [ ] **Step 2: Permissions**

In `lib/permissions/checks.ts`:

```ts
export function canViewCalendar(role: UserRole) {
  return FRONT_OFFICE.includes(role) || role === "technician" || role === "admin";
}

export function canManageAppointments(role: UserRole) {
  return FRONT_OFFICE.includes(role) || role === "admin";
}
```

Re-export from `lib/permissions/index.ts` if that barrel lists exports explicitly.

- [ ] **Step 3: Zod schemas**

In `lib/validation/schemas.ts`:

```ts
export const bookAppointmentSchema = z.object({
  location_id: z.string().uuid(),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  channel: z.enum(["phone", "wix", "walk_in", "otomoto"]),
  customer_id: z.string().uuid().optional(),
  first_name: z.string().trim().min(1).max(80).optional(),
  last_name: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().min(7).max(40).optional(),
  email: z.string().trim().email().optional(),
  motorcycle_id: z.string().uuid().optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
}).superRefine((val, ctx) => {
  if (!val.customer_id && !val.phone && !val.email) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "customer_id or phone/email required",
    });
  }
  if (new Date(val.ends_at) <= new Date(val.starts_at)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ends_at must be after starts_at",
      path: ["ends_at"],
    });
  }
});

export const appointmentActionSchema = z.object({
  appointment_id: z.string().uuid(),
});
```

- [ ] **Step 4: Timeline events**

In `lib/timeline/events.ts` add:

```ts
  APPOINTMENT_CREATED: "Appointment Created",
  APPOINTMENT_ARRIVED: "Appointment Arrived",
  APPOINTMENT_CANCELLED: "Appointment Cancelled",
  APPOINTMENT_NO_SHOW: "Appointment No Show",
  WORK_ORDER_CREATED_FROM_BOOKING: "Work Order Created From Booking",
```

- [ ] **Step 5: Commit**

```bash
git add lib/database/types.ts lib/permissions/checks.ts lib/permissions/index.ts lib/validation/schemas.ts lib/timeline/events.ts
git commit -m "feat: types and permissions for appointments"
```

---

### Task 3: Pure transition helpers + unit tests

**Files:**
- Create: `lib/appointments/transitions.ts`
- Create: `tests/unit/appointmentTransitions.test.ts`
- Create: `tests/unit/appointmentsBoardFilter.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/appointmentTransitions.test.ts
import { describe, expect, it } from "vitest";
import {
  assertCanTransitionAppointment,
  nextWorkOrderStatusOnAppointmentEnd,
} from "@/lib/appointments/transitions";

describe("assertCanTransitionAppointment", () => {
  it("allows scheduled → arrived|cancelled|no_show", () => {
    expect(() => assertCanTransitionAppointment("scheduled", "arrived")).not.toThrow();
    expect(() => assertCanTransitionAppointment("scheduled", "cancelled")).not.toThrow();
    expect(() => assertCanTransitionAppointment("scheduled", "no_show")).not.toThrow();
  });

  it("blocks terminal → anything", () => {
    expect(() => assertCanTransitionAppointment("arrived", "cancelled")).toThrow();
    expect(() => assertCanTransitionAppointment("cancelled", "scheduled")).toThrow();
  });
});

describe("nextWorkOrderStatusOnAppointmentEnd", () => {
  it("cancels draft WO on cancel/no_show", () => {
    expect(nextWorkOrderStatusOnAppointmentEnd("cancelled")).toBe("cancelled");
    expect(nextWorkOrderStatusOnAppointmentEnd("no_show")).toBe("cancelled");
  });

  it("opens draft WO on arrive", () => {
    expect(nextWorkOrderStatusOnAppointmentEnd("arrived")).toBe("open");
  });
});
```

```ts
// tests/unit/appointmentsBoardFilter.test.ts
import { describe, expect, it } from "vitest";
import { isVisibleOnLiveShopBoard } from "@/lib/appointments/transitions";

describe("isVisibleOnLiveShopBoard", () => {
  it("hides draft work orders", () => {
    expect(isVisibleOnLiveShopBoard("draft")).toBe(false);
  });

  it("shows open and later active statuses", () => {
    expect(isVisibleOnLiveShopBoard("open")).toBe(true);
    expect(isVisibleOnLiveShopBoard("in_progress")).toBe(true);
  });

  it("hides completed and cancelled", () => {
    expect(isVisibleOnLiveShopBoard("completed")).toBe(false);
    expect(isVisibleOnLiveShopBoard("cancelled")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/unit/appointmentTransitions.test.ts tests/unit/appointmentsBoardFilter.test.ts
```

Expected: FAIL module not found / exports missing.

- [ ] **Step 3: Implement helpers**

```ts
// lib/appointments/transitions.ts
import type { AppointmentStatus, WorkOrderStatus } from "@/lib/database/types";

const FROM_SCHEDULED: AppointmentStatus[] = ["arrived", "cancelled", "no_show"];

export function assertCanTransitionAppointment(
  from: AppointmentStatus | string,
  to: AppointmentStatus | string
) {
  if (from !== "scheduled" || !FROM_SCHEDULED.includes(to as AppointmentStatus)) {
    throw new Error("INVALID_APPOINTMENT_TRANSITION");
  }
}

export function nextWorkOrderStatusOnAppointmentEnd(
  appointmentStatus: Extract<AppointmentStatus, "arrived" | "cancelled" | "no_show">
): Extract<WorkOrderStatus, "open" | "cancelled"> {
  if (appointmentStatus === "arrived") return "open";
  return "cancelled";
}

const LIVE: WorkOrderStatus[] = [
  "open",
  "inspection_in_progress",
  "waiting_for_customer_approval",
  "waiting_for_parts",
  "ready_for_technician",
  "in_progress",
  "quality_check",
  "ready_for_pickup",
  "on_hold",
];

export function isVisibleOnLiveShopBoard(status: WorkOrderStatus | string): boolean {
  return LIVE.includes(status as WorkOrderStatus);
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run tests/unit/appointmentTransitions.test.ts tests/unit/appointmentsBoardFilter.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/appointments/transitions.ts tests/unit/appointmentTransitions.test.ts tests/unit/appointmentsBoardFilter.test.ts
git commit -m "feat: appointment transition helpers and board visibility"
```

---

### Task 4: Appointments service — book, list, arrive, cancel, no-show

**Files:**
- Create: `lib/services/appointments.ts`
- Modify: `lib/services/errors.ts` (add error codes if that file centralizes messages)
- Modify: `lib/services/workOrders.ts` (export shared draft-create + ensureInspection helpers if cleaner; otherwise keep helpers private in appointments.ts)

- [ ] **Step 1: Implement `lib/services/appointments.ts`**

Core responsibilities (full implementation in file):

1. `findOrCreateCustomerForBooking({ customer_id?, first_name?, last_name?, phone?, email? })` — match phone then email (ilike), else create (require phone or email).
2. `createDraftWorkOrderForAppointment({ customer_id, motorcycle_id | null, location_id, reason, source, scheduled_at, wix_booking_id?, created_by_user_id })` — mint number, insert WO `status: "draft"`, **no inspection**, set `source` (`phone` | `wix_booking` | `walk_in` | `other`), timeline `WORK_ORDER_CREATED_FROM_BOOKING`, audit.
3. `bookAppointment(input)` — `canManageAppointments`; `bookAppointmentSchema`; location = active location; create customer if needed; insert appointment (`wix_sync_status`: `not_synced` for phone/otomoto, `synced` for wix, `n/a` for walk_in); create draft WO; set `appointment.work_order_id`; timeline on WO; return `{ appointment_id, work_order_id, work_order_number }`.
4. `listAppointmentsForRange({ location_id, from, to })` — `canViewCalendar`; filter location + `starts_at` overlap; join customer/motorcycle/WO number for UI.
5. `arriveAppointment(appointment_id)` — `canManageAppointments`; load appointment; `assertCanTransitionAppointment(scheduled→arrived)`; if `!motorcycle_id` throw `MOTORCYCLE_REQUIRED_FOR_ARRIVAL`; update appointment; update WO `status=open`, set `motorcycle_id` from appointment if needed; **create inspection + template results** (copy pattern from `createWorkOrder` / old `bookings.ts`); timeline `APPOINTMENT_ARRIVED` + status change; audit; return `{ work_order_id }` for redirect.
6. `cancelAppointment` / `noShowAppointment` — transition; set WO `cancelled` if still draft (or always if linked and not completed); timeline + audit.

Default slot length when UI only sends start: **60 minutes** (`ends_at = starts_at + 60m`) — form may also send ends.

Pseudo for arrive inspection create (mirror existing):

```ts
async function ensureInspectionForWorkOrder(supabase, workOrderId: string, userId: string | null) {
  const { data: existing } = await supabase
    .from("inspection")
    .select("inspection_id")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (existing) return existing.inspection_id;

  const { data: inspection, error } = await supabase
    .from("inspection")
    .insert({ work_order_id: workOrderId })
    .select("inspection_id")
    .single();
  if (error) throw error;

  const { data: templateItems } = await supabase
    .from("inspection_template_item")
    .select("template_item_id, category, item_name, display_order, requires_measurement")
    .eq("active", true)
    .order("display_order");

  if ((templateItems ?? []).length > 0) {
    await supabase.from("inspection_result").insert(
      (templateItems ?? []).map((item) => ({
        inspection_id: inspection.inspection_id,
        template_item_id: item.template_item_id,
        category_snapshot: item.category,
        item_name_snapshot: item.item_name,
        display_order_snapshot: item.display_order,
        requires_measurement_snapshot: item.requires_measurement,
      }))
    );
  }

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: userId,
    event_type: TimelineEventType.INSPECTION_CREATED,
    entity_type: "inspection",
    entity_id: inspection.inspection_id,
    description: "Inspection created on arrival",
  });

  return inspection.inspection_id;
}
```

Foreign-location writes: if `appointment.location_id !== user.active_location_id` throw `LOCATION_MISMATCH` (same as WO).

- [ ] **Step 2: Smoke via unit-free compile**

```bash
npx tsc --noEmit
```

Expected: no type errors in new service (or fix until clean).

- [ ] **Step 3: Commit**

```bash
git add lib/services/appointments.ts lib/services/workOrders.ts lib/services/errors.ts
git commit -m "feat: appointments service book arrive cancel no-show"
```

---

### Task 5: Hide drafts on live shop board

**Files:**
- Modify: `lib/services/dashboard.ts`
- Modify: `tests/unit/pipeline.test.ts` only if pipeline indexes draft specially — leave pipeline stage for draft if used elsewhere

- [ ] **Step 1: Update ACTIVE_STATUSES**

In `lib/services/dashboard.ts`, remove `"draft"` from `ACTIVE_STATUSES` so scheduled bookings do not appear on Dashboard/ShopBoard. Prefer importing `isVisibleOnLiveShopBoard` if the filter is applied in JS after fetch; if query uses `.in("status", ACTIVE_STATUSES)`, update the constant:

```ts
const ACTIVE_STATUSES: WorkOrderStatus[] = [
  "open",
  "inspection_in_progress",
  "waiting_for_customer_approval",
  "waiting_for_parts",
  "ready_for_technician",
  "in_progress",
  "quality_check",
  "ready_for_pickup",
  "on_hold",
];
```

Also exclude draft from any status filter chips that imply “on the floor” if they currently list draft as default-visible.

- [ ] **Step 2: Run dashboard-related tests**

```bash
npx vitest run tests/unit/pipeline.test.ts tests/unit/flags.test.ts
```

Expected: PASS (or update expectations if a test assumed draft on board).

- [ ] **Step 3: Commit**

```bash
git add lib/services/dashboard.ts
git commit -m "fix: hide draft work orders from live shop board"
```

---

### Task 6: Refactor Wix webhook → appointment + draft WO

**Files:**
- Modify: `lib/services/bookings.ts`
- Modify: `app/api/wix/webhooks/bookings/route.ts` (only if response shape changes)

- [ ] **Step 1: Rewrite `processWixBookingWebhook`**

Idempotency order:

1. Look up `appointment` by `wix_booking_id` — if found, return existing `work_order_id` / numbers (`created: false`).
2. Else look up legacy `work_order.wix_booking_id` for pre-migration rows — return those without creating appointment (or backfill appointment in a follow-up; do not duplicate WO).
3. Else `getWixBooking`, find/create customer, find motorcycle **optional** (null OK).
4. Call shared draft WO create with `source: "wix_booking"`, `status: "draft"`, no inspection.
5. Insert appointment: `channel: "wix"`, `wix_sync_status: "synced"`, `starts_at` from booking (default ends +60m), link WO.
6. Timeline + audit.

Remove hard throw `BOOKING_MOTORCYCLE_REQUIRED`.

- [ ] **Step 2: Keep webhook route response compatible**

```ts
{ ok: true, work_order_id, work_order_number, customer_id, created, appointment_id? }
```

- [ ] **Step 3: Commit**

```bash
git add lib/services/bookings.ts app/api/wix/webhooks/bookings/route.ts
git commit -m "feat: Wix bookings create appointment and draft WO"
```

---

### Task 7: Calendar UI + server actions

**Files:**
- Create: `app/(app)/calendar/page.tsx`
- Create: `app/(app)/calendar/actions.ts`
- Create: `components/calendar/CalendarView.tsx`
- Create: `components/calendar/AppointmentPanel.tsx`
- Create: `components/calendar/BookAppointmentForm.tsx`
- Modify: `components/layout/SidebarNav.tsx`
- Modify: `app/globals.css` (calendar layout primitives — minimal, match existing tokens)

- [ ] **Step 1: Server actions**

```ts
// app/(app)/calendar/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  arriveAppointment,
  bookAppointment,
  cancelAppointment,
  noShowAppointment,
} from "@/lib/services/appointments";

export async function bookAppointmentAction(formData: FormData) {
  // parse fields → bookAppointment → revalidatePath("/calendar")
}

export async function arriveAppointmentAction(formData: FormData) {
  const appointment_id = String(formData.get("appointment_id") ?? "");
  const { work_order_id } = await arriveAppointment(appointment_id);
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  redirect(`/work_orders/${work_order_id}`);
}

export async function cancelAppointmentAction(formData: FormData) { /* … */ }
export async function noShowAppointmentAction(formData: FormData) { /* … */ }
```

- [ ] **Step 2: Calendar page**

- Auth via `(app)/layout`; `canViewCalendar` else redirect dashboard.
- Query params `?date=YYYY-MM-DD&view=day|week` (default day = today).
- Load `listAppointmentsForRange` for active location.
- Render `CalendarView` + “Book” opens `BookAppointmentForm` (phone/otomoto channel).
- Selecting an appointment opens `AppointmentPanel` with customer, bike, reason, linked WO link, Arrive / Cancel / No-show (hide mutate buttons if `!canManageAppointments` — technicians read-only).

Day view: vertical time column 7:00–19:00, blocks positioned by start/end. Week view: 7 columns. Keep Safari-friendly (no exotic DnD required for v1).

- [ ] **Step 3: Book form**

Fields: first/last or existing customer search (reuse customer search patterns if available), phone, email, optional motorcycle select for customer, reason, start datetime-local, duration select (60 default). Channel hidden = `phone` from phone CTA, `otomoto` from calendar Book.

- [ ] **Step 4: Nav**

In `SidebarNav` `buildPrimaryLinks`, after Dashboard:

```ts
{ href: "/calendar", label: "Calendar" },
```

- [ ] **Step 5: Commit**

```bash
git add app/(app)/calendar components/calendar components/layout/SidebarNav.tsx app/globals.css
git commit -m "feat: calendar UI for appointments and phone booking"
```

---

### Task 8: Walk-in — same-day appointment prompt + optional calendar block

**Files:**
- Modify: `components/forms/CreateWorkOrderForm.tsx`
- Modify: `app/(app)/work_orders/` create actions as needed
- Modify: `lib/services/appointments.ts` — add `listScheduledForCustomerOnDay(customer_id, location_id, day)` and `createWalkInCalendarBlock({ work_order_id, customer_id, motorcycle_id, location_id, starts_at? })`

- [ ] **Step 1: Before create, check same-day scheduled appointments**

When customer selected on create-WO wizard, call a small server action / preload:

```ts
listScheduledForCustomerOnDay(customerId, locationId, today)
```

If results length > 0, show banner:

> This customer has a scheduled visit today (WO-…). Open existing draft instead of creating another?

Link to `/work_orders/{id}` or Arrive CTA.

- [ ] **Step 2: Optional same-day calendar block**

After successful walk-in `createWorkOrder`, checkbox “Show on calendar today” (default off). If checked, insert appointment `channel: walk_in`, `status: arrived` (already here), `wix_sync_status: n/a`, link the new WO, `starts_at = now` truncated to 30m, `ends_at +60m`.

- [ ] **Step 3: Commit**

```bash
git add components/forms/CreateWorkOrderForm.tsx lib/services/appointments.ts app/(app)/work_orders
git commit -m "feat: walk-in same-day appointment prompt and calendar block"
```

---

### Task 9: WO detail — draft booking banner + motorcycle gate

**Files:**
- Modify: `components/work_orders/WorkOrderHeader.tsx` and/or `OverviewTab.tsx`
- Modify: `app/(app)/work_orders/[work_order_id]/page.tsx` (load linked appointment)

- [ ] **Step 1: When WO status is draft**

Show banner: “Scheduled booking — not on shop floor until Arrive.” Link to `/calendar?date=…`. If linked appointment `scheduled`, show **Arrive** button (calls `arriveAppointmentAction`). If `motorcycle_id` null, Arrive disabled with “Add motorcycle first” + link to attach bike (use existing motorcycle create/link patterns on customer).

- [ ] **Step 2: Commit**

```bash
git add components/work_orders app/(app)/work_orders/[work_order_id]/page.tsx
git commit -m "feat: draft booking banner and arrive from work order"
```

---

### Task 10: Verify

- [ ] **Step 1: Unit tests**

```bash
npm test
```

Expected: all PASS including new appointment tests.

- [ ] **Step 2: Typecheck / lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: clean (or only pre-existing unrelated warnings).

- [ ] **Step 3: Manual smoke (local or preview)**

1. Calendar → Book phone visit → appointment + draft WO; Dashboard does not show draft.  
2. Arrive → redirects to WO; inspection exists; WO on board as open.  
3. Cancel scheduled → WO cancelled; gone from calendar active list.  
4. Simulate Wix webhook twice → one appointment/WO.  
5. Walk-in same day as appointment → prompt shows.

- [ ] **Step 4: Final commit if smoke fixes needed**

```bash
git commit -m "fix: before-arrival smoke fixes"
```

---

## Self-review

| Spec requirement | Task |
|------------------|------|
| Appointment table + fields | 1 |
| Draft WO at book; motorcycle optional | 1, 4 |
| Arrive → open + inspection; motorcycle required | 4, 9 |
| Cancel / no-show → cancel draft WO | 4 |
| Calendar day/week + book + panel actions | 7 |
| Phone book form | 7 |
| Wix inbound idempotent; motorcycle optional | 6 |
| Hide drafts from live board | 3, 5 |
| Walk-in prompt + optional block | 8 |
| Permissions (tech read-only calendar) | 2, 7 |
| Wix outbound deferred (`wix_sync_status`) | 1, 4, 6 |

No TBD placeholders. Outbound Wix push intentionally omitted (companion spec).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-12-before-arrival-process.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with executing-plans checkpoints  

**Which approach?**
