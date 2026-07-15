-- Keep iPhone/iPad paper-agreement photos uploadable if browser compression
-- falls back to the original HEIC/HEIF file.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]
WHERE id = 'customer-documents';
