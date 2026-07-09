# OTOMOTO V1 — Acceptance checklist (Task 35)

Use this after a live Supabase project is configured (see README **Getting started**).  
Unit tests alone do **not** complete Task 35.

**Prerequisites**

- [ ] Migrations `001`–`007` applied
- [ ] Bootstrap seed run (`supabase/seed/dev_bootstrap.sql`) + Auth user linked as `owner`
- [ ] `npm test` passes
- [ ] `npm run dev` running; primary checks in **Safari** (Mac and/or iPad)

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

- [ ] Work order saves
- [ ] Create form requires six intake photos (front, rear, left side, right side, VIN, dash/odometer)
- [ ] Submit blocked until all six are selected; photos upload with create
- [ ] If a photo upload fails after create, recovery UI keeps the user on the missing slots
- [ ] Dashboard “No intake photos” flag clears once intake photos exist
- [ ] Inspection is automatically created
- [ ] Inspection results are generated from active template
- [ ] Timeline shows Work Order Created
- [ ] Timeline shows Inspection Created
- [ ] Timeline shows Intake Photo Uploaded for each required photo

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

- [ ] Technician cannot approve job
- [ ] Technician cannot complete work order
- [ ] Technician cannot manage users
- [ ] Technician can update assigned jobs
- [ ] Technician can complete inspection

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
| Unit tests (`npm test`) | ☐ |
| Tests 1–17 | ☐ |
| Design extras | ☐ |
| Safari Mac smoke | ☐ |
| Safari iPad smoke (if available) | ☐ |

**Do not mark Task 35 complete until the live checklist above is walked.**  
If gaps are found, fix them and commit with: `test: close V1 acceptance gaps from checklist`.
