# Pickup Message Vehicle Details Design

## Goal

Ready-for-pickup SMS and email messages must identify the customer's motorcycle
without exposing an invoice or work-order number and without including a payment
or portal link.

## Scope

The change applies to both ways a ready-for-pickup message can be sent:

1. The combined SMS-and-email notice offered after a work order moves to Ready
   for Pickup.
2. The manual `ready_for_pickup` template in the work-order communications
   panel.

Approval requests, contract links, payment reminders, and portal functionality
outside the pickup template are unchanged.

## Message Content

Each pickup message will include:

- the customer's first name;
- the motorcycle as `Year Make Model`;
- `VIN: <VIN>` when a VIN is recorded;
- `VIN not on file` when the motorcycle has no VIN;
- the Toronto pickup address, business hours, phone details where currently
  applicable, and the SMS opt-out footer.

The email subject will use the motorcycle description, for example:
`Ready for pickup — 2022 Honda CB500F`.

Pickup SMS, email subject, HTML body, and plain-text body must not contain:

- the work-order or invoice number;
- a payment link;
- a customer portal link or payment call to action.

## Architecture and Data Flow

The existing shared pickup renderer remains the single source of pickup copy.
Its pickup-specific input will receive motorcycle year, make, model, and nullable
VIN rather than using the work-order number or portal URL.

The combined pickup-notice service will join the work order's motorcycle and
pass its details to the renderer. It will no longer create a portal token because
pickup messages cannot contain a portal link.

The manual communications service will also join the motorcycle and pass those
details into the same renderer. Portal-token creation will be skipped for the
`ready_for_pickup` template while remaining unchanged for templates that need a
link.

No database migration or persisted-data change is required.

## Missing Data and Safety

VIN is nullable, so a missing or blank VIN will render as `VIN not on file` and
will not block delivery. Year, make, and model retain their database-backed
values. Dynamic values in the HTML email will continue to be HTML-escaped.

Existing channel validation, SMS consent checks, Toronto-location restriction,
delivery logging, deduplication, and failure handling remain unchanged.

## Testing

Regression tests will verify:

1. SMS, email subject, HTML, and plain text contain Year, Make, Model, and VIN.
2. Missing VIN renders `VIN not on file` and delivery remains allowed.
3. Pickup output contains neither the work-order/invoice number nor any portal
   or payment link.
4. The combined pickup service loads motorcycle details and does not create a
   portal token.
5. Both automatic and manual pickup sends use the same vehicle-based renderer,
   while link-bearing non-pickup templates retain their existing behavior.
