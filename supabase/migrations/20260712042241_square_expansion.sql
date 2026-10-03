-- OTOMOTO A–F expansion: contracts, fitment, Square, comms, portal, Wix bookings

-- ---------------------------------------------------------------------------
-- Phase A: Drop-off agreements
-- ---------------------------------------------------------------------------

CREATE TABLE drop_off_agreement_template (
  template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  title text NOT NULL,
  body_html text NOT NULL,
  initial_fields jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drop_off_agreement (
  agreement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_order (work_order_id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES drop_off_agreement_template (template_id),
  template_version text NOT NULL,
  signer_name text NOT NULL,
  initials jsonb NOT NULL DEFAULT '{}',
  signature_storage_path text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  signed_by_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_order_id)
);

CREATE INDEX idx_drop_off_agreement_wo ON drop_off_agreement (work_order_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contract-signatures',
  'contract-signatures',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Phase F: YMM fitment catalogue
-- ---------------------------------------------------------------------------

CREATE TABLE fitment_vehicle (
  vehicle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make text NOT NULL,
  model text NOT NULL,
  year_start integer NOT NULL,
  year_end integer NOT NULL,
  category text NOT NULL DEFAULT 'motorcycle',
  spec_data jsonb NOT NULL DEFAULT '{}',
  part_data jsonb NOT NULL DEFAULT '{}',
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_fitment_vehicle_key
  ON fitment_vehicle (lower(make), lower(model), year_start, year_end);

CREATE INDEX idx_fitment_vehicle_make ON fitment_vehicle (lower(make));
CREATE INDEX idx_fitment_vehicle_years ON fitment_vehicle (year_start, year_end);

CREATE TABLE fitment_import_run (
  import_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  row_count integer,
  error_message text,
  source_path text
);

-- ---------------------------------------------------------------------------
-- Phase B: Square billing + customer credits
-- ---------------------------------------------------------------------------

ALTER TABLE customer
  ADD COLUMN IF NOT EXISTS square_customer_id text,
  ADD COLUMN IF NOT EXISTS wix_contact_id text;

ALTER TABLE work_order
  ADD COLUMN IF NOT EXISTS square_invoice_id text,
  ADD COLUMN IF NOT EXISTS square_payment_status text
    CHECK (
      square_payment_status IS NULL
      OR square_payment_status IN (
        'draft',
        'unpaid',
        'partially_paid',
        'paid',
        'refunded',
        'cancelled'
      )
    ),
  ADD COLUMN IF NOT EXISTS wix_booking_id text,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'walk_in'
    CHECK (source IN ('walk_in', 'wix_booking', 'phone', 'other'));

CREATE TABLE customer_credit (
  credit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customer (customer_id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  remaining_amount numeric(12, 2) NOT NULL CHECK (remaining_amount >= 0),
  reason text NOT NULL,
  source_work_order_id uuid REFERENCES work_order (work_order_id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX idx_customer_credit_customer ON customer_credit (customer_id)
  WHERE remaining_amount > 0;

CREATE TABLE square_webhook_event (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  square_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Phase D: Communications
-- ---------------------------------------------------------------------------

CREATE TABLE communication_log (
  log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid REFERENCES work_order (work_order_id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customer (customer_id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'email')),
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  template_key text,
  to_address text NOT NULL,
  from_address text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'received')),
  external_id text,
  error_message text,
  sent_by_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_communication_log_wo ON communication_log (work_order_id, created_at DESC);
CREATE INDEX idx_communication_log_customer ON communication_log (customer_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Phase C: Customer portal tokens + inspection acknowledgement
-- ---------------------------------------------------------------------------

CREATE TABLE customer_portal_token (
  token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_order (work_order_id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL
    CHECK (purpose IN ('full', 'estimate', 'payment', 'inspection', 'contract')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz
);

CREATE INDEX idx_portal_token_wo ON customer_portal_token (work_order_id);

CREATE TABLE inspection_acknowledgement (
  acknowledgement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_order (work_order_id) ON DELETE CASCADE,
  inspection_id uuid NOT NULL REFERENCES inspection (inspection_id) ON DELETE CASCADE,
  signer_name text NOT NULL,
  signature_storage_path text,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  portal_token_id uuid REFERENCES customer_portal_token (token_id) ON DELETE SET NULL,
  UNIQUE (work_order_id, inspection_id)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE drop_off_agreement_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE drop_off_agreement ENABLE ROW LEVEL SECURITY;
ALTER TABLE fitment_vehicle ENABLE ROW LEVEL SECURITY;
ALTER TABLE fitment_import_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_credit ENABLE ROW LEVEL SECURITY;
ALTER TABLE square_webhook_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_portal_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_acknowledgement ENABLE ROW LEVEL SECURITY;

CREATE POLICY drop_off_agreement_template_select ON drop_off_agreement_template
  FOR SELECT TO authenticated USING (is_active_app_user());

CREATE POLICY drop_off_agreement_select ON drop_off_agreement
  FOR SELECT TO authenticated USING (is_active_app_user());

CREATE POLICY drop_off_agreement_write ON drop_off_agreement
  FOR INSERT TO authenticated WITH CHECK (is_active_app_user());

CREATE POLICY fitment_vehicle_select ON fitment_vehicle
  FOR SELECT TO authenticated USING (is_active_app_user());

CREATE POLICY fitment_import_run_select ON fitment_import_run
  FOR SELECT TO authenticated USING (is_active_app_user());

CREATE POLICY customer_credit_select ON customer_credit
  FOR SELECT TO authenticated USING (is_active_app_user());

CREATE POLICY customer_credit_write ON customer_credit
  FOR INSERT TO authenticated WITH CHECK (is_active_app_user());

CREATE POLICY customer_credit_update ON customer_credit
  FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

CREATE POLICY communication_log_select ON communication_log
  FOR SELECT TO authenticated USING (is_active_app_user());

CREATE POLICY communication_log_write ON communication_log
  FOR INSERT TO authenticated WITH CHECK (is_active_app_user());

CREATE POLICY customer_portal_token_select ON customer_portal_token
  FOR SELECT TO authenticated USING (is_active_app_user());

CREATE POLICY customer_portal_token_write ON customer_portal_token
  FOR INSERT TO authenticated WITH CHECK (is_active_app_user());

CREATE POLICY customer_portal_token_update ON customer_portal_token
  FOR UPDATE TO authenticated
  USING (is_active_app_user())
  WITH CHECK (is_active_app_user());

CREATE POLICY inspection_acknowledgement_select ON inspection_acknowledgement
  FOR SELECT TO authenticated USING (is_active_app_user());

CREATE POLICY contract_signatures_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'contract-signatures' AND is_active_app_user());

CREATE POLICY contract_signatures_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'contract-signatures' AND is_active_app_user());

-- Seed default drop-off agreement template (v1)
INSERT INTO drop_off_agreement_template (version, title, body_html, initial_fields)
VALUES (
  '2026-07-01',
  'Motorcycle Drop-Off & Service Agreement',
  '<h2>Toronto Moto — Drop-Off Agreement</h2>
<p>By signing below, the customer acknowledges and agrees to the following terms for motorcycle service at Toronto Moto.</p>
<section data-initial="liability"><h3>1. Liability &amp; Storage</h3>
<p>The shop is not responsible for loss or damage due to theft, fire, or events beyond reasonable control while the motorcycle is on premises. Storage fees may apply after 30 days following notification of completion.</p></section>
<section data-initial="authorization"><h3>2. Service Authorization</h3>
<p>Customer authorizes diagnostic inspection and the repair work described on this work order. Additional work requires separate approval.</p></section>
<section data-initial="parts"><h3>3. Parts &amp; Labour</h3>
<p>Quoted prices are estimates. Final invoice reflects actual parts and labour. Deposits are non-refundable once special-order parts are ordered.</p></section>
<section data-initial="condition"><h3>4. Vehicle Condition</h3>
<p>Customer confirms the motorcycle condition documented in intake photos accurately reflects its state at drop-off, including mileage and visible damage.</p></section>
<section data-initial="pickup"><h3>5. Pickup</h3>
<p>Customer agrees to pick up the motorcycle within 14 days of ready-for-pickup notification. Uncollected motorcycles may incur storage charges.</p></section>
<p><strong>Customer signature below confirms agreement to all sections.</strong></p>',
  '["liability","authorization","parts","condition","pickup"]'::jsonb
);
