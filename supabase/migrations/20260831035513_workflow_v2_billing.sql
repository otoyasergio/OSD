-- Workflow V2 phase 6/7: invoice, payment, and credit ledger plus external
-- provider document tracking and idempotent integration events.

CREATE TABLE IF NOT EXISTS invoice (
  invoice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES location(location_id) ON DELETE RESTRICT,
  estimate_version_id uuid REFERENCES estimate_version(estimate_version_id) ON DELETE SET NULL,
  invoice_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'issued', 'partially_paid', 'paid', 'void', 'refunded')
  ),
  currency text NOT NULL DEFAULT 'CAD',
  subtotal_cents bigint NOT NULL DEFAULT 0,
  discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents bigint NOT NULL DEFAULT 0,
  balance_cents bigint NOT NULL DEFAULT 0,
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  created_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_work_order ON invoice (work_order_id);

CREATE TABLE IF NOT EXISTS invoice_line (
  invoice_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoice(invoice_id) ON DELETE CASCADE,
  job_id uuid REFERENCES job(job_id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('labor', 'part', 'fee', 'discount', 'package')),
  description text NOT NULL,
  quantity numeric(10, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount_cents bigint NOT NULL,
  extended_amount_cents bigint NOT NULL,
  tax_code text NOT NULL DEFAULT 'HST',
  tax_rate_bps integer NOT NULL DEFAULT 1300 CHECK (tax_rate_bps >= 0),
  tax_amount_cents bigint NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invoice_line_invoice
  ON invoice_line (invoice_id, position);

CREATE TABLE IF NOT EXISTS payment_request (
  payment_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoice(invoice_id) ON DELETE SET NULL,
  request_type text NOT NULL CHECK (request_type IN ('deposit', 'invoice', 'balance')),
  provider text NOT NULL DEFAULT 'square',
  requested_amount_cents bigint NOT NULL CHECK (requested_amount_cents > 0),
  external_document_id text,
  external_status text,
  public_url text,
  idempotency_key text,
  created_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_request_idempotency
  ON payment_request (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment (
  payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid REFERENCES payment_request(payment_request_id) ON DELETE SET NULL,
  work_order_id uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'square',
  provider_transaction_id text NOT NULL,
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'CAD',
  status text NOT NULL CHECK (
    status IN ('pending', 'succeeded', 'failed', 'voided', 'partially_refunded', 'refunded')
  ),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_work_order ON payment (work_order_id);

CREATE TABLE IF NOT EXISTS credit_ledger_entry (
  credit_entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customer(customer_id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('grant', 'use', 'refund', 'expiry', 'adjustment')),
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
  source text,
  notes text,
  related_work_order_id uuid REFERENCES work_order(work_order_id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_customer
  ON credit_ledger_entry (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS credit_application (
  application_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_entry_id uuid NOT NULL REFERENCES credit_ledger_entry(credit_entry_id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES invoice(invoice_id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_allocation (
  allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid REFERENCES payment(payment_id) ON DELETE CASCADE,
  credit_entry_id uuid REFERENCES credit_ledger_entry(credit_entry_id) ON DELETE SET NULL,
  invoice_id uuid NOT NULL REFERENCES invoice(invoice_id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_allocation_source CHECK (
    payment_id IS NOT NULL OR credit_entry_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_payment_allocation_invoice
  ON payment_allocation (invoice_id);

CREATE TABLE IF NOT EXISTS external_billing_document (
  document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'square',
  document_kind text NOT NULL CHECK (
    document_kind IN ('draft_invoice', 'invoice', 'deposit_invoice', 'refund', 'payment_link')
  ),
  work_order_id uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
  internal_table text,
  internal_id uuid,
  external_id text NOT NULL,
  external_version integer,
  external_status text,
  public_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_external_billing_document_wo
  ON external_billing_document (work_order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS integration_event (
  integration_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_event_id text NOT NULL,
  object_type text,
  object_id text,
  object_version text,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'received' CHECK (
    status IN ('received', 'processing', 'processed', 'failed', 'ignored')
  ),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  UNIQUE (provider, external_event_id)
);

-- RLS: financial data is front office/admin only; writes via commands/service role.
ALTER TABLE invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_application ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_billing_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_select ON invoice;
CREATE POLICY invoice_select ON invoice
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
    AND location_id IN (SELECT public.user_location_ids())
  );

DROP POLICY IF EXISTS invoice_line_select ON invoice_line;
CREATE POLICY invoice_line_select ON invoice_line
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
    AND EXISTS (
      SELECT 1 FROM invoice i
      WHERE i.invoice_id = invoice_line.invoice_id
        AND i.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS payment_request_select ON payment_request;
CREATE POLICY payment_request_select ON payment_request
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
  );

DROP POLICY IF EXISTS payment_select ON payment;
CREATE POLICY payment_select ON payment
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
  );

DROP POLICY IF EXISTS credit_ledger_entry_select ON credit_ledger_entry;
CREATE POLICY credit_ledger_entry_select ON credit_ledger_entry
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
  );

DROP POLICY IF EXISTS credit_application_select ON credit_application;
CREATE POLICY credit_application_select ON credit_application
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
  );

DROP POLICY IF EXISTS payment_allocation_select ON payment_allocation;
CREATE POLICY payment_allocation_select ON payment_allocation
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
  );

DROP POLICY IF EXISTS external_billing_document_select ON external_billing_document;
CREATE POLICY external_billing_document_select ON external_billing_document
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'service_advisor', 'admin')
  );

DROP POLICY IF EXISTS integration_event_select ON integration_event;
CREATE POLICY integration_event_select ON integration_event
  FOR SELECT TO authenticated
  USING (
    is_active_app_user()
    AND current_app_user_role() IN ('owner', 'manager', 'admin')
  );

-- Payments and issued invoices are financial evidence: append-only except
-- for sanctioned status transitions performed inside definer commands.
DROP TRIGGER IF EXISTS trg_payment_append_only ON payment;
CREATE TRIGGER trg_payment_append_only
  BEFORE DELETE ON payment
  FOR EACH ROW EXECUTE FUNCTION public.workflow_v2_reject_evidence_mutation();

DROP TRIGGER IF EXISTS trg_payment_allocation_append_only ON payment_allocation;
CREATE TRIGGER trg_payment_allocation_append_only
  BEFORE UPDATE OR DELETE ON payment_allocation
  FOR EACH ROW EXECUTE FUNCTION public.workflow_v2_reject_evidence_mutation();

DROP TRIGGER IF EXISTS trg_credit_ledger_append_only ON credit_ledger_entry;
CREATE TRIGGER trg_credit_ledger_append_only
  BEFORE UPDATE OR DELETE ON credit_ledger_entry
  FOR EACH ROW EXECUTE FUNCTION public.workflow_v2_reject_evidence_mutation();
