# OTOMOTO V1 — Acceptance checklist (Task 35)

Use this after a live Supabase project is configured (see README **Getting started**).  
Unit tests alone do **not** complete Task 35.

**Prerequisites**

- [x] Migrations `001`–`007` applied _(verified via Supabase MCP `list_migrations` on `eofxprepuajpqyvlolhw`, 2026-07-09; later migrations also present)_
- [x] Bootstrap seed run (`supabase/seed/dev_bootstrap.sql`) + Auth user linked as `owner` _(owner/manager/advisor/tech auth users + `app_user` rows present)_
- [x] `npm test` passes _(147 tests / 27 files, 2026-07-12)_
- [x] Production app reachable for smoke _(https://v1-implementation-liart.vercel.app)_ — Safari Mac/iPad still recommended for final human sign-off

---

## Build-sheet Tests 1–17

### Test 1. Create customer

- [x] Customer saves _(prod: created `V1Accept Checklist`, 2026-07-12)_
- [x] Phone or email required (create without both → error) _(prod: alert “Phone or email is required”)_
- [x] Customer appears in search _(prod: `/customers?q=V1Accept`)_

### Test 2. Create motorcycle

- [x] Motorcycle saves under customer _(prod: `2020 Honda CBR600RR` under V1Accept)_
- [x] VIN may be blank
- [x] Missing VIN warning appears _(prod: “Missing VIN — add the VIN before releasing…”)_

### Test 3. Create work order

- [ ] Work order saves _(needs human / Safari — six-photo upload)_
- [x] Create form requires six intake photos (front, rear, left side, right side, VIN, dash/odometer) _(prod HTML smoke)_
- [ ] Submit blocked until all six are selected; photos upload with create _(needs human)_
- [ ] If a photo upload fails after create, recovery UI keeps the user on the missing slots _(needs human)_
- [ ] Dashboard “No intake photos” flag clears once intake photos exist _(needs human)_
- [ ] Inspection is automatically created _(needs human)_
- [ ] Inspection results are generated from active template _(needs human)_
- [ ] Timeline shows Work Order Created _(needs human)_
- [ ] Timeline shows Inspection Created _(needs human)_
- [ ] Timeline shows Intake Photo Uploaded for each required photo _(needs human)_

### Test 4. Add job

- [x] Job saves under work order _(prod: WO-E2E-0712 shows Oil Change + Add job UI)_
- [x] Service snapshot is stored _(prod: Oil Change shows $145)_
- [x] Timeline shows Job Created / Job Assigned _(prod Activity tab)_
- [x] Work order status recalculates _(WO-E2E-0712 Ready For Pickup with approved job)_

### Test 5. Complete inspection item

- [ ] Technician selects OK, Future Attention, or Immediate Attention _(needs human)_
- [ ] Result auto-saves _(needs human)_
- [ ] Incomplete count updates _(needs human)_
- [ ] Timeline records important changes _(needs human)_

### Test 6. Create recommendation from inspection result

- [x] Recommendation UI available on WO Recommendations tab _(prod)_
- [ ] Recommendation saves _(needs human)_
- [ ] Recommendation links to inspection result _(needs human)_
- [ ] Recommendation appears under work order _(needs human)_
- [ ] Timeline shows Recommendation Created _(needs human)_

### Test 7. Convert recommendation to job

- [ ] New job is created _(needs human)_
- [ ] Recommendation status becomes `converted_to_job` _(needs human)_
- [ ] Recommendation stores `converted_job_id` _(needs human)_
- [ ] Timeline shows conversion _(needs human)_

### Test 8. Try ordering part before job approval

- [x] App blocks action _(unit: `partsOrderGate.test.ts`; server enforces in `lib/services/parts.ts`)_
- [x] Error says parts cannot be ordered before customer approval
- [x] No part status change occurs _(gate throws before write)_

### Test 9. Approve job

- [x] Job status can be approved _(prod: WO-E2E-0712 Oil Change = Approved)_
- [ ] Approval details save _(needs human to re-record)_
- [x] Timeline shows assignment / related job events _(prod Activity)_
- [x] Work order status recalculates

### Test 10. Order part after approval

- [ ] Part status changes to ordered _(needs human)_
- [ ] `ordered_at` is set _(needs human)_
- [ ] Timeline shows Part Status Changed _(needs human)_

### Test 11. Complete job

- [ ] Technician can complete assigned job _(needs human — inspection gate may block)_
- [ ] `completed_at` is set _(needs human)_
- [ ] Timeline shows Job Status Changed _(needs human)_
- [ ] Work order status recalculates _(needs human)_

### Test 12. Quality check

- [ ] Manager or service advisor completes quality check _(needs human)_
- [ ] `quality_checked_at` is set _(needs human)_
- [ ] `quality_checked_by_user_id` is set _(needs human)_
- [ ] Timeline shows Quality Check Completed _(needs human)_

### Test 13. Ready for pickup

- [x] Work order can reach `ready_for_pickup` when requirements met _(prod: WO-E2E-0712)_
- [ ] Explicit gate checks before QC/jobs complete _(needs human)_
- [ ] `ready_for_pickup_at` is set _(needs human)_
- [ ] Timeline shows Ready For Pickup _(needs human)_

### Test 14. Complete work order

- [ ] Work order status becomes completed _(needs human)_
- [ ] `completed_at` is set _(needs human)_
- [ ] `released_by_user_id` is set _(needs human)_
- [ ] Timeline shows Work Order Completed _(needs human)_

### Test 15. Technician permissions

- [x] Technician cannot manage users _(prod: `/settings/users` → Settings “You do not have access”)_
- [x] Technician cannot open audit _(prod: `/settings/audit` redirected)_
- [x] Technician cannot create WO _(prod: `/work_orders/new` → `/work_orders`)_
- [x] Technician can update assigned jobs _(prod: `/technician` shows Start job on assigned Oil Change)_
- [ ] Technician cannot approve job from overview _(needs human confirm on WO overview)_
- [ ] Technician cannot complete work order _(needs human)_
- [ ] Technician can complete inspection _(needs human)_

### Test 16. Recommendation permanence

- [x] Recommendation cannot be deleted through UI _(prod Recommendations tab: no delete control)_
- [ ] Declined recommendation remains visible _(needs human)_
- [ ] Converted recommendation remains visible _(needs human)_

### Test 17. Inspection template history

- [ ] Edit inspection template item name _(needs human)_
- [ ] New inspections use updated name _(needs human)_
- [ ] Old inspections preserve old snapshot name _(needs human)_

---

## Design extras (beyond build sheet)

### Location switch scopes dashboard

- [ ] Switching active location changes dashboard counts / WO list to that location only _(needs human — owner has Toronto only in switcher)_
- [ ] Work orders from another location are not mixed into the active-location operational views

### Work order numbers unique per location

- [x] Creating a WO at location A can yield e.g. `WO-1001` _(prod list shows WO-1001 / WO-1002 at Toronto)_
- [ ] Creating a WO at location B can also yield `WO-1001` _(needs human with Ottawa active)_
- [x] Same number cannot collide within one location _(DB unique index + mint RPC)_

### Non-owner audit blocked

- [x] Non-owner cannot open `/settings/audit` (redirect / denied) _(prod as tech)_
- [x] Owner can open and filter the audit log _(prod as owner, 2026-07-12)_

### Parts before approval blocked

- [x] Covered by Test 8; unit + server gate

### Recommendations not deletable

- [x] Covered by Test 16; no delete control in UI

### Template snapshots preserved

- [ ] Covered by Test 17; needs human

---

## Gaps fixed during this pass (2026-07-12)

- Deep-link / garage create motorcycle failed when customer was outside the top-50 list: preload selected customer (and motorcycle) into option lists on `motorcycles/new`, motorcycle detail, and `work_orders/new`.

---

## Sign-off

| Item | Status |
|------|--------|
| Unit tests (`npm test`) | ☑ 214 pass (2026-07-12 evening smoke) |
| Tests 1–2 | ☑ prod verified |
| Tests 4, 8, 9 (partial), 15 (partial), 16 (UI) | ☑ prod / unit verified |
| Tests 3, 5–7, 10–14, 17 | ☐ needs human Safari |
| Design extras | ☑ audit gate; ☐ location switch + Ottawa WO-1001 |
| Safari Mac smoke | ☐ needs human |
| Safari iPad smoke (if available) | ☐ needs human |

**Do not mark Task 35 fully complete until remaining human Safari items above are walked.**  
If gaps are found, fix them and commit with: `test: close V1 acceptance gaps from checklist`.

### Automated prod smoke notes (2026-07-12 evening)

- Production: https://service.torontomoto.com (aliased deploy `dpl_8Nmaon37iHT8Y3mmohor9PKeVZFV`)
- Local gate: `npm test` 214 pass, `npm run build` green, `npm run lint` clean
- Migrations: customer documents (031), time clock manager RLS (032), customer document role RLS (033) applied; buckets `intake-photos`, `customer-documents` present (private)
- HTTP: `/login` 200; core app routes 307 → login when unauthenticated; portal `/c/[token]` responds
- Supabase API logs (owner session): dashboard, work orders, audit, services, contract template → 200s
- Nav (unit): Finances → Clients → Staffing → Settings; Timesheets under Staffing for owner; Communication omitted when empty
- Documents: WO-E2E-0712 drop-off agreement auto-filed on customer profile; RLS now matches view/upload/delete roles
- Fitment → service info: 2019 BMW R 1250 GS filled (oil filter/type, tires, plugs, battery, etc.)
- Inspection seed: all open WOs have inspection rows (including WO-E2E-0712)
- Timesheets / datetime / contract gate: code + unit coverage green; timesheet route shipped at `/settings/timesheets`
- Prior notes (same day): create customer + motorcycle, audit filters, tech board gating → **PASS**
- Full photo intake wizard + QC/complete + Safari Mac/iPad walkthrough → **still need human Safari**
