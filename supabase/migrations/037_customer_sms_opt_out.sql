-- SMS opt-out flag for CASL / Twilio Advanced Opt-Out suppression
ALTER TABLE customer
  ADD COLUMN IF NOT EXISTS sms_opted_out_at timestamptz;

COMMENT ON COLUMN customer.sms_opted_out_at IS
  'When set, outbound SMS is blocked in-app (carrier STOP still handled by Twilio Advanced Opt-Out).';
