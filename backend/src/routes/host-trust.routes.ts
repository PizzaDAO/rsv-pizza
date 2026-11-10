/**
 * Host trust routes (plans/trusted-hosts.md phase 1: read-only report + settings).
 *
 * Mounted at /api/admin/host-trust (before the /api/admin catch-all):
 *   GET  /               report of hosts: tier, score, reasons, blockers, today's Fast Pass (payment admin;
 *                        404 until the `host_trust.report_enabled` setting is on)
 *   GET  /:userId        one host, with a per-party table (same gates)
 *   GET  /settings       settings registry + current values + recent audit (super admin)
 *   PUT  /settings       change ONE setting { key, value, note? } (super admin; stricter-only rules)
 *
 * Nothing here approves, pays, or changes a budget or a host's view.
 */
import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, isPaymentAdmin, isSuperAdmin, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { checkSettingChange, readSettings, writeSetting } from '../lib/appSettings.js';
import { HOST_TRUST_SETTINGS, HOST_TRUST_SETTING_BY_KEY, getHostTrustConfig } from '../lib/hostTrustSettings.js';
import { MAX_REPORT_PAGE, listHostCandidates, loadHostTrustRows, type HostTrustRow } from '../services/hostTrust.service.js';

const router = Router();
router.use(requireAuth);

async function requirePaymentAdmin(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (!(await isPaymentAdmin(req.userEmail))) throw new AppError('Payments admin access required', 403, 'FORBIDDEN');
    next();
  } catch (err) {
    next(err);
  }
}

async function requireSuperAdmin(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (!(await isSuperAdmin(req.userEmail))) throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    next();
  } catch (err) {
    next(err);
  }
}

function serializeRow(r: HostTrustRow, withParties: boolean) {
  return {
    userId: r.userId,
    name: r.name,
    email: r.email,
    tier: r.trust.tier,
    score: r.trust.score,
    reasons: r.trust.reasons,
    gates: r.trust.gates,
    blockers: r.trust.blockers,
    verifiedParties: r.trust.verifiedParties,
    verifiedPartiesRaw: r.trust.verifiedPartiesRaw,
    completedParties: r.trust.completedParties,
    accountAgeDays: r.trust.accountAgeDays,
    medianTurnout: r.trust.medianTurnout,
    turnoutParties: r.trust.turnoutParties,
    pizzadao: r.trust.pizzadao,
    todayTier: r.todayTier,
    disagrees: r.disagrees,
    ...(withParties ? { parties: r.parties } : {}),
  };
}

// ---------------------------------------------------------------- settings (super admin)
router.get('/settings', requireSuperAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const snap = await readSettings(HOST_TRUST_SETTINGS);
    const audit = await prisma.appConfigAudit.findMany({
      where: { key: { in: HOST_TRUST_SETTINGS.map((d) => d.key) } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.set('Cache-Control', 'private, no-store');
    res.json({
      readFailed: snap.readFailed,
      settings: HOST_TRUST_SETTINGS.map((d) => ({
        key: d.key,
        area: d.area,
        label: d.label,
        help: d.help,
        min: d.min,
        max: d.max,
        default: d.default,
        unit: d.unit ?? null,
        stricterOnly: !!d.stricterOnly,
        looserWhen: d.looserWhen ?? null,
        value: snap.values[d.key].value,
        source: snap.values[d.key].source,
      })),
      audit: audit.map((a) => ({
        key: a.key,
        oldValue: a.oldValue,
        newValue: a.newValue,
        actorEmail: a.actorEmail,
        note: a.note,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', requireSuperAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { key, value, note } = (req.body ?? {}) as { key?: unknown; value?: unknown; note?: unknown };
    const def = typeof key === 'string' ? HOST_TRUST_SETTING_BY_KEY[key] : undefined;
    if (!def) throw new AppError('Unknown setting', 400, 'UNKNOWN_SETTING');
    const noteStr = typeof note === 'string' ? note.trim().slice(0, 500) : null;

    const snap = await readSettings([def]);
    if (snap.readFailed) throw new AppError('Could not read the current value; try again', 503, 'READ_FAILED');
    const current = snap.values[def.key].value;

    const check = checkSettingChange(def, current, value, noteStr);
    if (!check.ok) throw new AppError(check.message, 400, check.code);
    if (value === current) return res.json({ ok: true, unchanged: true, value: current });

    await writeSetting(def, current, value as number, req.userEmail ?? 'unknown', noteStr || null);
    res.json({ ok: true, value, loosening: check.loosening });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- report (payment admin)
async function requireReportEnabled(_req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const { config } = await getHostTrustConfig();
    if (!config.reportEnabled) throw new AppError('Not found', 404, 'NOT_FOUND');
    next();
  } catch (err) {
    next(err);
  }
}

/** Lets the page decide whether to show the link without a 404 in the console. Never 404s. */
router.get('/enabled', requirePaymentAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { config } = await getHostTrustConfig();
    res.set('Cache-Control', 'private, no-store');
    res.json({ enabled: config.reportEnabled });
  } catch (err) {
    next(err);
  }
});

router.get('/', requirePaymentAdmin, requireReportEnabled, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const { config } = await getHostTrustConfig();
    const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);
    const limit = Math.min(MAX_REPORT_PAGE, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : undefined;
    const tier = typeof req.query.tier === 'string' ? req.query.tier : undefined;

    const { hosts, total } = await listHostCandidates({ q, offset, limit }, now);
    const rows = await loadHostTrustRows(hosts.map((h) => h.userId), config, now, { scoreFakeRisk: true });
    const byId = new Map(rows.map((r) => [r.userId, r]));
    // Keep the candidate order (name asc); the tier filter applies to this page only.
    const ordered = hosts.map((h) => byId.get(h.userId)).filter((r): r is HostTrustRow => !!r);
    const filtered = tier ? ordered.filter((r) => r.trust.tier === tier) : ordered;

    res.set('Cache-Control', 'private, no-store');
    res.json({
      generatedAt: now.toISOString(),
      total,
      offset,
      limit,
      hasMore: offset + hosts.length < total,
      hosts: filtered.map((r) => serializeRow(r, false)),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:userId', requirePaymentAdmin, requireReportEnabled, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const { config } = await getHostTrustConfig();
    const [row] = await loadHostTrustRows([String(req.params.userId)], config, now, { scoreFakeRisk: true });
    if (!row) throw new AppError('Host not found', 404, 'NOT_FOUND');
    res.set('Cache-Control', 'private, no-store');
    res.json({ generatedAt: now.toISOString(), host: serializeRow(row, true) });
  } catch (err) {
    next(err);
  }
});

export default router;
