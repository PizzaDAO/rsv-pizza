-- Sponsor Dashboard tables
-- Apply via: mcp__supabase-pizzadao__apply_migration with project_id znpiwdvvsqaxuskpfleo

-- Table: sponsor_users
CREATE TABLE sponsor_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  tag TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sponsor_users_tag ON sponsor_users(tag);

-- Table: sponsor_checklist_items
CREATE TABLE sponsor_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_user_id UUID NOT NULL REFERENCES sponsor_users(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  due_date DATE,
  sort_order INT NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sponsor_checklist_sponsor ON sponsor_checklist_items(sponsor_user_id);
CREATE INDEX idx_sponsor_checklist_party ON sponsor_checklist_items(party_id);
