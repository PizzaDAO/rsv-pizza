# focaccia-61802: frontend vite 5 -> 6.4.x

## Goal
Bump `frontend` vite from `^5.4.2` (5.4.21 installed) to `^6.4.4` to close 4 Dependabot alerts. Production output should not change in any way that matters. Stop Dependabot ignoring vite majors.

## Target: 6.4.x (not 7 or 8)
- **6.4.x is the smallest change that fixes the alerts.** Its Node floor is 18/20/22+, so it works on the CI's `node-version: 20` with no further changes.
- **Vite 7+ needs Node 20.19+.** `setup-node` with `20` resolves to the latest 20.x today, so that would probably pass. But 7 also moves the default `build.target` to `baseline-widely-available`. That doesn't matter here because we set it explicitly (`es2020`, `safari15`). 8 swaps Rollup for Rolldown, and Rolldown could change the chunking that iOS 16 and the bundle size depend on.
- **Vitest 4 and the backend already pull vite 8.3.8, nested.** That doesn't push the frontend's own vite to 8: vitest keeps using its own copy. Going to 7 or 8 is a separate follow-up task.
- **Recommendation:** `vite ^6.4.4`. Leave `@vitejs/plugin-react` at `^4.3.1` (4.7.0 is installed and its peer range already covers vite ^6 and ^7).

## Files to change
1. `frontend/package.json`: change `"vite": "^5.4.2"` to `"vite": "^6.4.4"`.
2. `package-lock.json`: regenerate by running `npm install vite@^6.4.4 -w frontend` from the repo root. Don't delete the lockfile. Then check `npm ls vite` shows frontend on 6.4.x, and that vitest's nested 8.3.8 is unchanged.
3. `.github/dependabot.yml`:
   - Delete the `vite` semver-major ignore entry.
   - Keep the `@vitejs/plugin-react` ignore for now. plugin-react 5 is a separate step and needs vite 6+.
   - Update the header comment if it still lists vite.
4. `frontend/vite.config.ts`: no change expected.

## Vite 6 breaking changes checked against this config
| Change | Applies? | Notes |
|---|---|---|
| `resolve.conditions` / `ssr.resolve.conditions` defaults are now explicit | No | The config sets neither, and the new defaults match v5's built-in behavior. |
| `json.stringify` now defaults to `'auto'` | Low | The i18n locale JSON (`src/i18n/index.ts`) may now be emitted as `JSON.parse("...")` for big files. Behavior is the same and the size difference is small. Named imports from JSON still work. |
| Sass uses the modern API by default | No | There's no sass/scss in the project. CSS is Tailwind 3 through PostCSS. |
| postcss-load-config 6 (`tsx`/`jiti` for TS configs) | No | `postcss.config.js` is plain ESM JS using tailwindcss + autoprefixer, which still loads. Check that Tailwind classes actually appear in the build CSS. |
| Library mode CSS file name follows package name | No | This is an app build, not a library. |
| `define` / env: `import.meta.env` replacement, `loadEnv` | Low | There's no `define` block. `brandIndexHtml` calls `loadEnv(mode, process.cwd(), 'VITE_')`, and that signature hasn't changed. Vitest `test.env` belongs to vitest 4, not vite. |
| `server.*` / proxy: http-proxy upgrade, `server.cors` default tightened (6.0.9+) | Dev only | Only `server.port: 5176` is set, with no proxy. The tighter CORS default affects only the dev server. Check that the local frontend at 5176 still talks to the backend (that's the backend's CORS, which is unaffected). |
| `?url` asset imports / workers | Check | `pdfUtils.ts` imports `pdfjs-dist/build/pdf.worker.min.mjs?url`. Confirm the worker asset is emitted and loads, by testing a PDF upload or receipt. |
| `transformIndexHtml` hook | No | The plugin uses the plain function form, which is still supported. |
| `optimizeDeps.exclude: ['lucide-react']` | No | Still supported. |
| Runtime: Environment API, removed CJS Node API | No | We don't use them, and the config is ESM. |

## Plugins
- `@vitejs/plugin-react` 4.7.0: compatible with vite 6. This is the only vite plugin in the frontend.
- `vitest` 4 and `@vitest/coverage-v8` 4: they use their own nested vite 8 and only read `test` from this config. Make sure the `/// <reference types="vitest/config" />` types still typecheck against the top-level vite 6 `defineConfig` (run the typecheck workflow command).

## Verification
Run all of these from the repo root on Node 20, in the worktree.
1. **Baseline first (on `master`, before the bump):** `npm ci && npm run build -w frontend`, then copy `frontend/dist` to `<scratchpad>/dist-v5` and record `du -sh` plus the per-chunk sizes from the build log.
2. `npm ci`. It must succeed with no `ERESOLVE` or peer warnings involving vite.
3. `npm ls vite`: frontend shows `vite@6.4.x`. `npm audit | grep -i vite` shows no vite advisories.
4. Tests: `npm test -w frontend` (702+ must all pass), plus the backend tests (unchanged, as a sanity check).
5. Typecheck: run the same commands as `.github/workflows/typecheck.yml`, and run lint.
6. `npm run build -w frontend`, then compare against the baseline:
   - total size and chunk sizes should be within about 3%
   - `diff <(ls dist-v5/assets | sed 's/-[A-Za-z0-9_-]*\./ ./' | sort) <(same for new)`: the same set of chunks, with only the hashes changing
   - `diff dist-v5/index.html dist/index.html`: only asset hash changes
   - grep the built JS for `safari15`-incompatible syntax (look for `??=`, which esbuild should have transpiled)
   - check that the pdf worker asset is present
7. **Brand variants.** Build locally once per brand with the brand's `VITE_BRAND_*` env:
   - the default rsvpizza build, which must give a byte-identical `index.html` apart from hashes
   - doge, monad and team1, using values from `VERCEL_TOKEN="$(vercel-token)" vercel env pull` for each project, or the Vercel dashboard
   - in each one's `dist/index.html`, check the title, OG tags and favicon
8. **Previews.** Run `/ship` to get PRs and previews for rsvpizza, rsvpizza-doge, -monad and -team1, and check that each Vercel build is Ready. On the rsvpizza preview, smoke-test:
   - the home page, event page, RSVP flow and host dashboard
   - maps: the default OSM/maplibre view, plus the Google Places autocomplete in event create
   - wallet connect: open the ConnectKit modal and connect, then disconnect
   - a PDF/receipt upload (the pdf worker)
   - switching i18n language
   - a hard reload on a deep link (the SPA rewrite)
   On each brand preview, check the branding and the page title.
   Also run a mobile check with `/mobile-check`, because of the Safari 15/16 target.
9. **Deploy to GitHub Pages:** after merge, confirm the `deploy.yml` run passes and the live site loads.

## Risks
- **Chunk or hash churn causing stale-chunk 404s for users with a cached old `index.html`.** This is no different from any normal deploy, since `/assets` is immutable and hashed.
- **Changed esbuild or Rollup minor versions alter the output for Safari 15.** Mitigation: the explicit target, plus the mobile check.
- **Lockfile churn pulling unrelated packages.** Install only the targeted package with `-w frontend`, and review the lockfile diff to make sure only vite, esbuild, rollup and postcss subtrees move.
- **Dependabot may immediately open a vite 7/8 PR** once the ignore is removed. That's expected. Triage it as its own task, keeping the Node 20.19 and Rolldown points in mind.

## Rollback
The change is limited to three files. Revert the PR (`git revert <merge sha>`), which restores `^5.4.2`, the old lockfile and the dependabot ignore, then redeploy (GitHub Pages runs again on merge to master, and the Vercel projects rebuild). For an urgent fix, promote the previous Vercel deployment for each brand project first.
