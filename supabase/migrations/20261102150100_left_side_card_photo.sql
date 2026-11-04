-- Bike cards show the left-side intake photo, then the front photo.
CREATE OR REPLACE FUNCTION public.board_primary_intake_photos(p_work_order_ids uuid[])
RETURNS TABLE (
  work_order_id uuid,
  storage_path text,
  thumb_storage_path text,
  photo_url text,
  category text,
  photo_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT
      ip.work_order_id,
      ip.storage_path,
      ip.thumb_storage_path,
      ip.photo_url,
      ip.category::text AS category,
      COUNT(*) OVER (PARTITION BY ip.work_order_id) AS photo_count,
      ROW_NUMBER() OVER (
        PARTITION BY ip.work_order_id
        ORDER BY
          CASE ip.category::text
            WHEN 'left_side' THEN 0
            WHEN 'front' THEN 1
            WHEN 'right_side' THEN 2
            WHEN 'rear' THEN 3
            WHEN 'damage' THEN 4
            WHEN 'accessories' THEN 5
            WHEN 'other' THEN 6
            ELSE 99
          END,
          ip.created_at ASC
      ) AS rn
    FROM public.intake_photo ip
    WHERE ip.work_order_id = ANY (p_work_order_ids)
  )
  SELECT
    ranked.work_order_id,
    ranked.storage_path,
    ranked.thumb_storage_path,
    ranked.photo_url,
    ranked.category,
    ranked.photo_count
  FROM ranked
  WHERE ranked.rn = 1;
$$;
