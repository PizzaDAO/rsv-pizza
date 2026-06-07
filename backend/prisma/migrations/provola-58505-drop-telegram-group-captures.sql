-- provola-58505: retire the dead inbound Telegram capture suite.
--
-- The @MoltoBeneBot token is owned by the separate moltobene service, so
-- rsvpizza's webhook never received updates and the capture table was unused.
-- City → chat_id mapping now flows from moltobene's GET /city/groups (lazy,
-- per-city, on demand) into city_telegram_groups. The TelegramGroupCapture
-- Prisma model was removed; drop its table.
DROP TABLE IF EXISTS telegram_group_captures;
