# Wix invoices

Wix owns the invoice. The work order number is the Wix display number, for example `0003894`. Square records the money. QuickBooks keeps reading Square through the Square Connector.

The path stays off until both of these are exactly `1`:

- `WIX_INVOICES_ENABLED`
- `WIX_INVOICES_GATES_CONFIRMED`

Unset means the shop keeps the current Square invoice screens.

## Legacy invoices

This site still uses Wix's old invoices. Wix is rolling the new Invoices API out site by site, and it has not reached this one. Staff create, edit, and void invoices in Wix.

A `428`, or a refusal that the legacy invoices service is only available through Velo, means leave both switches unset. Do not call the new API to create or edit invoices until Wix enables it here.

Cash, e-transfer, cheque, and a terminal payment void the Wix invoice, and that store credit stays used. Staff also void an invoice to cancel a visit where the customer paid nothing. The app cannot tell those two voids apart without the new API, so it does not return store credit on a void. Staff put that credit back on the customer. When the new API is on this site, integrate Wix and Square together so a cancel can be told from a payment.

## Gates

`npm run check:wix-invoices` reads the latest number, the site legal name, and the Square location. It does not create an invoice.

`npm run check:wix-invoices -- --probe-draft` creates one draft, checks `numbering.displayNumber`, and deletes that draft. Set `WIX_GATE_PROBE_CONTACT_ID` first. A `428`, or a draft with no display number, means the flag stays off. The app does not write Wix numbering settings and does not invent a number.

The site business name must be **OTOMOTO TORONTO MOTO INC.** Prices sent to Wix are pre-tax. Wix adds Ontario HST.

The invoice webhook accepts the shared secret, then loads the invoice from Wix by id. While either switch is unset it records nothing. A delete removes the local row only after Wix answers that the invoice is gone.

## Cutover from main

Production deploys only from `main` with `npm run deploy:production`.

1. Merge with both switches unset and deploy from `main`.
2. Apply the `wix_invoice` migration to production.
3. Run `npm run import:wix-invoices` against production only with `IMPORT_WIX_INVOICES_CONFIRM=1`. The import does not create work orders and does not renumber existing ones. It links a work order when the number already equals a display number. Invoices already paid in Wix are stored and are not asked to be squared.
4. Run `npm run square:cancel-open-invoices` and read the list. It does not cancel anything.
5. After that list is confirmed, check out `main` and run `CONFIRM_CANCEL_OPEN_SQUARE_INVOICES=1 npm run square:cancel-open-invoices -- --confirm`. Paid invoices are not in the list. Do not cancel from a feature branch.
6. Set both switches to `1`. Watch the invoice webhook and the first intake. A `428` or a draft with no display number means set both switches back to unset.
7. Confirm one PayPal payment squares once, one terminal payment is chosen and not charged again, and a technician cannot see the amounts.

## Payments

PayPal on the Wix invoice is written to Square once, named with the client and the invoice number. Any other Wix payment waits for Yes from an owner, manager, or service advisor. Not yet stays on the list as paid on Wix and not squared. A second Yes does nothing.

Cash, e-transfer, cheque, and a terminal payment void the Wix invoice. Staff pick the Square terminal payment or record the offline amount. The visit is squared when that Square total equals the amount staff recorded.

A voided invoice stays on the customer and the motorcycle and is left out of the square question.

Publishing sends the invoice through Wix. The app does not send a second copy.

## Licence scan

The intake customer step and the customer form read the PDF417 barcode in Safari with the rear camera. Licence number and expiry are stored on `customer_private_profile` for owner, manager, service advisor, and admin. They are not sent to Wix and are not used in a promotion.
