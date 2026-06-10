-- focaccia-58519: bump event-images bucket file_size_limit from 10MB to 25MB
-- (already applied to prod manually; this is the tracked record). Mirrors nduja-58296.
UPDATE storage.buckets SET file_size_limit = 26214400 WHERE id = 'event-images';
