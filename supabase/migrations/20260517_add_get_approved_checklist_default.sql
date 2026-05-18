-- garlic-43340: Add "Get reviewed for funding" auto-completing default checklist item
-- Auto-completes when parties.underboss_status is any non-pending value.

INSERT INTO checklist_defaults (name, due_date, is_auto, auto_rule, link_tab, sort_order)
VALUES ('Get reviewed for funding', '2026-05-19', true, 'underboss_reviewed', NULL, 10)
ON CONFLICT (name) DO NOTHING;

-- Backfill: insert into checklist_items for existing GPP events that don't yet have this row.
-- (The GET handler short-circuits seeding once an event has any defaults, so existing events
-- won't get the row automatically.)
INSERT INTO checklist_items (id, party_id, name, due_date, is_auto, auto_rule, link_tab, sort_order, is_default, completed, created_at, updated_at)
SELECT gen_random_uuid(), p.id, 'Get reviewed for funding', '2026-05-19'::date, true, 'underboss_reviewed', NULL, 10, true, false, now(), now()
FROM parties p
WHERE p.event_type = 'gpp'
  AND NOT EXISTS (
    SELECT 1 FROM checklist_items ci
    WHERE ci.party_id = p.id AND ci.name = 'Get reviewed for funding'
  );
