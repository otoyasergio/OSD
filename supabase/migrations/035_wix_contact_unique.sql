-- Version 035 is recorded on production (unique index on customer.wix_contact_id).
-- Kept as a no-op so fresh applies do not run before `customer` exists; the index is
-- created in 20260712043000_wix_contact_unique.sql after square_expansion.
SELECT 1;
