# Tech Job Packet + Floor Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Floor techs never see the 11-tab office work-order page; context lives in an in-floor Job packet; floor lag from blind 60s refresh and duplicate home fetches is removed.

**Architecture:** Shared `techJobPacketHref` / redirect helpers; `JobPacketPanel` on `/technician?panel=packet` with lazy photo loading; floor-tech early redirect on `/work_orders/[id]`; floor shell refreshes only on tab focus; home page skips overlapping floor+docket fetches.

**Tech Stack:** Next.js App Router (RSC + client shell), Supabase server clients, Vitest, existing floor/note/photo server actions.

## Global Constraints

- Domain rules unchanged: complete gate, peer QC, safety, flags, `deriveWorkOrderStatus`.
- Floor lock applies when `isFloorTech(role)` is true (`technician`, `head_tech`).
- Front-office `/work_orders/[id]` tabs stay as they are for non-floor roles.
- Primary client: Safari iPad landscape; tap targets ≥44px.
- Do not commit unless the user explicitly asks (ignore “Commit” steps until then; still mark work done).

**Spec:** [docs/superpowers/specs/2026-07-16-tech-job-packet-floor-lock-design.md](../specs/2026-07-16-tech-job-packet-floor-lock-design.md)

---

## File structure

| File                                             | Responsibility                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `lib/technician/assignmentHref.ts`               | `techJobPacketHref`, `floorTechWorkOrderRedirect`                      |
| `lib/services/jobPacket.ts`                      | `getJobPacket(workOrderId)` — header, jobs, notes; photos deferred     |
| `components/technician/JobPacketPanel.tsx`       | Packet UI + lazy photo section                                         |
| `components/technician/TechnicianFloorShell.tsx` | Panel routing, hide dock, visibility refresh, link rewires             |
| `app/(app)/technician/page.tsx`                  | `panel` / `packetSection` params; fetch strategy                       |
| `app/(app)/work_orders/[work_order_id]/page.tsx` | Floor-tech redirect before heavy loads                                 |
| `lib/services/technicianFloor.ts`                | `overview_href` → packet href                                          |
| `lib/services/technicianDocket.ts`               | `overview_href` → packet href                                          |
| `lib/services/readyForPickup.ts`                 | Optional `hrefFor` already exists — callers pass packet href for floor |
| `tests/unit/techJobPacketHref.test.ts`           | Href + redirect mapping                                                |
| `tests/unit/floorOsUx.test.ts`                   | Update `overview_href` fixtures if needed                              |

---

### Task 1: Href helpers + unit tests

**Files:**

- Modify: `lib/technician/assignmentHref.ts`
- Create: `tests/unit/techJobPacketHref.test.ts`

**Interfaces:**

- Produces:
  - `techJobPacketHref(workOrderId: string, options?: { jobId?: string; section?: "notes" | "photos" | "jobs" }): string`
  - `floorTechWorkOrderRedirect(workOrderId: string, tab?: string): string` — maps office tabs to floor/packet/inspection

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  techJobPacketHref,
  floorTechWorkOrderRedirect,
} from "@/lib/technician/assignmentHref";

describe("techJobPacketHref", () => {
  it("builds packet URL with encoded wo", () => {
    expect(techJobPacketHref("wo/1")).toBe("/technician?wo=wo%2F1&panel=packet");
  });

  it("includes job and section when provided", () => {
    expect(techJobPacketHref("w1", { jobId: "j1", section: "notes" })).toBe(
      "/technician?wo=w1&panel=packet&job=j1&packetSection=notes"
    );
  });
});

describe("floorTechWorkOrderRedirect", () => {
  it("sends inspection tab to inspection with returnTo floor", () => {
    expect(floorTechWorkOrderRedirect("w1", "inspection")).toBe(
      "/work_orders/w1/inspection?returnTo=%2Ftechnician%3Fwo%3Dw1"
    );
  });

  it("maps notes tab to packet notes section", () => {
    expect(floorTechWorkOrderRedirect("w1", "notes")).toBe(
      "/technician?wo=w1&panel=packet&packetSection=notes"
    );
  });

  it("maps photos tab to packet photos section", () => {
    expect(floorTechWorkOrderRedirect("w1", "photos")).toBe(
      "/technician?wo=w1&panel=packet&packetSection=photos"
    );
  });

  it("defaults other tabs to packet", () => {
    expect(floorTechWorkOrderRedirect("w1", "overview")).toBe(
      "/technician?wo=w1&panel=packet"
    );
    expect(floorTechWorkOrderRedirect("w1")).toBe("/technician?wo=w1&panel=packet");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/techJobPacketHref.test.ts`  
Expected: FAIL — exports missing

- [ ] **Step 3: Implement helpers**

```ts
// lib/technician/assignmentHref.ts
export function staffAssignmentHref(workOrderId: string): string {
  return `/technician?wo=${encodeURIComponent(workOrderId)}`;
}

export type JobPacketSection = "notes" | "photos" | "jobs";

export function techJobPacketHref(
  workOrderId: string,
  options?: { jobId?: string; section?: JobPacketSection }
): string {
  const params = new URLSearchParams();
  params.set("wo", workOrderId);
  params.set("panel", "packet");
  if (options?.jobId) params.set("job", options.jobId);
  if (options?.section) params.set("packetSection", options.section);
  return `/technician?${params.toString()}`;
}

export function floorTechWorkOrderRedirect(workOrderId: string, tab?: string): string {
  if (tab === "inspection") {
    const returnTo = `/technician?wo=${encodeURIComponent(workOrderId)}`;
    return `/work_orders/${encodeURIComponent(workOrderId)}/inspection?returnTo=${encodeURIComponent(returnTo)}`;
  }
  if (tab === "notes" || tab === "photos") {
    return techJobPacketHref(workOrderId, { section: tab });
  }
  return techJobPacketHref(workOrderId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/techJobPacketHref.test.ts`  
Expected: PASS

---

### Task 2: Floor-tech redirect on work-order detail

**Files:**

- Modify: `app/(app)/work_orders/[work_order_id]/page.tsx`
- Modify: `app/(app)/work_orders/[work_order_id]/contract/page.tsx` (if it exists as a separate page — redirect floor techs to packet; otherwise skip)

**Interfaces:**

- Consumes: `floorTechWorkOrderRedirect`, `isFloorTech`

- [ ] **Step 1: Redirect before `getWorkOrderDetail`**

Immediately after `getCurrentAppUser()` / login check in `WorkOrderDetailPage`:

```ts
import { floorTechWorkOrderRedirect } from "@/lib/technician/assignmentHref";

// after user loaded and work_order_id / tab known:
if (isFloorTech(user.role)) {
  redirect(floorTechWorkOrderRedirect(work_order_id, tabParam));
}
```

Place this **before** `getWorkOrderDetail` so floor techs never pay for the heavy fan-out.

Remove or leave dead the “← Tech floor” back link branch for floor techs (unreachable after redirect). Prefer leaving `isFloorTech` back-link code — harmless.

- [ ] **Step 2: Contract route**

If `app/(app)/work_orders/[work_order_id]/contract/page.tsx` exists, add the same `isFloorTech` → `techJobPacketHref(id)` redirect at the top.

- [ ] **Step 3: Manual sanity**

As a floor tech session (or by reading the guard): opening `/work_orders/{id}` must not render `WorkOrderTabs`.

---

### Task 3: Point tech `overview_href` at the packet

**Files:**

- Modify: `lib/services/technicianFloor.ts` — set `overview_href: techJobPacketHref(wo.work_order_id)` (both surface builders ~620 and ~744)
- Modify: `lib/services/technicianDocket.ts` — same for every `overview_href:`
- Modify: `lib/services/technician.ts` — same if still used by any tech UI
- Modify: `app/(app)/technician/page.tsx` or `ReadyForPickupCarousel` callers — pass `hrefFor: (id) => techJobPacketHref(id)` into `listReadyForPickup` if the API supports it; else map items after fetch

**Interfaces:**

- Consumes: `techJobPacketHref`
- Keep field name `overview_href` for fewer call-site churns; value is now the packet URL for tech-produced rows.

- [ ] **Step 1: Replace string templates**

Replace `` `/work_orders/${id}` `` assignments to `overview_href` in the files above with `techJobPacketHref(id)`.

- [ ] **Step 2: Ready-for-pickup**

In `listReadyForPickup` call sites used by `technician/page.tsx`:

```ts
listReadyForPickup().catch(() => []);
// become, if hrefFor supported:
listReadyForPickup({ hrefFor: (id) => techJobPacketHref(id) }).catch(() => []);
```

Read `readyForPickup.ts` — if `listReadyForPickup` does not accept options, add an optional `hrefFor` param mirroring `listWaitingStageBikes`, defaulting to `` `/work_orders/${id}` `` for Control Center / office callers.

- [ ] **Step 3: Update floor UX fixture**

In `tests/unit/floorOsUx.test.ts`, set `overview_href` to a packet-shaped string if any test asserts on it (currently `"/y"` — leave unless assertions break).

- [ ] **Step 4: Run unit tests**

Run: `npx vitest run tests/unit/floorOsUx.test.ts tests/unit/techJobPacketHref.test.ts`  
Expected: PASS

---

### Task 4: Job packet data loader

**Files:**

- Create: `lib/services/jobPacket.ts`
- Create: `tests/unit/jobPacketAccess.test.ts` (pure access helper if extracted; otherwise test redirect only and smoke the loader shape)

**Interfaces:**

- Produces:

```ts
export type JobPacketJob = {
  job_id: string;
  service_name: string;
  status: JobStatus;
  status_label: string;
  assigned_technician_id: string | null;
  assigned_to_me: boolean;
  floor_href: string; // /technician?wo=&job=
};

export type JobPacket = {
  work_order_id: string;
  work_order_number: string;
  wo_status: WorkOrderStatus;
  wo_status_label: string;
  motorcycle_label: string;
  jobs: JobPacketJob[];
  notes: TechnicianNote[];
  /** Intentionally empty — photos load in a separate client/server action when section opens */
};

export async function getJobPacket(workOrderId: string): Promise<JobPacket | null>;
```

- [ ] **Step 1: Implement `getJobPacket`**

Reuse patterns from `getWorkOrderDetail` / floor surface:

1. `requireUser()`; reject if `!canViewerAccessWorkOrder` for floor tech.
2. Load WO + motorcycle + non-cancelled jobs (id, service name, status, assignee).
3. `listTechnicianNotes(workOrderId)`.
4. Do **not** call `listIntakePhotos` here.
5. Build `floor_href` via `staffAssignmentHref` + `job` query param:

```ts
function jobFloorHref(workOrderId: string, jobId: string): string {
  const params = new URLSearchParams();
  params.set("wo", workOrderId);
  params.set("job", jobId);
  return `/technician?${params.toString()}`;
}
```

- [ ] **Step 2: Wire page fetch**

In `technician/page.tsx`, when `panel === "packet"` and `wo` present:

```ts
const packet =
  params.panel === "packet" && params.wo
    ? await getJobPacket(params.wo).catch(() => null)
    : null;
```

Pass `packet` + `packetSection` into `TechnicianFloorShell`.

---

### Task 5: JobPacketPanel UI + shell integration

**Files:**

- Create: `components/technician/JobPacketPanel.tsx`
- Modify: `components/technician/TechnicianFloorShell.tsx`
- Modify: `app/(app)/technician/page.tsx` (searchParams typing)
- Modify: `app/globals.css` only if existing `.floor-*` classes need a packet overlay (prefer reuse)

**Interfaces:**

- Consumes: `JobPacket`, `addTechnicianNoteAction`, photo list action
- Shell props add: `packet: JobPacket | null`, `panel: "packet" | null`, `packetSection: JobPacketSection | null`

- [ ] **Step 1: Build `JobPacketPanel`**

Structure:

1. Header: bike, WO number, status
2. Jobs list — `Link` to `job.floor_href` (closes packet by omitting `panel`)
3. Notes — reuse `TechnicianNotes` with `addTechnicianNoteAction.bind(null, workOrderId)` and jobs mapped to the shape `TechnicianNotes` expects (`WorkOrderJob[]` minimal fields: `job_id`, `service_name_snapshot` or whatever the type requires — read `WorkOrderJob` and map)
4. Photos — client subsection that calls a small server action or loads via `<JobPacketPhotos workOrderId={...} />` which is an async server child only rendered when `packetSection === "photos"` **or** when the photos `<details>` is opened via a nested server Component with suspense. Simplest approach matching spec: always show a “Load photos” button that navigates to `?panel=packet&packetSection=photos`, and when that section is active the page passes `photos` from `listIntakePhotos` + proof query **only then**.
5. Footer: `Link` “Back to job” → `/technician?wo=&job=&stage=` (no panel)

- [ ] **Step 2: Shell behavior when `panel === "packet"`**

```tsx
{panel === "packet" && packet ? (
  <JobPacketPanel
    packet={packet}
    section={packetSection}
    closeHref={closePacketHref} // computed from selected / wo+job+stage
  />
) : (
  // existing stage body + StickyDock
)}
```

Hide `StickyDock` while packet is open. Keep docket aside visible.

- [ ] **Step 3: Rewire copy/links in stages**

- DoneStage “Open notes” → `techJobPacketHref(surface.work_order_id, { jobId: surface.job_id ?? undefined, section: "notes" })`
- QcStage overview link → packet href
- Flag banner “View on overview” → packet href (or remove if `overview_href` already packet)

- [ ] **Step 4: Page searchParams**

Extend:

```ts
searchParams: Promise<{
  job?: string;
  wo?: string;
  mode?: string;
  stage?: string;
  panel?: string;
  packetSection?: string;
}>;
```

---

### Task 6: Lag fixes — refresh + home fetch

**Files:**

- Modify: `components/technician/TechnicianFloorShell.tsx`
- Modify: `app/(app)/technician/page.tsx`

- [ ] **Step 1: Replace 60s interval with visibility refresh**

Remove `FLOOR_REFRESH_MS` interval. Use:

```tsx
useEffect(() => {
  const onVis = () => {
    if (document.visibilityState === "visible") {
      routerRef.current.refresh();
    }
  };
  document.addEventListener("visibilitychange", onVis);
  return () => document.removeEventListener("visibilitychange", onVis);
}, []);
```

Do not refresh on every mount beyond the initial RSC render.

- [ ] **Step 2: Skip floor OS when idle**

In `technician/page.tsx`:

```ts
const hasSelection = Boolean(params.job || params.wo);

const [floor, docket, readyForPickup, packet] = await Promise.all([
  hasSelection
    ? getTechnicianFloorOs({
        jobId: params.job ?? null,
        workOrderId: params.wo ?? null,
        mode: modeForFetch(requestedStage),
      })
    : Promise.resolve(emptyFloorOs()), // { priority:[], readyToPull:[], needsQc:[], safeties:[], flagged:[], selected: null }
  getTechnicianDocket(user.user_id).catch(() => null), // only when isFloorTech / assigner viewing
  listReadyForPickup({ hrefFor: (id) => techJobPacketHref(id) }).catch(() => []),
  params.panel === "packet" && params.wo
    ? getJobPacket(params.wo).catch(() => null)
    : Promise.resolve(null),
]);
```

Export or inline `emptyFloorOs()` next to the floor service.

When `hasSelection` is true, **still** load docket for “My motorcycles” (ordering UX). Accept remaining overlap only while a job is open — idle home no longer double-fetches floor lanes + docket.

- [ ] **Step 3: Photos only with packetSection=photos**

In page:

```ts
const photos =
  params.panel === "packet" && params.packetSection === "photos" && params.wo
    ? await listIntakePhotos(params.wo).catch(() => [])
    : [];
```

Pass into panel. Proof photos: query `intake_photo` / existing proof list helper used by floor surface if available; otherwise show intake first and proof count from packet jobs later — minimum is intake lazy-load.

---

### Task 7: Verification

**Files:** none (manual + automated)

- [ ] **Step 1: Unit suite**

Run:

```bash
npx vitest run tests/unit/techJobPacketHref.test.ts tests/unit/floorOsUx.test.ts
```

Expected: PASS

- [ ] **Step 2: Manual checklist (iPad or desktop)**

1. Floor tech: open `/work_orders/{assignedId}` → lands on packet, no tabs.
2. Done → Open notes → packet notes; Back to job → stage dock returns.
3. Open photos section → photos load; other packet views do not request signed URLs.
4. Leave tab in background 2+ minutes, return → at most one refresh on focus; no 60s churn while focused.
5. Front office: `/work_orders/{id}` still shows 11 tabs.
6. Start / Complete / Flag / Pass QC still work from dock with packet closed.

---

## Spec coverage (self-review)

| Spec requirement             | Task                                |
| ---------------------------- | ----------------------------------- |
| Floor-only home              | 2, 5                                |
| Job packet contents          | 4, 5                                |
| Redirect `/work_orders/[id]` | 2                                   |
| Inspection still fullscreen  | 1 (`floorTechWorkOrderRedirect`), 2 |
| Replace escape links         | 3, 5                                |
| Stop 60s refresh             | 6                                   |
| Dedupe idle home fetch       | 6                                   |
| Lazy photos                  | 4, 5, 6                             |
| Domain rules unchanged       | All (no status/gate edits)          |
| Front office unchanged       | 2 (redirect only for `isFloorTech`) |
