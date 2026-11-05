-- One staff decision per client-action occurrence. Sending or dismissing
-- a card records the occurrence so the same prompt does not return until
-- the underlying visit or reminder cycle starts again.

CREATE TABLE public.client_action_resolution (
  resolution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.location(location_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customer(customer_id) ON DELETE CASCADE,
  motorcycle_id uuid REFERENCES public.motorcycle(motorcycle_id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.work_order(work_order_id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (
    reason IN (
      'reply',
      'approval',
      'parts',
      'pickup',
      'pickup_week',
      'shop_days',
      'annual',
      'oil',
      'birthday'
    )
  ),
  cycle_key text NOT NULL CHECK (char_length(cycle_key) BETWEEN 1 AND 2000),
  outcome text NOT NULL CHECK (outcome IN ('sent', 'dismissed')),
  snooze_until date,
  communication_log_id uuid REFERENCES public.communication_log(log_id) ON DELETE SET NULL,
  acted_by_user_id uuid REFERENCES public.app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_action_resolution_occurrence UNIQUE (location_id, reason, cycle_key)
);

COMMENT ON TABLE public.client_action_resolution IS
  'Staff send or dismiss for one client-action card. Visit cards stay cleared for that occurrence. Reminder dismissals store snooze_until.';

CREATE INDEX idx_client_action_resolution_location
  ON public.client_action_resolution (location_id, updated_at DESC);

ALTER TABLE public.client_action_resolution ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_action_resolution_select
  ON public.client_action_resolution
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
    AND (SELECT public.current_app_user_role()) = ANY (
      ARRAY['owner'::text, 'manager'::text, 'service_advisor'::text]
    )
  );

CREATE POLICY client_action_resolution_insert
  ON public.client_action_resolution
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
    AND (SELECT public.current_app_user_role()) = ANY (
      ARRAY['owner'::text, 'manager'::text, 'service_advisor'::text]
    )
  );

CREATE POLICY client_action_resolution_update
  ON public.client_action_resolution
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
    AND (SELECT public.current_app_user_role()) = ANY (
      ARRAY['owner'::text, 'manager'::text, 'service_advisor'::text]
    )
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND location_id IN (SELECT public.user_location_ids())
    AND (SELECT public.current_app_user_role()) = ANY (
      ARRAY['owner'::text, 'manager'::text, 'service_advisor'::text]
    )
  );

REVOKE ALL ON TABLE public.client_action_resolution FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.client_action_resolution TO authenticated;
GRANT ALL ON TABLE public.client_action_resolution TO service_role;
