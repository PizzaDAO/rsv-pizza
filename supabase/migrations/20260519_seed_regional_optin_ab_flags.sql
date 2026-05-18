-- mushroom-36006: regional expansion of the parmesan-98989 combined PizzaDAO+SWC
-- opt-in A/B test. Seeds one kill-switch flag per non-US SWC region (CA, AU, EU,
-- UK, BR). All new flags default enabled=false; the US flag was seeded in
-- 20260518_create_experiment_flags.sql and is unchanged here.

INSERT INTO experiment_flags (key, enabled, description) VALUES
  ('optin_ab_pizzadao_partners_ca', false,
    'mushroom-36006: combined PizzaDAO+SWC opt-in A/B for swccanada-tagged events (Canada). When OFF, swccanada RSVPs render the two-checkbox baseline.'),
  ('optin_ab_pizzadao_partners_au', false,
    'mushroom-36006: combined PizzaDAO+SWC opt-in A/B for swcau-tagged events (Australia). When OFF, swcau RSVPs render the two-checkbox baseline.'),
  ('optin_ab_pizzadao_partners_eu', false,
    'mushroom-36006: combined PizzaDAO+SWC opt-in A/B for swceu-tagged events (EU). When OFF, swceu RSVPs render the two-checkbox baseline.'),
  ('optin_ab_pizzadao_partners_uk', false,
    'mushroom-36006: combined PizzaDAO+SWC opt-in A/B for swcuk-tagged events (UK). When OFF, swcuk RSVPs render the two-checkbox baseline.'),
  ('optin_ab_pizzadao_partners_br', false,
    'mushroom-36006: combined PizzaDAO+SWC opt-in A/B for swcbr-tagged events (Brazil). When OFF, swcbr RSVPs render the two-checkbox baseline.')
ON CONFLICT (key) DO NOTHING;
