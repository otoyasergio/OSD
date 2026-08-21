# Inline inspection recommendation design

## Goal

When a technician chooses **Create recommendation** for a Future or Now inspection
finding, they can review and save the linked recommendation without leaving the
inspection checklist. The checklist position and in-progress local edits remain
intact.

## Existing behavior

- Saving a Future or Now status already creates a pending recommendation linked
  to the inspection result.
- The current button navigates to the Work Order Recommendations tab.
- That tab uses a create-only form, so submitting it can create a duplicate
  recommendation for the same finding.

## Interaction

1. The technician taps **Create recommendation** on a flagged inspection item.
2. A modal opens over the checklist.
3. The modal is prefilled with:
   - the inspection item and category as the description;
   - Future or Now mapped to the matching recommendation severity;
   - the inspection item's current notes.
4. The technician can edit the description, severity, and notes.
5. Saving updates the existing pending recommendation linked to the inspection
   result. If it is absent, void, already acted on, or no longer a Future/Now
   finding, the modal stays open with recovery guidance instead of creating a
   replacement.
6. On success, the modal closes and the item row displays
   **Recommendation saved**.
7. On failure, the modal stays open and displays the error.

Closing or cancelling the modal makes no database change.

## Architecture

### Inspection checklist

`InspectionChecklist` owns the selected inspection result and modal open state.
It replaces the current `window.location.href` callback with an in-place modal
open action. No router navigation or page reload occurs.

### Modal

A focused client component renders an accessible dialog with description,
severity, notes, cancel, and save controls. It receives the selected
`InspectionResultRow` and derives initial values from that row.

The modal uses action state so pending and error states remain visible. A
successful result closes the dialog and notifies the checklist, which records a
local saved indicator for that inspection result.

### Server action and service

A dedicated server action accepts the work order ID, inspection result ID, and
form fields. The service:

1. verifies the current user may create recommendations and modify the work
   order;
2. verifies the inspection result belongs to that exact work order and that a
   floor technician is assigned to it;
3. verifies the current result remains Future or Now;
4. loads the newest linked recommendation;
5. updates it only when it is still pending, unconverted, and open;
6. returns a mapped error when no editable linked recommendation exists;
7. returns a success result and revalidates only the verified work order paths.

This is idempotent for the normal inspection flow and does not create an
approved job or send work to the technician docket.

## Error handling

- Validation, permission, and database failures render inside the modal.
- A recommendation already acted on or converted is not overwritten; the modal
  reports that it can no longer be edited.
- A missing or withdrawn linked recommendation is never recreated by this
  modal; the technician is told to re-flag or retry the finding.
- Repeated save attempts target the same linked pending recommendation.
- Cancelling preserves the automatic recommendation created by the Future or
  Now status.

## Testing

- A checklist interaction test verifies the button opens the modal without
  changing `window.location`.
- Service/action tests verify an existing linked pending recommendation is
  updated rather than duplicated.
- A missing-row test verifies the modal returns recovery guidance without
  creating a replacement.
- Modal tests verify successful save closes and marks the row, while errors keep
  the modal open.
- Existing inspection and recommendation suites must remain green.

## Out of scope

- Customer approval.
- Creating an approved work job.
- Sending work to the technician docket.
- Changing the automatic recommendation created by Future or Now statuses.
- Adding a schema migration or transactional recommendation-creation fallback.
