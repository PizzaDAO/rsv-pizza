-- guests-anon-exposure step A: host live updates via Broadcast-from-Database instead of
-- postgres_changes. Payload has NO guest data and NO ids: {"op": "..."} on topic
-- guests:<party_id> (party ids are already public). Additive: nobody listens until the
-- frontend PR ships, and postgres_changes keeps working until Migration B. A broadcast failure
-- must NEVER fail a guest write (public RSVP), hence the EXCEPTION block.
-- Topic prefix 'guests:' and event 'guests_changed' are asserted verbatim by a frontend test.
-- ROLLBACK: backend/scripts/apply-guests-broadcast-trigger.cjs --rollback
CREATE OR REPLACE FUNCTION public.broadcast_guests_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  pid uuid;
  -- Columns the host UI never shows; webhook/cron churn on these must not trigger refetch storms.
  noisy constant text[] := ARRAY[
    'email_status','email_status_updated_at','email_resend_id','reminder_sent_at',
    'reminders_unsubscribed','survey_token','visitor_session_id',
    'nft_token_id','nft_transaction_hash','nft_minted_at'];
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      FOR pid IN SELECT DISTINCT party_id FROM new_rows LOOP
        PERFORM realtime.send(jsonb_build_object('op','insert'), 'guests_changed', 'guests:' || pid::text, false);
      END LOOP;
    ELSIF TG_OP = 'DELETE' THEN
      FOR pid IN SELECT DISTINCT party_id FROM old_rows LOOP
        PERFORM realtime.send(jsonb_build_object('op','delete'), 'guests_changed', 'guests:' || pid::text, false);
      END LOOP;
    ELSE -- UPDATE: only when a host-visible column changed (covers party_id moves too)
      FOR pid IN
        SELECT DISTINCT p FROM (
          SELECT unnest(ARRAY[n.party_id, o.party_id]) AS p
          FROM new_rows n JOIN old_rows o ON o.id = n.id
          WHERE (to_jsonb(n) - noisy) IS DISTINCT FROM (to_jsonb(o) - noisy)
        ) s
      LOOP
        PERFORM realtime.send(jsonb_build_object('op','update'), 'guests_changed', 'guests:' || pid::text, false);
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'broadcast_guests_changed (%): %', TG_OP, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.broadcast_guests_changed() FROM PUBLIC, anon, authenticated;

-- Transition tables require one trigger per event.
DROP TRIGGER IF EXISTS trg_guests_broadcast_ins ON public.guests;
DROP TRIGGER IF EXISTS trg_guests_broadcast_upd ON public.guests;
DROP TRIGGER IF EXISTS trg_guests_broadcast_del ON public.guests;
CREATE TRIGGER trg_guests_broadcast_ins AFTER INSERT ON public.guests
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_guests_changed();
CREATE TRIGGER trg_guests_broadcast_upd AFTER UPDATE ON public.guests
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_guests_changed();
CREATE TRIGGER trg_guests_broadcast_del AFTER DELETE ON public.guests
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_guests_changed();
