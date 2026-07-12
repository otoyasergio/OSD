# Billing area (role-based money desk)

**Date:** 2026-07-12  
**Status:** Approved for implementation  
**Branch:** `feature/square-expansion`  
**Extends:** [2026-07-12-work-order-billing-lifecycle-design.md](./2026-07-12-work-order-billing-lifecycle-design.md)

## Problem

WO Overview Billing handles create/publish per job. Staff still need a **shop-wide area** to chase payment, see what’s unpaid, and (for managers/owners) see money totals and a ledger — without hunting work orders one by one.

## Decisions locked

| Decision | Choice |
|----------|--------|
| Entry | Sidebar **Billing** → `/billing` |
| Architecture | One route, role-default tab + allowed tabs (Approach 1) |
| Advisor | Collections board (default) |
| Manager | Money desk (default) + Collections + Ledger |
| Owner | Ledger (default) + Collections + Money desk |
| Technician | No access (nav hidden; `/billing` → dashboard) |
| WO panel | Remains the detailed billing editor |
| Data | No new `invoice` table; query `work_order` billing fields |

## Tabs

### Collections
Buckets for active-location WOs:
- Ready to invoice (`ready_to_invoice`)
- Unpaid (`invoiced` + unpaid)
- Partial / balance due (partially paid or deposit collected with remaining)
- Awaiting approval (`awaiting_approval`)

Actions: open WO, open/copy payment link, send payment reminder, send for approval (existing actions).

### Money desk
Collections plus:
- Stats: collected today, collected this week, unpaid total, count ready to invoice
- Quick actions for manager+: publish full / publish balance / sync draft via existing Square server actions (row-scoped)

### Ledger
Sortable/filterable table: WO#, customer, bike, billing stage, payment status, estimate/collected/remaining, Square invoice id, dates. Row links to WO.

## Permissions

- `canViewBillingArea` — owner, manager, service_advisor  
- `canViewBillingMoneyDesk` — owner, manager  
- `canViewBillingLedger` — owner, manager  
- Money mutations — existing `canRecordCustomerApproval` / billing roles  

Forbidden tab query → redirect to role default tab.

## Implementation sketch

- `lib/services/billingBoard.ts` — list + stats + bucket helpers  
- `lib/billing/buckets.ts` — pure classification (unit tested)  
- `app/(app)/billing/page.tsx`  
- `components/billing/*`  
- `SidebarNav` accepts `role` and shows Billing when allowed  

## Out of scope

Standalone invoice entity, multi-location owner rollup, QBO UI, tech access, removing WO Billing panel.
