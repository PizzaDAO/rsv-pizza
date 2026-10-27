/**
 * Host fast pass routes.
 *
 * Admin router (mounted at /api/admin/host-fast-pass, before the /api/admin
 * catch-all): payment_admin / admin / super_admin only.
 *   GET  /party/:partyId/review   track record + red flags + checklist
 *   POST /party/:partyId/approve  pre-approve a budget (does NOT pay anything)
 *   POST /party/:partyId/revoke
 *
 * Host router (mounted at /api/parties):
 *   GET  /:partyId/fast-pass      badge progress + the approved budget.
 *                                 Never includes red flags or issue details.
 *
 * No route here creates, approves or executes a payout. Payouts still go
 * through the normal admin payout flow.
 */
import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, isPaymentAdmin, isFullAdmin, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty } from '../helpers/partyAccess.js';
import { BUDGET_CATEGORIES } from './budget.routes.js';
import { FAST_PASS_THRESHOLDS, decideApproval, toHostView } from '../lib/hostTrackRecord.js';
import { isSelfInterested, loadHostTrackRecord, loadReviewAssist } from '../services/hostFastPass.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_APPROVED_USD = 5000;
const MAX_DEADLINE_DAYS = 90;

async function requirePaymentAdmin(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (!(await isPaymentAdmin(req.userEmail))) {
      throw new AppError('Payments admin access required', 403, 'FORBIDDEN');
    }
    next();
  } catch (err) {
    next(err);
  }
}

function serializeApproval(a: {
  approvedAmountUsd: unknown;
  covers: string[];
  receiptDeadline: Date;
  basis: string;
  approvedAt: Date;
}) {
  return {
    approvedAmountUsd: Number(a.approvedAmountUsd),
    covers: a.covers,
    receiptDeadline: a.receiptDeadline.toISOString(),
    basis: a.basis,
    approvedAt: a.approvedAt.toISOString(),
  };
}

// ---------------------------------------------------------------- admin
export const adminFastPassRouter = Router();
adminFastPassRouter.use(requireAuth, requirePaymentAdmin);

adminFastPassRouter.get('/party/:partyId/review', async (req: AuthRequest, res, next) => {
  try {
    const result = await loadReviewAssist(req.params.partyId);
    if (!result) throw new AppError('Party or host not found', 404, 'NOT_FOUND');
    const approval = await prisma.hostFastPassApproval.findUnique({
      where: { partyId: req.params.partyId },
    });
    const selfBlocked = await isSelfInterested(req.params.partyId, req.userId, req.userEmail);
    // Same rules as approve (note assumed present) so the UI can explain a block up front.
    const decision = decideApproval({
      track: result.track,
      review: result.review,
      eligibleForFastPass: result.eligibleForFastPass,
      capUsd: result.capUsd,
      amountUsd: null,
      selfInterested: selfBlocked,
      actorEmail: req.userEmail ?? '',
      actorIsFullAdmin: await isFullAdmin(req.userEmail),
      note: 'preview',
    });
    res.json({
      selfBlocked,
      decision: decision.ok
        ? { allowed: true, basis: decision.basis, requiresNote: decision.requiresNote }
        : { allowed: false, code: decision.code, message: decision.message, requiresNote: decision.requiresNote },
      hostEmail: result.hostEmail,
      track: result.track,
      review: result.review,
      capUsd: result.capUsd,
      eligibleForFastPass: result.eligibleForFastPass,
      approval: approval && !approval.revokedAt ? serializeApproval(approval) : null,
      thresholds: FAST_PASS_THRESHOLDS,
    });
  } catch (err) {
    next(err);
  }
});

adminFastPassRouter.post('/party/:partyId/approve', async (req: AuthRequest, res, next) => {
  try {
    const { partyId } = req.params;
    const amount = Number(req.body?.amountUsd);
    const covers: unknown = req.body?.covers;
    const note: string | undefined =
      typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : undefined;

    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_APPROVED_USD) {
      throw new AppError(`amountUsd must be between 0 and ${MAX_APPROVED_USD}`, 400, 'INVALID_AMOUNT');
    }
    if (
      !Array.isArray(covers) ||
      covers.length === 0 ||
      !covers.every((c) => (BUDGET_CATEGORIES as readonly string[]).includes(c))
    ) {
      throw new AppError('covers must be a non-empty list of budget categories', 400, 'INVALID_COVERS');
    }

    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, date: true, userId: true, cancelledAt: true },
    });
    if (!party?.userId) throw new AppError('Party not found', 404, 'NOT_FOUND');
    if (party.cancelledAt) throw new AppError('Party is cancelled', 400, 'PARTY_CANCELLED');

    const result = await loadReviewAssist(partyId);
    if (!result) throw new AppError('Party or host not found', 404, 'NOT_FOUND');

    const decision = decideApproval({
      track: result.track,
      review: result.review,
      eligibleForFastPass: result.eligibleForFastPass,
      capUsd: result.capUsd,
      amountUsd: amount,
      selfInterested: await isSelfInterested(partyId, req.userId, req.userEmail),
      actorEmail: req.userEmail ?? '',
      actorIsFullAdmin: await isFullAdmin(req.userEmail),
      note,
    });
    if (!decision.ok) throw new AppError(decision.message, decision.status, decision.code);
    const basis = decision.basis;

    // Receipt deadline: default party date + 14d; clamp to [now, party date + 90d].
    const now = new Date();
    const anchor = party.date ?? now;
    const maxDeadline = new Date(anchor.getTime() + MAX_DEADLINE_DAYS * DAY_MS);
    const requestedDeadline = req.body?.receiptDeadline ? new Date(req.body.receiptDeadline) : null;
    let receiptDeadline =
      requestedDeadline && !Number.isNaN(requestedDeadline.getTime())
        ? requestedDeadline
        : new Date(anchor.getTime() + FAST_PASS_THRESHOLDS.receiptDeadlineDays * DAY_MS);
    if (receiptDeadline < now) receiptDeadline = now;
    if (receiptDeadline > maxDeadline) receiptDeadline = maxDeadline;

    const data = {
      approvedAmountUsd: amount,
      covers: covers as string[],
      receiptDeadline,
      basis,
      note: note ?? null,
      approvedByEmail: req.userEmail!,
      approvedAt: new Date(),
      revokedAt: null,
      revokedByEmail: null,
    };
    const approval = await prisma.hostFastPassApproval.upsert({
      where: { partyId },
      create: { partyId, ...data },
      update: data,
    });
    res.json({ approval: serializeApproval(approval) });
  } catch (err) {
    next(err);
  }
});

adminFastPassRouter.post('/party/:partyId/revoke', async (req: AuthRequest, res, next) => {
  try {
    const existing = await prisma.hostFastPassApproval.findUnique({ where: { partyId: req.params.partyId } });
    if (!existing || existing.revokedAt) throw new AppError('No active approval', 404, 'NOT_FOUND');
    await prisma.hostFastPassApproval.update({
      where: { partyId: req.params.partyId },
      data: { revokedAt: new Date(), revokedByEmail: req.userEmail! },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------- host
export const hostFastPassRouter = Router();
// Path-scoped: this router is mounted at /api/parties beside many others, so an
// unconditioned router.use(requireAuth) would gate every /api/parties/* request.
hostFastPassRouter.use('/:partyId/fast-pass', requireAuth);

hostFastPassRouter.get('/:partyId/fast-pass', async (req: AuthRequest, res, next) => {
  try {
    const { partyId } = req.params;
    if (!(await canUserEditParty(partyId, req.userId, req.userEmail))) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }
    const party = await prisma.party.findUnique({ where: { id: partyId }, select: { userId: true } });
    if (!party?.userId) throw new AppError('Party not found', 404, 'NOT_FOUND');

    const loaded = await loadHostTrackRecord(party.userId);
    const approval = await prisma.hostFastPassApproval.findUnique({ where: { partyId } });
    res.json({
      track: loaded ? toHostView(loaded.track) : null,
      approval: approval && !approval.revokedAt ? serializeApproval(approval) : null,
      thresholds: FAST_PASS_THRESHOLDS,
    });
  } catch (err) {
    next(err);
  }
});
