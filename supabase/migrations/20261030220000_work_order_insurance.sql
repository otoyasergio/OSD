-- Insurance bikes are a parked Control Center row. The card stays there
-- until someone drags it out; job updates must not rewrite the status.

ALTER TABLE public.work_order
  DROP CONSTRAINT IF EXISTS work_order_status_check;

ALTER TABLE public.work_order
  ADD CONSTRAINT work_order_status_check CHECK (status IN (
    'draft',
    'open',
    'inspection_in_progress',
    'waiting_for_customer_approval',
    'waiting_for_parts',
    'ready_for_technician',
    'in_progress',
    'quality_check',
    'safety_check',
    'ready_for_pickup',
    'in_storage',
    'insurance',
    'completed',
    'cancelled',
    'on_hold'
  ));
