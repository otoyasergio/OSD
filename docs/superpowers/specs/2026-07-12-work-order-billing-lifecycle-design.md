# Work-order billing lifecycle (Square estimate → invoice)

**Date:** 2026-07-12  
**Status:** Approved for planning  
**Branch:** `feature/square-expansion`  
**Extends:** [2026-07-11-square-expansion-design.md](./2026-07-11-square-expansion-design.md)

## Problem

V1 treated invoicing as external (`external_invoice_number`). Square expansion added “Create Square invoice” only at ready-for-pickup / completed. Staff need estimates and payment handled **on the work order** earlier: draft anytime, explicit send-for-approval, then publish for payment when the shop chooses (deposit, balance, or full).

## Decisions locked

| Decision | Choice |
|----------|--------|
| Where billing lives | On the work order (Overview Billing panel), not a separate Invoices app |
| Money document | One *active* Square invoice per work order (Square-owned); deposit then balance = sequential invoices, prior ids in timeline only |
| Estimate vs invoice | Same Square draft reused; publish when collecting money |
| Approval | Portal approve/decline jobs first; Square publish is payment only |
| When to publish | Staff choice per WO (deposit early, balance at pickup, or full at end) |
| Draft anytime | Yes; “Send for approval” is an explicit staff action |
| After publish | No silent resync; Cancel & recreate if lines must change |
| External invoice # | Optional legacy reference only; not required to create a WO |

## Approach

**Single Square invoice, staged on the WO** — extend `SquareInvoicePanel` and `squareBilling` services; keep portal for job approval; add sync-draft / send-approval / publish-payment actions with amount modes.

## Billing stages

Stored on `work_order.billing_stage`:

| Stage | Meaning |
|-------|---------|
| `none` | No Square draft yet |
| `draft` | Unpublished Square invoice synced from current lines |
| `awaiting_approval` | Portal approval link sent; invoice still unpublished |
| `ready_to_invoice` | At least one billable approved line; ready to publish |
| `invoiced` | Square invoice published; awaiting / receiving payment |
| `paid` | Square reports paid (via webhook) |

Payment status remains on `work_order.square_payment_status`: `draft` | `unpaid` | `partially_paid` | `paid` | `refunded` | `cancelled`.

## Staff actions

| Action | Gate | Effect |
|--------|------|--------|
| **Create / sync draft** | Advisor+; Square configured | Upsert Square draft from billable lines; set `billing_stage=draft`; store `square_invoice_id` + public URL if available |
| **Send for approval** | Advisor+; jobs needing approval | Create/reuse portal token (`estimate`/`full`); optional SMS/email; set `awaiting_approval` + `estimate_sent_at` |
| **Publish for payment** | Advisor+; billable amount > 0; draft exists and not yet published | Apply amount mode + credits; publish Square invoice; set `invoiced`, `invoice_published_at`, `billing_amount_*` |
| **Cancel & recreate** | Advisor+; published and `square_payment_status` is `unpaid` or `cancelled` (not `partially_paid` / `paid`) | Cancel/void in Square; clear invoice fields + billing amount metadata; return to `none` so a new draft can be synced |
| **Copy / open payment link** | When published | Use stored public URL |

### Publish amount modes

- **Full** — Square line items = publishable jobs/parts; apply customer credits as today
- **Deposit %** / **Custom** — publish a Square invoice totaling only the deposit (single “Deposit — {WO#}” line)
- **Balance** — after a deposit invoice is paid, publish a new Square invoice for remaining billable jobs/parts

**Active invoice rule:** The WO stores one *active* `square_invoice_id`. Prior invoice ids live only in timeline/audit. No two open invoices at once. After a deposit is paid, **Publish balance** creates the next active invoice for the remainder.

## Line items

Derived at sync/publish time from the work order (OTOMOTO is source of truth until publish):

**Draft sync** includes priced jobs that are awaiting approval or already approved / in progress / completed, plus priced parts on those jobs — so the estimate shows the full proposed work.

**Publish** includes only approved (and later repair) statuses already used by today’s Square billing: `approved`, `waiting_for_parts`, `ready_to_start`, `in_progress`, `completed`, plus priced parts on those jobs. Declined/cancelled jobs and parts are excluded.

Snapshots go into Square line items; resync while unpublished overwrites the draft. After publish, changes require Cancel & recreate.

## Data model

Extend `work_order` (migration on `feature/square-expansion`):

- `billing_stage` text NOT NULL DEFAULT `'none'` with check constraint for the stages above
- `square_invoice_public_url` text nullable
- `billing_amount_mode` text nullable (`full` | `deposit_percent` | `custom` | `balance`)
- `billing_amount_cents` integer nullable (amount on the *active* published invoice)
- `billing_collected_cents` integer NOT NULL DEFAULT 0 (sum of paid amounts toward this WO; used for Balance mode)
- `estimate_sent_at` timestamptz nullable
- `invoice_published_at` timestamptz nullable

Keep existing: `square_invoice_id`, `square_payment_status`, customer credits, `square_webhook_event` idempotency.

**No new invoice table.** Prefer timeline + audit for billing history (`square_invoice_draft_synced`, `estimate_sent`, `square_invoice_published`, payment webhook events). Add a dedicated billing_event table only if shop reporting later requires it.

`external_invoice_number` stays optional; remove any hard UX that implies “create invoice elsewhere first.”

## UI

Expand `components/square/SquareInvoicePanel.tsx` on work-order Overview:

- Running totals from current WO lines
- Stage badge + Square payment status
- Primary actions: Sync draft · Send for approval · Publish for payment · Publish balance · Cancel & recreate
- Publish form: amount mode + value when not Full
- Payment link when published
- Disable actions by stage and permission (`canRecordCustomerApproval` / ready-for-pickup class roles as today)

Customer portal (`/c/[token]`):

- Always can show itemized estimate and approve/decline while jobs await approval
- Pay CTA / payment link only when `billing_stage` is `invoiced` or later (and not `paid`)

## Stage transitions

- `none` → `draft` on successful sync draft
- `draft` → `awaiting_approval` on send for approval (also allowed from `ready_to_invoice` to resend)
- `awaiting_approval` → `ready_to_invoice` automatically when portal/staff approval leaves at least one publishable billable line (recomputed in job approval services / status helpers)
- `ready_to_invoice` → `invoiced` on publish
- `invoiced` → `paid` when webhook maps Square status to paid (also set `square_payment_status=paid`)
- Any unpublished stage → stay put on Square API failure
- Cancel & recreate (allowed statuses only) → `none`
- After deposit paid + Publish balance → `invoiced` again with new active invoice id

If all awaiting jobs are declined and no billable lines remain, stage returns to `draft` (or `none` if no Square draft).

## Happy path

```text
Price jobs/parts
  → Sync draft (Square draft, billing_stage=draft)
  → Send for approval (portal + optional SMS/email)
  → Customer approve/decline in portal
  → ready_to_invoice when billable approvals exist
  → Publish for payment (Full or Deposit/Custom)
  → Square webhook → partially_paid / paid
  → (optional) Publish balance for remaining after deposit
  → Timeline + audit; portal shows paid
```

## Guards and errors

- No draft/publish without Square env + upsertable Square customer (email or valid phone)
- No publish with zero billable amount
- No silent overwrite of a published invoice
- Deposit/custom capped at remaining total; existing credit application at publish remains
- Square API failures: show in panel; leave stage unchanged
- Webhook duplicates: ignore via `square_webhook_event`
- Expired portal token: staff can resend approval or payment messaging

## Permissions

Same roles that can record customer approval / manage pickup billing today (owner, manager, service advisor). Technicians do not publish invoices. Foreign-location WOs remain read-only for billing actions.

## Testing

- Unit: line-item builder (draft vs publish sets), amount modes, stage transition helpers
- Integration: sync draft → portal approve → publish → webhook status mapping
- UI: button enablement per `billing_stage`; pay CTA gated on portal

## Out of scope

- Standalone `/invoices` list page
- Multiple concurrent Square invoices per work order
- Custom QuickBooks invoice API (QBO remains via Square Connector)
- Wix invoicing
- Softphone / call recording
- Marketing campaigns

## Implementation notes

- Build on existing `lib/services/squareBilling.ts`, `lib/square/client.ts`, `app/(app)/work_orders/square-actions.ts`, portal + communications
- Relax ready-for-pickup-only gate on create; replace with stage-aware actions
- Follow permission → write → timeline → audit → (status recalc if needed) patterns
- Document supersession of “invoice only at pickup” in Square expansion ops notes when this ships
