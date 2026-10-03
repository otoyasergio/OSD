-- Control Center work timer: when front office "Opens" a bike on the board.

ALTER TABLE work_order
  ADD COLUMN IF NOT EXISTS opened_at timestamptz;
