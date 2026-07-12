# Work-Order Billing Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Square estimate → approval → invoice → deposit/balance work on the work order Overview for alpha testing.

**Architecture:** Extend `work_order` with `billing_stage` and amount metadata; split Square client into draft/publish/cancel; replace pickup-only invoice create with sync-draft / send-approval / publish / publish-balance / cancel-recreate; gate portal pay CTA on invoiced stage.

**Tech Stack:** Next.js App Router, Supabase Postgres, Square Invoices API, existing portal + timeline/audit.

**Spec:** `docs/superpowers/specs/2026-07-12-work-order-billing-lifecycle-design.md`

---

### Task 1: Migration + types

**Files:**
- Create: `supabase/migrations/020_work_order_billing_lifecycle.sql`
- Modify: `lib/services/workOrders.ts` (select list + mapped fields)
- Modify: `lib/timeline/events.ts`
- Modify: `lib/services/errors.ts`

- [ ] Add columns: `billing_stage`, `square_invoice_public_url`, `billing_amount_mode`, `billing_amount_cents`, `billing_collected_cents`, `estimate_sent_at`, `invoice_published_at`
- [ ] Apply migration to remote Supabase
- [ ] Wire fields through WO detail select/map

### Task 2: Square client draft/publish/cancel

**Files:**
- Modify: `lib/square/client.ts`

- [ ] `createSquareInvoiceDraft` (order + invoice, no publish)
- [ ] `publishSquareInvoice(id, version)`
- [ ] `cancelSquareInvoice(id, version)`
- [ ] Keep `createSquareInvoice` as draft+publish helper or replace callers

### Task 3: Billing service + stage helpers

**Files:**
- Create: `lib/billing/stages.ts` (pure helpers + amount modes)
- Create: `tests/unit/billingStages.test.ts`
- Modify: `lib/services/squareBilling.ts`
- Modify: `lib/services/portal.ts` + `lib/services/jobs.ts` (recompute stage after approval)

- [ ] Unit tests for amount modes and stage transitions
- [ ] `syncWorkOrderSquareDraft`, `sendWorkOrderEstimateApproval`, `publishWorkOrderSquareInvoice`, `publishWorkOrderSquareBalance`, `cancelAndRecreateSquareInvoice`
- [ ] Webhook updates `billing_stage` / `billing_collected_cents` on paid

### Task 4: Server actions + Billing UI

**Files:**
- Modify: `app/(app)/work_orders/square-actions.ts`
- Modify: `components/square/SquareInvoicePanel.tsx`
- Modify: `app/(app)/work_orders/[work_order_id]/page.tsx`

- [ ] Actions for each staff operation
- [ ] Panel: totals, stage badge, sync / send approval / publish / balance / cancel

### Task 5: Portal + soft flags for alpha

**Files:**
- Modify: `components/portal/PortalClient.tsx`
- Modify: `lib/services/portal.ts` (expose billing_stage + public_url)
- Modify: `lib/status/flags.ts` + `tests/unit/flags.test.ts`
- Modify: `components/forms/CreateWorkOrderForm.tsx` (label external invoice as optional legacy)

- [ ] Pay CTA only when invoiced and not paid
- [ ] Stop “Missing invoice #” flag (or only when no Square billing either)

### Task 6: Verify for alpha

- [ ] `npm test` / vitest unit suite for billing + flags
- [ ] Typecheck if available
- [ ] Commit on `feature/square-expansion`
