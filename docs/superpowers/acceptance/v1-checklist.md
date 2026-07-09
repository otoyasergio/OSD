# OTOMOTO V1 — Acceptance checklist (Task 35)

Use this after a live Supabase project is configured (see README **Getting started**).  
Unit tests alone do **not** complete Task 35.

**Prerequisites**

- [x] Migrations `001`–`007` applied _(verified via Supabase MCP `list_migrations` on `eofxprepuajpqyvlolhw`, 2026-07-09; later migrations also present)_
- [x] Bootstrap seed run (`supabase/seed/dev_bootstrap.sql`) + Auth user linked as `owner` _(owner/manager/advisor/tech auth users + `app_user` rows present)_
- [x] `npm test` passes _(73 tests / 15 files, 2026-07-09)_
- [ ] `npm run dev` running; primary checks in **Safari** (Mac and/or iPad) _(needs human)_

---

## Build-sheet Tests 1–17

### Test 1. Create customer

- [ ] Customer saves
- [ ] Phone or email required (create without both → error)
- [ ] Customer appears in search

### Test 2. Create motorcycle

- [ ] Motorcycle saves under customer
- [ ] VIN may be blank
- [ ] Missing VIN warning appears

### Test 3. Create work order

- [ ] Work order saves _(needs human / Safari)_
- [x] Create form requires six intake photos (front, rear, left side, right side, VIN, dash/odometer) _(prod HTML smoke: `/work_orders/new` as owner shows all 6 slot labels)_
- [ ] Submit blocked until all six are selected; photos upload with create _(needs human)_
- [ ] If a photo upload fails after create, recovery UI keeps the user on the missing slots _(needs human)_
- [ ] Dashboard “No intake photos” flag clears once intake photos exist _(needs human)_
- [ ] Inspection is automatically created _(needs human)_
- [ ] Inspection results are generated from active template _(needs human)_
- [ ] Timeline shows Work Order Created _(needs human)_
- [ ] Timeline shows Inspection Created _(needs human)_
- [ ] Timeline shows Intake Photo Uploaded for each required photo _(needs human)_

### Test 4. Add job

- [ ] Job saves under work order
- [ ] Service snapshot is stored
- [ ] Timeline shows Job Created
- [ ] Work order status recalculates

### Test 5. Complete inspection item

- [ ] Technician selects OK, Future Attention, or Immediate Attention
- [ ] Result auto-saves
- [ ] Incomplete count updates
- [ ] Timeline records important changes

### Test 6. Create recommendation from inspection result

- [ ] Recommendation saves
- [ ] Recommendation links to inspection result
- [ ] Recommendation appears under work order
- [ ] Timeline shows Recommendation Created

### Test 7. Convert recommendation to job

- [ ] New job is created
- [ ] Recommendation status becomes `converted_to_job`
- [ ] Recommendation stores `converted_job_id`
- [ ] Timeline shows conversion

### Test 8. Try ordering part before job approval

- [ ] App blocks action
- [ ] Error says parts cannot be ordered before customer approval
- [ ] No part status change occurs

### Test 9. Approve job

- [ ] Job status changes to approved
- [ ] Approval details save
- [ ] Timeline shows Customer Approval Recorded
- [ ] Work order status recalculates

### Test 10. Order part after approval

- [ ] Part status changes to ordered
- [ ] `ordered_at` is set
- [ ] Timeline shows Part Status Changed

### Test 11. Complete job

- [ ] Technician can complete assigned job
- [ ] `completed_at` is set
- [ ] Timeline shows Job Status Changed
- [ ] Work order status recalculates

### Test 12. Quality check

- [ ] Manager or service advisor completes quality check
- [ ] `quality_checked_at` is set
- [ ] `quality_checked_by_user_id` is set
- [ ] Timeline shows Quality Check Completed

### Test 13. Ready for pickup

- [ ] Work order cannot move to `ready_for_pickup` before jobs complete
- [ ] Work order cannot move to `ready_for_pickup` before quality check
- [ ] After requirements are satisfied, `ready_for_pickup_at` is set
- [ ] Timeline shows Ready For Pickup

### Test 14. Complete work order

- [ ] Work order status becomes completed
- [ ] `completed_at` is set
- [ ] `released_by_user_id` is set
- [ ] Timeline shows Work Order Completed

### Test 15. Technician permissions

- [ ] Technician cannot approve job _(needs human)_
- [ ] Technician cannot complete work order _(needs human)_
- [x] Technician cannot manage users _(prod smoke: tech has no Users nav; `/work_orders/new` redirects to list)_
- [x] Technician can update assigned jobs _(prod smoke: `/technician` shows My jobs / Assigned)_
- [ ] Technician can complete inspection _(needs human)_

### Test 16. Recommendation permanence

- [ ] Recommendation cannot be deleted through UI
- [ ] Declined recommendation remains visible
- [ ] Converted recommendation remains visible

### Test 17. Inspection template history

- [ ] Edit inspection template item name
- [ ] New inspections use updated name
- [ ] Old inspections preserve old snapshot name

---

## Design extras (beyond build sheet)

### Location switch scopes dashboard

- [ ] Switching active location changes dashboard counts / WO list to that location only
- [ ] Work orders from another location are not mixed into the active-location operational views

### Work order numbers unique per location

- [ ] Creating a WO at location A yields e.g. `WO-1001`
- [ ] Creating a WO at location B can also yield `WO-1001` (numbers are per location, not global)
- [ ] Same number cannot collide within one location

### Non-owner audit blocked

- [ ] Non-owner cannot open `/settings/audit` (redirect / denied)
- [ ] Owner can open and filter the audit log

### Parts before approval blocked

- [ ] Covered by Test 8; reconfirm from Parts tab on an unapproved job

### Recommendations not deletable

- [ ] Covered by Test 16; no delete control in UI; declined/converted rows remain

### Template snapshots preserved

- [ ] Covered by Test 17; renaming a template item does not rewrite existing inspection result snapshots

---

## Sign-off

| Item | Status |
|------|--------|
| Unit tests (`npm test`) | ☑ verified 2026-07-09 (73 pass) |
| Tests 1–17 | ☐ partial — only Test 3 photo slots + Test 15 nav/role smoke automated; rest need Safari |
| Design extras | ☐ needs human |
| Safari Mac smoke | ☐ needs human |
| Safari iPad smoke (if available) | ☐ needs human |

**Do not mark Task 35 complete until the live checklist above is walked.**  
**Task 16 (Recommendation permanence) was not verified in this pass — do not claim complete.**  
If gaps are found, fix them and commit with: `test: close V1 acceptance gaps from checklist`.

### Automated prod smoke notes (2026-07-09)

- Production: https://v1-implementation-liart.vercel.app
- Auth password grant: `owner@otomoto.local` and `tech@otomoto.local` → **PASS**
- Owner session → `/dashboard` loads, “New work order” present → **PASS**
- Owner → `/work_orders/new` shows 6 intake slots → **PASS**
- Tech session → `/technician` (My jobs / Assigned); cannot open create WO → **PASS** (role-gated)
- Full UI sign-out click path not exercised (no browser MCP); Auth API logout not required for API smoke
- Tests 1–2, 4–14, 16–17 + design extras + Safari → **still need human**
