-- salami-58119: expand event-photos bucket MIME allowlist to include HEIC/HEIF/AVIF
-- so iPhone (HEIC) and modern Android (AVIF) users can upload library photos.
-- Mirrors existing list (jpeg/png/webp/gif); videos live in the separate event-videos bucket.
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/avif'
]
where id = 'event-photos';
