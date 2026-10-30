-- One automatic pickup notice per channel for a Ready placement.
-- Manual sends leave dedupe_key null, so the message panel can send again.

ALTER TABLE public.communication_log
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS communication_log_pickup_notice_dedupe
  ON public.communication_log (work_order_id, channel, template_key, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

COMMENT ON COLUMN public.communication_log.dedupe_key IS
  'Ready-for-pickup confirmation key (ready_for_pickup_at). Null for manual sends.';
