-- mushroom-48468 (follow-up): lowercase denormalized email columns in audit
-- tables for consistency. These are informational (no FK relationships) so
-- this is non-blocking and reversible.
--
-- Scope (per Snax decision #5): only audit-style columns that we control
-- programmatically. Skip user-typed metadata like Donation.donorEmail and
-- Sponsor.contactEmail — those are external identifiers we don't own.

UPDATE party_status_audit
  SET actor_email = lower(actor_email)
  WHERE actor_email IS NOT NULL
    AND actor_email <> lower(actor_email);

UPDATE payout_audit
  SET actor_email = lower(actor_email)
  WHERE actor_email IS NOT NULL
    AND actor_email <> lower(actor_email);
