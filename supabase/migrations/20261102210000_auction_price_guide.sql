-- Realized motorcycle auction sales for the customer price guide.
-- Lots are shared reference data (no customer PII). Snapshots cache one guide
-- per motorcycle so the portal does not query the provider on every view.
-- Staff and customers read both through the service role after an auth or
-- portal-token check. There is no direct browser grant.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.auction_lot (
  auction_lot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_lot_id text NOT NULL,
  title text NOT NULL,
  make text NOT NULL,
  make_key text NOT NULL,
  model text NOT NULL DEFAULT '',
  model_year integer,
  vendor text,
  sale_date date,
  status text NOT NULL,
  price_usd_cents bigint,
  hammer_amount_cents bigint,
  hammer_currency text,
  location text,
  country text,
  lot_url text,
  search_text text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auction_lot_source_id UNIQUE (source, source_lot_id),
  CONSTRAINT auction_lot_source_slug CHECK (source ~ '^[a-z][a-z0-9_]{0,39}$'),
  CONSTRAINT auction_lot_title CHECK (char_length(title) BETWEEN 1 AND 400),
  CONSTRAINT auction_lot_make CHECK (char_length(make) BETWEEN 1 AND 80),
  CONSTRAINT auction_lot_status CHECK (status IN ('sold', 'unsold', 'withdrawn', 'unknown')),
  CONSTRAINT auction_lot_model_year CHECK (
    model_year IS NULL OR (model_year BETWEEN 1885 AND 2100)
  ),
  CONSTRAINT auction_lot_price CHECK (
    price_usd_cents IS NULL OR price_usd_cents > 0
  ),
  CONSTRAINT auction_lot_hammer CHECK (
    hammer_amount_cents IS NULL OR hammer_amount_cents > 0
  ),
  CONSTRAINT auction_lot_currency CHECK (
    hammer_currency IS NULL OR hammer_currency ~ '^[A-Z]{3}$'
  ),
  CONSTRAINT auction_lot_url CHECK (
    lot_url IS NULL OR (char_length(lot_url) <= 1000 AND lot_url ~ '^https?://')
  )
);

COMMENT ON TABLE public.auction_lot IS
  'Realized motorcycle auction lots from ALT/FNDATA and imported auction files. Not a shop appraisal.';

CREATE INDEX auction_lot_make_key_idx ON public.auction_lot (make_key);
CREATE INDEX auction_lot_search_trgm_idx
  ON public.auction_lot
  USING gin (search_text gin_trgm_ops);

CREATE TABLE public.auction_price_snapshot (
  motorcycle_id uuid PRIMARY KEY
    REFERENCES public.motorcycle (motorcycle_id) ON DELETE CASCADE,
  year integer NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  guide jsonb NOT NULL,
  provider_status text NOT NULL,
  provider_message text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auction_price_snapshot_status CHECK (
    provider_status IN ('ready', 'empty', 'not_configured', 'unavailable', 'error')
  )
);

COMMENT ON TABLE public.auction_price_snapshot IS
  'Cached auction price guide for one motorcycle. Rebuilt when the bike identity or sale set changes.';

ALTER TABLE public.auction_lot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_price_snapshot ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auction_lot FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.auction_price_snapshot FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auction_lot TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auction_price_snapshot TO service_role;
