# claim-later-nft: attendance NFTs claimed later with any wallet

Branch: `claim-later-nft`. Base: `origin/master`. Local `master` is 7 commits behind; rebase first. #1343 (`guestWalletsEnabled()`) is only on origin.

## Goal
Guests who attended an NFT-enabled event and have no usable wallet get a private, single-use link. They claim the attendance NFT to any address they choose: a connected wallet, a pasted 0x address, or an ENS name. Eligible guests with a wallet they typed in get minted with no claim step. Privy stops being part of the guest flow.

## What exists today (investigated)
- **Contract/chain:** one ERC-721 per chain with `mintOrUpdate(to, eventId=partyId, uri)`, `hasToken(owner, eventId)`, `tokenOfOwner`. Chains `base` (default) and `monad` (`parties.nft_chain`). Contract addresses and RPCs are edge-function env vars.
- **Minter key:** `MINTER_PRIVATE_KEY` exists only in the Supabase edge function `supabase/functions/mint-nft/index.ts`. The backend never holds it.
- **Edge function guard (`checkMintAllowed`):**
  - the party has `nft_enabled` and an `event_image_url`;
  - the requested chain equals the party's chain;
  - approval-required events need `approved`;
  - **recipient must equal `guests.ethereum_address`**.
  - Idempotent on-chain per (address, partyId): if `hasToken` is true it returns `alreadyMinted`.
- **Mint triggers (none of them are attendance):**
  1. At RSVP, the client calls the edge function with the anon key (`frontend/src/hooks/useMintNFT.ts`, used by `frontend/src/components/RSVPModal.tsx`), but only if the guest typed or connected a wallet. It then saves the result with `PATCH /api/nft/guest/:guestId` (guest-token gated, `backend/src/routes/nft.routes.ts`).
  2. When a host approves a guest: `backend/src/lib/mintOnApproval.ts`, called from `party.routes.ts` ~L2182 with the service key.
  3. The CLI `backend/scripts/backfill-nft-mints.ts` (plan: `plans/backfill-nft-mints.md`): guests with an address and no token.
  - Privy wallets were set on the backend after RSVP, so nothing on the client minted to them. Most of the 155 likely have **no NFT** (verify with the counts in Rollout).
- **Metadata:** `GET /api/nft/metadata/:partyId/:address` looks up the guest by `ethereum_address`. Any claim must therefore write the claimed address to `guests.ethereum_address`.
- **Guest DB fields:**
  - `ethereum_address`, `wallet_source` (`manual` | `privy-embedded`), `privy_user_id`;
  - `nft_token_id`, `nft_transaction_hash`, `nft_minted_at`;
  - `checked_in_at`, `checked_in_by` (host scan, peer vouch, host self-check-in in `checkin.routes.ts`);
  - `survey_token` (precedent for a tokenized link).
- **Guest auth:**
  - email login code / magic link (`lib/loginCode.ts`), JWT Bearer in localStorage;
  - HMAC guest capability token (`lib/guestToken.ts`, `callerOwnsGuest`).
  - A guest can change their wallet only by re-submitting the RSVP (`rsvp.routes.ts` `updateData`). That path also **nulls `ethereum_address`** if left blank, so it would wipe a Privy wallet (existing bug, noted in Risks). There is no wallet field on `/account`.
- **Frontend wallet stack:**
  - wagmi + ConnectKit (`main.tsx`, `lib/wagmiConfig`, `lib/wallet/connectors.ts`: EIP-6963 + Coinbase, no WalletConnect);
  - `OpenInWallet` hand-off for mobile in-app browsers;
  - the RSVPModal pattern: `useAccount()` auto-fills an `IconInput` wallet field.
  - ENS resolution: `backend/src/services/ens.service.ts` `resolveEns`.
- **Post-event email:**
  - guest survey, `routes/survey.routes.ts` (`buildSurveyEmail`, `sendSurveyToParty`): Resend via `fetch`, `site = siteForParty(party)` for brand URL and from-address;
  - hourly cron `POST /api/cron/send-surveys` (`backend/vercel.json`, `CRON_SECRET`, `isMorningAfterInTimezone`).
- **White-label:**
  - `BRAND_FEATURES.nftMinting = !BRAND.isBranded` (`frontend/src/config/brandScope.ts`);
  - `EventPage` forces `nftEnabled:false` on branded builds.
  - NFTs are PizzaDAO-only, not per-brand.
- **Rate limiting:** `express-rate-limit` in `index.ts`, plus the durable cross-instance store `lib/authRateLimit.ts` (`prismaRateStore`, `hashRateKey`, table `auth_rate_events`).

## Decisions (recommended, see Open Questions)
- **Eligibility** `isNftEligible(guest, party)`:
  - `party.nft_enabled` and `event_image_url` are set;
  - the party has no branded series (`siteForParty(party).name === brand.name`);
  - the event has ended (`end_time`, or `date` + 6h, before now);
  - `guest.checked_in_at IS NOT NULL` and `approved IS DISTINCT FROM false`;
  - `nft_token_id IS NULL`;
  - no other guest row at the party with the same `lower(email)` already has a token or a minted claim.
- **Wallet on file:**
  - `wallet_source = 'manual'` (or null with an address) → mint directly from the cron, no email.
  - `wallet_source = 'privy-embedded'` → treated as **no usable wallet**: guests can't access it, since the frontend has no Privy login. They get a claim link.
- **No signature proof.** Entering an address is enough.
  - The token holder can only send *their own* NFT, once, so the risk is a typo, not theft.
  - A signature would block pasted exchange addresses, ENS names, and hardware/no-browser wallets.
  - The UI shows a confirm step with the full address and chain. (Alternative considered: EIP-191 `signMessage`, checked with `publicClient.verifyMessage` (ERC-1271/6492 for smart wallets). It is easy to add later as an optional "verified" flag.)
- **Claim token = opaque random value, stored as a hash in a new table.** Not a stateless HMAC, and not the guest token.
  - The guest token also grants RSVP edits and never expires.
  - Single use and idempotency need DB state anyway.
  - The URL is `https://rsv.pizza/nft/claim/<token>` (32 bytes base64url). It never contains email, guest id, or party id.
  - The DB stores `sha256(token)` only.
  - Expiry: 90 days (backfill: 120). Re-sending rotates the token.
- **Second path, no token:** a guest logged in by email, or holding the guest token, can claim from the event page through `callerOwnsGuest`.
- **Mint path:** always backend → edge function (service key), the same call as `mintOnApproval`. The minter key stays in the edge function. The RSVP-time client mint stays as is (out of scope).

## DB change (migration applied to prod BEFORE merge)
`backend/prisma/migrations/20261117_nft_claims/migration.sql` + `backend/scripts/apply-nft-claims.cjs` (dry-run default, `--apply`; same shape as `apply-auth-rate-events.cjs`). Additive, new table only, no `parties`/`guests` columns, so there is no column-grant or realtime change.

```sql
CREATE TABLE IF NOT EXISTS nft_claims (
  guest_id          uuid PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
  party_id          uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  token_hash        text UNIQUE,              -- sha256 hex; null for direct mints
  token_expires_at  timestamptz,
  status            text NOT NULL DEFAULT 'issued', -- issued|minting|minted|failed|revoked
  source            text NOT NULL,            -- wallet_on_file|claim_link|logged_in|backfill
  recipient_address text,                     -- lowercased 0x, locked at first mint attempt
  recipient_input   text,                     -- what the guest typed (ENS)
  previous_address  text,                     -- guests.ethereum_address before claim (privy)
  attempts          int NOT NULL DEFAULT 0,
  last_error        text,
  minting_started_at timestamptz,
  minted_at         timestamptz,
  tx_hash           text,
  token_id          int,
  email_sent_at     timestamptz,
  email_resend_id   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON nft_claims (party_id);
CREATE INDEX ON nft_claims (status, minting_started_at);
CREATE INDEX ON nft_claims (minted_at);
ALTER TABLE nft_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nft_claims FROM anon, authenticated;
```
- `backend/prisma/schema.prisma`: add a `NftClaim` model (`@@map("nft_claims")`) and a back-relation on `Guest`/`Party`.
- `scripts/anon-no-access-tables.json`: add `nft_claims` (CI C1).
- CI `schema-drift.yml` must pass against prod. That is why the migration goes first.

## Backend
1. **`backend/src/lib/nftMint.ts`** (new): factor the edge-function call out of `mintOnApproval.ts` into `callMintEdge(party, guest, recipient, fetchImpl)` → `{ ok, tokenId, txHash, alreadyMinted, error, status }`. `mintOnApproval.ts` becomes a thin wrapper; keep its tests green.
2. **`backend/src/lib/nftClaim.ts`** (new):
   - `isNftEligible(...)`: pure; unit tested.
   - `issueClaim(guestId, source, ttlDays)`: upsert the row, return the plaintext token once.
   - `findClaimByToken(token)`: hash lookup, check expiry.
   - `startMint(guestId, recipient, input)`: the **atomic lock**, done as `UPDATE nft_claims SET status='minting', recipient_address=COALESCE(recipient_address,$r), attempts=attempts+1, minting_started_at=now() WHERE guest_id=$g AND status IN ('issued','failed') AND (recipient_address IS NULL OR recipient_address=$r) AND attempts < 5` (Prisma `updateMany`, count must be 1, else 409).
     - Once an address is locked, retries can't redirect the NFT.
     - Then, in one `$transaction`: write `guests.ethereum_address = recipient`, `wallet_source = 'claim'`, keep `privy_user_id`, save `previous_address`.
   - `finishMint(...)`: on success, set `minted` + tx/token on **both** `nft_claims` and `guests.nft_*`. On error, set `failed` + `last_error`.
   - Treat `alreadyMinted` as success.
   - Nonce collisions (cron and a user claim at the same moment) fail cleanly and are retried by the cron.
3. **`backend/src/routes/nftClaim.routes.ts`** (new), mounted `app.use('/api/nft/claim', ...)` in `index.ts` before `/api/nft`:
   - `GET /:token` → `{ partyName, eventImageUrl, chain, status, expiresAt, maskedRecipient? }`. Unknown or expired tokens get a uniform 404. Never returns email or guest id.
   - `POST /:token` `{ address }`:
     - accept a 0x address or ENS name; resolve via `resolveEns`; reject the zero address and our contract/minter address;
     - re-check eligibility, then `startMint` → `callMintEdge` (awaited; `maxDuration` is 300) → `finishMint`;
     - return `{ status, txHash, explorerUrl }`.
     - The token stays valid only for read-back after `minted` (single use).
   - `POST /guest/:guestId` `{ address }`: `optionalAuth` + `callerOwnsGuest` (JWT email or guest token). Lazily issues a `source='logged_in'` row, then the same flow. Non-owners get a 404.
   - Rate limits:
     - `express-rate-limit` 20 req / 15 min / IP on `/api/nft/claim`;
     - durable `prismaRateStore` bucket `nft_claim_ip` (10 POSTs / hour / IP);
     - a global daily cap `NFT_MINT_DAILY_CAP` (default 1000, counted from `nft_claims.minted_at > now()-24h`). Over the cap → 503 "try again later", and the row stays `issued`.
4. **`GET /api/parties/:id/my-guest`** (`party.routes.ts` ~L580): add `nftClaim: { eligible, status, txHash }` so the event page can show the card. Self-only, no new exposure.
5. **Cron `POST /api/cron/nft-claims`** (in `nftClaim.routes.ts` or `survey.routes.ts` cronRouter, `CRON_SECRET`), added to `backend/vercel.json` hourly at `15 * * * *`. Per run, sequential, stop at ~240s:
   - a. Retry `failed` with attempts < 5, and `minting` older than 10 min (same locked recipient; idempotent on-chain).
   - b. Parties that ended 12h–7d ago with NFTs on: eligible guests with no `nft_claims` row.
     - Wallet on file (`manual`) → `issueClaim(source='wallet_on_file', no token)` + mint.
     - Otherwise → `issueClaim('claim_link')`. Email only if `NFT_CLAIM_EMAILS=on` and the guest has an email, then set `email_sent_at`.
   - Batching: 10 emails per batch, 500ms gap (same as survey).
6. **`backend/src/lib/nftClaimEmail.ts`** (new): `buildNftClaimEmail(party, guest, url)`.
   - Mirrors `buildSurveyEmail`: escape helper, flyer, one button "Claim your NFT".
   - Copy: "No wallet? Any wallet works; you can claim within 90 days."
   - Always PizzaDAO site (eligibility already excludes branded). From address: `site.fromEmail`.
7. **Admin (optional, small):** `GET /api/admin/nft-claims/stats` with counts by status and the minter balance (read via RPC with viem, no key). Lets us watch the gas budget.

## Frontend
1. **`frontend/src/pages/NftClaimPage.tsx`** (new), route `/nft/claim/:token` in `App.tsx` (lazy):
   - On branded builds (`!BRAND_FEATURES.nftMinting`), render a "not available" state.
   - Layout: event image and name, chain badge.
   - Address field: `IconInput` (Wallet icon); placeholder "Wallet address or ENS name (0x... or name.eth)"; no label.
   - A "Connect wallet" button (ConnectKit `useModal`). `useAccount()` auto-fills the field, as in RSVPModal.
   - `<OpenInWallet />` on mobile. Pass a `getHandoffUrl` that returns the **plain claim URL**: the token is the capability, so no login hand-off is needed.
   - Confirm step: "Mint to 0x1234…abcd on Base?" Confirm → POST, then a spinner "Minting, this can take ~30s".
   - Success: explorer link (basescan / monadscan).
   - States: expired, already minted, cap reached, generic error.
   - Strings go in i18n `frontend/src/i18n/locales/en/nft.json` (other locales fall back).
2. **`frontend/src/components/NftClaimCard.tsx`** (new): shown on `EventPage` when `myGuest.nftClaim.eligible && status !== 'minted'` and NFTs are on for the build. Same field and connect button, posting to `/api/nft/claim/guest/:guestId` with the guest token / JWT.
3. **`frontend/src/lib/api.ts`**: add `getNftClaim(token)`, `submitNftClaim(token, address)`, `submitNftClaimAsGuest(guestId, address, guestToken)`.
4. No change to `PizzaContext` realtime, `SAFE_PARTY_COLUMNS`, or the anon Supabase reads. Everything goes through the backend.

## Backfill (sends need Snax's explicit OK)
`backend/scripts/nft-claim-backfill.ts`. Dry run is the default and prints per-party counts. It uses the same `isNftEligible`, without the 7-day window.
- `--mint-wallets-on-file`: direct mints for eligible guests with `manual` wallets and no token. Prefer this over the old `backfill-nft-mints.ts`, because it records rows in `nft_claims`.
- `--issue-claims`: create tokens only, no email. Guests can then claim from the event page when logged in.
- `--send-emails --limit N --party <id>`: **only with Snax's OK**. Run it in waves: 1 party, then 100, then all. Respect `NFT_MINT_DAILY_CAP` and the Resend limits.
- Privy guests: the 155 `privy-embedded` rows count as "no usable wallet".
  - If one already holds a token, it is done and gets no re-claim (see Open Questions).
  - Otherwise it gets a claim link. Claiming saves the old address in `previous_address`.

## Privy and `PRIVY_GUEST_WALLETS`
- Now: leave the #1343 flag off. Keep the `privy_user_id` and `wallet_source` columns and the data.
- Follow-up PR, after the claim flow has been live for 2 weeks:
  - delete `provisionWalletIfNeeded` (rsvp.routes.ts);
  - delete `backend/src/services/privy.service.ts` and its test;
  - delete the admin `provision-wallets` endpoint (admin.routes.ts ~L731);
  - delete the `@privy-io/node` / `@privy-io/server-auth` deps (also clears the dependabot alerts). Check `usdc-base.service.ts` first: comments mention a Privy server wallet, but d8b63c8e moved it to a self-custodied key.
- Separately, fix `updateData` so a blank RSVP re-submit doesn't null an existing address.

## White-label
NFTs are PizzaDAO-only (`nftMinting: !BRAND.isBranded`). Branded-series parties (team1, monad, doge, swc) are excluded in `isNftEligible`, and the claim page is unavailable on branded builds. Monad-chain events on rsv.pizza still work through `nft_chain='monad'`.

## Risks
- **Schema-before-column:** a `NftClaim` model merged before the table exists 500s only the new routes (Prisma touches it only there), but CI drift fails. Apply the migration first.
- **Nonce collisions** from concurrent mints with the single minter key. Mitigations: the cron runs sequentially; user claims are rare; failures are retryable; on-chain `hasToken` makes retries idempotent.
- **Double mint to two addresses:** prevented by the locked `recipient_address`, the single `nft_claims` row per guest, the dedupe on same-email rows, and the `nft_token_id IS NULL` check.
- **Gas:**
  - Before launch, measure the cost per mint on Base from a recent tx receipt.
  - Set `NFT_MINT_DAILY_CAP`.
  - Check the minter balance before any backfill.
  - Monad needs MON funded on the minter.
- **Fake events / peer-vouch farming:** low-value NFT, but it costs gas. Mitigation: the daily cap, plus optionally skipping parties flagged by fake detection (check for an existing flag column when implementing).
- **Edge function timeout (60s)** inside a 300s backend request: the row stays `minting`, and the cron retries after 10 min.
- **Eligibility by check-in only** may exclude most events that never scan check-ins (see Open Questions).

## Verify
- **Unit tests (vitest, backend):**
  - `nftClaim.test.ts`: eligibility matrix; token hash/expiry; `startMint` lock (second call → 409, a different address after lock → 409); `finishMint` paths; `alreadyMinted`.
  - `nftClaim.routes.test.ts`: 404 uniformity; no email/id in the GET response; ENS resolution mocked; daily cap 503; `callerOwnsGuest` on the `/guest/:id` path.
  - cron test: direct mint vs. issue, email gated by `NFT_CLAIM_EMAILS`, branded party skipped.
  - existing `mintOnApproval.test.ts` still passes.
- **Frontend tests:** `NftClaimPage.test.tsx` (connect auto-fill, confirm step, expired state, branded build hidden); the lint gate `rules-of-hooks` passes.
- **CI:** schema-drift, rls-anon-exposure (C1 includes `nft_claims`), build.
- **Vercel preview** (`https://rsvpizza-git-claim-later-nft-pizza-dao.vercel.app`; it shares the prod backend, so backend routes work only after the backend is merged/deployed. Test the frontend against a backend preview, or merge the backend PR first):
  - Use a test party with NFTs on and Base, with a check-in.
  - Issue a token via the script with `--party <test> --issue-claims`. Open the claim page: paste an address → confirm → tx on basescan, metadata URL resolves.
  - Reload the link → "already minted".
  - Logged-in path on the event page card.
  - Mobile: OpenInWallet → MetaMask in-app browser → connect → claim.
  - Brand build preview: route unavailable.

## Rollout
1. Read-only counts (Snax OK to run against prod):
   - eligible guests by check-in vs. by confirmed RSVP on NFT-enabled parties;
   - how many of them have `manual` / `privy-embedded` / no wallet;
   - how many `privy-embedded` rows already have a token.
2. PR A (backend + migration):
   - apply `apply-nft-claims.cjs --apply` to prod, then merge;
   - the cron ships with `NFT_CLAIM_EMAILS` unset (tokens issued, mints for wallets on file, no emails).
3. PR B (frontend claim page + event card): preview check, merge.
4. Snax OK → set `NFT_CLAIM_EMAILS=on` (go-live switch).
5. Snax OK → backfill waves.
6. After 2 weeks, open the Privy removal PR.

## Open questions for Snax
1. Eligibility: checked-in only, or also confirmed/approved RSVPs on events that never use check-in?
2. Should the cron auto-mint for guests who typed a wallet (no email)? Recommended: yes.
3. A separate "claim your NFT" email, or a block inside the morning-after survey email (one email instead of two)?
4. Claim link expiry: 90 days OK? And for the backfill?
5. Backfill scope: all past NFT-enabled events, or only the ones after 2026-05-11 (the Privy outage)?
6. Privy guests that already hold an NFT in an inaccessible wallet: allow one re-claim to a new address, or leave them done?
7. Daily gas cap number, and who tops up the minter (Base and Monad)?

## Snax decisions (2026-11-16: "defaults")
1. Eligibility: **checked-in only** (`checked_in_at IS NOT NULL`). Revisit after the read-only counts.
2. Auto-mint for guests with a manual wallet on file: **yes**, no email.
3. **Separate** "claim your NFT" email (own template), sent only when `NFT_CLAIM_EMAILS=on`.
4. Expiry: **90 days** for new links, **120 days** for backfill links.
5. Backfill scope: **only parties after 2026-05-11** (the Privy outage). Dry-run counts first; every send wave needs Snax's OK.
6. Privy guests who already hold a token: **done, no re-claim**.
7. Gas: `NFT_MINT_DAILY_CAP` **defaults to 0 when unset**, so nothing mints (cron or claim page) until Snax sets the cap. That makes merging safe; setting the cap is the go-live switch. Snax tops up the minter (Base, Monad).
