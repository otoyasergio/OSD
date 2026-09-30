-- Snapshot the visit customer on work orders so motorcycle ownership
-- transfers do not rewrite historical WO → customer identity.

ALTER TABLE work_order
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customer(customer_id) ON DELETE RESTRICT;

UPDATE work_order wo
SET customer_id = m.customer_id
FROM motorcycle m
WHERE wo.motorcycle_id = m.motorcycle_id
  AND wo.customer_id IS NULL;

ALTER TABLE work_order
  ALTER COLUMN customer_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS work_order_customer_id_idx
  ON work_order (customer_id);
