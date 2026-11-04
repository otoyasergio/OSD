-- Scan reports arrive in their own Google mailbox. The customer mailbox
-- stays send-only. The refresh token is readable only by the service role.

CREATE TABLE public.scan_mailbox (
  location_id uuid PRIMARY KEY REFERENCES public.location(location_id) ON DELETE CASCADE,
  email_address text NOT NULL,
  refresh_token text NOT NULL,
  connected_by_user_id uuid REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scan_mailbox_email_length CHECK (char_length(email_address) BETWEEN 3 AND 320),
  CONSTRAINT scan_mailbox_token_length CHECK (char_length(refresh_token) BETWEEN 20 AND 2048)
);

COMMENT ON TABLE public.scan_mailbox IS
  'Google mailbox that receives TopGuru scan reports. Read-only token. Service-role only.';

REVOKE ALL ON TABLE public.scan_mailbox FROM anon;
REVOKE ALL ON TABLE public.scan_mailbox FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scan_mailbox TO service_role;

ALTER TABLE public.scan_mailbox ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.scan_report (
  scan_report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.location(location_id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL,
  subject text NOT NULL DEFAULT '',
  from_address text NOT NULL DEFAULT '',
  outcome text NOT NULL CHECK (outcome IN ('codes', 'no_codes', 'no_connection', 'needs_confirmation')),
  vin_in_report text,
  codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  report_text text NOT NULL DEFAULT '',
  inspection_id uuid REFERENCES public.inspection(inspection_id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.work_order(work_order_id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scan_report_message_unique UNIQUE (location_id, gmail_message_id)
);

COMMENT ON TABLE public.scan_report IS
  'A TopGuru report read from the scans mailbox and filed on an open inspection when the VIN matches.';

CREATE INDEX scan_report_location_received_idx
  ON public.scan_report (location_id, received_at DESC);

REVOKE ALL ON TABLE public.scan_report FROM anon;
REVOKE ALL ON TABLE public.scan_report FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scan_report TO service_role;

ALTER TABLE public.scan_report ENABLE ROW LEVEL SECURITY;
