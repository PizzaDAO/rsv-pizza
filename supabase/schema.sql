-- RSVPizza Database Schema for Supabase

-- Parties table
CREATE TABLE parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL DEFAULT substring(md5(random()::text), 1, 8),
  host_name TEXT,
  date TIMESTAMPTZ,
  pizza_style TEXT NOT NULL DEFAULT 'new-york',
  max_guests INTEGER,
  address TEXT,
  rsvp_closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Guests table
CREATE TABLE guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID REFERENCES parties(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  dietary_restrictions TEXT[] DEFAULT '{}',
  liked_toppings TEXT[] DEFAULT '{}',
  disliked_toppings TEXT[] DEFAULT '{}',
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  submitted_via TEXT DEFAULT 'link'
);

-- Create indexes for faster lookups
CREATE INDEX idx_parties_invite_code ON parties(invite_code);
CREATE INDEX idx_guests_party_id ON guests(party_id);

-- Enable Row Level Security
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;

-- Policies for parties table
-- Anyone can create a party
CREATE POLICY "Anyone can create parties" ON parties
  FOR INSERT WITH CHECK (true);

-- Anyone can read parties (needed for RSVP page)
CREATE POLICY "Anyone can read parties" ON parties
  FOR SELECT USING (true);

-- Anyone can update their own party (by invite_code match in app logic)
CREATE POLICY "Anyone can update parties" ON parties
  FOR UPDATE USING (true);

-- Policies for guests table
-- Anyone can add guests (for RSVP submissions)
CREATE POLICY "Anyone can add guests" ON guests
  FOR INSERT WITH CHECK (true);

-- Anyone can read guests (host needs to see them)
CREATE POLICY "Anyone can read guests" ON guests
  FOR SELECT USING (true);

-- Anyone can delete guests
CREATE POLICY "Anyone can delete guests" ON guests
  FOR DELETE USING (true);
