-- AlterTable: mortadella-92106 — admin-only city-level notes on parties.
-- Free-text scratchpad for the /payments by-city expansion. Distinct from
-- per-payout `payouts.admin_notes` (which is on the Payout model) and from
-- `parties.underboss_notes` (visible to underbosses). This column is gated
-- to admins on read AND write.
--
-- GRANT SELECT only to `authenticated`, NOT to `anon`. Server-side admin
-- gating in the route handler + serializer is the primary protection;
-- this is defense-in-depth.
ALTER TABLE "parties" ADD COLUMN "admin_notes" TEXT;

GRANT SELECT ("admin_notes") ON "parties" TO authenticated;
