CREATE INDEX IF NOT EXISTS idx_guests_email ON guests (lower(email));
