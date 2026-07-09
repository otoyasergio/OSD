# Video 4 — Shopmonkey Q1 2026 feature recap

**Date reviewed:** 2026-07-09  
**Video ID:** `R-oIS6t8mIs`  
**Title:** What's New in Shopmonkey? | Latest Features & Updates | Q1 2026  
**Playlist:** [Shopmonkey Features](https://www.youtube.com/playlist?list=PLazaWgaFFCUDM4otc1AziKRPeaubGDiwM) (`PLazaWgaFFCUDM4otc1AziKRPeaubGDiwM`)  
**Product:** Shopmonkey (auto repair shop management)  
**Length:** ~43 min (livestream recording, published 2026-04-23)

## Already covered on this branch

Prior video-review commits already shipped: kanban board, list view, filter chips, density toggle, global search, work-order job todo, activity/timeline tab. No overlap with this video’s themes.

## Patterns / features observed (new vs branch)

| Chapter | Pattern | OTOMOTO relevance |
| --- | --- | --- |
| CRM campaigns | Block email/SMS campaign editor; deferred-service reminders from declined recommendations | V2 CRM / customer retention |
| Order settings | Hide line-item pricing (itemized without $) vs lump-sum package | V2 estimates / customer-facing quotes |
| Service categories | Category at service (not only line) + sales-by-category report | V2 reporting / profit centers |
| Reporting | Commission detail report; saved (personal/shared) reports; scheduled reports (upcoming) | V2 owner analytics |
| Time log | Est. vs actual hours on labor line side panel | V2 tech time tracking |
| Purchase orders | Edit PO cost while draft/pending; fees; tax adjust | V2 parts procurement |
| Theme | Light / dark / system preference | V2 polish (large surface area) |
| Inspections | E-signature on inspection + configurable footer terms | V2 DVI / dispute protection |
| Inventory | Bulk count/adjust with save-progress + PDF | V2 inventory |
| Payments | Overpayment → customer credit balance, apply on next order | V2 billing |
| Release notes | Non-intrusive “What’s New” + monthly help-center notes | Nice-to-have; needs content ops |
| Integrations | ALLDATA labor guide (alongside Motor) | Out of scope / partner |
| Mobile | In-app notification center | V2 mobile |

## Decision for this pass

**No code changes.** Nothing here is a 1–2 file trivial UX win for V1 without new data models (time logs, credits, e-sign, inventory counts) or a full theme pass (dark mode).

## Deferred for V2 plan

Priority candidates if OTOMOTO grows toward Shopmonkey-class ops:

1. **Est. vs actual labor time** on jobs (shop efficiency signal).
2. **Inspection acknowledgement / e-sign** (check-in condition + terms).
3. **Customer credits** from overpayment or declined-then-deferred work.
4. **Service/work categories** for owner reporting.
5. **Estimate presentation modes** (itemized, hide prices, lump sum).
6. Optional: system dark theme; in-app release notes.

## Source chapters (for re-watch)

- 02:11 CRM email editor  
- 04:58 Hide item line pricing  
- 08:32 Service level categories  
- 12:32 Commission / saved reports  
- 15:15 Time log est. vs actual  
- 18:43 PO improvements  
- 22:10 Dark mode  
- 24:06 E-signatures on inspections  
- 28:00 Inventory bulk adjustments  
- 31:41 Overpayment credits  
- 34:53 Release notes experience  
- 36:48 ALLDATA integration  
- (~end) Mobile notification center  
