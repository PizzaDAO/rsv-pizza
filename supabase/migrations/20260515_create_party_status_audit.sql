-- ============================================
-- Party Status Audit Log (pizzaiolo-97053)
-- ============================================
-- Records every change to parties.underboss_status with the actor email.
-- Service-role read only — never exposed to anon/authenticated.
-- ============================================

CREATE TABLE party_status_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id    UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('approve','reject','list','hide','pending')),
  old_status  TEXT,                       -- nullable: first-ever transition has no prior value
  new_status  TEXT NOT NULL,
  actor_email TEXT NOT NULL,              -- 'unknown' for system / pre-audit writes
  actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('admin','underboss','owner','system')),
  reason      TEXT,                       -- reserved for future use (e.g. fingerprint detector)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_party_status_audit_party_id   ON party_status_audit (party_id);
CREATE INDEX idx_party_status_audit_created_at ON party_status_audit (created_at DESC);

-- Permissions: backend / service-role only.
-- Follow Feb 2026 audit pattern: revoke broad access, do NOT grant column-level SELECT to anon/authenticated.
REVOKE ALL ON party_status_audit FROM anon, authenticated;

-- Enable RLS as belt-and-suspenders (service_role bypasses RLS by default; no policies = deny-all otherwise).
ALTER TABLE party_status_audit ENABLE ROW LEVEL SECURITY;
