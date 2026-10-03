-- Follow-up: staff labels for checkout categories on the atomic upload RPC.

CREATE OR REPLACE FUNCTION public.create_intake_photo_with_event(
  p_photo_id uuid,
  p_work_order_id uuid,
  p_storage_path text,
  p_thumb_storage_path text,
  p_category text,
  p_notes text,
  p_inspection_result_id uuid,
  p_job_id uuid,
  p_client_upload_id uuid,
  p_content_type text,
  p_byte_size bigint,
  p_pixel_width integer,
  p_pixel_height integer
)
RETURNS SETOF public.intake_photo
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_location_id uuid;
  v_work_order_number text;
  v_category_label text;
  v_new_value jsonb;
  v_photo public.intake_photo;
BEGIN
  v_user_id := public.current_app_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT wo.location_id, wo.work_order_number
  INTO v_location_id, v_work_order_number
  FROM public.work_order AS wo
  WHERE wo.work_order_id = p_work_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND';
  END IF;

  v_category_label := CASE p_category
    WHEN 'front' THEN 'Front'
    WHEN 'rear' THEN 'Rear'
    WHEN 'left_side' THEN 'Left Side'
    WHEN 'right_side' THEN 'Right Side'
    WHEN 'odometer' THEN 'Odometer'
    WHEN 'vin' THEN 'VIN'
    WHEN 'damage' THEN 'Damage'
    WHEN 'accessories' THEN 'Accessories'
    WHEN 'fuel_level' THEN 'Fuel Level'
    WHEN 'other' THEN 'Other'
    WHEN 'inspection_tires' THEN 'Inspection — Tires'
    WHEN 'inspection_brakes' THEN 'Inspection — Brakes'
    WHEN 'inspection_forks' THEN 'Inspection — Forks'
    WHEN 'inspection_item' THEN 'Inspection — Needs work'
    WHEN 'job_proof' THEN 'Job proof'
    WHEN 'job_work' THEN 'Work photo'
    WHEN 'checkout_front' THEN 'Checkout — Front'
    WHEN 'checkout_rear' THEN 'Checkout — Rear'
    WHEN 'checkout_left_side' THEN 'Checkout — Left Side'
    WHEN 'checkout_right_side' THEN 'Checkout — Right Side'
    WHEN 'checkout_odometer' THEN 'Checkout — Odometer'
    ELSE p_category
  END;

  v_new_value := jsonb_build_object(
    'category', p_category,
    'storage_path', p_storage_path
  );

  INSERT INTO public.intake_photo (
    photo_id,
    work_order_id,
    uploaded_by_user_id,
    storage_path,
    thumb_storage_path,
    photo_url,
    category,
    notes,
    inspection_result_id,
    job_id,
    client_upload_id,
    content_type,
    byte_size,
    pixel_width,
    pixel_height
  ) VALUES (
    p_photo_id,
    p_work_order_id,
    v_user_id,
    p_storage_path,
    p_thumb_storage_path,
    NULL,
    p_category,
    p_notes,
    p_inspection_result_id,
    p_job_id,
    p_client_upload_id,
    p_content_type,
    p_byte_size,
    p_pixel_width,
    p_pixel_height
  )
  RETURNING * INTO STRICT v_photo;

  INSERT INTO public.timeline_event (
    work_order_id,
    user_id,
    event_type,
    entity_type,
    entity_id,
    description,
    new_value
  ) VALUES (
    p_work_order_id,
    v_user_id,
    'Intake Photo Uploaded',
    'intake_photo',
    v_photo.photo_id,
    format('Intake photo uploaded (%s)', v_category_label),
    v_new_value
  );

  INSERT INTO public.audit_log (
    actor_user_id,
    location_id,
    action,
    entity_type,
    entity_id,
    description,
    new_value
  ) VALUES (
    v_user_id,
    v_location_id,
    'intake_photo_uploaded',
    'intake_photo',
    v_photo.photo_id,
    format('Intake photo (%s) uploaded on %s', v_category_label, v_work_order_number),
    v_new_value
  );

  RETURN NEXT v_photo;
END;
$$;

REVOKE ALL ON FUNCTION public.create_intake_photo_with_event(
  uuid, uuid, text, text, text, text, uuid, uuid, uuid, text, bigint, integer, integer
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_intake_photo_with_event(
  uuid, uuid, text, text, text, text, uuid, uuid, uuid, text, bigint, integer, integer
) TO authenticated, service_role;
