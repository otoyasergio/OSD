-- Operational indexes for dashboard board, parts waiting, and common FK joins.
-- Partial indexes match hot filters used by lib/services/dashboard.ts and partsBoard.ts.

-- Active work orders by location (shop board / dashboard)
CREATE INDEX IF NOT EXISTS idx_work_order_status_location
  ON work_order (location_id, status)
  WHERE status NOT IN ('completed', 'cancelled');

-- Parts waiting board (needed / ordered)
CREATE INDEX IF NOT EXISTS idx_part_status_waiting
  ON part (status)
  WHERE status IN ('needed', 'ordered');

-- Ensure job → work_order join path (idempotent with 001)
CREATE INDEX IF NOT EXISTS idx_job_work_order ON job (work_order_id);

-- High-traffic FK / nest joins used by dashboard and WO detail
CREATE INDEX IF NOT EXISTS idx_intake_photo_work_order_id
  ON intake_photo (work_order_id);

CREATE INDEX IF NOT EXISTS idx_technician_note_work_order_id
  ON technician_note (work_order_id);

CREATE INDEX IF NOT EXISTS idx_inspection_work_order_id
  ON inspection (work_order_id);

CREATE INDEX IF NOT EXISTS idx_work_order_technician_technician_id
  ON work_order_technician (technician_id);

CREATE INDEX IF NOT EXISTS idx_work_order_technician_work_order_id
  ON work_order_technician (work_order_id);

-- Recommendation follow-ups by motorcycle (via work_order) stay on WO indexes;
-- support deferred-status scans on recommendation
CREATE INDEX IF NOT EXISTS idx_recommendation_status_outstanding
  ON recommendation (status)
  WHERE status IN ('pending', 'deferred', 'declined');
