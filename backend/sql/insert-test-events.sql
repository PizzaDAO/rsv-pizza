-- Insert test events with images
-- Run this in Supabase SQL Editor

-- Pizza Piola event
INSERT INTO parties (
  name,
  host_name,
  date,
  duration,
  address,
  description,
  event_image_url,
  custom_url,
  pizza_style,
  max_guests,
  available_beverages
) VALUES (
  'Pizza Piola',
  'PizzaDAO',
  '2025-11-21 20:00:00',
  3.0,
  'Dune Park, Araoz 740, Buenos Aires',
  'Join the pizza mafia, pepe.wtf, Memeables, and friends for pizza, refreshments, and art on Thursday, December 4 from 5-8pm at FunDimension Miami.

PizzaDAO is a global pizza co-op, a pizza party planner, and a pizza faucet for onchain builders. We''re preparing for our 5th annual Global Pizza Party on Bitcoin Pizza Day, May 22.',
  '/rsv-pizza/piola.jpg',
  'piola',
  'new-york',
  50,
  ARRAY['coke', 'sprite', 'water']
) ON CONFLICT (custom_url) DO UPDATE SET
  event_image_url = EXCLUDED.event_image_url,
  description = EXCLUDED.description;

-- Pizza Joli event
INSERT INTO parties (
  name,
  host_name,
  date,
  duration,
  address,
  description,
  event_image_url,
  custom_url,
  pizza_style,
  max_guests,
  available_beverages
) VALUES (
  'Pizza Joli',
  'PizzaDAO x Web3Lagos',
  '2025-08-30 17:00:00',
  2.0,
  'The Zone, Lagos',
  'PizzaDAO x Web3Lagos Conference presents Pizza Joli! Join us for an evening of pizza, networking, and Web3 discussions at The Zone in Lagos.',
  '/rsv-pizza/joli.jpg',
  'joli',
  'new-york',
  75,
  ARRAY['coke', 'sprite', 'fanta', 'water']
) ON CONFLICT (custom_url) DO UPDATE SET
  event_image_url = EXCLUDED.event_image_url,
  description = EXCLUDED.description;

-- ETH Tokyo event
INSERT INTO parties (
  name,
  host_name,
  date,
  duration,
  address,
  description,
  event_image_url,
  custom_url,
  pizza_style,
  max_guests,
  available_beverages
) VALUES (
  'ハックピザ (Hack Pizza)',
  'PizzaDAO x Ethreactor',
  '2025-09-15 18:00:00',
  2.0,
  'ETHTokyo Venue',
  'PizzaDAO x Ethreactor present ハックピザ (Hack Pizza)! Join us after the ETHTokyo hackathon (Sep 14-15) for pizza and networking at our party on Sep 15, 6-8pm.

Fuel your hacking with fresh pizza while connecting with builders from the ETHTokyo community.',
  '/rsv-pizza/ethtokyo.jpg',
  'ethtokyo',
  'new-york',
  60,
  ARRAY['coke', 'sprite', 'water', 'iced-tea']
) ON CONFLICT (custom_url) DO UPDATE SET
  event_image_url = EXCLUDED.event_image_url,
  description = EXCLUDED.description;

-- Verify the inserts
SELECT
  id,
  name,
  custom_url,
  date,
  duration,
  max_guests,
  event_image_url
FROM parties
WHERE custom_url IN ('piola', 'joli', 'ethtokyo')
ORDER BY date;
