# Work Order Billing Tab — Design Spec

**Date:** 2026-07-13  
**Status:** Approved (brainstorm)  
**Branch:** `feature/wix-crm-merge`  
**Reference UI:** Claude session `WorkOrderForm.jsx` (labor/parts tables + charges/tax/variance)

## Problem

Work orders have Jobs and Parts for operational work, and Square lifecycle on Overview for payment — but no dedicated place to compose the bill: edit service/part sell prices, add custom lines, and apply shop charges (supplies, diagnostic, HST) with estimate variance before syncing to Square.

## Goals

1. Add a **Billing** tab on work order detail.
2. Show **services** (jobs), **parts**, and **other** (custom) lines in editable tables with live totals.
3. Apply **shop supplies %**, **diagnostic fee**, and **HST**, with quoted estimate vs current total variance.
4. Feed Square draft/publish from billable lines (and charge lines as configured below).
5. Keep Jobs and Parts tabs for operational workflow (status, install, ordering).

## Non-goals

- Replacing Jobs/Parts tabs or Floor OS flows.
- Rebuilding customer/vehicle/QC/intake from `WorkOrderForm.jsx` (already covered elsewhere).
- Unified polymorphic billable-lines table for every row type (deferred).
- Customer portal invoice editor.
- Changing shop-wide `/billing` collections board beyond using the same totals.

## Decisions (locked)

| Decision               | Choice                                                                |
| ---------------------- | --------------------------------------------------------------------- |
| Location               | New **Billing** tab on WO detail                                      |
| Other lines            | Fully custom: description + qty + unit price                          |
| Relation to Jobs/Parts | Mirror + edit prices; optional quick-add creates real job/part        |
| Architecture           | Custom-line table + edit existing job/part price fields               |
| Layout                 | Single column: line tables → charges/totals → Square actions          |
| Charges                | Full block from reference form: supplies %, diagnostic, HST, variance |
| UI pattern             | Table editors inspired by `WorkOrderForm.jsx` Labor/Parts sections    |

## Information architecture

### Tab

Add `billing` to `WorkOrderTabs` (label: **Billing**).  
Permissions: edit prices/charges with `canEditWorkOrder` (or existing billing money permission). Technicians: read-only by default.

### Layout (single column)

1. **Header:** WO number, stage chip, current total.
2. **Services table:** jobs (name, sell price; optional labour hrs × rate later if we expose hours).
3. **Parts table:** part #/name, qty, unit price, extended.
4. **Other table:** custom `billing_line` rows (description, qty, unit price, extended).
5. **Charges & totals** (see formula).
6. **Square block:** existing lifecycle actions; Overview keeps summary + link to Billing.

### Line behavior

**Services (job)** — edit `standard_price_snapshot`; quick-add catalogue → real job; status on Jobs tab.  
**Parts (part)** — edit `unit_price` / `quantity`; quick-add still requires `job_id`; status on Parts tab.  
**Other (`billing_line`)** — CRUD on Billing only; amount = qty × unit_price.

## Charges & totals (from WorkOrderForm)

Shared pure function `calculateWorkOrderBillingTotals` (client + server):

```
servicesSubtotal = sum(billable job prices)
partsSubtotal    = sum(billable part unit_price × qty)
otherSubtotal    = sum(billing_line qty × unit_price)
merchandise      = servicesSubtotal + partsSubtotal + otherSubtotal
suppliesAmt      = merchandise × shop_supplies_rate
subtotal         = merchandise + suppliesAmt + diagnostic_fee
taxAmt           = subtotal × tax_rate
currentTotal     = subtotal + taxAmt
variance         = currentTotal − quoted_estimate_total
reauthExceeded   = quoted_estimate_total set AND variance > reauth_threshold
```

**Billable exclusions:** jobs cancelled/declined; parts cancelled/not_required.

**Shop defaults (editable per WO, seeded from location/shop settings when available):**

| Field                   | Default (Ontario shop) | Storage                            |
| ----------------------- | ---------------------- | ---------------------------------- |
| `shop_supplies_rate`    | `0.05` (5%)            | on `work_order`                    |
| `diagnostic_fee`        | `0`                    | on `work_order`                    |
| `tax_rate`              | `0.13` (HST)           | on `work_order`                    |
| `quoted_estimate_total` | null until set         | on `work_order` (cents or numeric) |
| `reauth_threshold`      | `50`                   | on `work_order`                    |

UI: yellow-style “shop default” inputs for rates/fees (Track Day: accent-muted), gray calculated fields for amounts.

## Data model

### New table `billing_line`

| Column                      | Type                       | Notes   |
| --------------------------- | -------------------------- | ------- |
| `billing_line_id`           | uuid PK                    |         |
| `work_order_id`             | uuid FK → work_order       | CASCADE |
| `description`               | text NOT NULL              |         |
| `quantity`                  | numeric NOT NULL DEFAULT 1 | > 0     |
| `unit_price`                | numeric NOT NULL           | sell    |
| `sort_order`                | int NOT NULL DEFAULT 0     |         |
| `created_at` / `updated_at` | timestamptz                |         |
| `created_by_user_id`        | uuid nullable              |         |

RLS: location-scoped like `job` / `part`.

### Columns on `work_order`

Add: `shop_supplies_rate`, `diagnostic_fee`, `tax_rate`, `quoted_estimate_total`, `reauth_threshold` (numeric; money in dollars matching existing job/part price style, or cents if billing lifecycle already uses cents — **match existing `billing_amount_cents` convention on the WO and convert in one place**).

## Square integration

`buildLines()` includes:

1. Billable jobs
2. Billable parts
3. Custom `billing_line` rows
4. **Shop supplies** as one line when `suppliesAmt > 0` (e.g. “Shop supplies”)
5. **Diagnostic fee** as one line when `> 0`
6. **Tax:** prefer Square tax if configured; otherwise one “HST” line for `taxAmt` so the invoice total matches `currentTotal`

Credits remain via existing `customer_credit`.  
Estimate/approval messaging should use `quoted_estimate_total` and surface `reauthExceeded` to advisors.

## Permissions

- View: anyone who can open the WO.
- Edit lines/charges: `canEditWorkOrder` / billing money roles.
- Technicians: read-only Billing.

## Track Day UI

Table headers use chrome/teal; primary Square CTA orange; calculated cells muted surface; shop-default rate fields accent-muted. Follow `WorkOrderForm.jsx` row add/remove patterns, not gray/blue marketing styles.

## Rollout

1. Migration: `billing_line` + WO charge columns + RLS.
2. `calculateWorkOrderBillingTotals` + unit tests (incl. supplies/tax/variance).
3. Billing tab UI (tables + charges + Square).
4. Wire Square `buildLines` + Overview link.
5. Seed defaults from shop settings if present.

## Success criteria

- Advisor sees services, parts, other, supplies, diagnostic, HST, and current total on Billing.
- Editing prices updates snapshots used by Square.
- Custom lines and charge lines appear on Square draft.
- Variance flags when over re-auth threshold.
- Jobs/Parts operational flows unchanged for techs.

## References

- `docs/superpowers/specs/2026-07-12-work-order-billing-lifecycle-design.md`
- Reference form: `WorkOrderForm.jsx` (Claude local-agent output) — labor/parts/charges math only
- Track Day Visual OS for styling
