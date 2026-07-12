# Wix-style Invoices area (list + detail)

**Date:** 2026-07-12  
**Status:** Approved for planning  
**Branch:** `feature/square-expansion`  
**Extends:** [2026-07-12-billing-area-design.md](./2026-07-12-billing-area-design.md), [2026-07-12-work-order-billing-lifecycle-design.md](./2026-07-12-work-order-billing-lifecycle-design.md)

## Problem

Today’s **Billing** area is a work-order money desk (collections / desk / ledger). Staff want a **Wix CRM–style Invoices** experience: create freestyle invoices for a customer, track document statuses (Draft → Sent → Paid/Partial/Overdue/Void), and collect payment via Square — with an optional work-order link, not a hard requirement.

## Decisions locked

| Decision | Choice |
|----------|--------|
| Relation to Billing | Evolve Billing into Invoices (Approach A) |
| Creation | Freestyle: customer + line items; WO optional (prefill when linked) |
| Money | OTOMOTO owns invoice record/status; Square for pay links |
| Architecture | First-class `invoice` + `invoice_line` tables |
| UI shell | List + detail pane (master/detail) |
| Roles | Same as Billing: owner / manager / service advisor; technicians excluded |

## Product shape

### Navigation
- Sidebar label: **Invoices** (route may remain `/billing` or move to `/invoices` — prefer `/invoices` with redirect from `/billing`)
- Hidden for technicians; `/invoices` redirects to dashboard if forbidden

### Layout (desktop)
- **Left pane:** searchable invoice list with status filters (Draft, Sent, Viewed, Partial, Paid, Overdue, Void)
- **Right pane:** selected invoice detail — customer, optional WO link, lines, totals, due date, Square pay link, actions
- **Header:** period stats (Paid / Outstanding / Overdue) + **Create invoice**
- Mobile: list first; tap opens full-screen detail

### Create / edit flow
1. Create invoice → select customer  
2. Optionally link a work order → prefill lines from approved/priced jobs + parts  
3. Edit line items (name, description, qty, unit amount)  
4. Set issue date / due date  
5. **Save draft** or **Send** (publish Square + notify when messaging configured)

### Row / detail actions by status
| Action | When |
|--------|------|
| Save draft | Draft |
| Send / Resend | Draft → Sent; Sent/Partial/Overdue |
| Share / open pay link | Sent, Partial, Overdue (has Square URL) |
| Void | Sent/Partial/Overdue unpaid (not Paid) |
| Duplicate | Any |
| Open customer / WO | When linked |

## Data model

### `invoice`
- `invoice_id` uuid PK  
- `location_id` uuid NOT NULL (active location scope)  
- `invoice_number` text NOT NULL (unique per location)  
- `customer_id` uuid NOT NULL → customer  
- `work_order_id` uuid NULL → work_order  
- `status` text NOT NULL CHECK (`draft`, `sent`, `viewed`, `partial`, `paid`, `overdue`, `void`)  
- `issue_date` date NOT NULL  
- `due_date` date NULL  
- `subtotal_cents` int NOT NULL DEFAULT 0  
- `tax_cents` int NOT NULL DEFAULT 0  
- `total_cents` int NOT NULL DEFAULT 0  
- `amount_paid_cents` int NOT NULL DEFAULT 0  
- `square_invoice_id` text NULL  
- `square_public_url` text NULL  
- `notes` text NULL  
- `sent_at`, `voided_at`, `created_at`, `updated_at`  
- `created_by_user_id` uuid NULL  

### `invoice_line`
- `line_id` uuid PK  
- `invoice_id` uuid NOT NULL  
- `sort_order` int NOT NULL DEFAULT 0  
- `name` text NOT NULL  
- `description` text NULL  
- `quantity` numeric NOT NULL DEFAULT 1  
- `unit_amount_cents` int NOT NULL  
- `job_id` / `part_id` uuid NULL (when sourced from WO)  

### Numbering
Per-location sequence table or column (e.g. `invoice_sequence`), format `INV-YYYY-####` (or location-prefixed). Mint on first save.

### Overdue
Computed or nightly: if `due_date < today` and status in (`sent`, `viewed`, `partial`) → set/display `overdue`. Prefer display-time computation for alpha; optional cron later.

## Square sync

| OTOMOTO event | Square |
|---------------|--------|
| Save draft | Optional unpublished Square draft, or local-only until Send |
| Send | Create order + invoice from lines, publish, store id + public_url; status `sent` |
| Webhook PAID / PARTIALLY_PAID | `paid` / `partial`; update `amount_paid_cents` |
| Void | Cancel Square invoice when unpaid; status `void` |
| Paid/void | Lines locked; use Duplicate to revise |

Idempotent webhook handling via existing `square_webhook_event` pattern (match on `square_invoice_id` → `invoice` row).

## Relationship to work-order billing

- WO Overview Billing panel remains for alpha repair flow  
- **Create from WO** opens Invoices create with WO + prefilled lines  
- Linked invoices listed on WO Billing panel  
- Long-term: deprecate single `work_order.square_invoice_id` as the only document; migrate toward `invoice` as system of record (not required in first ship)

## Permissions

Reuse / extend Billing gates:
- `canViewBillingArea` → view Invoices (rename helpers to `canViewInvoices` aliases OK)  
- Create/send/void: same as `canRecordCustomerApproval` (front office)  
- Technicians: no access  

## Testing

- Unit: line totals, status transitions, overdue display, number minting  
- Integration: create draft → send → webhook paid  
- UI: list filters; detail actions enabled/disabled by status; mobile list→detail  

## Out of scope (v1)

- Recurring invoices  
- Tax/GST configuration UI (tax_cents may stay 0 or manual)  
- PDF brand designer  
- In-app card charge / Terminal from invoice detail  
- Custom QuickBooks invoice API  
- Removing WO Billing panel in the first ship  

## Implementation notes

- Build on existing Square client (draft/publish/cancel) and communications templates (`payment_reminder`)  
- Replace Billing page UI with list+detail Invoices shell; keep collections helpers as optional “Needs attention” filter on the list  
- Follow permission → write → timeline/audit (invoice entity events) patterns  
- Spec supersedes Billing-area “no new invoice table” for this phase
