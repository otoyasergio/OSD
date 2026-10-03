-- Advisor-set ordering for each technician's docket (What's next).

ALTER TABLE job
  ADD COLUMN IF NOT EXISTS docket_position integer;

CREATE INDEX IF NOT EXISTS idx_job_docket_position
  ON job (assigned_technician_id, docket_position)
  WHERE assigned_technician_id IS NOT NULL;

-- Backfill open assigned jobs, preserving the current implicit order (created_at).
WITH ranked AS (
  SELECT job_id,
         ROW_NUMBER() OVER (
           PARTITION BY assigned_technician_id
           ORDER BY created_at, job_id
         ) AS rn
  FROM job
  WHERE assigned_technician_id IS NOT NULL
    AND status NOT IN ('completed', 'cancelled', 'declined')
)
UPDATE job
SET docket_position = ranked.rn
FROM ranked
WHERE job.job_id = ranked.job_id;
