# ciabatta-61803: Upgrade react-router-dom 6.30.6 to react-router 7.18.5

## Goal

Clear the two react-router advisories that `npm audit` reports against `react-router 6.0.0 - 7.17.0`:

- GHSA-wrjc-x8rr-h8h6: open redirect through a backslash in `<Link>` / `useNavigate` (a bypass of CVE-2025-68470).
- GHSA-337j-9hxr-rhxg: SSR `deserializeErrors()`. This one is SSR only and doesn't reach this SPA.

The fix is to move to `react-router@7.18.5`, the current `version-7` tag. Dependabot #1280 bumps `react-router-dom` to the same version. Do not jump to 8.x: `latest` is 8.5.1, and v8 drops the `react-router-dom` package.

The open-redirect advisory does reach this app. `LoginPage.tsx:20-31` stores `?redirect=` in `sessionStorage.authReturnUrl` without validation and later calls `navigate(returnUrl)`. `AuthVerifyPage.tsx:188-190` does the same as a fallback (`navigate(nextParam || returnUrl || '/')`). Only `next` goes through `sanitizeNextPath`.

## What the codebase uses (findings)

- **Router type:** declarative `<BrowserRouter>` + `<Routes>` in `frontend/src/App.tsx:133-238`. It does not use `createBrowserRouter`, `RouterProvider`, loaders, actions, fetchers, `json` or `defer`.
- **Future flags:** none set. `<BrowserRouter>` at `App.tsx:133` has no `future` prop.
- **Splat routes:** none. There is no `path="*"` or `/foo/*`. The catch-all is `/:slug` (`App.tsx:235`), so unmatched multi-segment URLs render nothing, both today and after the upgrade.
- **Relative links:** none. Every `<Link to>`, `<Navigate to>` and `navigate()` target is absolute or a template starting with `/` (I grepped for any `to=`/`navigate(` target that doesn't start with `/`).
- **`React.lazy`:** always at module scope (`App.tsx`, `HostPage.tsx:52`, the map pages). That is the one thing the guide says to check for `v7_startTransition`.
- **Imports:** 76 `react-router-dom` imports. 70 are runtime imports in `src/`. 5 are test files using `MemoryRouter`. Two `.ts` files (plus `underbossTableUrlState.ts:3`) mention it only in comments. No file imports router types (`NavigateFunction` etc.).
- **Tests:** none use `vi.mock('react-router-dom')`. The test files that touch the router all render real `MemoryRouter`s:
  - `src/components/hackathon/ParticipantPanel.test.tsx:3`
  - `src/__tests__/auth-code-email.test.tsx:13`
  - `src/pages/JudgePage.test.tsx:3`
  - `src/pages/DisplayPage.test.tsx:3`
  - `src/pages/AuthVerifyPage.handoff.test.tsx:5`

  The `e2e/` Playwright specs do not import the router.
- **Requirements:** v7 needs React >= 18 and Node >= 20. Both are confirmed in the official v6 upgrade guide and in `npm view react-router@7.18.5` (`peerDependencies react >=18, react-dom >=18`; `engines node >=20.0.0`). The app is on React 18.3.1 and CI uses Node 20 (`deploy.yml:27`, `tests.yml:31,54`, `typecheck.yml:31,51`). Local node is 24. The four Vercel projects (rsvpizza, doge, monad, team1) must also be on Node >= 20. Check this in Project Settings > General > Node.js Version.
- **TypeScript:** `moduleResolution: "bundler"` (`tsconfig.app.json:10`), so the v7 `exports` map resolves. ESLint is not type-aware, so v7's `navigate()` returning `void | Promise<void>` will not trip `no-floating-promises`.
- **Dependencies:** nothing else depends on `react-router-dom`. `npm ls` shows only `frontend`. `@remix-run/router` goes away because v7 bundles it.

## Future flags: what changes for this app

The official guide is "Upgrading from v6". I read the 7.17.0 docs copy on jsdelivr because the live reactrouter.com URL returned 404 to the fetcher.

| Flag | Applies to BrowserRouter? | Effect here |
|---|---|---|
| `v7_relativeSplatPath` | Yes | **None.** There are no splat routes and no relative links. |
| `v7_startTransition` | Yes | **Small, positive.** Router state updates are wrapped in `React.startTransition`. See below. |
| `v7_fetcherPersist` | Data routers only | N/A |
| `v7_normalizeFormMethod` | Data routers only | N/A |
| `v7_partialHydration` | Data routers only | N/A |
| `v7_skipActionErrorRevalidation` | Data routers only | N/A |

What `v7_startTransition` changes:

1. **Lazy pages keep the old page on screen.** Navigating to a lazy page (DJ, Judge, Display, Photos, Underboss, ...) currently blanks the screen through the outer `<Suspense fallback={null}>` at `App.tsx:134`. After the upgrade the previous page stays visible until the chunk loads. First load of a deep link still shows the fallback.
2. **URL-bound controls update as transitions.** `setSearchParams` updates become transitions. Most controls bound to the URL are selects or buttons:
   - `EventsSearchPage.tsx:126-163`
   - `PaymentsAdminPage.tsx:272`
   - `UnderbossDashboard.tsx:144`
   - `PartnersPage.tsx:77`
   - `LeaderboardPage.tsx:234,246`
   - `PhotosFeedPage.tsx:113`
   - `ConsolidatedReportPage.tsx:100`
   - `HackathonTab.tsx:73`
   - `ParticipantPanel.tsx:134`
   - `PizzaIndexPage.tsx:257`

   The one free-text input I checked, `EventsSearchPage.tsx:35`, already uses local state with a debounce, so typing is not affected. The smoke test should still exercise these controls.

3. **Unchanged:** `navigate()` called during render. It still only warns, the same as in v6, and the hits I checked are inside effects or handlers.

## Recommendation: (b) one PR

The guide's two-step path ("flags on v6, ship, then bump") exists for apps that have splat routes, relative links or data routers. This app has none of those. The only flag that changes anything is `v7_startTransition`, and it is low-risk. A separate flags PR would add a deploy cycle with no isolation benefit, since a revert of the single PR restores v6 exactly. If Snax wants extra caution, an optional first commit inside the same PR can add `future={{ v7_startTransition: true, v7_relativeSplatPath: true }}` on 6.30.6 and run the tests before bumping. That is cheap, but I don't think it's needed.

## Steps (implementer, worktree on branch `ciabatta-61803-react-router-7`, per repo CLAUDE.md)

1. **Swap the package.** Work at the repo root so the npm workspace lockfile updates:
   ```bash
   npm uninstall react-router-dom --workspace=frontend
   npm install react-router@^7.18.5 --workspace=frontend
   ```
   Result: `frontend/package.json:42` changes from `"react-router-dom": "^6.30.4"` to `"react-router": "^7.18.5"`, and `package-lock.json` is updated. Then confirm the audit is clean and nothing else pulls the old packages:
   ```bash
   npm ls react-router react-router-dom @remix-run/router
   npm audit --workspace=frontend
   ```
   The react-router entries must be gone.

2. **Rewrite imports from `'react-router-dom'` to `'react-router'`** in all 75 import lines. That is the official sed, macOS variant, run from `frontend/`:
   ```bash
   find ./src \( -name "*.tsx" -o -name "*.ts" \) -type f -exec sed -i '' "s#from 'react-router-dom'#from 'react-router'#g" {} +
   ```
   Then `grep -rn "react-router-dom" src` should show only the three comment lines below, which can be edited by hand for accuracy:
   - `components/payments-admin/paymentsUrlState.ts:3`
   - `components/underboss/underbossTableUrlState.ts:3`
   - `pages/partnersUrlState.ts:2`

   Nothing needs `react-router/dom`, because that subpath only provides `RouterProvider`/`HydratedRouter`. Files touched (`file:line` of the import):
   - `App.tsx:2`
   - components:
     - `LoginModal.tsx:3`
     - `PartyHeader.tsx:3`
     - `EventForm.tsx:3`
     - `AppsHub.tsx:3`
     - `EventDetailsTab.tsx:4`
     - `Header.tsx:2`
     - `payments-admin/PayoutsByPartyTable.tsx:3`
     - `payments-admin/PrepayQueueTable.tsx:2`
     - `payments-shared/PayoutRow.tsx:2`
     - `gpp-dashboard/GPPDashboardTab.tsx:2`
     - `gpp-dashboard/GPP27DashboardTab.tsx:3`
     - `gpp-dashboard/Gpp27StatusPanel.tsx:3`
     - `hackathon/WinnersStrip.tsx:1`
     - `hackathon/ParticipantPanel.tsx:2`
     - `hackathon/HackathonSection.tsx:2`
     - `hackathon/HackathonTab.tsx:2`
     - `series-create/SeriesCreateFlow.tsx:2`
     - `checklist/HostChecklistCard.tsx:2`
     - `checklist/ChecklistTab.tsx:4`
     - `flyer/FlyerGenerator.tsx:3`
   - pages:
     - `LoginPage.tsx:2`
     - `DJPage.tsx:2`
     - `EventPage.tsx:3`
     - `SideCreatePage.tsx:3`
     - `PaymentsAdminPage.tsx:2`
     - `HackathonGalleryPage.tsx:2`
     - `EventsMapSwcPage.tsx:2`
     - `PartnerIntakePage.tsx:3`
     - `DisplayPage.tsx:2`
     - `TaxFormRequestPage.tsx:2`
     - `HomePage.tsx:2`
     - `LeaderboardPage.tsx:2`
     - `CheckInPage.tsx:2`
     - `PartnersPage.tsx:2`
     - `GPP27CreatePage.tsx:3`
     - `GraphicsDashboard.tsx:4`
     - `NewEventPage.tsx:1`
     - `AdminLogoCleanup.tsx:2`
     - `HackathonProjectPage.tsx:2`
     - `SeriesLandingPage.tsx:2`
     - `UnderbossDashboard.tsx:3`
     - `EventsSearchPage.tsx:2`
     - `PartnerBizdevPage.tsx:3`
     - `SurveyPage.tsx:2`
     - `PublicReportPage.tsx:3`
     - `AuthVerifyPage.tsx:2`
     - `MouPage.tsx:2`
     - `PhotosFeedPage.tsx:2`
     - `PublicVenueReportPage.tsx:3`
     - `HostPage.tsx:3`
     - `HostSurveyPage.tsx:3`
     - `GPPLandingPage.tsx:2`
     - `InvoicePage.tsx:2`
     - `RSVPPage.tsx:2`
     - `PaymentsHostsPage.tsx:8`
     - `EventsMapPage.tsx:2`
     - `AccountPage.tsx:2`
     - `JudgePage.tsx:2`
     - `OneSheetPage.tsx:2`
     - `EventsMapAllPage.tsx:2`
     - `ConsolidatedReportPage.tsx:4`
     - `GPPPizzeriasPage.tsx:2`
     - `GraphicsFlyerEdit.tsx:2`
     - `ArtDisplayPage.tsx:2`
     - `DayOfRunPage.tsx:2`
     - `PizzaIndexPage.tsx:3`
     - `PhotosSlideshowPage.tsx:2`
   - tests:
     - `ParticipantPanel.test.tsx:3`
     - `__tests__/auth-code-email.test.tsx:13`
     - `JudgePage.test.tsx:3`
     - `DisplayPage.test.tsx:3`
     - `AuthVerifyPage.handoff.test.tsx:5`

   All paths are under `frontend/src/`.

3. **Leave `App.tsx:133` as `<BrowserRouter>` with no `future` prop.** v7 makes those behaviours the default, and the v6 flags no longer exist.

4. **Recommended same-PR hardening, about five lines.** This is what makes the security fix actually matter here: run the stored return URL through the existing `sanitizeNextPath` (`src/lib/wallet/handoff.ts:84`).
   - `LoginPage.tsx:29`: `const returnUrl = sanitizeNextPath(sessionStorage.getItem('authReturnUrl')) || '/';`
   - `AuthVerifyPage.tsx:188`: `const returnUrl = sanitizeNextPath(sessionStorage.getItem('authReturnUrl'));`

   Add one test to the existing `AuthVerifyPage.handoff.test.tsx` or a LoginPage test: `?redirect=/\evil.com` and `//evil.com` must land on `/`. If Snax wants the PR to stay a pure upgrade, split this into its own task instead.

5. **Run the checks from `frontend/`:**
   ```bash
   npx tsc -p tsconfig.app.json --noEmit   # or the typecheck.yml command
   npx eslint --config eslint.hooks.config.js "src/**/*.{ts,tsx}"
   npm test        # all ~739 tests
   npm run build   # also `npm run build` at the repo root for generate-og-meta
   ```
   Also confirm the "React Router Future Flag Warning" console noise from v6 is gone from the test output.

6. **Ship.** `/ship` opens the PR. Close Dependabot #1280 as superseded, linking the new PR.

## Test plan

**Automated:** steps 5 and 6. Optionally run Playwright, `npx playwright test --project=chromium`, which uses the dev server on port 5176.

**Manual smoke test on the Vercel preview** (rsvpizza). Repeat a short subset on one brand preview (doge, monad or team1), since those builds set `IS_SERIES_SCOPED`.

1. **Deep links, cold load in a new tab:**
   - `/`
   - `/events?continent=...`
   - `/<event-slug>`
   - `/rsvp/<code>`
   - `/host/<code>`
   - `/host/<code>/<tab>` for several tabs
   - `/display/<partyId>/<slug>`
   - `/display/<partyId>/art`
   - `/checkin/<code>/<guestId>`
   - `/<slug>/projects`
   - `/<slug>/projects/<projectSlug>`
   - `/underboss/<region>`
   - `/graphics/<slug>/edit`
2. **Nested and param routes:** on `/host/:inviteCode/:tab`, switch tabs (`HostPage.tsx:147-149`) and use the checklist and GPP-dashboard links that call `hostTabPath`. The URL and the active tab should stay in sync.
3. **Redirects:**
   - `/partner-dashboard` and `/sponsor-dashboard` go to `/partner`.
   - `/sponsor-intake/x` goes to `/partner-intake/x`.
   - `/raleigh` goes to `/durham`.
   - `/santacruzdelasierra` goes to `/santacruz` (Vercel 308).
   - On a brand preview, any `GPP_ONLY_PATHS` route (e.g. `/gpp`, `/payments`) goes to `/`.
   - The host gate goes to `/login?redirect=...` and then back to the host page after login (`HostPage.tsx:93`).
   - `/auth/verify?next=...` lands on `next`.
4. **Back/forward:** navigate home, then an event, then the host page, then a tab change, then a lazy page (`/dj/<code>`). Browser back and forward should restore each URL and view. Lazy pages should no longer flash blank. `replace: true` flows (filters, JudgePage slug redirect) should add no history entries.
5. **Query strings:** a refresh should restore the filters on each of these:
   - `/events`
   - `/partners`
   - `/payments`
   - `/underboss`
   - `/leaderboard`
   - `/photos`
   - `/partner/report`

   Changing a select should update the URL without a lag or snap-back. Bookmark-style `?year=` on `/pizza-index` should clear correctly.
6. **404 / fallback:**
   - **Vercel:** `vercel.json` rewrites all non-asset paths to `/index.html`. An unknown single segment (`/nope123`) should render EventPage's not-found state. An unknown multi-segment path (`/a/b/c`) renders blank because there is no `*` route, the same as on v6. Check that both behave identically on production and the preview.
   - **GitHub Pages** (`https://pizzadao.github.io/rsv-pizza/`): today's build uses `base: '/'` with no `basename` and has no `404.html`, so routing on Pages is already broken. Assets resolve to the domain root and deep links get GitHub's 404. The upgrade does not change this. Just confirm the deploy workflow still builds green, and note it as a separate issue.
7. **Logs:** check the console on the preview. There should be no new React Router warnings or errors.

## Rollback

There are no data or migration side effects, so rollback is just a revert.

- Revert the merge commit and push. GitHub Pages redeploys through `deploy.yml`.
- On Vercel, promote the previous production deployment for each project (rsvpizza, doge, monad, team1) through `vercel promote` / the dashboard, or redeploy with `vercel-deploy --prod` after the revert.

## Risks

- **Brand projects' Node version on Vercel** (low). If any project is pinned below 20, its install fails. Check before merging.
- **startTransition behaviour** (low):
  - pending navigations now keep the old UI on screen;
  - URL-bound selects update a frame later.

  The smoke test covers both.
- **Lockfile churn** (low): the `npm uninstall` + `install` regenerates part of `package-lock.json`. Review the diff to confirm only the react-router, react-router-dom, @remix-run/router, cookie and set-cookie-parser entries changed.
- **Stray future imports** (low): someone copying v6 snippets later could add `react-router-dom` back. It still works in v7 as a re-export, but it would be a second dependency. Optionally add an ESLint `no-restricted-imports` entry for `react-router-dom`.
- **Out of scope:**
  - **v8:** react-router 8 removes `react-router-dom`. After this PR, moving to v8 is just a version bump plus that version's own flags.
  - **Unmatched paths:** there is still no `*` route for unmatched multi-segment paths.
