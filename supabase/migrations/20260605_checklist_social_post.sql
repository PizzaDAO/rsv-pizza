-- diavola-58479: "Post about the party on socials" checklist item.
--
-- A new non-auto default checklist row placed after "Estimated Attendance"
-- (sort_order 11, due 2026-06-08). link_tab 'social-post' is a SENTINEL, not a
-- real tab/route — both checklist renderers (GPPDashboardTab name-based onClick,
-- ChecklistTab handleNavigate) intercept it to open the new SocialPostModal.
--
-- IMPORTANT ordering note for the operator: before this checklist_defaults row is
-- inserted in prod, run backend/scripts/backfill-social-post-checklist.cjs --apply
-- so already-seeded parties get the new item directly. Otherwise the seed
-- endpoint's reconcile (delete-and-recreate when a party's is_default count drops
-- below the checklist_defaults count) would fire on every already-seeded party and
-- wipe manual completion on the non-auto default items (Find Partners, Select
-- Pizzeria, etc.). The backfill script performs both steps in the correct order;
-- this file documents the template change for the migration history.

INSERT INTO checklist_defaults (name, due_date, is_auto, auto_rule, link_tab, sort_order) VALUES
  ('Post about the party on socials', '2026-06-08', false, NULL, 'social-post', 11)
ON CONFLICT (name) DO NOTHING;
