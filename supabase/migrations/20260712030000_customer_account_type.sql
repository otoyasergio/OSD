-- V2 Task 15: fleet / commercial customer account tags

ALTER TABLE customer
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'retail'
    CHECK (account_type IN ('retail', 'fleet', 'commercial'));

CREATE INDEX IF NOT EXISTS idx_customer_account_type
  ON customer (account_type);
