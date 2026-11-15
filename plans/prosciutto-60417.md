# prosciutto-60417: Upgrade Prisma 6.19.3 → 7.10.1 (backend)

## Goal
Clear the high-severity advisory that reaches us through Prisma 6 (Dependabot #1281 `prisma` and #1272 `@prisma/client`, both 7.10.1), with no schema or DB change and no behaviour change in the API.

**What the advisory is (from `npm audit`):** GHSA-ggr8-5vv4-36mx, `deepmerge-ts <8.0.0` (stack exhaustion), reached via `prisma` → `@prisma/config@6.19.3` (pins `deepmerge-ts@7.1.5`). It is **CLI/build-time only**: `prisma` is `devOptional` in the lockfile, and `@prisma/client` 6 has no runtime dependency on `@prisma/config`. Nothing in the request path is exposed. `@prisma/config@7.10.1` pins `deepmerge-ts@8.0.2`.

Both Dependabot PRs fail CI as they stand: each bumps only one package, and the schema `url` and the missing adapter both break. Close both once this ships.

## Facts that shape the plan (verified)
- **Migrations don't use Prisma Migrate.** There's no `migration_lock.toml` and no `_prisma_migrations` tracking (`scripts/check-migrations-applied.js:7`). Migrations are hand-written SQL in `backend/prisma/migrations/` (mixed loose `.sql` files and folders), applied by `backend/scripts/apply-*.cjs` runners or by MCP. `prisma migrate deploy` isn't run anywhere: not in `deploy-backend.yml` and not in any workflow. The only CLI command that runs is `prisma generate` (`backend/package.json:8,10`, `tests.yml:40`, `typecheck.yml:60`). "Keep `migrate deploy` working" therefore means keeping the CLI and the apply-runners working. **No `schema.prisma` model change and no DB change.**
- **Deploy target:** `deploy-backend.yml` runs `vercel --prod` from `backend/`, deploying to Vercel project `pizza-dao/backend` (`api.rsv.pizza`, **Node 24.x**). The build is legacy `@vercel/node` (`backend/vercel.json`). Only `backend/` is uploaded, so **Vercel installs without the root lockfile** and `^` ranges resolve fresh. `postinstall: prisma generate` runs there.
- **Prod `DATABASE_URL`** is the Supavisor **transaction pooler** `aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&statement_cache_size=0`. It has no `sslmode` and there's no `DIRECT_URL`. The Vercel env has `DATABASE_URL` in both Production and Preview, and Preview also has `JWT_SECRET`, so a preview backend can boot.
- **`@prisma/adapter-pg@7.10.1` source** (checked): it sends **unnamed** statements unless `statementNameGenerator` is set, so it is safe on transaction-mode Supavisor. Interactive transactions hold one `pg` client (`BEGIN`/`COMMIT`), so `SET LOCAL` in `helpers/auditContext.ts:17-18` keeps working. Unknown URL params (`pgbouncer`, `statement_cache_size`) are ignored by `pg`. Its deps are `pg ^8.16.3`, and we already have `pg ^8.23.1` (`backend/package.json:42`).
- **`@prisma/client@7.10.1` has no `runtime/library`.** Only `runtime/client` exists, so the 5 `Decimal` imports break. The `transactionOptions` and `log` constructor options are kept. `datasourceUrl` and `datasources` are removed, and `adapter` (or `accelerateUrl`) is required at the type level.
- Toolchain is already compliant: Node ≥20.19 (local 24, Vercel 24, CI `node-version: 20` resolves to latest 20.x), TS 5.9.3 (≥5.4), backend already `"type": "module"` + `module/moduleResolution: NodeNext` (`backend/package.json:5`, `backend/tsconfig.json:3-5`).
- `Prisma 8.0.0-rc` is `latest` on npm, and v8 removes `prisma-client-js`. 7.10.1 is the newest 7.x.

## Prisma 7 changes mapped to this codebase
| v7 change (official upgrade guide) | Where it hits | Action |
|---|---|---|
| New `prisma-client` generator, `output` required, imports from generated path. `prisma-client-js` **still works in v7** (deprecated, removed in v8) | `schema.prisma:1-3`. 75 files import `@prisma/client`. ~30 `.cjs`/`.js` scripts `require('@prisma/client')`. 3 tests mock or import `@prisma/client` (`routes/rsvp-overwrite.routes.test.ts:36-39`, `lib/authRateLimit.test.ts:305`, `routes/pizza-index-submissions.routes.test.ts:55`) | **Keep `prisma-client-js` in this PR** (decision D1). Moving to `prisma-client` becomes a follow-up task before v8 |
| `url`/`directUrl` in schema deprecated → `prisma.config.ts` | `schema.prisma:7` | Remove the `url` line and add `backend/prisma.config.ts` |
| No automatic `.env` loading. `env()` throws if a var is unset | `prisma generate` in CI and on Vercel runs with no `DATABASE_URL` | Use `process.env.DATABASE_URL ?? ''`, not `env()`. Load `.env` with built-in `process.loadEnvFile` (no `dotenv`: it isn't a backend dep, and the Vercel install is backend-only) |
| **Driver adapter required** (`@prisma/adapter-pg`) | `config/database.ts:8`. **`routes/nft.routes.ts:7` (`new PrismaClient()` at module top: in v7 this throws at import and takes down the whole API)**. Tests `lib/authRateLimit.test.ts:306-307`, `lib/hackathon/votingStore.db.test.ts:45` (`datasourceUrl`). 29 backend scripts + 5 root scripts call `new PrismaClient()` | One shared factory, used everywhere (below) |
| Pool defaults now come from `pg` (`max` 10, no connect timeout) instead of v6 (`2×cpus+1`, which is 5 on Vercel per `lib/consolidatedReport.ts:128`, pool_timeout 10s, connect 5s, idle 300s) | Calabrese-58204 outage history (pool exhaustion) | Pin `max: 5` (env-overridable), `connectionTimeoutMillis: 10_000`, `idleTimeoutMillis: 300_000` |
| SSL: `pg` doesn't silently accept bad certs. With no `sslmode` the v6 engine used `prefer` (TLS, unverified), and `pg` would use **plaintext** | Prod URL has no `sslmode` | Pass `ssl: { rejectUnauthorized: false }` for non-local hosts (same as the precedent at `scripts/check-schema-drift.js:186`). Decision D3 |
| ESM required | Already ESM/NodeNext. `prisma.config.ts` sits outside `rootDir: ./src`, so `tsc` ignores it | None |
| Removed: `$use` middleware, Metrics, `$on` engine events, `datasourceUrl`/`datasources`, `migrate dev --skip-generate`, `migrate diff --from-url`, several `PRISMA_*` env vars | None used (grep: `$use(`, `$metrics`, `$on(`, `$extends` all 0, apart from the type-only `'$use'` in `Omit<>` at `helpers/auditContext.ts:11`, which is harmless). `datasourceUrl` only in the 2 tests above | Fix the 2 tests. Optionally drop `'$use'` from the Omit |
| `migrate dev`/`db push` no longer auto-generate | `package.json:12-13` `db:push`/`db:migrate` (footguns: `.env` points at prod) | Decision D4 |
| Node ≥20.19, TS ≥5.4 | Already satisfied | Add `"engines": {"node": ">=20.19"}` to `backend/package.json` (documents the floor) |
| `@prisma/client/runtime/library` gone | `routes/payout.routes.ts:18`, `routes/admin-payout.routes.ts:22`, `routes/telegram-inbound.routes.ts:34`, `routes/budget.routes.ts:5`, `helpers/reimbursementCapAudit.ts:9` | Switch to `Prisma.Decimal` (generator-portable) |

Unaffected, but covered by tests and smoke checks: 159 `$queryRaw`, 32 `$executeRaw`, 13 + 13 `*Unsafe`, 136 `$transaction`, `Prisma.sql/join/raw/empty`. Error handling only reads `.code` (P2002 ×17, P2003 ×3, P2025 ×5). Nothing reads `meta.target`, whose shape changes under adapters. `checkin.routes.ts:39-42` already accepts `P2002`/`23505`/message.

## Approach
### Alternatives considered
- **A (recommended): Prisma 7.10.1 + `prisma-client-js` + `@prisma/adapter-pg`.** Imports stay as they are. Changes are confined to config, one factory, 5 `Decimal` imports, `nft.routes.ts`, 2 tests and the scripts' constructor lines.
- **B: also switch to the `prisma-client` generator now** (`output = "../src/generated/prisma"`, gitignored). This also needs: 75 imports rewritten to relative `…/generated/prisma/client.js`, `vi.mock('@prisma/client')` repointed in 3 tests, and every CJS script moved off `require` (the generated client is TS/ESM). That roughly triples the diff, all of it in money and migration-runner code, for no security gain. Do it as a follow-up before v8.
- **C: stay on 6.19.3 and add `"overrides": {"@prisma/config": {"deepmerge-ts": "8.0.2"}}`.** About a 1-line fix, but it forces a major of a transitive dep under a pinned exact version (it's only used for config merging). Prisma 6 also gets no further fixes, and the v7 work just moves later. A viable stopgap if Snax wants zero runtime risk this week.

### Exact file changes (Option A)
1. **`backend/package.json`**: pin exact versions (Vercel installs without a lockfile): `"@prisma/client": "7.10.1"`, `"@prisma/adapter-pg": "7.10.1"` (new, in dependencies), devDep `"prisma": "7.10.1"`. Add `"engines": {"node": ">=20.19"}`. Then run `npm install` at the **repo root** so the root `package-lock.json` updates. Confirm `deepmerge-ts` resolves to 8.0.2 and `npm audit` no longer lists `prisma`/`@prisma/config`.
2. **`backend/prisma/schema.prisma:5-8`**: datasource becomes `provider = "postgresql"` only (delete `url = env("DATABASE_URL")`). Generator stays `prisma-client-js`. No model edits.
3. **`backend/prisma.config.ts`** (new, next to `package.json`):
   ```ts
   import { defineConfig } from 'prisma/config';
   try { process.loadEnvFile('.env'); } catch { /* CI/Vercel: env comes from the environment */ }
   export default defineConfig({
     schema: 'prisma/schema.prisma',
     // CLI only (db pull / studio / migrate diff). Runtime uses the adapter in src/config/prismaClient.ts.
     // NOTE: migrations are hand-applied SQL; never run `prisma migrate deploy|dev` or `db push` against prod.
     datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '' },
   });
   ```
   Leave out `migrations.path` on purpose, so the CLI is never pointed at the hand-applied folder.
4. **`backend/src/config/prismaClient.ts`** (new): a single factory.
   ```ts
   import { PrismaClient, Prisma } from '@prisma/client';
   import { PrismaPg } from '@prisma/adapter-pg';
   const LOCAL = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/;
   export function createPrismaClient(opts: { url?: string } & Omit<Prisma.PrismaClientOptions, 'adapter' | 'accelerateUrl'> = {}) {
     const { url = process.env.DATABASE_URL, ...rest } = opts;
     const adapter = new PrismaPg({
       connectionString: url,
       max: Number(process.env.DATABASE_POOL_MAX) || 5,        // v6 parity on Vercel (2×cpus+1)
       connectionTimeoutMillis: 10_000,                          // v6 pool_timeout (also covers connect)
       idleTimeoutMillis: 300_000,                               // v6 max_idle_connection_lifetime
       ssl: url && LOCAL.test(url) ? false : { rejectUnauthorized: false }, // v6 sslmode=prefer parity (D3)
     });
     return new PrismaClient({ adapter, ...rest });
   }
   ```
   Don't add `sslmode` to `DATABASE_URL`: `pg` lets URL params override the `ssl` option, and `sslmode=require` now means verify-full.
5. **`backend/src/config/database.ts:1,8`**: import `createPrismaClient`, then `global.prisma || createPrismaClient({ log: …, transactionOptions: { maxWait: 5000, timeout: 20000 } })`. Keep the calabrese comment and the `$connect().catch`.
6. **`backend/src/routes/nft.routes.ts:2,7`**: delete the private client and `import { prisma } from '../config/database.js'`. That also removes a second pool. The `PrismaClient` mock in `rsvp-overwrite.routes.test.ts:36-39` becomes dead code; remove it, since `database.js` is already mocked at line 34.
7. **Decimal ×5** (lines listed in the table): `import { Prisma } from '@prisma/client'` (merge with any existing import) plus `const { Decimal } = Prisma;`. Any type-position use becomes `Prisma.Decimal`.
8. **Tests**: `lib/authRateLimit.test.ts:305-307` → `const { createPrismaClient } = await vi.importActual<typeof import('../config/prismaClient.js')>('../config/prismaClient.js'); c1 = createPrismaClient({ url: PG_URL });` (same for c2). `lib/hackathon/votingStore.db.test.ts:45` → `createPrismaClient({ url: URL })`. Both are local-PG, env-gated suites, and the `LOCAL` regex keeps SSL off for them.
9. **Scripts**: new **`backend/scripts/lib/prisma-client.cjs`**, the CJS twin of the factory (`require('@prisma/client')`, `require('@prisma/adapter-pg')`, same options, `max: 2`). Mechanically replace `new PrismaClient()` → `createPrismaClient()` and the require line in all 23 `backend/scripts/*.cjs` that construct a client, plus root `scripts/gen-template-flyers.cjs`, `fix-event-regions.js`, `fix-kit-countries.js`, `migrate-gpp-slugs.js` (`require('../backend/scripts/lib/prisma-client.cjs')`). The 6 `backend/scripts/*.ts` (`backfill-nft-mints`, `backfill-email-status`, `backfill-city-group-regions`, `import-telegram-groups`, `link-event-to-user`, `resolve-telegram-groups-from-urls`) and root `scripts/update-nft-uris.ts` import `createPrismaClient` from `src/config/prismaClient.ts`. Scripts that already import `src/config/database.js` (`import-pizza-history`, `backfill-pizza-count`, `clear-implausible-pizza-counts`, `check-pizza-count-hash`) need nothing. Keep the lazy `require` inside `main()` where it exists (`apply-lockdown-guests.cjs:402`, `apply-hackathon-voting.cjs:252`), because tests `require` those modules for their pure helpers. Grep check at the end: `grep -rn "new PrismaClient(" backend scripts --exclude-dir=node_modules` returns hits only inside the two factories.
10. **`.github/dependabot.yml`**: add a group `prisma: { patterns: ['prisma', '@prisma/*'] }` so the CLI, client and adapter always move together (the current `dev-and-build` group could skew them). Optionally ignore `prisma`/`@prisma/*` semver-major until the v8 follow-up.
11. **`CLAUDE.md`** (CI gates section, 2 lines): the runtime client is built only via `createPrismaClient` (driver adapter, pool `max` 5). Never use `new PrismaClient()`, and never run `prisma migrate deploy|dev`/`db push` against prod.

No changes to `tests.yml`, `typecheck.yml` or `deploy-backend.yml`. `npx prisma generate` (and `postinstall`) loads `prisma.config.ts`, and that works with no `DATABASE_URL` because of the `?? ''`. On Vercel, `postinstall` generates into `node_modules/.prisma/client` as before. The v7 client is Rust-free (WASM query compiler), so there's no platform engine binary to trace.

## Migration workflow
Nothing changes: SQL migrations stay hand-applied (apply-runners or MCP) **before** merge, per CLAUDE.md. Because this PR edits `schema.prisma`, `schema-drift.yml` runs on it. Its parser skips `datasource` blocks and no model changes, so it must pass, and that is the proof that no DB change is needed. `migrations-applied.yml` doesn't trigger (no new migration file). After the upgrade, smoke-run one apply-runner in its default dry-run/read mode (e.g. `node backend/scripts/apply-lockdown-parties-columns.cjs` **without** `--apply`) to prove the CJS factory connects. Never pass `--apply`.

## Test plan
1. `npm ci` at the root (postinstall generate succeeds with `DATABASE_URL` unset: `env -u DATABASE_URL npx prisma generate` in `backend/`).
2. `cd backend && npx tsc --noEmit -p tsconfig.json`: must stay at 0 errors (the blocking typecheck job).
3. `cd backend && npm test`: full suite (~2400) green, same count as on master (record the master baseline first). Also run the two real-PG suites against a throwaway local Postgres: `AUTH_RATE_TEST_DATABASE_URL=… HACKATHON_VOTING_TEST_DB=… npx vitest run src/lib/authRateLimit.test.ts src/lib/hackathon/votingStore.db.test.ts`. These exercise the adapter, `$executeRawUnsafe`, cross-connection atomicity and transactions on a real DB.
4. `npm audit` shows no `prisma`/`@prisma/config`/`deepmerge-ts` entries.
5. **Backend preview smoke test (real prod DB, read-only GETs only).** From the worktree's `backend/`: `VERCEL_TOKEN=… vercel link --project backend --scope pizza-dao`, then `vercel-deploy` (preview, not `--prod`). The Preview env has `DATABASE_URL` + `JWT_SECRET`. Crons don't run on previews. Use `vercel curl` if deployment protection is on. Diff the JSON from each route against `https://api.rsv.pizza` (v6), ignoring timing fields:
   - `GET /api/health` (`$queryRaw SELECT 1`, pool, SSL): `dbMs` similar, `degraded:false`
   - `GET /api/events/:slug` for 2 real events (public party read, relations)
   - `GET /api/gpp/events` and `/api/gpp/events/by-city/:citySlug` (list and filter queries)
   - with an admin JWT (Snax supplies one, or `vercel curl` with an admin session): `GET /api/admin/payouts` (Decimal + raw aggregates), an underboss detail GET (filtered `_count`, `underboss.routes.ts:1166-1172`), and the sponsor consolidated report GET (heavy raw `COUNT DISTINCT`, BigInt mapping)
   - `vercel inspect <url> --logs`: no `P1010`/`P2024`/TLS/`self-signed certificate` errors.
   Any field-level diff, especially Decimal/BigInt/Date/JSON shapes from `$queryRaw`, blocks the merge.

## Rollout
1. Branch `prosciutto-60417-prisma7`. Implement, then run CI (tests, typecheck, schema-drift) and the preview smoke test above.
2. Merge to `master` at a quiet hour (not during a GPP event window). "Deploy Backend" ships it in about 1 min.
3. Watch for 30 min: `/api/health` every minute, Vercel runtime logs for 5xx/`P10xx`/`P2024`, and Supabase pooler client-connection count (it should be at or below pre-deploy, since `max` 5 matches v6). The next `*/15` event-reminders cron run succeeds.
4. Close Dependabot #1281/#1272 as superseded. Open the follow-up task "switch to `prisma-client` generator (before Prisma 8)".

## Rollback
`DATABASE_URL` is untouched and there is no schema/DB change, so rollback is code-only and instant. Option 1 (fastest): Vercel dashboard or `vercel promote <previous backend deployment>` (`vercel rollback` on the `backend` project); this takes seconds. Then `git revert` the merge commit on `master`, which redeploys v6 via Deploy Backend and keeps master matching prod. v6 still reads `?pgbouncer=true` from the unchanged URL.

## Risks
- **A missed `new PrismaClient()` crashes on import.** In `src` the typecheck catches it, since `adapter` is required. In untyped `.cjs`/`.js` scripts only the grep check in step 9 catches it.
- **Raw-query result mapping under the adapter** (BigInt/Decimal/timestamp/JSON from `$queryRaw`) may differ subtly. Mitigated by the full suite, the real-PG suites and the prod-vs-preview JSON diff.
- **Pool behaviour:** wrong `max` or timeouts could recreate the 2026-05-19 pool exhaustion. Mitigated by pinning v6-equivalent values and watching Supavisor connections after deploy.
- **TLS:** `rejectUnauthorized:false` keeps the v6 posture (encrypted, unverified). If Supabase "Enforce SSL" is on and `ssl` were omitted, every query would fail, which is why `ssl` is set explicitly.
- **Lockfile-less Vercel install** could drift from CI. Mitigated by exact pins on all three Prisma packages.
- **Behaviour changes in Prisma 7 internals** (Rust-free query compiler, now the only engine): there may be edge differences in `$transaction` timeouts or error messages. `transactionOptions` is preserved, and error handling keys off `.code` only.
- **Deprecated generator:** `prisma-client-js` goes away in v8, and Dependabot will open v8 PRs. Hence the follow-up task and the D2 ignore.

## Decisions for Snax
- **D1: scope.** Option A (v7 + `prisma-client-js`, recommended), B (v7 + new generator now, about 3× the diff), or C (stay on v6 + `deepmerge-ts` override; the advisory is build-time only and not reachable at runtime).
- **D2: Dependabot.** Group `prisma`/`@prisma/*` (recommended) and ignore their majors until the v8 follow-up?
- **D3: TLS.** Keep `rejectUnauthorized:false` (v6 parity, recommended for this PR), or pin Supabase's CA (`ssl: { ca }` from the dashboard cert) for verified TLS, as a separate change.
- **D4: footgun scripts.** Remove `db:push`/`db:migrate` from `backend/package.json:12-13`? They target whatever `.env` points at, which is prod.
- **D5: admin token for the smoke test.** The admin-gated read-only GETs need Snax's session or a short-lived admin JWT. Otherwise only the public routes get checked.
