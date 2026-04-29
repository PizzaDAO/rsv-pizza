-- ============================================
-- Deletion Audit Log
-- ============================================
-- Captures full row snapshots before any DELETE.
-- Postgres BEFORE DELETE triggers on high-priority tables.
-- Backend sets session vars (app.current_user, app.delete_context)
-- inside interactive transactions so the trigger can record who
-- performed the delete and from what context.
-- ============================================

-- 1. Create the deletion_log table
CREATE TABLE deletion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  record_data JSONB NOT NULL,
  deleted_by TEXT,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  context TEXT
);

CREATE INDEX idx_deletion_log_table_name ON deletion_log (table_name);
CREATE INDEX idx_deletion_log_deleted_at ON deletion_log (deleted_at);
CREATE INDEX idx_deletion_log_record_id ON deletion_log (record_id);

-- 2. Generic trigger function
CREATE OR REPLACE FUNCTION log_deletion()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO deletion_log (table_name, record_id, record_data, deleted_by, context)
  VALUES (
    TG_TABLE_NAME,
    OLD.id::TEXT,
    to_jsonb(OLD),
    current_setting('app.current_user', true),
    current_setting('app.delete_context', true)
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 3. Triggers on high-priority tables (direct deletes)
CREATE TRIGGER trg_deletion_log_parties BEFORE DELETE ON parties FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_guests BEFORE DELETE ON guests FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_photos BEFORE DELETE ON photos FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_sponsors BEFORE DELETE ON sponsors FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_raffles BEFORE DELETE ON raffles FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_raffle_prizes BEFORE DELETE ON raffle_prizes FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_raffle_entries BEFORE DELETE ON raffle_entries FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_raffle_winners BEFORE DELETE ON raffle_winners FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_displays BEFORE DELETE ON displays FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_staff BEFORE DELETE ON staff FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_performers BEFORE DELETE ON performers FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_venues BEFORE DELETE ON venues FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_venue_photos BEFORE DELETE ON venue_photos FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_budget_items BEFORE DELETE ON budget_items FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_checklist_items BEFORE DELETE ON checklist_items FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_party_kits BEFORE DELETE ON party_kits FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_social_posts BEFORE DELETE ON social_posts FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_notable_attendees BEFORE DELETE ON notable_attendees FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_admins BEFORE DELETE ON admins FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_checklist_defaults BEFORE DELETE ON checklist_defaults FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_quiz_questions BEFORE DELETE ON quiz_questions FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_quiz_question_templates BEFORE DELETE ON quiz_question_templates FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_quiz_answers BEFORE DELETE ON quiz_answers FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_webhooks BEFORE DELETE ON webhooks FOR EACH ROW EXECUTE FUNCTION log_deletion();

-- 4. Triggers on cascade-only targets (important child data)
CREATE TRIGGER trg_deletion_log_orders BEFORE DELETE ON orders FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_donations BEFORE DELETE ON donations FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_sponsor_checklist_items BEFORE DELETE ON sponsor_checklist_items FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_partner_event_notes BEFORE DELETE ON partner_event_notes FOR EACH ROW EXECUTE FUNCTION log_deletion();

-- 5. Permissions: audit log is backend/service-role only
REVOKE ALL ON deletion_log FROM anon, authenticated;
