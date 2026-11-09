/**
 * sfincione-40417 (submissions): PUBLIC receipt submission endpoints, mounted at
 * /api/pizza-index/submissions (before the public aggregates router). Anonymous callers are
 * allowed; a logged-in caller is recorded as submitter_user_id.
 *
 * File bytes never pass through Express (Vercel's 4.5 MB body limit): the browser uploads
 * straight to the private bucket with a signed upload token, then POSTs the metadata.
 *
 *   POST /upload-url  { mimeType, fileSize }            -> { path, token }
 *   POST /            { path, receiptDate, merchant, city, country, sizeNote?, email?, website }
 *                                                        -> { id, status: 'pending' }
 *
 * Anti-abuse: kill switch (app_config pizza_index.submissions_enabled), honeypot `website`
 * (filled -> silent success, nothing stored), 3/hour + 10/day per IP, 300 pending globally.
 * Responses never contain storage paths, URLs or emails.
 */
import { Router, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import {
  HONEYPOT_FIELD,
  cleanupOrphanedUploads,
  createUploadUrl,
  finalizeSubmission,
  submissionsEnabled,
} from '../services/pizzaSubmission.service.js';

const router = Router();
export const pizzaSubmissionCronRouter = Router();

// Upload URLs are the cheap step, so cap them per IP too (finalize enforces the real 3/hr, 10/day).
const uploadUrlLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  message: { error: { message: 'Too many uploads, try again later.', code: 'RATE_LIMITED' } },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

async function requireOpen(_req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (!(await submissionsEnabled())) throw new AppError('Receipt submissions are closed right now.', 503, 'SUBMISSIONS_CLOSED');
    next();
  } catch (err) {
    next(err);
  }
}

router.post('/upload-url', uploadUrlLimiter, requireOpen, optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const out = await createUploadUrl(req.userId ?? null, body.mimeType, body.fileSize, req.ip);
    res.set('Cache-Control', 'no-store');
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireOpen, optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.set('Cache-Control', 'no-store');
    // Honeypot: bots fill every field. Look like a success, store nothing.
    const trap = body[HONEYPOT_FIELD];
    if (typeof trap === 'string' && trap.trim() !== '') {
      return res.status(201).json({ id: 'received', status: 'pending' });
    }
    const out = await finalizeSubmission({
      userId: req.userId ?? null,
      userEmail: req.userEmail ?? null,
      body,
      ip: req.ip,
    });
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
});

// Daily cleanup of orphaned uploads (CRON_SECRET gate, same as the other /api/cron routes).
// Vercel crons call with GET; POST is accepted for manual runs.
async function runCleanup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || (req.headers.authorization || '') !== `Bearer ${cronSecret}`) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }
    res.json(await cleanupOrphanedUploads());
  } catch (err) {
    next(err);
  }
}
pizzaSubmissionCronRouter.get('/cleanup-pizza-submissions', runCleanup);
pizzaSubmissionCronRouter.post('/cleanup-pizza-submissions', runCleanup);

// GET /status -> { open }: lets the public page hide the Submit button while the kill switch is off.
router.get('/status', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ open: await submissionsEnabled() });
  } catch (err) {
    next(err);
  }
});

export default router;
