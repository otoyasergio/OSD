-- Dual SMS consent + audit log for Twilio / CASL verification

ALTER TABLE customer
  ADD COLUMN IF NOT EXISTS sms_transactional_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_marketing_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_consent_source text;

COMMENT ON COLUMN customer.sms_transactional_consent_at IS
  'When set, customer opted in to transactional/service SMS.';
COMMENT ON COLUMN customer.sms_marketing_consent_at IS
  'When set, customer opted in to marketing/promotional SMS.';
COMMENT ON COLUMN customer.sms_consent_source IS
  'Last consent UI touch: web_form | staff | portal | inbound_sms. Non-null ends soft-rollout allow.';

CREATE TABLE IF NOT EXISTS sms_consent_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customer (customer_id) ON DELETE CASCADE,
  program text NOT NULL CHECK (program IN ('transactional', 'marketing', 'all')),
  action text NOT NULL CHECK (action IN ('opt_in', 'opt_out')),
  method text NOT NULL CHECK (method IN ('web_form', 'staff', 'portal', 'inbound_sms')),
  source_path text,
  actor_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_consent_event_customer
  ON sms_consent_event (customer_id, created_at DESC);

ALTER TABLE sms_consent_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY sms_consent_event_select ON sms_consent_event
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY sms_consent_event_insert ON sms_consent_event
  FOR INSERT TO authenticated
  WITH CHECK (true);
