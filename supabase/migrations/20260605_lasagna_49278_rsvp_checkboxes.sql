-- lasagna-49278: DB-driven config for the RSVP opt-in checkboxes.
--
-- Replaces 9 hardcoded checkbox blocks in `RSVPFormStep1.tsx` with rows in
-- this table. Renderer fetches rows, filters by `required_tags` / `excluded_tags`,
-- groups by `combined_group`, and renders one checkbox per row (or per group).
--
-- v1 ships 8 global seed rows (`party_id IS NULL`) — one per existing checkbox.
-- Per-event override rows MAY be added later (`party_id REFERENCES parties(id)`);
-- when present, they take precedence over the global row with the same `id`.
--
-- Destination columns on `guests` (`mailing_list_opt_in`, `swc_*_opt_in`,
-- `ethconf_opt_in`) are NOT touched — `opt_in_fields` is a hardcoded
-- whitelist mapping renderer-side checkbox handles to those existing columns.
-- Adding a 9th destination column still requires a deploy.

-- Postgres rejects NULLs in primary-key columns, so the natural composite key
-- (id, party_id) can't be the PRIMARY KEY when party_id is nullable. We use a
-- surrogate row PK and enforce uniqueness with two partial UNIQUE indexes:
-- one over (id) for global rows (party_id IS NULL) and one over
-- (id, party_id) for per-event overrides.
CREATE TABLE IF NOT EXISTS rsvp_checkboxes (
  row_pk                 bigserial PRIMARY KEY,
  id                     text NOT NULL,
  party_id               uuid REFERENCES parties(id) ON DELETE CASCADE,
  position               int  NOT NULL DEFAULT 0,
  active                 boolean NOT NULL DEFAULT true,

  required_tags          text[] NOT NULL DEFAULT '{}',
  excluded_tags          text[] NOT NULL DEFAULT '{}',
  always_show            boolean NOT NULL DEFAULT false,

  opt_in_fields          text[] NOT NULL,
  combined_group         text,

  label_i18n_key         text,
  label_default          text,
  label_overrides        jsonb NOT NULL DEFAULT '{}'::jsonb,

  info_modal_i18n_ns     text,
  info_modal_privacy_url text,
  info_modal_terms_url   text,
  info_modal_terms_key   text,
  modal_overrides        jsonb NOT NULL DEFAULT '{}'::jsonb,

  accent_color           text NOT NULL DEFAULT 'red',

  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             text
);

-- Per-event overrides: exactly one row per (id, party_id).
CREATE UNIQUE INDEX IF NOT EXISTS rsvp_checkboxes_per_event_unique
  ON rsvp_checkboxes (id, party_id) WHERE party_id IS NOT NULL;

-- Indexes: renderer fetches global config once, then per-party overrides.
CREATE INDEX IF NOT EXISTS rsvp_checkboxes_global_idx
  ON rsvp_checkboxes (active, position) WHERE party_id IS NULL;
CREATE INDEX IF NOT EXISTS rsvp_checkboxes_per_event_idx
  ON rsvp_checkboxes (party_id, id) WHERE party_id IS NOT NULL;

-- Column-level public read of fields the form needs. updated_at / updated_by
-- stay admin-only via the backend endpoint.
GRANT SELECT (
  id, party_id, position, active, required_tags, excluded_tags, always_show,
  opt_in_fields, combined_group,
  label_i18n_key, label_default, label_overrides,
  info_modal_i18n_ns, info_modal_privacy_url, info_modal_terms_url, info_modal_terms_key,
  modal_overrides, accent_color
) ON rsvp_checkboxes TO anon, authenticated;

ALTER TABLE rsvp_checkboxes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read rsvp checkboxes" ON rsvp_checkboxes;
CREATE POLICY "Anyone can read rsvp checkboxes"
  ON rsvp_checkboxes FOR SELECT
  USING (true);

-- Primary key only enforces uniqueness on (id, party_id). The renderer
-- requires the (id, NULL) "global" row to be unique; the partial unique
-- index makes that explicit and lets the admin CRUD detect dupes.
CREATE UNIQUE INDEX IF NOT EXISTS rsvp_checkboxes_global_id_unique
  ON rsvp_checkboxes (id) WHERE party_id IS NULL;

-- Seed: 8 global rows mirroring today's hardcoded behavior.
-- Guard: only seed when the table is empty (so re-running the migration is a no-op).
DO $seed$
BEGIN
IF NOT EXISTS (SELECT 1 FROM rsvp_checkboxes WHERE party_id IS NULL) THEN
-- All combined_group='pizzadao_partners' so the renderer merges them per event.
-- mailing_list.always_show=true; SWC rows only join when their tag is present.
-- mailing_list.label_i18n_key='step1.combinedOptIn' so the renderer's
-- spokesperson rule (lowest-position row in group) yields the combined label
-- when there is more than one in-group row active for the event.

INSERT INTO rsvp_checkboxes (
  id, party_id, position, active,
  required_tags, excluded_tags, always_show,
  opt_in_fields, combined_group,
  label_i18n_key, label_default, label_overrides,
  info_modal_i18n_ns, info_modal_privacy_url, info_modal_terms_url, info_modal_terms_key,
  modal_overrides, accent_color
) VALUES
  (
    'mailing_list', NULL, 10, true,
    '{}', '{}', true,
    ARRAY['mailingListOptIn'], 'pizzadao_partners',
    'step1.combinedOptIn', 'Sign up for PizzaDAO''s mailing list', '{}'::jsonb,
    NULL, NULL, NULL, NULL,
    '{}'::jsonb, 'red'
  ),
  (
    'swc_us', NULL, 20, true,
    ARRAY['swc'], '{}', false,
    ARRAY['swcOptIn'], 'pizzadao_partners',
    'step1.swcJoin', 'Join Stand With Crypto and receive updates from the SWC Alliance', '{}'::jsonb,
    'swcModal', 'https://www.standwithcrypto.org/privacy', 'https://www.standwithcrypto.org/terms-of-service', 'termsConditions',
    '{}'::jsonb, 'purple'
  ),
  (
    'swc_ca', NULL, 21, true,
    ARRAY['swccanada'], '{}', false,
    ARRAY['swcCaOptIn'], 'pizzadao_partners',
    'step1.swcNotify', 'Notify me about Stand With Crypto Canada updates', '{}'::jsonb,
    'swcCaModal', 'https://www.standwithcrypto.org/ca/privacy', 'https://www.standwithcrypto.org/ca/terms-of-service', 'termsOfService',
    '{}'::jsonb, 'purple'
  ),
  (
    'swc_au', NULL, 22, true,
    ARRAY['swcau'], '{}', false,
    ARRAY['swcAuOptIn'], 'pizzadao_partners',
    'step1.swcNotify', 'Notify me about Stand With Crypto Australia updates', '{}'::jsonb,
    'swcAuModal', 'https://www.standwithcrypto.org/au/privacy', 'https://www.standwithcrypto.org/au/terms-of-service', 'termsOfService',
    '{}'::jsonb, 'purple'
  ),
  (
    'swc_eu', NULL, 23, true,
    ARRAY['swceu'], '{}', false,
    ARRAY['swcEuOptIn'], 'pizzadao_partners',
    'step1.swcNotify', 'Notify me about Stand With Crypto EU updates', '{}'::jsonb,
    'swcEuModal', 'https://www.standwithcrypto.org/eu/en/privacy', 'https://www.standwithcrypto.org/eu/en/terms-of-service', 'termsOfService',
    '{}'::jsonb, 'purple'
  ),
  (
    'swc_uk', NULL, 24, true,
    ARRAY['swcuk'], '{}', false,
    ARRAY['swcUkOptIn'], 'pizzadao_partners',
    'step1.swcNotify', 'Notify me about Stand With Crypto UK updates', '{}'::jsonb,
    'swcUkModal', 'https://www.standwithcrypto.org/gb/en/privacy', 'https://www.standwithcrypto.org/gb/en/terms-of-service', 'termsOfService',
    '{}'::jsonb, 'purple'
  ),
  (
    'swc_br', NULL, 25, true,
    ARRAY['swcbr'], '{}', false,
    ARRAY['swcBrOptIn'], 'pizzadao_partners',
    'step1.swcBrNotify', 'Notify me about Juntos por Cripto updates', '{}'::jsonb,
    'swcBrModal', 'https://www.juntosporcripto.org/br/privacy', 'https://www.juntosporcripto.org/br/terms-of-service', 'termsOfService',
    '{}'::jsonb, 'purple'
  ),
  (
    'ethconf', NULL, 30, true,
    ARRAY['ethconf'], '{}', false,
    ARRAY['ethconfOptIn'], 'pizzadao_partners',
    'step1.ethconfDiscount', 'I want a discount code for the ETHConf conference', '{}'::jsonb,
    NULL, NULL, NULL, NULL,
    '{}'::jsonb, 'red'
  );
END IF;
END $seed$;
