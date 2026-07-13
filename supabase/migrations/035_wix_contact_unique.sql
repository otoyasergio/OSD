-- Unique index for Wix CRM contact linkage (column already added in 019_square_expansion)

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_wix_contact_id
  ON customer (wix_contact_id)
  WHERE wix_contact_id IS NOT NULL;
