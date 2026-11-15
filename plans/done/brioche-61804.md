# brioche-61804: frontend vite 6 -> 8.3.x (Rolldown) + @vitejs/plugin-react 4 -> 6

## Goal
Move `frontend` from vite `^6.4.6` (6.4.6) to `^8.3.8`, which swaps Rollup for Rolldown and esbuild for Oxc. Bump `@vitejs/plugin-react` from `^4.3.1` (4.7.0) to `^6.3.0` in the same change, because plugin-react 4.x's peer range stops at vite 7 and 6.x is the line built for vite 8. Production output must keep working on iOS 16 / Safari 15 (`forno-81402`), and the bundle should not get meaningfully bigger. Supersede Dependabot PR #1306.

## Why not just merge Dependabot #1306
#1306 bumps only `vite`. Its lockfile keeps a **root `node_modules/vite@6.4.6` + `rollup`** alive, only to satisfy plugin-react 4.7.0's peer. So the frontend builds with vite 8 while running a plugin that doesn't officially support it, and there is a dead vite 6 / Rollup / esbuild tree in the lock. Its builds pass, but the setup is unsupported. Close #1306 as superseded, with a comment linking the new PR.

## Target versions (checked on npm, 2026-11-15)
| Package | From | To | Notes |
|---|---|---|---|
| `vite` | ^6.4.6 (6.4.6) | **^8.3.8** (8.3.8, latest) | engines `node: ^20.19.0 \|\| >=22.12.0`. esbuild is now an *optional* peer, and we don't need it. |
| `@vitejs/plugin-react` | ^4.3.1 (4.7.0) | **^6.3.0** (6.3.0, latest, 2026-11-09) | peer `vite: ^8.0.0`. Babel is removed, and React Refresh is done by Oxc. Engines are the same as vite. |
| `vitest` / `@vitest/coverage-v8` | 4.1.12 | unchanged | peer `vite ^6 \|\| ^7 \|\| ^8`. The frontend's vitest dedupes onto the frontend's vite 8.3.8. |

Out of scope: vitest 5, Tailwind 4, React 19, and any change to code-splitting behavior (see the optional step below).

### plugin-react 5 and 6 breaking changes vs. our usage
We call `react()` with **no options**, so most of these don't affect us.
- 6.0: the `babel` option is removed, along with the Babel dependency. We don't use it, and there's no React Compiler.
- 6.0: vite 7 and below are dropped. That's fine, since we're moving to 8.
- 5.0: the default `exclude` is now `/\/node_modules\//`. This only matters for refresh/JSX on node_modules files, and we don't rely on it.
- 5.0: `react`/`react-dom` are no longer auto-added to `resolve.dedupe`. Check that the lockfile has a single `react`/`react-dom` (`npm ls react react-dom`). It did in the trial: the hoisted 18.3.1.
- 5.0: dev builds use the dev JSX transform. Dev only.

## Files to change
1. `frontend/package.json`: `"vite": "^8.3.8"` and `"@vitejs/plugin-react": "^6.3.0"`.
2. `package-lock.json`: from the repo root, run
   `npm install vite@^8.3.8 @vitejs/plugin-react@^6.3.0 -w frontend`.
   - Don't delete or hand-regenerate the lockfile.
   - Then run `npm install --package-lock-only`, which must produce **no further diff**. That shows the lock is canonical; it was in the trial.
   - In the trial, the lock diff was **exactly** these changes, and nothing unrelated moved:
     - removed: `vite@6.4.6`, `rollup@4.61.1` + `@rollup/*`, `esbuild@0.25.12` + `@esbuild/*` (vite's), `@vitejs/plugin-react@4.7.0`, `react-refresh@0.17.0`, `@babel/plugin-transform-react-jsx-{self,source}`, `@types/babel__*`, old `@rolldown/pluginutils@1.0.0-beta.27`
     - added: `frontend/node_modules/{vite@8.3.8, @vitejs/plugin-react@6.3.0, @rolldown/pluginutils@1.1.1}`
     - changed: none
   - **Layout note:** after this there is **no root `node_modules/vite`**. vite 8.3.8 is nested once under `frontend/` and once under `backend/` (backend's vitest copy, unchanged). That's what npm produces, and it's fine: `npm run build -w frontend`, Vercel (rootDirectory=frontend) and `cd frontend && npm run build` (deploy.yml) all resolve `frontend/node_modules/.bin/vite`. Don't "fix" it by adding a root vite. A stale root vite is exactly what broke CI in focaccia-61802.
3. `frontend/vite.config.ts`: **no change required.** The trial build passed with the current file and no deprecation warnings.
   - `build.target: ['es2020','safari15']`: still valid. Vite 8 errors only if the *same* browser is listed twice, and we list Safari once. Oxc lowers syntax to it, and Lightning CSS uses it as `cssTarget`.
   - `optimizeDeps.exclude: ['lucide-react']`: still supported. The optimizer is now Rolldown.
   - `transformIndexHtml(html)`, the plain function form: still supported. Vite 7 removed only the `enforce`/`transform` *object* options.
   - `loadEnv(mode, process.cwd(), 'VITE_')`: unchanged.
   - The `/// <reference types="vitest/config" />` + `test` block: typechecks, since `tsc -p tsconfig.node.json` gives 0 errors.
   - Update the `https://vitejs.dev/config/` comment URL to `https://vite.dev/config/`. Optional, cosmetic.
4. `.github/dependabot.yml`:
   - **Remove** the `@vitejs/plugin-react` semver-major ignore. We'll be on its latest major, and its next major will track vite 9. We want to see that.
   - **Add a `vite` group** *above* `dev-and-build` (the first matching group wins), with `patterns: ['vite', '@vitejs/*']` and no `update-types`, so majors are included. Then vite and plugin-react majors arrive in **one** PR, and we don't get another #1306-style half-bump. Majors aren't ignored, so the grouped major PR will open.
5. `.github/workflows/*.yml`: Node version. **Needs Snax's decision**, see Risks. Recommendation: change all 13 `node-version: 20` lines to `node-version: 24`, as a separate commit in this PR. Keep `NODE_OPTIONS=--max-old-space-size=6144` in `deploy.yml`. It's harmless, and the comment can note that Rolldown is native, with a peak RSS of about 1.7 GB in the trial.

## Approach and alternatives
- **Chosen: vite 8 + plugin-react 6 in one PR, config untouched.** This is the smallest supported combination. A trial in a temp worktree passed every check below.
- *Alt: merge #1306 as-is.* Rejected: it runs plugin-react 4.7 against vite 8 outside its peer range, and it leaves a dead vite 6 / Rollup / esbuild tree in the lock.
- *Alt: vite 7 first, then 8.* Not worth it. 7's only relevant change is the default `build.target`, and we set the target explicitly. The Node floor is the same as 8. Doing 7 first would mean two rounds of preview checks for nothing.
- *Alt: plugin-react 5.x with vite 8.* 5.x supports vite 8 too, but it still carries Babel. 6.x is the current line, so there's no reason to stop at 5.
- *Optional, not recommended for this PR: collapse the lucide icon chunks.* Rolldown splits shared modules into many small chunks (see the bundle results). The config below cut the initial-load files from 91 to 46, gave about 0.5% less gzip, and dropped the total JS chunk count from 251 to 205:
  ```ts
  build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'lucide', test: /node_modules[\\/]lucide-react/ }] } } } }
  ```
  Leave it out unless Snax wants it. It's a behavior choice (every icon goes into one shared chunk) and better as its own follow-up with a Lighthouse comparison.

## Trial results (temp worktree off `master` @ 093726fc, Node 24.16, macOS)
| Check | vite 6.4.6 (master) | vite 8.3.8 + plugin-react 6.3.0 |
|---|---|---|
| `npm ci` | ok | ok, no peer/ERESOLVE warnings, `npm ls` clean |
| frontend vitest | - | **66 files / 758 tests pass** |
| backend tests | - | 2406 pass / 20 skipped |
| `tsc -p tsconfig.app.json` errors (pre-existing, CI has continue-on-error) | 54 | 54 (no change) |
| `tsc -p tsconfig.node.json` (vite.config.ts) | 0 | 0 |
| eslint (lint.yml command) | - | 0 errors, 57 warnings (pre-existing) |
| build time | 18.2 s | **9.0 s** |
| JS chunks / total JS bytes | 162 / 12,080,538 | 251 / 11,916,205 (**-1.4%**) |
| CSS bytes (Lightning CSS minify) | 222,094 | 221,138 (-0.4%) |
| Entry chunk `index-*.js` | 4,659,495 | 3,907,752 (-16%; shared code moved into preloaded chunks) |
| Initial load (entry + modulepreload + CSS) | 2 files, 4.81 MB raw / 1.373 MB gzip | **91 files**, 4.71 MB raw / 1.341 MB gzip (-2.3% gzip) |
| `index.html` | 2.26 kB, no modulepreload | 9.4 kB, 89 `<link rel="modulepreload">` tags |
| Safe SDK CJS-viem duplicate lazy chunk | `index-*.js` 657,710 | still present: `dist-*.js` 642,422, lazy, not preloaded (same accepted state) |
| `es-check es2020 --module` on all `assets/*.js` | pass | **pass** (so no `??=`, class static blocks or other ES2021+ syntax) |
| pdf worker / maplibre worker `?url` assets | emitted | emitted, byte-identical (1,264,342 / 519,547) |
| brand build (`VITE_BRAND_*` + custom OG) | - | title, og:image (1200x630), site_name and twitter:card substituted correctly |
| `vite preview` smoke, Chromium + WebKit: `/`, `/events`, `/map`, `/login`, `/new`, `/<slug>`, `/leaderboard`, `/partners` (dummy env, no backend) | renders, 0 page errors | **identical text length per route, 0 page errors** (WebKit only logs the expected blocked-port fetches in both) |
| `vite` dev server | - | ready in about 0.5 s; `/` renders; React Refresh runtime present; 0 errors (the first cold load waits on the Rolldown dep optimizer) |
| new build warning | - | `node:worker_threads externalized for browser compatibility` from `viem/node_modules/ox/_esm/tempo/internal/virtualMasterPool.js`. Informational only: that code path is Node-only, and the same import existed before but Rollup didn't report it. |

## Vite 7/8 breaking changes checked against this repo
| Change | Applies? | Notes |
|---|---|---|
| Node ^20.19 \|\| >=22.12 (v7) | Yes | Vercel is on Node 24.x. CI `node-version: 20` resolves to the latest 20.x (>= 20.19), so it works, but Node 20 has been EOL since 2026-04-30. See Risks. |
| Default `build.target` changed (v7: baseline-widely-available, v8: Safari 16.4) | No | Our target is explicit. es-check confirms es2020 output. |
| Multiple versions of the same browser in `build.target` now errors | No | Only one Safari entry. |
| Oxc replaces esbuild for transforms/minify; `esbuild` option deprecated | No | No `esbuild`/`build.minify` config. No `transformWithEsbuild` in our plugin. |
| Lightning CSS is the default CSS minifier | Low | CSS -0.4%. `cssTarget` follows `build.target` (safari15). Tailwind 3 via PostCSS is unchanged; `postcss.config.js` is plain ESM. Confirm visually on the previews and with `/mobile-check`. |
| `build.rollupOptions` renamed `rolldownOptions`; `manualChunks` object form removed; `commonjsOptions` no-op | No | None used. |
| CJS interop: `default` import = `module.exports` unless `__esModule` (dev and build now consistent) | **Check at runtime** | Default imports of CJS/UMD packages: `react`, `qrcode`, `tz-lookup`, `heic2any`, `i18next-browser-languagedetector`, plus `maplibre-gl`/`pdfjs-dist` (ESM). The route smoke passed, but the lazy features need preview checks (verification step 8). If one breaks, `legacy.inconsistentCjsInterop: true` is the temporary escape hatch. |
| Format sniffing removed (`browser` vs `module` field) | Low | Resolution follows `resolve.mainFields`. Covered by the same runtime checks (wallet/viem/Safe, maps). |
| `import.meta.url` in UMD/IIFE no longer polyfilled | No | App build is ESM. Worker URLs use `?url`. |
| `transformIndexHtml` `enforce`/`transform` removed (v7) | No | We use the function form. |
| `splitVendorChunkPlugin` removed (v7), Sass legacy API removed (v7) | No | Neither used. |
| Plugin API: `moduleType: 'js'` for non-JS `load`/`transform`, sequential hooks, bundle mutation | No | Our only custom plugin uses `transformIndexHtml`. |
| Native decorators not lowered by Oxc | No | No decorators. |
| `server.cors` / middleware order (v7) | Dev only | Only `server.port: 5176` is set. |
| Vercel edge functions in `frontend/api/*` | No | Vercel compiles them, not vite. |

## Implementation steps
1. On branch `brioche-61804-vite8` (repo convention: `{task-id}-{short-name}`), in the implementer's worktree, run the install command from Files to change step 2. Check the lock diff against the expected set listed there, and confirm `npm install --package-lock-only` gives no diff.
2. Apply the dependabot.yml edits from step 4 (remove the plugin-react ignore, add the `vite` group above `dev-and-build`).
3. If Snax approves, make the Node 20 -> 24 workflow change as a separate commit.
4. Run all of Verification steps 1-7, then `/ship`. Close #1306 with a "superseded by #<new PR>" comment.

## Verification
Run from the repo root in the worktree.
1. **Baseline on `master` first:** `npm ci && npm run build -w frontend`. Copy `frontend/dist` to `<scratchpad>/dist-v6`. Record `ls assets/*.js | wc -l`, the total JS bytes, the entry chunk size, and the initial-load bytes (entry + every `modulepreload` + CSS from `index.html`, raw and `gzip -9`).
2. `rm -rf node_modules && npm ci`. It must succeed with no ERESOLVE or peer warnings. `npm ls vite @vitejs/plugin-react react react-dom` should show frontend `vite@8.3.8`, `@vitejs/plugin-react@6.3.0`, and a single react/react-dom.
3. Tests: `npm test -w frontend` (758 pass), and backend `npx prisma generate && npm test -w backend` (unchanged).
4. Typecheck and lint, using the same commands as `typecheck.yml` and `lint.yml`:
   - `tsc -p tsconfig.app.json` must stay at 54 errors (pre-existing)
   - `tsc -p tsconfig.node.json` must have 0 errors
   - eslint must have 0 errors
5. `npm run build -w frontend`, then compare against the baseline:
   - total JS and initial-load gzip within about ±3%. The trial gave -1.4% and -2.3%.
   - the extra modulepreload tags and higher chunk count are **expected**
   - no new build warnings apart from the `node:worker_threads` notice
   - the pdf and maplibre worker `.mjs` assets are present
   - the Safe/viem CJS lazy chunk is still lazy (not in `index.html`)
   - **Safari-15 syntax:** run `npx es-check es2020 'frontend/dist/assets/*.js' --module` from a scratch dir and point it at the build. It must pass. Also `grep -l '??=\|||=\|&&=' frontend/dist/assets/*.js` must find nothing.
6. **Brand builds:** build once with no `VITE_BRAND_*` set; the `<head>` meta must be identical to the baseline apart from the asset/modulepreload tags. Build once with a brand's env (doge: `VERCEL_TOKEN="$(vercel-token)" vercel env pull` in the doge project, or the dashboard values). Check the title, OG tags, favicon and twitter:card in `dist/index.html`.
7. **Local `vite preview` smoke** in Chromium *and* WebKit (Playwright; `npx playwright install webkit` if needed). Use a real `.env.local` copied from the main checkout's Vercel env, or dummy values. Visit:
   - `/`
   - `/events`
   - an event page
   - `/map` (OSM/maplibre tiles render)
   - `/login`
   - a language switch (i18n)
   - a hard reload on a deep link

   There must be no `pageerror`s, and each route should render the same content as the baseline preview.
8. **Vercel previews** (`/ship`): all 5 projects must be Ready: rsvpizza, -doge, -monad, -team1 and -swc. On the rsvpizza preview, also check the **CJS-interop-sensitive lazy features**:
   - a QR code renders (`qrcode`), e.g. a ticket or check-in
   - the event-create timezone auto-detect from a location (`tz-lookup`)
   - a HEIC photo upload converts (`heic2any`)
   - a PDF/receipt upload (the pdfjs worker)
   - the ConnectKit modal opens, connects and disconnects (wagmi/viem)
   - the Google Places autocomplete in event create
   - charts on an admin/report page (recharts)
   - markdown rendering (react-markdown/remark)

   On each brand preview, check the branding and title. Run `/mobile-check` for iOS 16/Safari, which is the main risk this change carries.
9. **After merge:** the `deploy.yml` GitHub Pages run passes and the live site loads.

## Risks (needing Snax's decision are marked **[decide]**)
- **[decide] Node 20 in CI.** It works today, because setup-node resolves to 20.20.x, which satisfies ^20.19. But Node 20 has been EOL since 2026-04-30, and vite 8 / plugin-react 6 have dropped older 20.x. Recommendation: bump every workflow to `node-version: 24` (it matches Vercel's 24.x; the trial, including backend tests, ran on 24.16) as a separate commit in this PR. Alternative: leave CI on 20 and open a small follow-up task.
- **[decide] Many more initial requests.** Rolldown puts shared modules in their own chunks: 89 modulepreload links, versus a single 4.6 MB entry before. Total bytes go *down*, Vercel and GitHub Pages serve HTTP/2, and vite's modulepreload polyfill covers Safari < 17. On slow mobile networks it could still change first-load timing either way. Recommendation: ship the defaults and compare Lighthouse/mobile on the preview. If it's worse, apply the optional lucide `codeSplitting` group (91 -> 46 files), here or as a follow-up.
- **CJS interop or format-resolution change breaks a lazy feature at runtime.** None was seen in the route smoke. Mitigation: the step 8 feature list, plus `legacy.inconsistentCjsInterop: true` as an escape hatch.
- **Oxc/Lightning CSS output on real iOS 16.** es-check gives syntax-level confidence only, and CSS lowering is untested on a device. Mitigation: `/mobile-check` on the preview.
- **Chunk/hash churn** (almost every asset name changes). This is the same as any deploy: `/assets` is hashed and immutable, and the SPA rewrite excludes `/assets/`. A user with a cached old `index.html` gets the usual stale-chunk behavior.
- **The grouped Dependabot `vite` PR** will now carry majors for vite and `@vitejs/*` together. That's intended. Triage future vite 9 PRs as their own task.

## Rollback
The change is limited to `frontend/package.json`, `package-lock.json`, `.github/dependabot.yml` and, if approved, the workflow Node versions. Revert the PR (`git revert <merge sha>`). That restores vite 6.4.6, plugin-react 4.7.0, the old lockfile and the ignore. GitHub Pages redeploys on merge to master, and the Vercel projects rebuild. For an urgent fix, first promote the previous Vercel deployment for each of the 5 projects.
