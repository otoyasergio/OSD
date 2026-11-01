# Private client details design

**Date:** 2026-10-31
**Status:** Approved

## Goal

Give authorized front-office staff two private client fields:

- **Personal details** for relationship context such as weddings, birthday plans,
  interests, and preferences.
- **Work / occupation** for what the client does professionally.

The details appear on the customer profile and during work-order intake. They
must never appear to technicians, customers, or other unauthorized roles.

## Access model

| Action      | Roles                                                   |
| ----------- | ------------------------------------------------------- |
| View / edit | `owner`, `manager`, `service_advisor`, and `admin` only |

Authorization is enforced twice:

1. Server services reject every other role.
2. Row-level security returns no rows and permits no writes for every other
   authenticated role or anonymous request.

Hiding the section in the interface is not an authorization control. Database
operators and the Supabase service role retain their inherent administrative
access, but no customer-facing or unauthorized staff application path receives
these values.

## Data model

Create a one-to-one `customer_private_profile` table instead of adding the
fields to `customer`:

- `customer_id` uuid primary key and foreign key to `customer`, cascading on
  customer deletion
- `personal_details` text nullable
- `occupation` text nullable
- `updated_by_user_id` uuid nullable foreign key to `app_user`
- `created_at` timestamptz
- `updated_at` timestamptz

An empty form removes the private-profile row. Inputs are trimmed, blank values
become `null`, personal details are limited to 4,000 characters, and occupation
is limited to 200 characters.

Keeping the values outside `customer` prevents broad customer queries, search
responses, Wix synchronization, portal code, and future customer exports from
receiving them accidentally.

## Existing notes migration

The current general customer **Notes** field is replaced in the interface.
Existing non-empty notes are copied verbatim into `personal_details`, then
cleared from `customer.notes`.

The old column remains temporarily as a deprecated, empty compatibility column
so schema rollout cannot break an older application instance. New application
code neither selects nor writes it. A later cleanup migration may drop it after
the rollout is established.

## Application boundaries

Add explicit private-detail permission helpers and a focused service for:

- loading one customer's private profile
- upserting normalized private details
- deleting the row when both fields are blank

The regular `Customer` type and `CUSTOMER_COLUMNS` selection do not contain the
private fields. Customer search and picker APIs continue returning only ordinary
customer data.

Private-profile updates create an audit event containing the customer id and
the names of changed fields only. The private text itself is never duplicated
into `audit_log.old_value`, `audit_log.new_value`, descriptions, logs, or error
messages.

## Customer profile experience

Replace the general Notes input with a separate **Private staff details** card
on the customer profile. The card has a lock indicator, a persistent
“Owner, manager, advisor, and admin only — never shared with the customer”
message, a multiline Personal details field, and a single-line Work /
occupation field.

The private form saves independently from ordinary contact details. This keeps
private writes out of the customer update and Wix synchronization flow. New
customers can receive private details after their profile exists.

## Work-order intake experience

After an authorized user selects a customer, intake loads that customer's
private profile through a dedicated server action and shows a compact,
read-only **Private staff details** card. It does not preload private data for
all customer options or include the data in typeahead responses.

Changing the selected customer clears the previous private details immediately
before loading the new selection. A load failure shows a neutral
“Private details unavailable” state and does not block intake.

## Non-disclosure requirements

The two private values are excluded from:

- customer search and duplicate-check responses
- Wix contact synchronization and webhooks
- customer portals and estimate links
- vehicle passports and public share links
- contracts, invoices, notifications, email, SMS, and voice payloads
- AI-assistant context and prompts
- reports, exports, and generic customer audit snapshots

No customer-facing route imports the private-profile service.

## Error handling

- Unauthorized reads and writes fail with `FORBIDDEN`; RLS remains the final
  defense if a service check is bypassed.
- Validation errors attach to the relevant private field without changing
  ordinary customer data.
- Missing private rows are treated as two blank fields.
- Intake remains usable if private details cannot be loaded.

## Verification

- Unit-test the exact four-role permission matrix and field validation.
- Run local Supabase RLS tests proving the four allowed roles can read/write,
  while technicians, head technicians, kiosk users, inactive users, and
  anonymous requests cannot read or mutate a row.
- Test that legacy notes migrate into `personal_details` and are cleared from
  the ordinary customer row.
- Test that customer search, Wix, portal, passport, reporting, and AI paths do
  not select or serialize private fields.
- Browser-test saving and reloading both fields on a customer profile, then
  selecting that customer during intake and seeing the read-only card.
- Browser-test that technician navigation and direct requests do not expose the
  private section or its data.

## Out of scope

- Showing private details on work-order pages after intake
- Searching or filtering customers by private details
- Customer self-service editing
- Field-level history containing the private text
- Encrypting individual field values with a separate application-managed key
