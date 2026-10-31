-- One weekly shop report email per location week.
-- The pickup dedupe index includes work_order_id. A shop-wide row has a null
-- work order, and Postgres does not treat those nulls as duplicates.

CREATE UNIQUE INDEX IF NOT EXISTS communication_log_weekly_shop_report_dedupe
  ON public.communication_log (template_key, dedupe_key)
  WHERE template_key = 'weekly_shop_report'
    AND dedupe_key IS NOT NULL;
