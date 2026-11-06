-- Wheel alignment is a normal checklist line. It does not require a measurement
-- or its own evidence photo. Unsigned inspections pick it up now; a signed
-- report stays as it was signed.

INSERT INTO public.inspection_template_item (
  category,
  item_name,
  display_order,
  requires_measurement,
  active
)
SELECT
  'Frame, Chassis, and Suspension',
  'Wheel alignment',
  725,
  false,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.inspection_template_item
  WHERE item_name = 'Wheel alignment'
    AND active = true
);

INSERT INTO public.inspection_result (
  inspection_id,
  template_item_id,
  category_snapshot,
  item_name_snapshot,
  display_order_snapshot,
  requires_measurement_snapshot
)
SELECT
  inspection.inspection_id,
  template.template_item_id,
  template.category,
  template.item_name,
  template.display_order,
  template.requires_measurement
FROM public.inspection
JOIN public.inspection_template_item AS template
  ON template.item_name = 'Wheel alignment'
 AND template.active = true
WHERE inspection.completed_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.inspection_result AS existing
    WHERE existing.inspection_id = inspection.inspection_id
      AND existing.item_name_snapshot = 'Wheel alignment'
  );
