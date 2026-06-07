/**
 * provola-58505 (Step 2): cron entrypoint for the moltobene city-group sync.
 *
 *   GET /api/cron/sync-telegram-groups
 *     Vercel-cron entrypoint, gated by `Authorization: Bearer ${CRON_SECRET}`
 *     (same shape as the reminder/survey crons). Runs
 *     `syncCityGroupsFromMoltobene()` and ALWAYS returns 200 — a cron failure
 *     should not surface as a non-2xx (Vercel retries), and the sync itself is
 *     non-throwing.
 *
 * The admin-triggered variant lives on the telegram router
 * (`POST /api/underboss/telegram/sync-from-moltobene`).
 */
import { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { syncCityGroupsFromMoltobene } from '../services/moltobeneSync.js';

const router = Router();

router.get('/cron/sync-telegram-groups', async (req: Request, res: Response) => {
  // Gate on the shared cron secret (constant-time compare).
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[provola-58505] CRON_SECRET not configured — refusing to run moltobene sync');
    // Always 200 so Vercel doesn't retry a config gap.
    return res.status(200).json({ ok: false, reason: 'CRON_SECRET not configured' });
  }
  const authHeader = req.headers.authorization || '';
  const expected = `Bearer ${cronSecret}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  const authed = a.length === b.length && timingSafeEqual(a, b);
  if (!authed) {
    // Unauthorized callers DO get a 401 (matches reminder cron); only genuine
    // run failures are masked behind 200 below.
    return res.status(401).json({ ok: false, reason: 'Unauthorized' });
  }

  try {
    const result = await syncCityGroupsFromMoltobene();
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[provola-58505] moltobene sync cron error:', err?.message || err);
    return res.status(200).json({ ok: false, reason: err?.message || 'sync failed' });
  }
});

export default router;
