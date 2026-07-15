ALTER TABLE public.customer
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS date_of_birth date;

COMMENT ON COLUMN public.customer.address IS
  'Optional single-line customer mailing or residential address.';

COMMENT ON COLUMN public.customer.date_of_birth IS
  'Optional customer birthday stored as a calendar date.';
