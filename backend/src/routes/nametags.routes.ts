/**
 * Member name tags (plans/marinara-32633). Mounted at /api/parties (before partyRoutes), and
 * nametagsAdminRouter at /api/admin/nametags (super admin).
 *
 * GET /:partyId/nametags/status  -> { available }   (guests-tab permission)
 *   available = the global `nametags.scope` setting allows this party.
 * GET /:partyId/nametags         -> { memberLookup: 'ok' | 'unavailable' | 'disabled', members: { [guestId]: member } }
 *   Guests tab permission (tags expose the guest list). Only hashes and wallets go to pizzadao.org;
 *   the response carries NO emails, wallets or guest names. A lookup failure answers 200 'unavailable'
 *   (every tag prints plain). `private, no-store`.
 */
import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, isSuperAdmin, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { isUuid } from '../lib/guestToken.js';
import { canUserAccessTab } from '../helpers/partyAccess.js';
import { checkSettingChange, readSettings, writeSetting } from '../lib/appSettings.js';
import { NAMETAG_SETTINGS, getNametagConfig, scopeAllows } from '../lib/nametagSettings.js';
import { lookupNametagMembers } from '../services/pizzadaoNametags.js';
import { assignMembers, collectIdentifiers } from '../lib/nametagMerge.js';

const router = Router();

async function authorize(req: AuthRequest, partyId: string) {
  if (!isUuid(partyId)) throw new AppError('Invalid party id', 400, 'BAD_REQUEST');
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { id: true, eventSeriesId: true, eventType: true, cancelledAt: true },
  });
  if (!party) throw new AppError('Party not found', 404, 'NOT_FOUND');
  if (!(await canUserAccessTab(partyId, req.userEmail, req.userId, 'guests'))) {
    throw new AppError('Guests access required', 403, 'FORBIDDEN');
  }
  return party;
}

router.get('/:partyId/nametags/status', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const party = await authorize(req, req.params.partyId as string);
    const cfg = await getNametagConfig();
    res.set('Cache-Control', 'private, no-store');
    res.json({ available: scopeAllows(cfg.scope, party) });
  } catch (err) {
    next(err);
  }
});

router.get('/:partyId/nametags', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const partyId = req.params.partyId as string;
    const party = await authorize(req, partyId);
    res.set('Cache-Control', 'private, no-store');
    const cfg = await getNametagConfig();
    if (!scopeAllows(cfg.scope, party)) return res.json({ memberLookup: 'disabled', members: {} });

    const guests = await prisma.guest.findMany({
      where: { partyId },
      select: { id: true, email: true, ethereumAddress: true, submittedAt: true, approved: true },
    });
    const ids = collectIdentifiers(guests);
    const matches = await lookupNametagMembers(ids, { maxIdentifiers: cfg.maxIdentifiers });
    if (matches === null) return res.json({ memberLookup: 'unavailable', members: {} });
    res.json({ memberLookup: 'ok', members: assignMembers(guests, matches) });
  } catch (err) {
    next(err);
  }
});

export const nametagsAdminRouter = Router();
nametagsAdminRouter.use(requireAuth);

async function requireSuperAdmin(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (!(await isSuperAdmin(req.userEmail))) throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    next();
  } catch (err) {
    next(err);
  }
}

nametagsAdminRouter.get('/settings', requireSuperAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const snap = await readSettings(NAMETAG_SETTINGS);
    res.set('Cache-Control', 'private, no-store');
    res.json({
      readFailed: snap.readFailed,
      settings: NAMETAG_SETTINGS.map((d) => ({
        key: d.key,
        label: d.label,
        help: d.help,
        min: d.min,
        max: d.max,
        default: d.default,
        value: snap.values[d.key].value,
        source: snap.values[d.key].source,
      })),
    });
  } catch (err) {
    next(err);
  }
});

nametagsAdminRouter.put('/settings', requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { key, value, note } = (req.body ?? {}) as { key?: unknown; value?: unknown; note?: unknown };
    const def = NAMETAG_SETTINGS.find((d) => d.key === key);
    if (!def) throw new AppError('Unknown setting', 400, 'UNKNOWN_SETTING');
    const noteStr = typeof note === 'string' ? note.trim().slice(0, 500) : null;
    const snap = await readSettings([def]);
    if (snap.readFailed) throw new AppError('Could not read the current value; try again', 503, 'READ_FAILED');
    const current = snap.values[def.key].value;
    const check = checkSettingChange(def, current, value, noteStr);
    if (!check.ok) throw new AppError(check.message, 400, check.code);
    if (value === current) return res.json({ ok: true, unchanged: true, value: current });
    await writeSetting(def, value as number, req.userEmail ?? 'unknown', noteStr || null);
    res.json({ ok: true, value });
  } catch (err) {
    next(err);
  }
});

export default router;
