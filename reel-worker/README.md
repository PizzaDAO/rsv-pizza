# reel-worker

Renders sizzle reels for the host dashboard. Outside the npm workspaces so it builds on its own.
Polls the `reels` table (`status = 'queued'`, claimed with `FOR UPDATE SKIP LOCKED`), renders with
ffmpeg, uploads to R2, and marks the row `ready` or `failed`. One replica, one job at a time.

Railway: set the service Root Directory to `reel-worker/`. Health check: `GET /health`.

## What it makes

For each requested ratio (9:16 at 1080x1920, 16:9 at 1920x1080): title card, 12-15 photos with Ken Burns
pans and cross transitions, end card with sponsor logos. Outputs under `reels/<partyId>/<reelId>/`:
`9x16.mp4`, `16x9.mp4` (with music, only if a track was chosen), `9x16_nomusic.mp4`, `16x9_nomusic.mp4`
(always), `poster.jpg`. The backend builds the whole spec (`backend/src/lib/reelSpec.ts`), so the worker
never reads the Photo or Sponsor tables.

Branding: Global Pizza Party cards use Hub 191 Display and the PizzaDAO logo in `assets/` (copied from
`frontend/public`), plus the series logo from the spec if there is one.

## Env

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (same DB as the backend; pooler is fine) |
| `REEL_DB_SSL` | `false` to disable TLS to Postgres (default on) |
| `REEL_WORKER_SECRET` | Bearer secret for `POST /wake` |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Output bucket (`rsv-pizza-reels`), write access |
| `REEL_PUBLIC_BASE_URL` | Public URL of that bucket (custom domain or r2.dev), no trailing slash |
| `REEL_MUSIC_R2_BUCKET` | The pizza-radio bucket holding `songs/<folder>/...` |
| `REEL_MUSIC_R2_ENDPOINT`, `REEL_MUSIC_R2_ACCESS_KEY_ID`, `REEL_MUSIC_R2_SECRET_ACCESS_KEY` | Read access to the music bucket (default to the `R2_*` values) |
| `REEL_POLL_MS`, `REEL_MAX_ATTEMPTS`, `REEL_STALE_MINUTES`, `REEL_WORK_DIR` | Optional tuning |

Keep the output bucket listing-disabled; object keys include the unguessable reel id.

## Develop

```bash
npm install
npm test          # unit tests + a golden render (needs ffmpeg/ffprobe; skipped without)
npm run typecheck
```

Not supported yet: HEIC inputs (convert before upload; the app already does), video clips, AI selection.
