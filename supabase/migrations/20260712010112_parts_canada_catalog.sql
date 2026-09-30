-- Parts Canada local catalog + pricing fields on work-order part lines.
-- Catalog is synced from Parts Canada inventory file (nightly ZIP/CSV).
-- Ordering remains manual; API is lookup/pricing/stock only.

ALTER TABLE part
  ADD COLUMN IF NOT EXISTS unit_price numeric(12, 2),
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12, 2),
  ADD COLUMN IF NOT EXISTS supplier_stock integer,
  ADD COLUMN IF NOT EXISTS catalog_source text
    CHECK (catalog_source IS NULL OR catalog_source IN ('parts_canada', 'manual'));

COMMENT ON COLUMN part.unit_price IS 'Sell price (typically Parts Canada MSRP); editable per line.';
COMMENT ON COLUMN part.unit_cost IS 'Dealer cost; visible only to owner/manager/service_advisor/admin.';
COMMENT ON COLUMN part.supplier_stock IS 'Supplier qty snapshot when the part was added or last refreshed.';
COMMENT ON COLUMN part.catalog_source IS 'Where the line was sourced from.';

CREATE TABLE parts_canada_catalog (
  part_number text PRIMARY KEY,
  old_part_number text,
  manufacturer_part_number text,
  upc_code text,
  brand text,
  description_en text,
  description_fr text,
  msrp numeric(12, 2),
  dealer_price numeric(12, 2),
  dealer_net_price numeric(12, 2),
  qty_cal integer,
  qty_lon integer,
  commodity_code text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_parts_canada_catalog_brand
  ON parts_canada_catalog (brand);

CREATE INDEX idx_parts_canada_catalog_description_en
  ON parts_canada_catalog USING gin (
    to_tsvector('english', coalesce(description_en, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(part_number, ''))
  );

CREATE TABLE parts_canada_sync_run (
  sync_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL
    CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  row_count integer,
  error_message text,
  triggered_by text
    CHECK (triggered_by IS NULL OR triggered_by IN ('cron', 'manual')),
  triggered_by_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL
);

CREATE INDEX idx_parts_canada_sync_run_started
  ON parts_canada_sync_run (started_at DESC);

-- Board hot path: needed / in_stock / ordered
CREATE INDEX IF NOT EXISTS idx_part_status_board
  ON part (status)
  WHERE status IN ('needed', 'in_stock', 'ordered');

ALTER TABLE parts_canada_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts_canada_sync_run ENABLE ROW LEVEL SECURITY;

-- Catalog is read-only for authenticated shop users; writes use service role.
CREATE POLICY parts_canada_catalog_select ON parts_canada_catalog
  FOR SELECT TO authenticated
  USING (is_active_app_user());

CREATE POLICY parts_canada_sync_run_select ON parts_canada_sync_run
  FOR SELECT TO authenticated
  USING (is_active_app_user());
