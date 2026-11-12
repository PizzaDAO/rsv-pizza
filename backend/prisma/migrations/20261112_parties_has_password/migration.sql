-- party-password-anon-exposure step 1: anon needs to know IF an event is password
-- protected without being able to read or filter on `password`. Generated column,
-- same precedent as co_hosts_public. Not declared in schema.prisma (like co_hosts_public).
-- Stays correct after hashing: a hash is non-null iff the password is.
ALTER TABLE parties
  ADD COLUMN IF NOT EXISTS has_password boolean
  GENERATED ALWAYS AS (password IS NOT NULL) STORED;
NOTIFY pgrst, 'reload schema';
