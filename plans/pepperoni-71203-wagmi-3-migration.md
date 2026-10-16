# pepperoni-71203 — Upgrade wallet stack: wagmi 2→3 + @wagmi/connectors 5→8 (security)

**Status:** todo · **Priority:** P1 (security) · **Created:** 2026-10-16

## Why
`npm audit` on master reports real moderate/high advisories in the wallet-connector stack's
transitive deps (`decode-uri-component`, `query-string`, `uuid`, `ws`, several
`@walletconnect` / `@reown` / `@metamask` packages). They only clear with
`@wagmi/connectors` 8.x. Dependabot PR #1127 (`@wagmi/connectors` 5.11.2 → 8.2.0) was closed
because it can't land alone: `@wagmi/connectors@8` needs `@wagmi/core@3` as a peer, and our
`wagmi@^2.19.5` bundles `@wagmi/core@2`. So this is a coordinated **wagmi 2 → 3** migration.
Full context: tracking comment on #1131 ("Deferred majors"). `.github/dependabot.yml` deliberately
does NOT ignore wagmi majors so this keeps resurfacing until done.

## Current versions (frontend/package.json)
- `wagmi` ^2.19.5, `@wagmi/connectors` ^5.11.2, `connectkit` ^1.9.1, `viem` ^2.57.3,
  `@tanstack/react-query` ^5.104.1

## Code that touches the wallet stack
- `frontend/src/lib/wagmiConfig.ts` — config/connectors (start here)
- `frontend/src/main.tsx` — providers (WagmiProvider / QueryClient / ConnectKitProvider)
- `frontend/src/components/RSVPModal.tsx` — wallet connect during RSVP
- `frontend/src/components/CryptoDonationWidget.tsx`, `frontend/src/hooks/useCryptoDonation.ts`
- `frontend/src/components/invoice/InvoiceCryptoPayment.tsx`
- `frontend/src/hooks/useTokenBalances.ts`

## Plan
1. Read the official wagmi v3 migration guide; list breaking changes that hit the files above
   (renamed hooks/params, connector constructors, `createConfig` options, provider changes).
2. **Check `connectkit` compatibility with wagmi 3 first.** If connectkit has no wagmi-3 release,
   decide: wait, or switch to an alternative (e.g. RainbowKit / Reown AppKit) — that's a bigger
   UI change and needs Snax's call before proceeding.
3. Bump together on one branch: `wagmi` 3.x, `@wagmi/connectors` 8.x (and `@wagmi/core` if
   pinned anywhere), `viem` to the version wagmi 3 requires. Regenerate the **root**
   `package-lock.json` once (workspaces — never merge Dependabot lockfile diffs piecemeal).
4. Update code per step 1. Keep behavior identical.
5. `npm audit --omit=dev` — confirm the wallet-stack advisories are gone.

## Verify
- `npm ci`, frontend `npm run build`, `tsc`, lint, frontend vitest (15 pre-existing e2e-noise failures are expected).
- **Manual on the Vercel preview (desktop + mobile):** connect via MetaMask (extension + mobile
  deep link) and WalletConnect; RSVP flow wallet step; crypto donation widget send; invoice crypto
  payment; token balances render; disconnect/reconnect; wrong-network handling.
- CI is path-filtered — make sure the PR also touches `frontend/src` (it will) so frontend checks run.

## Out of scope
- Prisma 6→7 (separate deferred major, build-time-only advisory).
