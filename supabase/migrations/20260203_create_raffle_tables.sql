-- Migration: Create raffle tables for the Raffle Widget feature
-- Run this via Supabase Dashboard SQL Editor or CLI

-- Raffles table - main raffle configuration
CREATE TABLE raffles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'drawn')),
  entries_per_guest INT NOT NULL DEFAULT 1 CHECK (entries_per_guest >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Raffle prizes table
CREATE TABLE raffle_prizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id UUID NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  image_url TEXT,
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Raffle entries table - tracks guest entries
CREATE TABLE raffle_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id UUID NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(raffle_id, guest_id)
);

-- Raffle winners table
CREATE TABLE raffle_winners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id UUID NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
  prize_id UUID NOT NULL REFERENCES raffle_prizes(id) ON DELETE CASCADE,
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_raffles_party_id ON raffles(party_id);
CREATE INDEX idx_raffle_prizes_raffle_id ON raffle_prizes(raffle_id);
CREATE INDEX idx_raffle_entries_raffle_id ON raffle_entries(raffle_id);
CREATE INDEX idx_raffle_entries_guest_id ON raffle_entries(guest_id);
CREATE INDEX idx_raffle_winners_raffle_id ON raffle_winners(raffle_id);
CREATE INDEX idx_raffle_winners_guest_id ON raffle_winners(guest_id);
