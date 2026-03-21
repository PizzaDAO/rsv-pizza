-- Create checklist_defaults table (master template for GPP checklists)
CREATE TABLE IF NOT EXISTS checklist_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  due_date date,
  is_auto boolean NOT NULL DEFAULT false,
  auto_rule text,
  link_tab text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS (no anon policies = service_role only)
ALTER TABLE checklist_defaults ENABLE ROW LEVEL SECURITY;

-- Seed with the 10 current default items
INSERT INTO checklist_defaults (name, due_date, is_auto, auto_rule, link_tab, sort_order) VALUES
  ('Create Event',          NULL,         true,  'event_created',       NULL,       0),
  ('Request Party Kit',     '2026-03-17', true,  'party_kit_submitted', 'gpp',      1),
  ('Build a Team',          '2026-03-30', true,  'team_built',          'details',  2),
  ('Find a Venue',          '2026-04-08', true,  'venue_added',         'venue',    3),
  ('Set Up Budget',         '2026-04-18', true,  'budget_submitted',    'budget',   4),
  ('Find Partners',         '2026-04-15', false, NULL,                  'sponsors', 5),
  ('Select Pizzeria',       '2026-04-18', false, NULL,                  'venue',    6),
  ('Prepare for the Party', '2026-04-20', false, NULL,                  NULL,       7),
  ('Post to Socials',       '2026-04-22', false, NULL,                  'promo',    8),
  ('Throw the Party',       '2026-05-22', false, NULL,                  NULL,       9)
ON CONFLICT (name) DO NOTHING;
