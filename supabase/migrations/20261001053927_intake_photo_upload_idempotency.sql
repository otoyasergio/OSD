ALTER TABLE public.intake_photo
  ADD COLUMN IF NOT EXISTS client_upload_id uuid,
  ADD COLUMN IF NOT EXISTS content_type text,
  ADD COLUMN IF NOT EXISTS byte_size bigint,
  ADD COLUMN IF NOT EXISTS pixel_width integer,
  ADD COLUMN IF NOT EXISTS pixel_height integer;

ALTER TABLE public.intake_photo
  ADD CONSTRAINT intake_photo_content_type_canonical_jpeg_check
    CHECK (content_type IS NULL OR content_type = 'image/jpeg'),
  ADD CONSTRAINT intake_photo_byte_size_positive_check
    CHECK (byte_size IS NULL OR byte_size > 0),
  ADD CONSTRAINT intake_photo_pixel_width_positive_check
    CHECK (pixel_width IS NULL OR pixel_width > 0),
  ADD CONSTRAINT intake_photo_pixel_height_positive_check
    CHECK (pixel_height IS NULL OR pixel_height > 0);

CREATE UNIQUE INDEX intake_photo_client_upload_id_unique
  ON public.intake_photo (client_upload_id)
  WHERE client_upload_id IS NOT NULL;

COMMENT ON COLUMN public.intake_photo.client_upload_id IS
  'Client-generated idempotency key for at-least-once photo delivery.';
COMMENT ON COLUMN public.intake_photo.content_type IS
  'Canonical stored object content type; new uploads are image/jpeg.';
COMMENT ON COLUMN public.intake_photo.byte_size IS
  'Exact byte size of the canonical full-detail object.';
COMMENT ON COLUMN public.intake_photo.pixel_width IS
  'Canonical full-detail image width in pixels after orientation.';
COMMENT ON COLUMN public.intake_photo.pixel_height IS
  'Canonical full-detail image height in pixels after orientation.';
