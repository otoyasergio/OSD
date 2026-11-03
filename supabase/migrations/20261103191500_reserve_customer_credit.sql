-- Reserve store credit onto one Wix invoice in a single transaction.
-- Two open invoices used to read the same balance and each subtract it, and a
-- failed follow-up write left the balance already reduced with nothing recorded
-- on the invoice. The next retry spent the credit again.

CREATE OR REPLACE FUNCTION public.reserve_customer_credit(
  p_customer_id uuid,
  p_wix_invoice_id text,
  p_target_cents integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_applied integer;
  v_delta bigint;
  v_taken bigint := 0;
  v_credit record;
  v_row_cents bigint;
  v_take bigint;
  v_reserved integer;
BEGIN
  IF p_customer_id IS NULL
    OR p_wix_invoice_id IS NULL
    OR btrim(p_wix_invoice_id) = ''
    OR p_target_cents IS NULL
    OR p_target_cents <= 0 THEN
    RAISE EXCEPTION 'CREDIT_RESERVE_INVALID';
  END IF;

  SELECT customer_id, credit_applied_cents
    INTO v_customer_id, v_applied
  FROM public.wix_invoice
  WHERE wix_invoice_id = p_wix_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WIX_INVOICE_NOT_FOUND';
  END IF;
  IF v_customer_id IS NOT NULL AND v_customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'CUSTOMER_MISMATCH';
  END IF;

  v_applied := COALESCE(v_applied, 0);
  v_delta := p_target_cents::bigint - v_applied::bigint;
  IF v_delta <= 0 THEN
    RETURN v_applied;
  END IF;

  -- Oldest balance first. Lock in a stable order so overlapping invoices wait
  -- instead of both spending the same row.
  FOR v_credit IN
    SELECT credit_id, remaining_amount
    FROM public.customer_credit
    WHERE customer_id = p_customer_id
      AND remaining_amount > 0
    ORDER BY created_at ASC, credit_id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_taken >= v_delta;
    v_row_cents := round(v_credit.remaining_amount * 100)::bigint;
    IF v_row_cents <= 0 THEN
      CONTINUE;
    END IF;
    v_take := LEAST(v_row_cents, v_delta - v_taken);
    UPDATE public.customer_credit
    SET remaining_amount = ((v_row_cents - v_take)::numeric / 100)
    WHERE credit_id = v_credit.credit_id;
    v_taken := v_taken + v_take;
  END LOOP;

  IF v_taken = 0 THEN
    RETURN v_applied;
  END IF;

  v_reserved := (v_applied::bigint + v_taken)::integer;
  UPDATE public.wix_invoice
  SET credit_applied_cents = v_reserved,
      updated_at = now()
  WHERE wix_invoice_id = p_wix_invoice_id;

  RETURN v_reserved;
END;
$$;

COMMENT ON FUNCTION public.reserve_customer_credit(uuid, text, integer) IS
  'Move store credit onto one invoice. Locks the invoice and open balances so a retry or a second invoice cannot spend the same credit.';

REVOKE ALL ON FUNCTION public.reserve_customer_credit(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_customer_credit(uuid, text, integer)
  TO service_role;
