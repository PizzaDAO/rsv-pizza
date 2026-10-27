-- Host fast pass: admin pre-approved reimbursement budget per party.
-- Additive, new table only. Backend uses the service role / Prisma connection;
-- RLS enabled with no policies so the table is unreachable via the anon key
-- (same convention as 20260924_taxform_rls_lockdown).
CREATE TABLE IF NOT EXISTS "host_fast_pass_approvals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "party_id" UUID NOT NULL,
  "approved_amount_usd" DECIMAL(12,2) NOT NULL,
  "covers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "receipt_deadline" TIMESTAMPTZ NOT NULL,
  "basis" TEXT NOT NULL DEFAULT 'fast_pass',
  "note" TEXT,
  "approved_by_email" TEXT NOT NULL,
  "approved_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "revoked_at" TIMESTAMPTZ,
  "revoked_by_email" TEXT,
  CONSTRAINT "host_fast_pass_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "host_fast_pass_approvals_party_id_fkey"
    FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE,
  CONSTRAINT "host_fast_pass_approvals_basis_check" CHECK ("basis" IN ('fast_pass', 'manual_review')),
  CONSTRAINT "host_fast_pass_approvals_amount_check" CHECK ("approved_amount_usd" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "host_fast_pass_approvals_party_id_key" ON "host_fast_pass_approvals"("party_id");
ALTER TABLE "host_fast_pass_approvals" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "host_fast_pass_approvals" FROM anon;
REVOKE ALL ON "host_fast_pass_approvals" FROM authenticated;

-- Receipt-reuse lookups (host fast pass review assist) match on url and on
-- (file_name, file_size). Plain CREATE INDEX IF NOT EXISTS per repo convention.
-- payout_documents is large-ish: if you want zero write blocking, run the two
-- CREATE INDEX CONCURRENTLY statements below BY HAND first (outside a
-- transaction, same index names); these then become no-ops.
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_payout_documents_url" ON "payout_documents"("url");
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_payout_documents_file_name_size" ON "payout_documents"("file_name", "file_size");
CREATE INDEX IF NOT EXISTS "idx_payout_documents_url" ON "payout_documents"("url");
CREATE INDEX IF NOT EXISTS "idx_payout_documents_file_name_size" ON "payout_documents"("file_name", "file_size");
