-- One Google mailbox per location for customer email. The refresh token is
-- readable only by the service role. Owners connect it from Settings.

CREATE TABLE public.shop_mailbox (
  location_id uuid PRIMARY KEY REFERENCES public.location(location_id) ON DELETE CASCADE,
  email_address text NOT NULL,
  refresh_token text NOT NULL,
  connected_by_user_id uuid REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_mailbox_email_length CHECK (char_length(email_address) BETWEEN 3 AND 320),
  CONSTRAINT shop_mailbox_token_length CHECK (char_length(refresh_token) BETWEEN 20 AND 2048)
);

COMMENT ON TABLE public.shop_mailbox IS
  'Google mailbox that sends customer email for a location. Refresh token is service-role only.';

REVOKE ALL ON TABLE public.shop_mailbox FROM anon;
REVOKE ALL ON TABLE public.shop_mailbox FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shop_mailbox TO service_role;

ALTER TABLE public.shop_mailbox ENABLE ROW LEVEL SECURITY;
