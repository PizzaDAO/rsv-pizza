-- salame-92110: host tax-form upload (W-9 / W-8BEN / W-8BEN-E).
--
-- Hosts must submit a tax form before admin can Approve their payouts.
-- US W-9 is required at $600 YTD; foreign W-8BEN / W-8BEN-E are required
-- for every payment (the IRS has no small-payment exception for foreign).
--
-- `tax_forms.form_data` is a JSONB blob holding the per-form fields used to
-- generate the PDF (name/address/TIN/etc.). The generated PDF is uploaded to
-- the existing `event-images` bucket (10MB cap + application/pdf allowlist
-- already in place from bocconcino-92104).
--
-- `payouts.tax_form_id` snapshots the form used at submission time so
-- historical immutability survives the host editing or replacing their form
-- later. ON DELETE SET NULL — deleting a tax form unsets the link but does
-- not cascade-destroy historical payouts.

CREATE TABLE "tax_forms" (
  "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         TEXT         NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "form_type"       TEXT         NOT NULL CHECK ("form_type" IN ('w9', 'w8ben', 'w8bene')),
  "status"          TEXT         NOT NULL DEFAULT 'draft'
                                  CHECK ("status" IN ('draft', 'submitted', 'verified', 'rejected')),
  "form_data"       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  "pdf_url"         TEXT,
  "pdf_thumb_url"   TEXT,
  "signed_at"       TIMESTAMPTZ,
  "expires_at"      TIMESTAMPTZ,
  "verified_at"     TIMESTAMPTZ,
  "verified_by"     TEXT,
  "rejected_reason" TEXT,
  "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX "idx_tax_forms_user_id"    ON "tax_forms"("user_id");
CREATE INDEX "idx_tax_forms_status"     ON "tax_forms"("status");
CREATE INDEX "idx_tax_forms_expires_at" ON "tax_forms"("expires_at") WHERE "expires_at" IS NOT NULL;

ALTER TABLE "payouts" ADD COLUMN "tax_form_id" UUID REFERENCES "tax_forms"("id") ON DELETE SET NULL;
CREATE INDEX "idx_payouts_tax_form_id" ON "payouts"("tax_form_id");

-- Column-level SELECT grants. `form_data` is intentionally NOT granted to
-- authenticated — the route handler's admin-only detail endpoint returns it
-- via the service-role Prisma client. Host-side endpoints surface the PDF
-- URL + thumbnail + status only.
GRANT SELECT (
  "id",
  "user_id",
  "form_type",
  "status",
  "pdf_url",
  "pdf_thumb_url",
  "signed_at",
  "expires_at",
  "verified_at",
  "rejected_reason",
  "created_at",
  "updated_at"
) ON "tax_forms" TO authenticated;

GRANT SELECT ("tax_form_id") ON "payouts" TO anon, authenticated;

-- culatello-92106: per-event admin-controlled gate for the tax-form
-- requirement. The salame-92110 host-side TaxFormSection only renders + the
-- backend TAX_FORM_REQUIRED 400 only fires when this flag is true. Default
-- false so existing events do NOT regress into requiring a form — admin
-- explicitly flips the flag for events that should be gated. Hosts cannot
-- toggle this; the admin checkbox lives on /payments (PayoutReviewModal +
-- PayoutsByPartyTable city expansion).
ALTER TABLE parties ADD COLUMN tax_form_required boolean NOT NULL DEFAULT false;
GRANT SELECT (tax_form_required) ON parties TO anon, authenticated;
