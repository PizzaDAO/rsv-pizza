-- calzone-70821: standalone tax-form requests (/tax-form?payee=<token>).
--
-- Rare Pizzas must collect W-9 / W-8BEN / W-8BEN-E forms from past payees,
-- many of whom have no rsv.pizza account. One tax_form_requests row per payee
-- carries the link token; submitted forms still live in tax_forms.
--
-- tax_forms.user_id becomes NULLABLE. Safe because (a) a CHECK requires
-- user_id OR request_id, so no ownerless rows, (b) all access is backend-only
-- via the table-owner Prisma role (RLS already enabled on tax_forms with no
-- policies, see 20260924_taxform_rls_lockdown), and (c) the existing FK is
-- ON DELETE CASCADE which is unchanged for non-null values.
--
-- Status 'submitting' is a transient lock held while the PDF is generated.
-- The tax_forms.user_id FK stays ON DELETE CASCADE on purpose: SET NULL would
-- violate the owner CHECK for user-owned forms and block user deletion. Token
-- routes never set user_id, so request-owned rows are unaffected.
--
-- NOT applied automatically. Apply to prod BEFORE merging (see CLAUDE.md).

CREATE TABLE IF NOT EXISTS "tax_form_requests" (
  "id"                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "token"               TEXT         NOT NULL UNIQUE,
  "requester"           TEXT         NOT NULL DEFAULT 'rare_pizzas'
                                      CHECK ("requester" IN ('rare_pizzas', 'pizzadao')),
  "payee_label"         TEXT         NOT NULL,
  "payee_email"         TEXT,
  "payee_wallet"        TEXT,
  "payee_handle"        TEXT,
  "suggested_form_type" TEXT         CHECK ("suggested_form_type" IS NULL OR "suggested_form_type" IN ('w9', 'w8ben', 'w8bene')),
  "tax_year_note"       TEXT,
  "user_id"             TEXT         REFERENCES "User"("id") ON DELETE SET NULL,
  "tax_form_id"         UUID,
  "status"              TEXT         NOT NULL DEFAULT 'sent'
                                      CHECK ("status" IN ('sent', 'opened', 'draft', 'submitting', 'submitted', 'verified', 'rejected')),
  "opened_at"           TIMESTAMPTZ,
  "submitted_at"        TIMESTAMPTZ,
  "revoked_at"          TIMESTAMPTZ,
  "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_tax_form_requests_requester_status" ON "tax_form_requests"("requester", "status");
CREATE INDEX IF NOT EXISTS "idx_tax_form_requests_user_id" ON "tax_form_requests"("user_id");

-- Backend-only: RLS on, no policies, no PostgREST grants.
ALTER TABLE "tax_form_requests" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "tax_form_requests" FROM anon;
REVOKE ALL ON "tax_form_requests" FROM authenticated;

-- tax_forms: nullable owner + request link + signer audit trail.
ALTER TABLE "tax_forms" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "tax_forms" ADD COLUMN IF NOT EXISTS "request_id" UUID REFERENCES "tax_form_requests"("id") ON DELETE SET NULL;
ALTER TABLE "tax_forms" ADD COLUMN IF NOT EXISTS "signer_ip" TEXT;
ALTER TABLE "tax_forms" ADD COLUMN IF NOT EXISTS "signer_user_agent" TEXT;
CREATE INDEX IF NOT EXISTS "idx_tax_forms_request_id" ON "tax_forms"("request_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_forms_owner_check') THEN
    ALTER TABLE "tax_forms"
      ADD CONSTRAINT "tax_forms_owner_check" CHECK ("user_id" IS NOT NULL OR "request_id" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_form_requests_tax_form_id_fkey') THEN
    ALTER TABLE "tax_form_requests"
      ADD CONSTRAINT "tax_form_requests_tax_form_id_fkey"
      FOREIGN KEY ("tax_form_id") REFERENCES "tax_forms"("id") ON DELETE SET NULL;
  END IF;
END $$;
