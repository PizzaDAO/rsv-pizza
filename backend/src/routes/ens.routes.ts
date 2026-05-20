/**
 * ENS resolution utility endpoint.
 *
 * Added by taleggio-30219 to back the PayoutMethodPicker's live-preview
 * UX ("→ 0x1234…abcd"). Mounted at /api/ens (see backend/src/index.ts).
 *
 * Auth-optional, IP rate-limited. ENS lookups are cheap but we don't want
 * to be a free public RPC.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { looksLikeEnsName, resolveEns } from '../services/ens.service.js';

const router = Router();

// 60 calls/hour/IP — generous for normal UI usage, cheap to enforce.
const ensResolveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { error: 'ENS resolve rate limit reached (60/hour). Please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

router.get('/resolve', ensResolveLimiter, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    const name = String(req.query.name ?? '').trim();
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!looksLikeEnsName(name)) {
      return res.status(400).json({ error: 'not an ENS-shaped name' });
    }
    const addr = await resolveEns(name);
    return res.json({ address: addr });
  } catch (err: any) {
    return res.status(404).json({ error: err?.message || 'Could not resolve ENS name' });
  }
});

export default router;
