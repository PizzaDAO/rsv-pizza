-- Select Pizzeria: route to Pizza tab + auto-complete when pizzerias are selected
UPDATE checklist_defaults
   SET link_tab = 'pizza',
       is_auto = true,
       auto_rule = 'pizzerias_selected',
       updated_at = now()
 WHERE name = 'Select Pizzeria';

UPDATE checklist_items
   SET link_tab = 'pizza',
       is_auto = true,
       auto_rule = 'pizzerias_selected'
 WHERE name = 'Select Pizzeria' AND is_default = true;

-- Find Partners: fix invalid link_tab ('sponsors' is not a HostPage tab)
UPDATE checklist_defaults
   SET link_tab = 'partners', updated_at = now()
 WHERE name = 'Find Partners';

UPDATE checklist_items
   SET link_tab = 'partners'
 WHERE name = 'Find Partners' AND is_default = true;
