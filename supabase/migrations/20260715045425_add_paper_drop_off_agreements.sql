-- Support physical drop-off agreements without requiring a digital signature image.

ALTER TABLE public.drop_off_agreement
  ADD COLUMN IF NOT EXISTS signature_method text NOT NULL DEFAULT 'digital';

ALTER TABLE public.drop_off_agreement
  DROP CONSTRAINT IF EXISTS drop_off_agreement_signature_method_check;

ALTER TABLE public.drop_off_agreement
  ADD CONSTRAINT drop_off_agreement_signature_method_check
  CHECK (signature_method IN ('digital', 'paper'));

ALTER TABLE public.drop_off_agreement
  ALTER COLUMN signature_storage_path DROP NOT NULL;

COMMENT ON COLUMN public.drop_off_agreement.signature_method IS
  'How the agreement was signed: digital in-app signature or a physical paper copy.';
