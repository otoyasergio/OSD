# Work Order Billing Tab — Design Spec

**Date:** 2026-07-13  
**Status:** Approved (brainstorm)  
**Branch:** `feature/wix-crm-merge`

## Problem

Work orders have Jobs and Parts for operational work, and Square lifecycle on Overview for payment — but no dedicated place to compose the bill: edit service/part sell prices and add custom (other) lines in one list before syncing to Square.

## Goals

1. Add a **Billing** tab on work order detail.
2. Show **services** (jobs), **parts**, and **other** (custom) lines in one scrollable list with totals.
3. Allow editing sell prices on jobs/parts and full CRUD on custom lines.
4. Feed Square draft/publish from the same lines (jobs + parts + custom).
5. Keep Jobs and Parts tabs for operational workflow (status, install, ordering).

## Non-goals

- Replacing Jobs/Parts tabs or Floor OS flows.
- Unified polymorphic billable-lines table for every row type (deferred).
- Customer portal invoice editor.
- Changing shop-wide `/billing` collections board beyond using the same totals.

## Decisions (locked)

| Decision               | Choice                                                         |
| ---------------------- | -------------------------------------------------------------- |
| Location               | New **Billing** tab on WO detail                               |
| Other lines            | Fully custom: description + qty + unit price                   |
| Relation to Jobs/Parts | Mirror + edit prices; optional quick-add creates real job/part |
| Architecture           | Custom-line table + edit existing job/part price fields        |
| Layout                 | Single column: line list → totals → Square actions             |

## Information architecture

### Tab

Add `billing` to `WorkOrderTabs` (label: **Billing**). Visible to roles that can edit WO money / view billing (front office + owner/manager; technicians may view read-only if they can open the WO — default: same as Square panel visibility on Overview today).

### Layout (single column)

1. **Header:** WO number, stage chip, estimate total.
2. **Services** section: rows from `job` (exclude cancelled/declined from billable default; show cancelled collapsed or grayed).
3. **Parts** section: rows from `part` (exclude cancelled/not_required from billable).
4. **Other** section: rows from new `billing_line`.
5. **Totals:** subtotal services, subtotal parts, subtotal other, **estimate total**.
6. **Square block:** existing `SquareInvoicePanel` actions (sync draft, send approval, publish modes) moved or duplicated here; Overview may keep a short summary + link to Billing tab.

### Line behavior

**Services (job)**

- Display: service name, sell price (`standard_price_snapshot`).
- Edit price → updates `job.standard_price_snapshot`.
- Quick-add catalogue service → `addJobToWorkOrder` (same as Jobs tab).
- Job status / start / complete remain on Jobs tab.

**Parts (part)**

- Display: name, qty, unit price, line total (`unit_price * quantity`).
- Edit unit price and/or qty → updates `part`.
- Quick-add still requires a parent job (existing invariant).
- Order/install status remains on Parts tab.

**Other (`billing_line`)**

- Fields: `description`, `quantity`, `unit_price`, optional `sort_order`.
- Line amount = quantity × unit_price.
- Add / edit / remove only on Billing tab.
- Included in estimate total and Square `buildLines()`.

## Data model

### New table `billing_line`

| Column                      | Type                       | Notes      |
| --------------------------- | -------------------------- | ---------- |
| `billing_line_id`           | uuid PK                    |            |
| `work_order_id`             | uuid FK → work_order       | CASCADE    |
| `description`               | text NOT NULL              |            |
| `quantity`                  | numeric NOT NULL DEFAULT 1 | > 0        |
| `unit_price`                | numeric NOT NULL           | sell price |
| `sort_order`                | int NOT NULL DEFAULT 0     |            |
| `created_at` / `updated_at` | timestamptz                |            |
| `created_by_user_id`        | uuid nullable              |            |

RLS: same location-scoped pattern as `job` / `part` for authenticated staff.

No change to `job` / `part` schema beyond continued use of existing price fields.

## Square integration

Update `buildLines()` in `lib/services/squareBilling.ts` to append custom billing lines after jobs and parts (name = description, amount = qty × unit_price; skip zero/negative unless we later support credits separately — credits remain via `customer_credit`).

Estimate total on Billing tab and Overview must use the same formula: sum billable jobs + billable parts + billing_lines.

## Permissions

- View Billing tab: users who can open the WO (existing).
- Edit prices / custom lines: `canEditWorkOrder` (or existing Square money permission if stricter).
- Technicians: read-only on Billing by default (prices visible; no edit) unless product later expands.

## Track Day UI

Use existing Track Day tokens: `td-board-card` / list rows, orange primary for Square CTAs, teal stage chips. No new brand.

## Rollout

1. Migration `billing_line` + RLS.
2. Service CRUD + list for WO.
3. Billing tab UI (list, edit, totals).
4. Wire Square `buildLines` + Overview summary link.
5. Tests for totals and Square line inclusion.

## Success criteria

- Advisor can open Billing and see all services, parts, and other lines with one total.
- Editing a job/part price on Billing updates the snapshot used by Square.
- Custom line appears on Square draft after sync.
- Jobs/Parts operational flows unchanged for technicians.

## References

- `docs/superpowers/specs/2026-07-12-work-order-billing-lifecycle-design.md` (Square lifecycle; still authoritative for stages)
- This spec adds the **line composer**; lifecycle actions stay as designed.
