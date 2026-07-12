-- Wix CRM / invoicing bridge (external IDs only; billing stays in Wix)

ALTER TABLE customer
  ADD COLUMN IF NOT EXISTS wix_contact_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_wix_contact_id
  ON customer (wix_contact_id)
  WHERE wix_contact_id IS NOT NULL;

ALTER TABLE work_order
  ADD COLUMN IF NOT EXISTS wix_invoice_id text;

CREATE INDEX IF NOT EXISTS idx_work_order_wix_invoice_id
  ON work_order (wix_invoice_id)
  WHERE wix_invoice_id IS NOT NULL;
