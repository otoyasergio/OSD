CREATE OR REPLACE FUNCTION mint_work_order_number(p_location_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO work_order_sequence (location_id, next_number)
  VALUES (p_location_id, 1001)
  ON CONFLICT (location_id) DO NOTHING;

  UPDATE work_order_sequence
  SET next_number = next_number + 1
  WHERE location_id = p_location_id
  RETURNING next_number - 1 INTO n;

  RETURN 'WO-' || n::text;
END;
$$;
