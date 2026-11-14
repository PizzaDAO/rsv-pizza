# pepperoni-71203: Upgrade wallet stack (wagmi 2 to 3, @wagmi/connectors 5 to 8) and replace ConnectKit

**Status:** todo · **Priority:** was P1 (security). Recommend dropping to **P3** (see "Is it still needed?")
**Created:** 2026-10-16 · **Re-planned:** 2026-11-14, against origin/master `aae9c0ce` (after #1252, #1255, #1260)

## TL;DR
- **#1252/#1255 did NOT remove the vulnerable packages.** They stopped *using* WalletConnect and the
  MetaMask SDK. But `@wagmi/connectors` 5.x/6.x lists `@walletconnect/ethereum-provider`,
  `@metamask/sdk`, `porto`, `@gemini-wallet/core`, Safe and Base SDKs as **hard dependencies**, so
  they are installed no matter what we import. `npm audit` on master still shows **61 (34 moderate,
  27 high)**, and 25 of those entries are the wallet stack.
- A trial bump in a temp copy (wagmi 3.7.11 + @wagmi/connectors 8.2.4 + @coinbase/wallet-sdk
  4.3.6) **cleared all 25 wallet-stack entries** (61 to 36) and **removed 392 packages**. The 36
  left are all backend or dev tooling (`@vercel/node`, privy, vite 5, vitest, react-router 6,
  prisma, typescript-eslint, archiver). They are out of scope here.
- **Real-world risk of the remaining wallet advisories is low.** All of them sit in browser-side
  code paths we never run (WalletConnect and MetaMask SDK connectors are never created), or in
  Node-only code (`ws`). The prod bundle has no WalletConnect relay or SDK code in the chunks I
  checked. This is audit noise and dependency hygiene, not an active exposure.
- **ConnectKit has no wagmi-3 release.** The latest is 1.9.2 (peer `wagmi: 2.x`). The upstream
  wagmi-3 PR (family/connectkit#514, "ConnectKit 2.0") has been open since 2026-07-26 with no
  maintainer response. The repo's last commit was 2026-03-27. RainbowKit 2.2.11 is also wagmi-2
  only. Reown AppKit supports wagmi 3, but it *is* the WalletConnect stack, which #1252 removed on
  purpose.
- **Recommendation:** replace ConnectKit with a small in-house wallet picker. That also ends the
  ConnectKit quirks #1255 had to work around. Ship it in **two PRs**: (1) swap ConnectKit for our
  own picker while still on wagmi 2, then (2) the mechanical wagmi 3 bump. Not urgent: let
  #1252/#1255 run in prod for a few days first.

## Is it still needed?
Yes, but not as P1.

| Advisory (master) | Where | Severity | Reachable in our app? |
|---|---|---|---|
| decode-uri-component GHSA-vcc3-ghjq-m6fr, GHSA-qr28-fpjm-wq7f (via query-string 7.1.3) | `@walletconnect/utils` | high | No. WalletConnect is never instantiated (no project ID, no `walletConnect()` connector). |
| ws 8.18.0 GHSA-58qx-3vcg-4xpx, GHSA-96hv-2xvq-fx4p | nested under `@reown/*`, `@walletconnect/utils` | high | No. `ws` is Node-only. Browsers use native WebSocket (`isows`). |
| zod GHSA-mrhx-c7xc-m3w5 | `@reown/appkit-wallet` copy | high | No (Reown never loads). The root `zod` copy is backend/privy and stays. |
| uuid 9.0.1 GHSA-w5hq-g745-h8pq | `@metamask/*` utils | moderate | No. The MetaMask SDK connector was removed in #1255, and the bug is in v3/v5/v6 with a `buf` argument only. |
| abitype / viem nested copies, `@reown/*`, `@walletconnect/*`, `@metamask/*`, `@gemini-wallet/core`, `@coinbase/cdp-sdk` | transitive | inherit | Same as above |

Why still do it:
- It clears the audit noise, so real advisories stand out. Dependabot keeps reopening this
  (#1127, #1131).
- `@metamask/sdk@0.33.1` is marked deprecated ("No longer maintained") and the WalletConnect
  2.21.x packages are deprecated too. They only go away with connectors 8.
- It installs 392 fewer packages.
- ConnectKit is effectively unmaintained and already caused a prod bug (#1255: the MetaMask
  extension could not connect). Owning the picker removes that dependency risk.

Why not rush:
- None of the advisories is exploitable as deployed.
- #1252 and #1255 changed wallet behaviour today. Changing the connect UI again right away makes
  regressions hard to attribute.

## Current state (origin/master)
- `frontend/package.json`: `wagmi ^2.19.5` (lock 2.19.5, bundles `@wagmi/connectors 6.2.0` +
  `@wagmi/core 2.22.1`), `@wagmi/connectors ^5.11.2` (a stray top-level copy that no file imports
  directly), `connectkit ^1.9.1` (lock 1.9.2), `viem ^2.57.3` (2.57.7),
  `@tanstack/react-query ^5.104.1`, TypeScript 5.9.3 (already meets wagmi 3's `>=5.9.3`).
- Wallet code:
  - `frontend/src/lib/wagmiConfig.ts`: `createConfig(getDefaultConfig({...}))`. ConnectKit's
    `getDefaultConfig` is a pure pass-through when `connectors` and `transports` are supplied
    (checked in its source), so plain `createConfig` is equivalent.
  - `frontend/src/lib/wallet/connectors.ts`: `injected()` (legacy fallback only) +
    `coinbaseWallet({ preference: 'all' })`, from `wagmi/connectors`.
  - `frontend/src/main.tsx`: `WagmiProvider > QueryClientProvider > ConnectKitProvider theme="midnight"`.
  - `ConnectKitButton.Custom` is used at 5 call sites:
    - `RSVPModal.tsx:208`: `show`
    - `CryptoDonationWidget.tsx:200`: `show`
    - `CryptoDonationWidget.tsx:245`: `show, truncatedAddress, ensName`
    - `InvoiceCryptoPayment.tsx:236`: `show`
    - `InvoiceCryptoPayment.tsx:315`: `show, truncatedAddress, ensName`
  - Hooks:
    - `useAccount`: RSVPModal, CryptoDonationWidget, InvoiceCryptoPayment, useCryptoDonation,
      useTokenBalances
    - `useSwitchChain().switchChain` and `useEnsAddress`: donation, invoice
    - `useSendTransaction().sendTransactionAsync`, `useWriteContract().writeContractAsync` and
      `useWaitForTransactionReceipt({ onReplaced })`: useCryptoDonation
    - `useBalance` and `useReadContracts`: useTokenBalances (formats with viem `formatUnits`, not
      wagmi's removed `.formatted`)
  - Not wagmi, but part of the same flows (from #1252): `OpenInWallet.tsx`, `lib/wallet/handoff.ts`,
    `AuthVerifyPage.tsx`, backend `POST /api/auth/handoff`.
  - Tests that mock the stack: `RSVPModal.test.tsx` (mocks `wagmi` and `connectkit`),
    `lib/wallet/connectors.test.ts`, `lib/wallet/handoff.test.ts`, `OpenInWallet.test.tsx`,
    `AuthVerifyPage.handoff.test.tsx`.

## wagmi 3 breaking changes vs our code
Sources: wagmi.sh v2 to v3 migration guide, plus a trial install and `tsc` in a temp copy.

| Change | Hits us? | Action |
|---|---|---|
| Connector SDKs become **optional peer deps** (`coinbaseWallet` needs `@coinbase/wallet-sdk ^4.3.6`; walletConnect, metaMask (`@metamask/connect-evm`), safe and baseAccount each need their own) | Yes, coinbaseWallet | Add `@coinbase/wallet-sdk` as a direct dependency. Install nothing else. |
| TypeScript `>=5.9.3` | Already 5.9.3 | Pin `typescript` to `^5.9.3` in frontend devDeps for clarity |
| `coinbaseWallet` `preference` is now object-only (`{ options: 'all' \| 'smartWalletOnly' \| 'eoaOnly' }`) | **Yes**: `connectors.ts:42` TS2322. At runtime a string would be spread as `{0:'a',1:'l',2:'l'}`. | `preference: { options: 'all' }` (also the v8 default) |
| `Window.ethereum` global type no longer provided transitively | **Yes**: `handoff.ts:26` TS2322 on the `win = window` default param | Type the param as `Window` and narrow inside with a cast, or add `declare global { interface Window { ethereum?: unknown; phantom?: { ethereum?: unknown } } }` in `src/vite-env.d.ts`. Keep `connectors.ts` consistent with whichever you pick. |
| `useAccount` renamed to `useConnection` (old name kept as a deprecated alias) | 5 files | Rename to `useConnection`. Same return shape (`address`, `chainId`, `isConnected`, `connector`). |
| Mutation hooks standardise on `mutate`/`mutateAsync`. The `sendTransactionAsync`/`writeContractAsync`/`switchChain` names still exist in 3.7.11. | useCryptoDonation, donation, invoice | Optional. Keep the names (smallest diff) or move to `const send = useSendTransaction(); send.mutateAsync(...)`. Recommend keeping them in PR2 and modernising later. |
| `useConnect().connectors`, `useSwitchChain().chains` removed per the guide (still present but deprecated in 3.7.11) | Only in the new picker | Use `useConnectors()` / `useChains()` in new code |
| `getBalance`/`useBalance` no longer return `.formatted` | No: we use `formatUnits`. ConnectKit's account modal *does* read it and would show "NaN ETH" (another reason to drop ConnectKit). | none |
| `useWaitForTransactionReceipt({ onReplaced })`, `useEnsAddress({ name, chainId })`, `useReadContracts` | Typecheck clean in the trial | none |

Trial result in a temp copy, wagmi 3 with ConnectKit still installed via `--legacy-peer-deps`:
- **2 new tsc errors**, both listed above. The 63 pre-existing frontend tsc errors are unchanged.
  The frontend typecheck is non-blocking in CI.
- `vite build` passed. Vite replaced the missing optional SDKs with empty stub chunks.
- The 5 wallet test files passed (29 tests).

## Decision: does ConnectKit stay?
**Option A: keep ConnectKit 1.9.2 under wagmi 3 via npm `overrides`.** Rejected.
- npm will not apply the override cleanly inside our workspace. With the existing lockfile it
  silently installs a **second wagmi 2.19.5** for connectkit (nested `wagmi` 3 under
  `frontend/node_modules`). connectkit's hooks would then read a different `WagmiContext`, so the
  app would crash at runtime while `npm install` succeeds. That is the worst failure mode.
- With pruned lock entries it fails with ERESOLVE. Only a full lockfile regeneration resolved it,
  and that churns every transitive dependency.
- Even when it resolves, `npm ls` reports `invalid`, the account modal shows NaN balance (fixable
  with `hideBalance`), and we would depend on deprecated v3 aliases inside an unmaintained
  library.

**Option B: wait for ConnectKit 2.0 (PR #514).** No maintainer activity in 4 months, so there is
no date. Fine if Snax wants zero UI work and accepts the audit noise indefinitely.

**Option C: RainbowKit.** wagmi `^2.9.0` only, so the same problem. **Reown AppKit:** it is
WalletConnect, which undoes #1252. Rejected.

**Option D (recommended): replace ConnectKit with an in-house `WalletModal`.** The surface we use
is small: open a picker, list connectors, connect, show the connected address/ENS, disconnect.
Chain switching and balances already live in our own widgets. The connector list is already
curated (EIP-6963 discovery + Coinbase + legacy injected fallback). Mobile without a wallet is
already handled by `OpenInWallet`. ConnectKit's mobile list (WalletConnect deep links) is dead
weight since #1252.

Effect: no more peer conflicts. It also removes `connectkit`, `styled-components@5`,
`framer-motion@6`, `@aave/account`, `qrcode` and `react-transition-state` from the frontend tree.

## Implementation plan

Branch names follow repo convention: `pepperoni-71203-wallet-modal` (PR1) and
`pepperoni-71203-wagmi3` (PR2), both off `master`. Each PR is independently revertible.

### PR1: replace ConnectKit with an in-house wallet modal (still wagmi 2)
1. **New `frontend/src/components/wallet/WalletModal.tsx`**:
   - `WalletModalProvider`: React context `{ open(), close(), isOpen }`. Renders the modal through
     `createPortal`.
   - Follow the `LoginModal` pattern: fixed backdrop, `z-50`, click outside and Escape close it,
     and a close button. Use theme classes (`bg-theme-surface`, `border-theme-stroke`, etc.).
   - **Disconnected view:**
     - List the connectors from `useConnectors()` (exists in wagmi 2 and 3). Dedupe by `id`, and
       skip a generic `injected` entry if an EIP-6963 connector exists (`connectors.ts` already
       mostly guarantees this).
     - Each row shows `connector.icon` (EIP-6963 data URI; fall back to a lucide `Wallet` icon)
       and `connector.name`. Label the Coinbase row "Coinbase Wallet / Smart Wallet".
     - Clicking a row calls `connect({ connector })` from `useConnect()`. Show a per-row pending
       spinner.
     - On error: "Request cancelled" for user rejection (`UserRejectedRequestError` / code 4001),
       otherwise a short message, plus a retry.
     - Zero connectors (mobile Safari with no wallet): show "No wallet detected" and render
       `<OpenInWallet />` in the modal.
   - **Connected view:**
     - ENS name (`useEnsName({ address, chainId: mainnet.id })`) or the truncated address
       (`0x1234…abcd`), a copy button, and the current chain name.
     - A **Disconnect** button (`useDisconnect().disconnect()`). Close on disconnect.
   - Auto-close when status goes from `connecting` to `connected`.
   - `WalletButton` render-prop component, `({ show, isConnected, truncatedAddress, ensName }) =>
     ReactNode`, mirroring the `ConnectKitButton.Custom` API so call sites are a one-line swap.
     Export `truncateAddress()` from `lib/wallet/` for reuse and tests.
   - i18n: add keys under `common` (en only; other locales fall back): `wallet.connectTitle`,
     `wallet.noWallet`, `wallet.cancelled`, `wallet.connectFailed`, `wallet.disconnect`,
     `wallet.copied`. The existing `buttons.connect` stays.
2. **`main.tsx`**: remove `ConnectKitProvider`. Wrap `<App />` in `<WalletModalProvider>`, inside
   `QueryClientProvider` (it uses wagmi hooks).
3. **`wagmiConfig.ts`**:
   - Drop `getDefaultConfig`. Use `createConfig({ chains: [mainnet, base, monad], transports, connectors })`.
   - Keep `multiInjectedProviderDiscovery` at its default (true).
   - Remove `walletConnectProjectId`, `appName`, `appDescription`, `appUrl`, `enableAaveAccount`.
     `appName`/`appIcon` are still passed to `walletConnectors()`.
   - Keep the comments about why there is no WalletConnect.
4. **Swap the 5 call sites** (`RSVPModal`, `CryptoDonationWidget` x2, `InvoiceCryptoPayment` x2):
   `ConnectKitButton.Custom` becomes `WalletButton`. Keep the button markup and classes identical.
5. **Tests:**
   - `RSVPModal.test.tsx`: replace the `vi.mock('connectkit')` with a mock of
     `./wallet/WalletModal`, or render inside the provider.
   - New `WalletModal.test.tsx` (mock wagmi hooks):
     - lists connectors and dedupes;
     - a click calls connect with the right connector;
     - the pending state renders;
     - user rejection shows "Request cancelled";
     - zero connectors renders `OpenInWallet`;
     - the connected view shows ENS/truncated address and Disconnect calls `disconnect`;
     - Escape and backdrop clicks close the modal.
6. `npm uninstall -w frontend connectkit` **from the repo root**, then sync
   `frontend/package-lock.json` (see "Lockfiles"). Also drop the stray direct
   `@wagmi/connectors ^5.11.2` dependency here (nothing imports it; `wagmi` brings its own).
   Re-add it explicitly in PR2 only if needed.
7. `grep -rn connectkit frontend/` should return nothing (code, tests, comments).

### PR2: wagmi 3 bump (after PR1 is in prod for a day or two)
1. From the repo root:
   `npm install -w frontend wagmi@^3.7.11 @coinbase/wallet-sdk@^4.3.6` (+ `typescript@^5.9.3` in
   devDeps). Do **not** add `@wagmi/connectors` as a direct dependency (wagmi 3 pins 8.2.4
   itself). Do **not** add walletconnect, metamask, safe or base SDKs. `viem` stays `^2.57.3`
   (wagmi 3 peer is `2.x`).
2. Confirm a single copy: `npm ls wagmi @wagmi/core @wagmi/connectors` shows one wagmi 3.x, one
   core 3.x, one connectors 8.x. `npm ls @walletconnect/ethereum-provider @metamask/sdk @reown/appkit`
   shows nothing.
3. Code:
   - `connectors.ts`: `preference: { options: 'all' }`.
   - `handoff.ts` (+ `connectors.ts`): `Window` typing fix as described above.
   - `useAccount` becomes `useConnection` in RSVPModal, CryptoDonationWidget,
     InvoiceCryptoPayment, useCryptoDonation, useTokenBalances, and in the `RSVPModal.test.tsx`
     wagmi mock.
   - `WalletModal`: already on `useConnectors`/`useConnect`/`useDisconnect`. Switch `connect(...)`
     to `connect.mutate(...)` style only if the deprecated names warn.
   - Leave `sendTransactionAsync`/`writeContractAsync`/`switchChain` as they are (still supported
     in 3.7.11).
4. Sync `frontend/package-lock.json`.
5. `npm audit` (root) should show 36 entries with no `@wagmi`, `@walletconnect`, `@reown`,
   `@metamask`, `query-string`, `decode-uri-component` or nested `ws` entries.
   `npm audit --omit=dev` should show no wallet-stack entries.
6. Update `.github/dependabot.yml` only if it has wagmi or connectkit ignore rules (the old plan
   says it does not). Comment on #1131 that the wagmi deferred major is done.

### Lockfiles (applies to both PRs)
- The **root `package-lock.json` is authoritative**. Running `npm ci` inside `frontend/` (CI
  `tests.yml`/`typecheck.yml`) detects the workspace root and uses the root lockfile. I confirmed
  this: `npm ci` in a workspace copy validated against the root lockfile.
- `frontend/package-lock.json` also exists. Dependabot updates it ("npm_and_yarn in /frontend"),
  and it is **already stale on master**: it still records `maplibre-gl ^5.24.0` / 5.24.1 after
  #1260 (so a standalone `npm audit` there shows the critical maplibre advisory).
- Either regenerate it from a copy of `frontend/` outside the workspace, then copy back only the
  lockfile and diff `frontend/package.json` to make sure it is unchanged (`--workspaces=false`
  bumped `@coinbase/wallet-sdk` to ^4.4.0 in my trial). Or, better, delete it in a separate
  cleanup PR. **Open question for Snax.**
- Make all bumps from the repo root with `-w frontend`. Never take Dependabot lockfile diffs
  piecemeal.

## Verify

### Automated (each PR)
- Root `npm ci`, then `npm run build` (frontend `vite build` + og meta).
- `cd frontend && npx tsc --noEmit -p tsconfig.app.json`: error count must not rise above the 63
  pre-existing ones. PR2 must fix the 2 new ones.
- `npx eslint -c eslint.hooks.config.js src` (the CI rules-of-hooks gate). The new modal has hooks,
  so put none after early returns.
- `npx vitest run` (frontend). Expect the known pre-existing e2e-noise failures only. Run the
  wallet files explicitly: `src/lib/wallet src/components/OpenInWallet.test.tsx
  src/components/RSVPModal.test.tsx src/pages/AuthVerifyPage.handoff.test.tsx
  src/components/wallet`.
- PR2: `npm audit` diff as in step 5. `npm ls wagmi` shows a single copy.
- Bundle sanity: `grep -l -i "relay.walletconnect\|MetaMaskSDK" frontend/dist/assets/*.js` returns
  nothing. Compare total `dist/assets` size before and after; it should go down.

### Manual on the Vercel preview (`https://rsvpizza-git-<branch>-pizza-dao.vercel.app`)
Use desktop Chrome with the MetaMask extension (plus Coinbase Wallet extension if available), an
iPhone in Safari plus the MetaMask and Coinbase Wallet apps, and Android Chrome if possible. Use
small Base USDC/ETH amounts to a test recipient.

1. **RSVP connect** (event page, RSVP modal, wallet field):
   - Desktop: Connect opens the picker, which lists MetaMask (EIP-6963 icon) and Coinbase. No
     duplicate "Browser Wallet" entry.
   - Connecting MetaMask fills the address field, and the validation tick shows.
   - Clear works.
   - Reject in MetaMask shows "Request cancelled" and the picker stays open.
   - Connect with Coinbase Smart Wallet (passkey popup).
   - Submit the RSVP. The address is saved, and NFT auto-mint still triggers where enabled.
2. **Crypto donation** (event with donations on):
   - Connect, then the connected pill shows ENS or the truncated address. Clicking the pill
     shows address, copy and Disconnect.
   - The chain switcher moves between Base, mainnet and Monad.
   - Token balances render.
   - Max button.
   - Send a small Base USDC donation: wallet prompt, tx hash, success state, and the donation is
     recorded.
   - Reject the tx: "Transaction was rejected".
   - Disconnect, then reload: the page stays disconnected. Connect, then reload: it reconnects
     automatically.
3. **Invoice crypto payment** (`/invoice/...` with a crypto option):
   - Same as donation, including the paid state.
   - The "Already sent? paste hash" fallback still works when not connected.
4. **Login hand-off on mobile (#1252)**:
   - iPhone Safari, signed in. Open the donation or RSVP wallet step.
   - `OpenInWallet` shows (collapsed). Tap "Open in MetaMask".
   - The MetaMask in-app browser opens `/auth/verify?token=...`, showing "Continue as <email>".
     Tap it: you are signed in, and you land on the same page.
   - Inside the MetaMask browser, Connect shows the injected MetaMask via EIP-6963, and it
     connects.
   - Repeat with Coinbase Wallet (universal link and `cbwallet://` fallback).
   - Reusing a spent link shows the failure message plus "Continue without signing in".
   - Signed-out hand-off opens the plain page.
5. **Mobile Safari, no wallet**: the picker shows "No wallet detected" plus `OpenInWallet`. No
   blank modal and no QR screen.
6. **Wrong network**: with MetaMask on an unsupported chain, the donation widget offers a switch
   and the switch works. A Monad add-chain prompt appears if the chain is missing.
7. **Brand previews** (rsvpizza-doge/monad/team1 projects are build-skipped on previews): spot-check
   one brand domain after the prod deploy to confirm the connect flow works.
8. **Regression sweep**: pages that do not use wallets still load (host dashboard, GPP pages) and
   there are no console errors from the providers. ErrorBoundary reports nothing new.

## Risks and mitigations
- **New picker UX gaps** vs ConnectKit (PR1). Main risks: Coinbase Smart Wallet popup blocked if
  `connect` is not called synchronously in the click handler, and the in-app browser layout.
  Mitigation: call `connect` directly in `onClick` (no awaits before it), and run the manual list
  on real devices.
- **Persisted connection after the wagmi 3 bump.** wagmi's localStorage store may not rehydrate
  across the major version, so returning users may need to reconnect once. Low impact. If
  reconnect misbehaves, clear the `wagmi.*` keys once (version-gated) in `main.tsx`.
- **Split wagmi copies.** Always check `npm ls wagmi` shows one copy. Two copies build fine but
  crash at runtime. PR1 removes connectkit, which is the only source of this risk.
- **Optional-peer stubs.** Vite stubs uninstalled connector SDKs with empty modules. Never add
  `walletConnect()`/`metaMask()`/`safe()` connectors without installing their SDK, or they fail at
  connect time. Add a comment in `connectors.ts`.
- **Shared prod backend.** No backend or DB changes in either PR, so preview testing is safe. The
  hand-off endpoint is unchanged.
- **Stale `frontend/package-lock.json`** may confuse Dependabot or any tool that reads it. See the
  open question.

## Rollback
- Each PR is a single squash commit, so revert it on `master` (frontend-only, deploys in about a
  minute).
- If PR2 regresses but PR1 is fine, revert PR2 alone. PR1 runs on wagmi 2.
- No data migrations and no backend coupling.
- Wallet sessions are client-side only; at worst users reconnect.

## Effort
- PR1 (in-house modal + tests): about 1 implementer day (sonnet), plus about 1 hour of Snax device
  testing.
- PR2 (wagmi 3 bump): about 2 to 3 hours, plus a short device re-test of flows 1 to 4.
- Option A instead (force ConnectKit): about half a day, but fragile. Not recommended.

## Open questions for Snax
1. Agree to downgrade from P1 to P3/P2 and wait a few days for #1252/#1255 to bake?
2. OK to drop ConnectKit for our own picker (Option D)? Or wait for ConnectKit 2.0 (Option B, no
   date)?
3. `frontend/package-lock.json`: delete it (the root lockfile is authoritative) in a separate
   cleanup PR, or keep refreshing it? Which install path does the Vercel `rsvpizza` project use
   (Root Directory `frontend`)? Check one build log before deciding.
4. Is the connected-state account view (address, copy, disconnect) enough, or do you also want
   the chain or balance in the picker? Our widgets already show both.

## Out of scope
- The remaining 36 audit entries: `@vercel/node` (undici, path-to-regexp, busboy), privy
  (zod, uuid via jayson, stream-json), vite 5 to 8 / esbuild, vitest, react-router 6 to 7,
  typescript-eslint, prisma, archiver, swagger-jsdoc. Each is its own deferred major (see #1131).
- Renaming `sendTransactionAsync`/`writeContractAsync` to `mutateAsync` (cosmetic follow-up).
