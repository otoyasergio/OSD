-- Work-order Square billing lifecycle (estimate draft → publish → deposit/balance)

ALTER TABLE work_order
  ADD COLUMN IF NOT EXISTS billing_stage text NOT NULL DEFAULT 'none'
    CHECK (
      billing_stage IN (
        'none',
        'draft',
        'awaiting_approval',
        'ready_to_invoice',
        'invoiced',
        'paid'
      )
    ),
  ADD COLUMN IF NOT EXISTS square_invoice_public_url text,
  ADD COLUMN IF NOT EXISTS billing_amount_mode text
    CHECK (
      billing_amount_mode IS NULL
      OR billing_amount_mode IN (
        'full',
        'deposit_percent',
        'custom',
        'balance'
      )
    ),
  ADD COLUMN IF NOT EXISTS billing_amount_cents integer,
  ADD COLUMN IF NOT EXISTS billing_collected_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimate_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_published_at timestamptz;

-- Existing Square invoices were created at pickup as published unpaid/paid
UPDATE work_order
SET billing_stage = CASE
  WHEN square_payment_status = 'paid' THEN 'paid'
  WHEN square_invoice_id IS NOT NULL THEN 'invoiced'
  ELSE billing_stage
END
WHERE square_invoice_id IS NOT NULL;
