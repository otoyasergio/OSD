# Picked up / filed status control design

**Date:** 2026-07-12  
**Status:** Approved for implementation

## Goal

Make marking a bike **picked up and filed** a first-class, in-flow action: a work-order header control and a shop-board column, both ending in confirm + optional pickup notes — without leaving the app or digging through Overview forms.

## Background

Today, release is **Complete / release** on the Overview tab (`completeWorkOrder` → `status: completed`). Completed work orders appear under **Complete and filed**. The shop board has a **Ready pickup** column (`ready_for_pickup`) but no column for filing. Completing currently requires ready-for-pickup (unless owner/manager override).

## Decisions

| Topic         | Choice                                                           |
| ------------- | ---------------------------------------------------------------- |
| Target status | Existing `completed` (no new status)                             |
| Surfaces      | Header button **and** shop-board column                          |
| Confirmation  | Confirm dialog + optional pickup notes                           |
| Availability  | Any active WO (not `cancelled` / already `completed`)            |
| Control style | Button that opens confirm sheet (not a reversible toggle switch) |
| Approach      | Reuse `completeWorkOrder`; relax ready-for-pickup gate           |

## Behavior

1. Authorized user clicks **Picked up / file…** on the work-order header, or drops a card onto the **Picked up / filed** board column.
2. Confirm UI: short copy (“Mark as picked up and file?”), optional pickup notes, Confirm / Cancel.
3. On confirm, call existing complete path: set `status: completed`, `completed_at`, `released_by_user_id`, `pickup_notes`; write timeline + audit as today.
4. Card leaves the active board; WO appears under Complete and filed / customer filed history.

### Ready gate

Remove the requirement that status be `ready_for_pickup` (or `ready_for_pickup_at` set) before completing. Front-office completers may file from any active status, including `on_hold`. `cancelled` and already `completed` remain blocked.

### Overview tab

Keep QC and **Ready for pickup** forms. Replace the primary **Complete / release** block with a short pointer to the header control (or share the same confirm component) so there is one primary path.

## UI

### Header

- Primary button: **Picked up / file…**
- Visible when user can complete and WO is active (not foreign-location read-only, not cancelled/completed).
- Opens confirm sheet (inline or modal consistent with existing WO patterns).

### Confirm sheet

- Title: Mark as picked up and file?
- Optional pickup notes textarea
- Confirm → server action; Cancel dismisses

### Shop board

- New last column: **Picked up / filed**
- Drop target for active, draggable cards when role can complete
- Drop opens the same confirm + notes UI; on success the card is gone from the board
- Do not show completed cards as sticky occupants of this column

## Permissions

| Action                     | Roles                                                |
| -------------------------- | ---------------------------------------------------- |
| Header / board complete    | Same as today: `canCompleteWorkOrder` (front office) |
| Foreign location           | Read-only; no complete                               |
| Un-file / reopen completed | Out of scope                                         |

## Errors

- Forbidden / foreign location / already completed / cancelled → clear mapped messages
- Reuse existing quality/complete error mapping where applicable; drop obsolete “must mark ready first” messaging for normal completers once the gate is relaxed

## Out of scope

- New statuses (`picked_up` separate from `completed`)
- Reopening or un-filing completed work orders
- Changing Complete and filed list page beyond receiving completed WOs as today
- Password / user-invite work (separate initiative)

## Testing

- Unit: `completeWorkOrder` (or derive/transition helper) allows complete from non-ready active statuses
- Unit: board `canDropInColumn` / target status for new filed column
- Manual or existing smoke: header confirm and board drop both file a WO
