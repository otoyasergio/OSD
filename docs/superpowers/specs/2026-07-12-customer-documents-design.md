# Customer documents design

**Date:** 2026-07-12  
**Status:** Approved

## Goal

Store customer-facing files on the customer profile: auto-file signed drop-off agreements, and allow staff to upload other documents (insurance, registration, etc.).

## Approach

Unified `customer_document` table. Manual uploads use a private `customer-documents` storage bucket. Signed contracts reuse existing `contract-signatures` paths via a document row linked to `drop_off_agreement`.

## Permissions

| Action        | Roles                                  |
| ------------- | -------------------------------------- |
| View / upload | owner, manager, admin, service_advisor |
| Delete        | owner, manager only                    |

Technicians have no access. Role checks are enforced in the service layer (same pattern as intake photos).

## Data model

`customer_document`:

- `document_id` uuid PK
- `customer_id` uuid FK → customer
- `title` text
- `source` text: `upload` | `drop_off_agreement`
- `work_order_id` uuid nullable FK
- `agreement_id` uuid nullable unique FK → drop_off_agreement
- `storage_bucket` text
- `storage_path` text
- `mime_type` text
- `file_size` integer nullable
- `uploaded_by_user_id` uuid nullable
- `created_at` timestamptz

## Sign flow

After successful shop or portal contract sign, insert a document titled like `Drop-off agreement — {WO#} ({date})`. Unique on `agreement_id` prevents duplicates.

## Profile UI

Documents section on customer detail: list, view/download signed URL, upload (PDF/JPEG/PNG ≤ 10MB), delete for owner/manager.

## Out of scope

- PDF of full contract body
- Customer portal self-upload
- Deleting a profile document does not delete the work-order agreement row
