# mushroom-48468: Email lookups case-insensitive + dedup duplicate Users

**Task ID**: `mushroom-48468`
**Priority**: P1 (auth correctness + identity-data dedup)
**Branch suggestion**: `mushroom-48468-email-ci` (24 chars — fits Vercel preview DNS)
**Preview URL**: `https://rsvpizza-git-mushroom-48468-email-ci-pizza-dao.vercel.app`

---

## 1. Problem statement

`POST /api/auth/magic-link` and the two verification endpoints (`/verify-token`, `/verify-code`) compare and store `User.email` with the raw casing the user typed. As a result, a single person can end up with multiple `User` rows for the same email address whenever they sign in on a device that auto-capitalizes (iOS/Android keyboards, Safari address autofill).

Concrete production impact:
- Valerie ("VDizzle") owns the GPP San Diego party via user `cmmtm3rim000sjr04qaloq5zv` (email stored as `vdizzle7nft@gmail.com`).
- On mobile she signed up as `VDizzle7NFT@gmail.com`; this created a fresh user `cmp79126y000ajr04w0iwuft2`.
- `HostPage` checks party ownership against `req.userId`, doesn't find a match, and redirects her to `/rsvp/sandiego` instead of her host dashboard.

Other tables (`Admin`, `Underboss`, `SponsorUser`, `GraphicsAdmin`, `Guest`) already normalize on read and write — only `User` (and a couple of `User.email`-targeted `findMany` calls) is unsafe. We must:

1. Lowercase every read/write that touches `User.email`.
2. Add a Postgres-level guard so this can't regress.
3. Merge the duplicate rows that already exist in production without losing data.

The order matters (see §6).

---

## 2. Files to change (line refs from `origin/master` @ `b1ca1540`)

### A. New file — central normalizer

`backend/src/helpers/email.ts` (new):
```ts
/**
 * Canonical email normalization for User.email lookups + writes.
 * Lowercases and trims. RFC 5321 says the local-part is case-sensitive,
 * but no consumer mail provider preserves case, and we MUST collapse case
 * for identity to work across iOS auto-capitalization. See mushroom-48468.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}
```

(Sibling location to existing `backend/src/helpers/auditContext.ts`, `partyAccess.ts`, `partnerSync.ts`.)

### B. `backend/src/routes/auth.routes.ts`

All four spots that touch `User.email` or `MagicLink.email`:

- **Line 65–69** (`POST /magic-link` input parse): import `normalizeEmail`, then add `const normalized = normalizeEmail(email)` right after the regex check. From this point onward in the handler, use `normalized` everywhere `email` is currently used.
- **Line 78** — `findUnique({ where: { email } })` → `findUnique({ where: { email: normalized } })`.
- **Line 99** — `MagicLink.create({ data: { ..., email } })` → `email: normalized` (so subsequent `/verify-token` lookups by code yield a normalized email field even if the row pre-dated the fix).
- **Line 121** — `sendMagicLinkEmail(email, ...)` — keep using the user-typed `email` for the `to:` field of the outbound Resend call, since SMTP is case-insensitive but some delivery logs preserve the original. (Optional; using `normalized` is also fine. Mention in Snax review.)
- **Line 218** (`/verify-token` user-creation path) — `prisma.user.create({ data: { email: magicLink.email } })`. `magicLink.email` is already-stored data and may be mixed-case for pre-existing rows. Wrap in `normalizeEmail(magicLink.email)!`.
- **Line 297** (`/verify-code` user-creation path) — same fix: wrap in `normalizeEmail(magicLink.email)!`.

### C. `backend/src/routes/party.routes.ts`

- **Line 356** — `prisma.user.findMany({ where: { email: { in: coHostEmails } } })`. `coHostEmails` comes from JSONB co-host blobs which are user-typed. Map to lowercase before the query so it matches the canonical lowercased `User.email`:
  ```ts
  const coHostEmailsLc = coHostEmails.map((e: string) => e.toLowerCase());
  const users = await prisma.user.findMany({
    where: { email: { in: coHostEmailsLc } },
    ...
  });
  const profilesByEmail = Object.fromEntries(users.map(u => [u.email, u]));
  // Later: profilesByEmail[h.email?.toLowerCase()] instead of profilesByEmail[h.email]
  ```

### D. `backend/src/routes/event.routes.ts`

- **Line 212–216** — same pattern as party.routes.ts:356. Lowercase `coHostEmails` before the `findMany` and switch the `profilesByEmail` key lookup to lowercase.

### E. `backend/src/routes/sponsor-user.routes.ts`

- **Line 588** — same pattern. The `allCoHostEmails` Set is populated from raw JSONB on lines 582–584. Lowercase as you insert into the Set, OR lowercase when building the `in:` array.

### F. (Note — no change needed) `backend/src/routes/gpp.routes.ts`

Already correct: line 262 sets `const normalizedEmail = email.toLowerCase().trim()` and uses it consistently in lines 306, 313, 413, 440, 470.

### G. (Note — no change needed) `backend/src/routes/user.routes.ts`

All three `findUnique` / `update` calls in this file key by `req.userId`, never by email.

### H. (Note — no change needed) `backend/src/middleware/auth.ts`

`req.userEmail` is read straight from the JWT. Existing tokens in the wild contain mixed-case emails for users who signed in before this fix; callers (`my-events`, `partyAccess.ts`, etc.) already defensively `.toLowerCase()` it. Leave as-is. After deploy, all newly-signed JWTs will carry the lowercased email since `user.email` is now canonical.

### I. New test — `backend/src/helpers/email.test.ts`

Unit test for the helper:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeEmail } from './email.js';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  VDizzle7NFT@Gmail.COM ')).toBe('vdizzle7nft@gmail.com');
  });
  it('returns null for null/undefined/empty', () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
  });
});
```

### J. Updated test — `backend/src/middleware/auth.test.ts:195-198`

Already asserts `isSuperAdmin('Admin@Example.COM')` calls `findUnique` with `'admin@example.com'`. Add equivalent test cases for the auth.routes.ts magic-link endpoint to lock in the new behavior (see §8.B).

---

## 3. Schema-level guard

### Options considered

| Option | Pros | Cons |
|---|---|---|
| **1. `citext` column** | Cleanest; query stays `where: { email: x }` with no normalization needed | Requires `CREATE EXTENSION citext` (Supabase supports it); Prisma represents `citext` as `Unsupported("citext")` which breaks the typed `where: { email }` predicate — would require raw SQL or `@db.Text` + native type override. Risky on a live `User` table. |
| **2. Functional unique index on `LOWER(email)`** | One-line migration; no Prisma type changes; matches existing precedent (`20260330_add_guest_email_index.sql` uses `lower(email)`). Application code stays in charge of normalization, which is fine because we're already adding `normalizeEmail()`. | Doesn't physically force lowercase storage — relies on app code to lowercase before insert. |
| **3. `BEFORE INSERT/UPDATE` trigger forcing lowercase** | Bulletproof — DB rejects mixed case. | Most surface area; harder to debug; triggers are easy to forget about when reading the schema. Overkill given option 2 + the new helper. |

### Recommendation: **Option 2** — functional unique index on `LOWER("User".email)`.

Rationale: matches the existing project convention (`guests.email` already has `idx_guests_email ON guests (lower(email))`); zero Prisma surgery; the new `normalizeEmail()` helper is the single chokepoint for writes so the trigger is redundant; cheap to evolve to option 3 later if a regression slips through.

### Migration SQL

`supabase/migrations/20260518_mushroom_48468_user_email_lower_unique.sql`:

```sql
-- mushroom-48468: enforce case-insensitive uniqueness on User.email.
--
-- IMPORTANT: this migration MUST be applied AFTER the backend deploy that
-- lowercases on read/write, AND AFTER the dedup backfill in
-- 20260518_mushroom_48468_dedup_users.sql. Applying it earlier would fail
-- on the existing duplicate-casing rows.

-- 1. Drop the old case-sensitive unique constraint.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_key";

-- 2. Add a functional unique index on lower(email).
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_lower_unique"
  ON "User" (lower(email));

-- 3. CHECK constraint: forbid any future row whose email isn't already lowercase.
-- Belt-and-suspenders with the app-level normalizeEmail() helper.
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_is_lowercase"
  CHECK (email = lower(email)) NOT VALID;

-- Validate it separately so we can investigate stragglers if any slip past dedup.
ALTER TABLE "User" VALIDATE CONSTRAINT "User_email_is_lowercase";
```

**Prisma schema sync**: After this migration is applied, update `backend/prisma/schema.prisma:12`:

```prisma
model User {
  id    String @id @default(cuid())
  email String  // ← drop @unique; the functional index doesn't map to a Prisma @unique
  ...
  @@unique([email], map: "User_email_lower_unique") // optional — keeps Prisma aware
}
```

Note: Prisma's `@unique` generates a plain B-tree unique. The functional index can't be represented in Prisma directly. Options: (a) leave `@unique` in the schema and add a comment explaining the DB-side index is what actually enforces case-insensitivity (Prisma's introspection won't see the functional index and may try to recreate the plain one during `prisma migrate dev` — guard against this with a `// prettier-ignore` comment and avoid running `migrate dev`); (b) drop `@unique` and rely solely on the DB-side index, accepting that `prisma db pull` will be lossy. **Recommend (a)** — keep `@unique` in Prisma for type-safety (it enables `findUnique({ where: { email } })` calls); the functional index does the real enforcement and `migrate dev` is not part of our deploy flow (we hand-write SQL migrations).

---

## 4. Dedup migration for existing duplicates

### Scope query (run first, share output with Snax)

```sql
-- How many duplicate-email clusters exist?
SELECT lower(email) AS lemail, COUNT(*) AS dup_count, array_agg(id ORDER BY "createdAt") AS ids
FROM "User"
GROUP BY lower(email)
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, lemail;
```

Expected output: clusters like `{vdizzle7nft@gmail.com, dup_count: 2, ids: [cmmtm3..., cmp791...]}`. **Before running the backfill, paste the count + a few examples into the PR description.**

### Canonical-row selection rule

For each cluster of duplicates with the same `lower(email)`:

1. **Primary tiebreaker**: pick the row that owns the most `parties` (party.user_id). Hosts are the highest-value identity to preserve — an orphaned dashboard is the worst failure mode.
2. **Secondary tiebreaker**: oldest `createdAt`. Original signup wins.
3. **Final tiebreaker**: lexicographically smallest `id`. Deterministic for testing.

Rationale: Valerie's `cmmtm3rim000sjr04qaloq5zv` row owns 1 party (San Diego GPP); the mobile-created `cmp79126y000ajr04w0iwuft2` owns 0. Rule (1) correctly selects the host row.

### Tables to re-point (enumerated from `backend/prisma/schema.prisma` `User` relations)

| Prisma relation | DB table | FK column | Notes |
|---|---|---|---|
| `parties` | `parties` | `user_id` (TEXT, nullable, ON DELETE CASCADE) | The high-value one. |
| `orders` | `"Order"` | `"userId"` (TEXT, NOT NULL, no cascade) | |
| `magicLinks` | `"MagicLink"` | `"userId"` (TEXT, nullable, ON DELETE CASCADE) | Old links are mostly expired — fine. |
| `apiKeys` | `api_keys` | `user_id` (TEXT, NOT NULL, ON DELETE CASCADE) | |
| `aiPhoneCalls` | `"AIPhoneCall"` | `"userId"` (TEXT, NOT NULL) | |
| `payouts` | `payouts` | `host_user_id` (TEXT, NOT NULL, ON DELETE RESTRICT) | New table from arugula-38633. ON DELETE RESTRICT means we MUST re-point before deleting losers. |

Sponsor / Admin / Underboss / SponsorUser / GraphicsAdmin / Guest have NO FK to `"User".id` — they're standalone tables keyed by email. Safe to ignore.

`PartyStatusAudit.actorEmail`, `PayoutAudit.actorEmail`, `Donation.donorEmail`, `venueContactEmail`, `Guest.email`, etc. are TEXT columns (not FKs). Optionally normalize these to lowercase in a follow-up pass for consistency, but NOT required for the dedup to be correct — they're informational.

### Field-merge rules (winner ← loser)

For each profile field, if the winner's value is `NULL`/empty and the loser's is non-null, copy from loser. **Never overwrite a non-null winner value.** Fields:

- `name`, `username`, `bio`, `profilePictureUrl`, `defaultAddress`
- `twitter`, `instagram`, `youtube`, `tiktok`, `linkedin`, `telegram`, `website`
- `defaultDietaryRestrictions`, `defaultLikedToppings`, `defaultDislikedToppings`, `defaultLikedBeverages`, `defaultDislikedBeverages` (arrays — winner wins if non-empty; else merge as union? **Recommend simple "winner wins if non-empty array, else copy loser"** — easier to reason about than union-merging arrays.)
- `preferredPayoutMethod`, `payoutWalletAddress`, `payoutBankDetails` (arugula-38633)
- `updatedAt` — set to `now()` for the winner row after merge

`username` is `@unique` in Prisma. If both winner and loser have non-null `username` values, that's a conflict — log the cluster and skip the merge for that field (keep winner's). If winner is null and loser non-null, copy.

### Backfill SQL

`supabase/migrations/20260518_mushroom_48468_dedup_users.sql`:

```sql
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
```

---

## 5. Other audit fixups (optional, low-risk)

After the User-table dedup completes successfully, run a one-off cleanup of denormalized email columns (no FK relationships):

```sql
UPDATE party_status_audit SET actor_email = lower(actor_email) WHERE actor_email <> lower(actor_email);
UPDATE payout_audit       SET actor_email = lower(actor_email) WHERE actor_email <> lower(actor_email);
```

Not blocking. Recommend deferring to a follow-up.

---

## 6. Order of operations (per memory `feedback_apply_migration_before_merging_prisma_changes.md`)

**This sequencing is non-negotiable.** Each step depends on the previous one being live.

1. **Open PR with backend code changes only** (§2). Reviewer: Snax.
2. **Merge PR → master.** Vercel auto-deploys backend. From this moment, all NEW magic-link signups + verifications write lowercase emails to `User` and `MagicLink`.
3. **Run scope query** (§4 "Scope query") in Supabase SQL editor. Paste result count + 5 example clusters into the PR comments for Snax to sanity-check the canonical-row selection rule.
4. **Apply `20260518_mushroom_48468_dedup_users.sql`** via Supabase SQL editor or `supabase migration up`.
5. **Verify dedup**: run `SELECT lower(email), COUNT(*) FROM "User" GROUP BY 1 HAVING COUNT(*) > 1`. Should return zero rows.
6. **Apply `20260518_mushroom_48468_user_email_lower_unique.sql`**.
7. **Update Prisma schema** (`backend/prisma/schema.prisma:12`) as a follow-up PR.
8. **Manual smoke test in production** (§8.C).

**DO NOT** apply step 6 before step 4 — unique index fails on duplicate data.
**DO NOT** apply step 4 before step 2 — new dupes can be created mid-merge.

---

## 7. Rollback strategy

**Code (steps 1-2)**: standard `git revert` of the merge commit + Vercel redeploy. Defensive `.toLowerCase()` in callers means the system still functions post-revert.

**Dedup (step 4)**: see ROLLBACK INSTRUCTIONS comment at end of `20260518_mushroom_48468_dedup_users.sql`. Snapshot tables contain the exact pre-merge state.

**Unique index (step 6)**:
```sql
ALTER TABLE "User" DROP CONSTRAINT "User_email_is_lowercase";
DROP INDEX "User_email_lower_unique";
ALTER TABLE "User" ADD CONSTRAINT "User_email_key" UNIQUE (email);
```

Keep snapshot tables for at least 7 days.

---

## 8. Test plan

### A. Unit
- `normalizeEmail()` lowercases + trims, returns null for empty/null.

### B. Integration

```ts
describe('POST /api/auth/magic-link', () => {
  it('finds existing user when email casing differs', async () => { /* ... */ });
  it('creates magic link row with normalized email', async () => { /* ... */ });
});
describe('POST /api/auth/verify-code', () => {
  it('creates User with lowercase email when magicLink.email is mixed-case', async () => { /* ... */ });
});
```

### C. Manual production smoke test (post-deploy, post-dedup)

1. Log out of rsv.pizza.
2. Sign in with `VDIZZLE7NFT@gmail.com` (uppercase).
3. Receive magic-link code, submit.
4. Decode JWT; assert `userId === 'cmmtm3rim000sjr04qaloq5zv'`.
5. Navigate to `/host/sandiego`; confirm dashboard loads.
6. Repeat with one more known-affected user.

---

## 9. Open questions for Snax

1. **Canonical-row tiebreaker**: I propose `party_count DESC, createdAt ASC, id ASC`. Alternative "always pick oldest" would lose Valerie's host row in edge cases. Confirm `party_count` first.
2. **Magic-link `to:` email**: use normalized lowercase or user-typed for Resend? Mild preference for normalized.
3. **`username` collision during merge**: if winner null and loser has `valerie` but it's taken, my migration leaves winner null and continues. OK, or fail-loud?
4. **`Donation.donorEmail`, `Sponsor.contactEmail`, etc.**: defer to follow-up, or fold into this PR?
5. **Prisma `@unique` vs. functional index**: recommend keeping `@unique` for ergonomics; DB enforces case-insensitivity via the functional index. OK?
6. **Lockfile timing**: this branch PRs against `master` independently (not stacked on `pesto-58917-venue-checklist-address`). Confirm.
