-- AlterTable: quattro-71244 — add host_goals JSONB for gamified dashboard KPIs.
-- Goals are private to the host (and admins via existing report endpoint gating)
-- so we GRANT SELECT only to `authenticated`, NOT to `anon`. This matches the
-- Feb 2026 column-level security audit pattern on `parties`.
ALTER TABLE "parties" ADD COLUMN "host_goals" JSONB;

GRANT SELECT ("host_goals") ON "parties" TO authenticated;
