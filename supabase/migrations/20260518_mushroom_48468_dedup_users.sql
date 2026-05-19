-- mushroom-48468: merge duplicate User rows that share the same lower(email).
--
-- ORDER: this migration MUST run AFTER backend code is deployed with
-- lowercase normalization (so no new duplicates are created mid-merge),
-- and BEFORE 20260518_mushroom_48468_user_email_lower_unique.sql (which
-- would fail on the duplicates).
--
-- ROLLBACK: snapshot tables created below. To rollback, see comments at end.

BEGIN;

-- 0. Snapshot for rollback (kept indefinitely; drop manually once verified)
CREATE TABLE IF NOT EXISTS "User_backup_mushroom_48468" AS SELECT * FROM "User";
CREATE TABLE IF NOT EXISTS "parties_user_id_backup_mushroom_48468" AS
  SELECT id, user_id FROM parties WHERE user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS "Order_userId_backup_mushroom_48468" AS
  SELECT id, "userId" FROM "Order";
CREATE TABLE IF NOT EXISTS "MagicLink_userId_backup_mushroom_48468" AS
  SELECT id, "userId" FROM "MagicLink" WHERE "userId" IS NOT NULL;
CREATE TABLE IF NOT EXISTS "api_keys_user_id_backup_mushroom_48468" AS
  SELECT id, user_id FROM api_keys;
CREATE TABLE IF NOT EXISTS "AIPhoneCall_userId_backup_mushroom_48468" AS
  SELECT id, "userId" FROM "AIPhoneCall";
CREATE TABLE IF NOT EXISTS "payouts_host_user_id_backup_mushroom_48468" AS
  SELECT id, host_user_id FROM payouts;

-- 1. Build a winners CTE per duplicate cluster, then a winner_loser map.
--    Tiebreaker per Snax: party_count DESC, createdAt ASC, id ASC.
WITH clusters AS (
  SELECT
    id,
    lower(email) AS lemail,
    "createdAt",
    (SELECT COUNT(*) FROM parties WHERE parties.user_id = "User".id) AS party_count
  FROM "User"
  WHERE lower(email) IN (
    SELECT lower(email) FROM "User" GROUP BY lower(email) HAVING COUNT(*) > 1
  )
),
ranked AS (
  SELECT id, lemail, "createdAt", party_count,
         ROW_NUMBER() OVER (
           PARTITION BY lemail
           ORDER BY party_count DESC, "createdAt" ASC, id ASC
         ) AS rn
  FROM clusters
),
winners AS (
  SELECT lemail, id AS winner_id FROM ranked WHERE rn = 1
),
losers AS (
  SELECT r.id AS loser_id, w.winner_id
  FROM ranked r
  JOIN winners w ON r.lemail = w.lemail
  WHERE r.rn > 1
)
SELECT * INTO TEMP TABLE user_merge_map FROM losers;

-- (Inspect mid-transaction — uncomment to see the merge plan)
-- SELECT * FROM user_merge_map;

-- 2. Re-point all FKs. Foreign keys without ON DELETE CASCADE / SET NULL
--    must be re-pointed FIRST so we don't violate ON DELETE RESTRICT on payouts.
UPDATE parties        SET user_id  = m.winner_id FROM user_merge_map m WHERE parties.user_id  = m.loser_id;
UPDATE "Order"        SET "userId" = m.winner_id FROM user_merge_map m WHERE "Order"."userId" = m.loser_id;
UPDATE "MagicLink"    SET "userId" = m.winner_id FROM user_merge_map m WHERE "MagicLink"."userId" = m.loser_id;
UPDATE api_keys       SET user_id  = m.winner_id FROM user_merge_map m WHERE api_keys.user_id  = m.loser_id;
UPDATE "AIPhoneCall"  SET "userId" = m.winner_id FROM user_merge_map m WHERE "AIPhoneCall"."userId" = m.loser_id;
UPDATE payouts        SET host_user_id = m.winner_id FROM user_merge_map m WHERE payouts.host_user_id = m.loser_id;

-- 3. Merge profile fields: winner gets loser's value ONLY when winner is null/empty.
--    `username` is @unique — if loser's username collides with another user, leave
--    winner's NULL and continue silently (per Snax decision #4).
WITH loser_data AS (
  SELECT
    m.winner_id,
    (ARRAY_AGG(u.name)                         FILTER (WHERE u.name IS NOT NULL))[1]                        AS name,
    (ARRAY_AGG(u.username)                     FILTER (WHERE u.username IS NOT NULL))[1]                    AS username,
    (ARRAY_AGG(u.bio)                          FILTER (WHERE u.bio IS NOT NULL))[1]                         AS bio,
    (ARRAY_AGG(u."profilePictureUrl")          FILTER (WHERE u."profilePictureUrl" IS NOT NULL))[1]         AS "profilePictureUrl",
    (ARRAY_AGG(u."defaultAddress")             FILTER (WHERE u."defaultAddress" IS NOT NULL))[1]            AS "defaultAddress",
    (ARRAY_AGG(u.twitter)                      FILTER (WHERE u.twitter IS NOT NULL))[1]                     AS twitter,
    (ARRAY_AGG(u.instagram)                    FILTER (WHERE u.instagram IS NOT NULL))[1]                   AS instagram,
    (ARRAY_AGG(u.youtube)                      FILTER (WHERE u.youtube IS NOT NULL))[1]                     AS youtube,
    (ARRAY_AGG(u.tiktok)                       FILTER (WHERE u.tiktok IS NOT NULL))[1]                      AS tiktok,
    (ARRAY_AGG(u.linkedin)                     FILTER (WHERE u.linkedin IS NOT NULL))[1]                    AS linkedin,
    (ARRAY_AGG(u.telegram)                     FILTER (WHERE u.telegram IS NOT NULL))[1]                    AS telegram,
    (ARRAY_AGG(u.website)                      FILTER (WHERE u.website IS NOT NULL))[1]                     AS website,
    (ARRAY_AGG(u."preferred_payout_method")    FILTER (WHERE u."preferred_payout_method" IS NOT NULL))[1]   AS "preferred_payout_method",
    (ARRAY_AGG(u."payout_wallet_address")      FILTER (WHERE u."payout_wallet_address" IS NOT NULL))[1]     AS "payout_wallet_address",
    (ARRAY_AGG(u."payout_bank_details")        FILTER (WHERE u."payout_bank_details" IS NOT NULL))[1]       AS "payout_bank_details",
    (ARRAY_AGG(u."defaultLikedToppings")        FILTER (WHERE COALESCE(array_length(u."defaultLikedToppings", 1), 0) > 0))[1]     AS "defaultLikedToppings",
    (ARRAY_AGG(u."defaultDislikedToppings")     FILTER (WHERE COALESCE(array_length(u."defaultDislikedToppings", 1), 0) > 0))[1]  AS "defaultDislikedToppings",
    (ARRAY_AGG(u."defaultLikedBeverages")       FILTER (WHERE COALESCE(array_length(u."defaultLikedBeverages", 1), 0) > 0))[1]    AS "defaultLikedBeverages",
    (ARRAY_AGG(u."defaultDislikedBeverages")    FILTER (WHERE COALESCE(array_length(u."defaultDislikedBeverages", 1), 0) > 0))[1] AS "defaultDislikedBeverages",
    (ARRAY_AGG(u."defaultDietaryRestrictions")  FILTER (WHERE COALESCE(array_length(u."defaultDietaryRestrictions", 1), 0) > 0))[1] AS "defaultDietaryRestrictions"
  FROM user_merge_map m
  JOIN "User" u ON u.id = m.loser_id
  GROUP BY m.winner_id
)
UPDATE "User" w
SET
  name                         = COALESCE(w.name,                         ld.name),
  username                     = CASE
                                   WHEN w.username IS NOT NULL THEN w.username
                                   WHEN ld.username IS NULL THEN NULL
                                   WHEN EXISTS (SELECT 1 FROM "User" u2 WHERE u2.username = ld.username AND u2.id <> w.id) THEN NULL
                                   ELSE ld.username
                                 END,
  bio                          = COALESCE(w.bio,                          ld.bio),
  "profilePictureUrl"          = COALESCE(w."profilePictureUrl",          ld."profilePictureUrl"),
  "defaultAddress"             = COALESCE(w."defaultAddress",             ld."defaultAddress"),
  twitter                      = COALESCE(w.twitter,                      ld.twitter),
  instagram                    = COALESCE(w.instagram,                    ld.instagram),
  youtube                      = COALESCE(w.youtube,                      ld.youtube),
  tiktok                       = COALESCE(w.tiktok,                       ld.tiktok),
  linkedin                     = COALESCE(w.linkedin,                     ld.linkedin),
  telegram                     = COALESCE(w.telegram,                     ld.telegram),
  website                      = COALESCE(w.website,                      ld.website),
  preferred_payout_method      = COALESCE(w.preferred_payout_method,      ld.preferred_payout_method),
  payout_wallet_address        = COALESCE(w.payout_wallet_address,        ld.payout_wallet_address),
  payout_bank_details          = COALESCE(w.payout_bank_details,          ld.payout_bank_details),
  "defaultLikedToppings"        = CASE WHEN COALESCE(array_length(w."defaultLikedToppings", 1), 0) = 0       THEN COALESCE(ld."defaultLikedToppings",        w."defaultLikedToppings")       ELSE w."defaultLikedToppings"       END,
  "defaultDislikedToppings"     = CASE WHEN COALESCE(array_length(w."defaultDislikedToppings", 1), 0) = 0    THEN COALESCE(ld."defaultDislikedToppings",     w."defaultDislikedToppings")    ELSE w."defaultDislikedToppings"    END,
  "defaultLikedBeverages"       = CASE WHEN COALESCE(array_length(w."defaultLikedBeverages", 1), 0) = 0      THEN COALESCE(ld."defaultLikedBeverages",       w."defaultLikedBeverages")      ELSE w."defaultLikedBeverages"      END,
  "defaultDislikedBeverages"    = CASE WHEN COALESCE(array_length(w."defaultDislikedBeverages", 1), 0) = 0   THEN COALESCE(ld."defaultDislikedBeverages",    w."defaultDislikedBeverages")   ELSE w."defaultDislikedBeverages"   END,
  "defaultDietaryRestrictions"  = CASE WHEN COALESCE(array_length(w."defaultDietaryRestrictions", 1), 0) = 0 THEN COALESCE(ld."defaultDietaryRestrictions",  w."defaultDietaryRestrictions") ELSE w."defaultDietaryRestrictions" END,
  "updatedAt"                  = now()
FROM loser_data ld
WHERE w.id = ld.winner_id;

-- 4. Lowercase the winner's email column (in case it was stored mixed-case).
UPDATE "User" SET email = lower(email) WHERE email <> lower(email);

-- 5. Now safe to delete losers (no FKs point at them).
DELETE FROM "User" WHERE id IN (SELECT loser_id FROM user_merge_map);

-- 6. Verify no duplicates remain.
DO $$
DECLARE dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT lower(email) FROM "User" GROUP BY lower(email) HAVING COUNT(*) > 1
  ) sub;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Dedup incomplete: % duplicate clusters remain', dup_count;
  END IF;
END $$;

COMMIT;

-- ROLLBACK INSTRUCTIONS (manual, run as SQL by an admin):
--   BEGIN;
--   TRUNCATE "User";
--   INSERT INTO "User" SELECT * FROM "User_backup_mushroom_48468";
--   UPDATE parties        SET user_id  = b.user_id  FROM "parties_user_id_backup_mushroom_48468"  b WHERE parties.id  = b.id;
--   UPDATE "Order"        SET "userId" = b."userId" FROM "Order_userId_backup_mushroom_48468"     b WHERE "Order".id  = b.id;
--   UPDATE "MagicLink"    SET "userId" = b."userId" FROM "MagicLink_userId_backup_mushroom_48468" b WHERE "MagicLink".id = b.id;
--   UPDATE api_keys       SET user_id  = b.user_id  FROM "api_keys_user_id_backup_mushroom_48468" b WHERE api_keys.id  = b.id;
--   UPDATE "AIPhoneCall"  SET "userId" = b."userId" FROM "AIPhoneCall_userId_backup_mushroom_48468" b WHERE "AIPhoneCall".id = b.id;
--   UPDATE payouts        SET host_user_id = b.host_user_id FROM "payouts_host_user_id_backup_mushroom_48468" b WHERE payouts.id = b.id;
--   COMMIT;
--
-- Once you've verified prod is stable (suggest 7 days), drop the backup tables:
--   DROP TABLE "User_backup_mushroom_48468",
--              "parties_user_id_backup_mushroom_48468",
--              "Order_userId_backup_mushroom_48468",
--              "MagicLink_userId_backup_mushroom_48468",
--              "api_keys_user_id_backup_mushroom_48468",
--              "AIPhoneCall_userId_backup_mushroom_48468",
--              "payouts_host_user_id_backup_mushroom_48468";
