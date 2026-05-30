-- asiago-58472: Estimated Attendance checklist item + new parties.estimated_attendance column.
--
-- A new integer column on parties stores the host's attendance estimate (distinct
-- from expected_guests). A new auto-rule 'attendance_estimated' ticks the
-- "Estimated Attendance" checklist row once the column is non-null (mirrors how
-- 'venue_added' ticks on parties.address).
--
-- IMPORTANT ordering note for the operator: before this checklist_defaults row is
-- inserted in prod, run backend/scripts/backfill-estimated-attendance-checklist.cjs
-- so already-seeded parties get the new item directly. Otherwise the seed
-- endpoint's reconcile (delete-and-recreate when defaultCount < checklist_defaults
-- count) would fire on every already-seeded party and wipe manual completion on
-- non-auto default items. The backfill script performs both steps in the correct
-- order; this file documents the schema change for the migration history.

ALTER TABLE parties ADD COLUMN IF NOT EXISTS estimated_attendance integer;

INSERT INTO checklist_defaults (name, due_date, is_auto, auto_rule, link_tab, sort_order) VALUES
  ('Estimated Attendance', '2026-06-01', true, 'attendance_estimated', 'attendance', 10)
ON CONFLICT (name) DO NOTHING;
