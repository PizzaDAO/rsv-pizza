-- nduja-58296: bump event-photos bucket file_size_limit from 10MB to 25MB
-- Snax requested this to accommodate DSLR/event-photographer JPEGs and modern smartphone high-MP modes.
-- The 10MB limit was rejecting most pro shots.
UPDATE storage.buckets SET file_size_limit = 26214400 WHERE id = 'event-photos';
-- 26214400 = 25 * 1024 * 1024 = 25 MiB
