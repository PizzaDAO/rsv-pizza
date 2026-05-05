-- Add Privy embedded wallet fields to guests table
ALTER TABLE guests ADD COLUMN IF NOT EXISTS privy_user_id VARCHAR;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS wallet_source VARCHAR;

-- Backfill existing guests who provided their own wallet address
UPDATE guests SET wallet_source = 'manual'
WHERE ethereum_address IS NOT NULL AND wallet_source IS NULL;
