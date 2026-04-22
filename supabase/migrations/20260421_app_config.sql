-- App-level configuration key-value store
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the GPP default description
INSERT INTO app_config (key, value) VALUES (
  'gpp_default_description',
  E'Join us for the Global Pizza Party, a worldwide celebration of pizza and bitcoin, where communities around the world come together to share pizza and good vibes.\n\nWhat to expect:\n- Free pizza\n- Crypto enthusiasts\n- Good conversations\n\nRSVP to secure your slice!'
) ON CONFLICT (key) DO NOTHING;
