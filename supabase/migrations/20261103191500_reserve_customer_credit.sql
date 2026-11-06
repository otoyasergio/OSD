-- Store credit held on one Wix invoice.
-- reserve_customer_credit sets the amount an invoice holds to a target, in one
-- transaction: it draws from the customer's balances when the target is above
-- what the invoice holds, and gives the difference back when it is below. A
-- target of zero returns everything the invoice holds.

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
  v_status text;
  v_voided boolean;
  v_display_number text;
  v_delta bigint;
  v_moved bigint := 0;
  v_credit record;
  v_row_cents bigint;
  v_step bigint;
  v_reserved integer;
BEGIN
  IF p_customer_id IS NULL
    OR p_wix_invoice_id IS NULL
    OR btrim(p_wix_invoice_id) = ''
    OR p_target_cents IS NULL
    OR p_target_cents < 0 THEN
    RAISE EXCEPTION 'CREDIT_RESERVE_INVALID';
  END IF;

  SELECT customer_id, credit_applied_cents, status, voided, display_number
    INTO v_customer_id, v_applied, v_status, v_voided, v_display_number
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
  IF v_delta = 0 THEN
    RETURN v_applied;
  END IF;

  -- A paid or voided invoice can give credit back but cannot take more: the
  -- discount could no longer be written to it.
  IF v_delta > 0
    AND (v_voided OR upper(v_status) IN ('PAID', 'VOIDED', 'CANCELED', 'CLOSED')) THEN
    RAISE EXCEPTION 'WIX_INVOICE_SEALED';
  END IF;

  -- Every movement for this customer takes the same locks in the same order,
  -- so a draw on one invoice and a return on another wait instead of deadlock.
  PERFORM 1
  FROM public.customer_credit
  WHERE customer_id = p_customer_id
  ORDER BY created_at ASC, credit_id ASC
  FOR UPDATE;

  IF v_delta > 0 THEN
    -- Oldest balance first.
    FOR v_credit IN
      SELECT credit_id, remaining_amount
      FROM public.customer_credit
      WHERE customer_id = p_customer_id
        AND remaining_amount > 0
      ORDER BY created_at ASC, credit_id ASC
    LOOP
      EXIT WHEN v_moved >= v_delta;
      v_row_cents := round(v_credit.remaining_amount * 100)::bigint;
      v_step := LEAST(v_row_cents, v_delta - v_moved);
      UPDATE public.customer_credit
      SET remaining_amount = ((v_row_cents - v_step)::numeric / 100)
      WHERE credit_id = v_credit.credit_id;
      v_moved := v_moved + v_step;
    END LOOP;

    IF v_moved = 0 THEN
      RETURN v_applied;
    END IF;
    v_reserved := (v_applied::bigint + v_moved)::integer;
  ELSE
    -- Refill the balances that were drawn down, newest first: the reverse of
    -- the order a draw takes them in.
    FOR v_credit IN
      SELECT credit_id, amount, remaining_amount
      FROM public.customer_credit
      WHERE customer_id = p_customer_id
        AND remaining_amount < amount
      ORDER BY created_at DESC, credit_id DESC
    LOOP
      EXIT WHEN v_moved >= -v_delta;
      v_row_cents := round((v_credit.amount - v_credit.remaining_amount) * 100)::bigint;
      v_step := LEAST(v_row_cents, -v_delta - v_moved);
      UPDATE public.customer_credit
      SET remaining_amount = remaining_amount + (v_step::numeric / 100)
      WHERE credit_id = v_credit.credit_id;
      v_moved := v_moved + v_step;
    END LOOP;

    -- The balances it came from are gone or already full again.
    IF v_moved < -v_delta THEN
      INSERT INTO public.customer_credit (customer_id, amount, remaining_amount, reason)
      VALUES (
        p_customer_id,
        ((-v_delta - v_moved)::numeric / 100),
        ((-v_delta - v_moved)::numeric / 100),
        'Returned from invoice ' || v_display_number
      );
    END IF;
    v_reserved := p_target_cents;
  END IF;

  UPDATE public.wix_invoice
  SET credit_applied_cents = v_reserved,
      updated_at = now()
  WHERE wix_invoice_id = p_wix_invoice_id;

  RETURN v_reserved;
END;
$$;

COMMENT ON FUNCTION public.reserve_customer_credit(uuid, text, integer) IS
  'Set the store credit one invoice holds. Locks the invoice and the customer''s balances so a retry or a second invoice cannot spend the same credit.';

REVOKE ALL ON FUNCTION public.reserve_customer_credit(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_customer_credit(uuid, text, integer)
  TO service_role;
