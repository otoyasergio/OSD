-- Optimize hot-table RLS policies and composite indexes for Dashboard, Control Center,
-- and Tech Floor queries so Postgres uses hashed SubPlans and initPlans instead of
-- per-row SECURITY DEFINER function invocations.

-- 1. Composite indexes for Dashboard / Control Center active & completed queries
CREATE INDEX IF NOT EXISTS idx_work_order_active_location_created
  ON public.work_order (location_id, date_created DESC)
  WHERE status NOT IN ('completed', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_work_order_completed_location
  ON public.work_order (location_id, completed_at DESC NULLS LAST)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_intake_photo_wo_created
  ON public.intake_photo (work_order_id, created_at ASC);

-- 2. Replace per-row work_order_in_user_locations() in hot SELECT/mutation RLS policies
--    with hashed SubPlans and initPlans.
DROP POLICY IF EXISTS intake_photo_select_location ON public.intake_photo;
CREATE POLICY intake_photo_select_location ON public.intake_photo
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS intake_photo_insert_location ON public.intake_photo;
CREATE POLICY intake_photo_insert_location ON public.intake_photo
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS intake_photo_delete_owner_manager ON public.intake_photo;
CREATE POLICY intake_photo_delete_owner_manager ON public.intake_photo
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) = ANY (ARRAY['owner'::text, 'manager'::text])
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS job_select_location ON public.job;
CREATE POLICY job_select_location ON public.job
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS job_insert_location ON public.job;
CREATE POLICY job_insert_location ON public.job
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS job_update_location ON public.job;
CREATE POLICY job_update_location ON public.job
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS inspection_select_location ON public.inspection;
CREATE POLICY inspection_select_location ON public.inspection
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS inspection_insert_location ON public.inspection;
CREATE POLICY inspection_insert_location ON public.inspection
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS inspection_update_location ON public.inspection;
CREATE POLICY inspection_update_location ON public.inspection
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS admin_flag_select_location ON public.admin_flag;
CREATE POLICY admin_flag_select_location ON public.admin_flag
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS admin_flag_insert_location ON public.admin_flag;
CREATE POLICY admin_flag_insert_location ON public.admin_flag
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS admin_flag_update_location ON public.admin_flag;
CREATE POLICY admin_flag_update_location ON public.admin_flag
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS timeline_event_select_location ON public.timeline_event;
CREATE POLICY timeline_event_select_location ON public.timeline_event
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS timeline_event_insert_location ON public.timeline_event;
CREATE POLICY timeline_event_insert_location ON public.timeline_event
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND work_order_id IN (
      SELECT wo.work_order_id
      FROM public.work_order wo
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS drop_off_agreement_select ON public.drop_off_agreement;
CREATE POLICY drop_off_agreement_select ON public.drop_off_agreement
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) = ANY (ARRAY['owner'::text, 'manager'::text, 'service_advisor'::text, 'admin'::text])
  );

DROP POLICY IF EXISTS drop_off_agreement_update ON public.drop_off_agreement;
CREATE POLICY drop_off_agreement_update ON public.drop_off_agreement
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) = ANY (ARRAY['owner'::text, 'manager'::text, 'service_advisor'::text, 'admin'::text])
  )
  WITH CHECK (
    (SELECT public.is_active_app_user())
    AND (SELECT public.current_app_user_role()) = ANY (ARRAY['owner'::text, 'manager'::text, 'service_advisor'::text, 'admin'::text])
  );

DROP POLICY IF EXISTS part_select_location ON public.part;
CREATE POLICY part_select_location ON public.part
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND job_id IN (
      SELECT j.job_id
      FROM public.job j
      JOIN public.work_order wo ON wo.work_order_id = j.work_order_id
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );

DROP POLICY IF EXISTS job_checklist_item_select_location ON public.job_checklist_item;
CREATE POLICY job_checklist_item_select_location ON public.job_checklist_item
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_active_app_user())
    AND job_id IN (
      SELECT j.job_id
      FROM public.job j
      JOIN public.work_order wo ON wo.work_order_id = j.work_order_id
      WHERE wo.location_id IN (SELECT public.user_location_ids())
    )
  );
