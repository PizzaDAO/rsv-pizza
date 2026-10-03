-- Drop dead migration-leftover backup tables (authorized 2026-10-03). They held
-- stale sensitive data (User/MagicLink/parties/payouts/api_keys/AIPhoneCall
-- backups + a photos created_at clobber backup), were anon-exposed until #1061
-- locked them, have ZERO references in code or schema.prisma, and the live
-- originals exist separately. Destructive + intentional. No CASCADE (nothing
-- depends on them).
DROP TABLE IF EXISTS "AIPhoneCall_userId_backup_mushroom_48468";
DROP TABLE IF EXISTS "MagicLink_userId_backup_mushroom_48468";
DROP TABLE IF EXISTS "User_backup_mushroom_48468";
DROP TABLE IF EXISTS "api_keys_user_id_backup_mushroom_48468";
DROP TABLE IF EXISTS "parties_user_id_backup_mushroom_48468";
DROP TABLE IF EXISTS "payouts_host_user_id_backup_mushroom_48468";
DROP TABLE IF EXISTS "photos_created_at_clobber_backup";
