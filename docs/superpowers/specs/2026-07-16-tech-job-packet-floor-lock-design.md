# Tech job packet + floor lock design

**Date:** 2026-07-16  
**Status:** Approved  
**Parents:** [2026-07-12-technician-floor-os-design.md](./2026-07-12-technician-floor-os-design.md), [2026-07-13-technician-floor-os-ux-polish-design.md](./2026-07-13-technician-floor-os-ux-polish-design.md)  
**Approach:** B+C merge — floor-only workspace + in-floor Job packet + lag fixes

## Goal

Make the technician experience one coherent shop-floor product: **Tech floor is home**, job work stays on Inspect → Work → Proof → Done, and any “more context” escape hatch is a **Job packet** on the floor — never the 11-tab office work-order page. Fix lag that makes the floor feel jumpy while working.

Primary client: Safari on iPad (landscape). Desktop remains usable.

## Problem

1. Dual UIs — Floor OS vs full `/work_orders/[id]` with 11 tabs (Contract, Messages, Service Info, billing chrome, etc.).
2. Escape links (“Open notes”, “Open work order overview”, docket/pickup `overview_href`) dump techs into office chrome mid-job.
3. Lag — 60s full `router.refresh()` on the floor, overlapping floor/docket/pickup fetches, heavy WO detail (always signed intake photos) when techs do land there.

## Decisions

| Topic          | Choice                                                         |
| -------------- | -------------------------------------------------------------- |
| Tech home      | `/technician` only for floor techs (`technician`, `head_tech`) |
| Escape hatch   | **Job packet** panel on floor (`?panel=packet`)                |
| Office WO page | Floor techs **redirected** away from `/work_orders/[id]`       |
| Inspection     | Fullscreen `/inspection` kept; always `returnTo` floor         |
| Domain rules   | Unchanged (gates, peer QC, safety, flags, status engine)       |
| Front office   | Full tabbed WO page unchanged                                  |

## Tech surfaces

```
Clock / docket
  → /technician (queue + stage rail + sticky dock)
       → Job packet panel (notes, photos, sibling jobs)
       → /work_orders/[id]/inspection?returnTo=/technician...
  ✗  /work_orders/[id]?tab=*  (redirect → floor + packet when relevant)
```

| Surface                       | Who                                                            | Purpose                                          |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `/technician`                 | Floor techs + assigners viewing floor                          | Queue, stages, dock, packet                      |
| Job packet                    | Floor techs                                                    | Single-scroll context without leaving floor      |
| `/work_orders/.../inspection` | Anyone with access                                             | Fullscreen inspection; return to floor for techs |
| `/work_orders/[id]`           | Front office / managers / roles that are not floor-tech-locked | Existing 11-tab office UI                        |

`isFloorTech(role)` defines the lock (same helper as today).

## Job packet

### URL

`/technician?wo={workOrderId}&panel=packet`  
Optional: `&job={jobId}` to keep the same selected job under the packet.  
Optional: `&packetSection=notes|photos|jobs` to scroll/focus a section (default: top).

Closing the packet returns to `/technician?wo=…&job=…&stage=…` (preserve stage when known).

### Contents (read/act for tech)

1. **Header** — motorcycle label, WO number, visit status chip
2. **Jobs on this visit** — sibling jobs (name, status, assignee); tap assigned/own job → close packet and open that job on the floor
3. **Notes** — existing technician notes list + add-note form (reuse `TechnicianNotes` / note actions)
4. **Photos** — intake + job proof thumbnails; load **signed URLs only when packet opens** (lazy)
5. **Footer** — “Back to job” (closes packet)

### Explicitly excluded

Contract, Messages, Service Info, Square/billing, hold/cancel/assign/primary/QC admin forms, recommendation convert, parts pricing.

### Entry points (replace office deep links)

| Current                                                | New                                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Done stage “Open notes” → `overview?tab=notes`         | Open packet (`packetSection=notes`)                                                            |
| QC “Open work order overview”                          | Open packet                                                                                    |
| Floor header muted WO link → `overview_href`           | Open packet                                                                                    |
| Docket `overview_href` when tech is on floor           | Floor href / packet (docket cards already have `href` for floor — prefer that for floor techs) |
| Ready-for-pickup carousel → `overview_href`            | For floor techs: `/technician?wo=…&panel=packet`                                               |
| Any bookmark/link to `/work_orders/{id}` by floor tech | Server redirect to floor (+ packet when `tab` is notes/photos/overview/jobs)                   |

## Floor lock (redirect)

On [`app/(app)/work_orders/[work_order_id]/page.tsx`](<../../app/(app)/work_orders/[work_order_id]/page.tsx>):

- After auth, if `isFloorTech(user.role)` → `redirect` to  
  `/technician?wo={id}&panel=packet`  
  (map `tab=notes|photos` → `packetSection`; `tab=inspection` → inspection route with `returnTo` floor instead of packet).

Do **not** redirect:

- `/work_orders/[id]/inspection` (still needed fullscreen)
- `/work_orders/[id]/contract` (floor techs should not need this; if hit, redirect to floor)

Update `overview_href` producers used by tech surfaces so they stop pointing at `/work_orders/{id}` for floor consumers:

- [`lib/services/technicianFloor.ts`](../../lib/services/technicianFloor.ts) → packet href
- [`lib/services/technicianDocket.ts`](../../lib/services/technicianDocket.ts) → packet or floor `href`
- [`lib/services/readyForPickup.ts`](../../lib/services/readyForPickup.ts) / carousel callers → packet for floor context
- [`lib/services/technician.ts`](../../lib/services/technician.ts) if still used by tech UI

Prefer a shared helper, e.g. `techJobPacketHref(workOrderId, options?)` in `lib/technician/assignmentHref.ts` (alongside `staffAssignmentHref`).

## Performance

| Change                      | Detail                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stop 60s blind refresh      | Remove `FLOOR_REFRESH_MS` interval `router.refresh()` in `TechnicianFloorShell`. Refresh on `visibilitychange` when document becomes visible, and rely on existing post-action redirects/`revalidatePath`.                                                                                                                                                               |
| Dedupe home fetches         | `technician/page.tsx` today loads floor OS + docket + ready-for-pickup in parallel with overlapping job/WO joins. Fold docket items into floor OS response **or** skip docket fetch when floor already returns equivalent queue lanes for the same user. Keep pickup list but do not re-sign photos already unused on initial paint if carousel can defer primary photo. |
| Lazy photos                 | Job packet loads photos when opened. Floor selected surface must not pull full intake signed URLs for the packet.                                                                                                                                                                                                                                                        |
| No office WO load for techs | Redirect prevents `getWorkOrderDetail` + always-on `listIntakePhotos` for floor techs.                                                                                                                                                                                                                                                                                   |

Out of scope for this pass: virtualizing inspection rows, Control Center realtime debounce, CreateWorkOrderForm size.

## UI / interaction

- Packet = full-height panel over the work surface (or replacing stage body), with dimmed/disabled queue optional; sticky dock **hidden** while packet is open so actions don’t compete.
- Primary close control: “Back to job” + Escape on desktop.
- Preserve existing stage rail chrome above or behind; when packet closes, restore previous `stage`.
- iPad: large tap targets (≥44px); packet scroll independent of queue.

## Out of scope

- Schema, permissions matrix, complete-gate, peer QC, safety rules
- Rewriting `InspectionChecklist` / `InspectionItemRow` internals
- Advisor Shop Board / Control Center
- Bay map, dark theme, heavy animation
- Changing front-office tab set

## Success criteria

1. Floor tech never sees 11 work-order tabs during a normal shift.
2. Notes and photos are available from the floor via Job packet without leaving `/technician`.
3. Floor does not full-reload on a 60s timer while a tech is mid-job.
4. Existing Start / Complete / Pull / Flag / Pass QC / Pass safety behavior unchanged.
5. Front office WO detail unchanged.

## Implementation touchpoints (summary)

- New: `techJobPacketHref` helper; `JobPacketPanel` (or equivalent) client/server split
- Modify: `TechnicianFloorShell`, `technician/page.tsx`, floor/docket/pickup hrefs, WO detail redirect
- Tests: unit for href helper + redirect mapping; floor UX tests for packet entry links
- Spec/plan docs under `docs/superpowers/`
