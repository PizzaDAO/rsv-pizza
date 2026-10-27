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
import { requireAuth, isPaymentAdmin, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty } from '../helpers/partyAccess.js';
import { BUDGET_CATEGORIES } from './budget.routes.js';
import { FAST_PASS_THRESHOLDS, toHostView } from '../lib/hostTrackRecord.js';
import { loadHostTrackRecord, loadReviewAssist } from '../services/hostFastPass.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_APPROVED_USD = 5000;

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
    res.json({
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

    // Segregation of duties: nobody pre-approves their own party's budget.
    const host = await prisma.user.findUnique({ where: { id: party.userId }, select: { email: true } });
    if (host && req.userEmail && host.email.toLowerCase() === req.userEmail.toLowerCase()) {
      throw new AppError('You cannot pre-approve your own party', 403, 'SELF_APPROVAL');
    }

    const result = await loadReviewAssist(partyId);
    if (!result) throw new AppError('Party or host not found', 404, 'NOT_FOUND');

    // Not Fast Pass eligible: allowed only as an explicit manual review with a
    // written note, and never when a high-severity flag is open.
    let basis: 'fast_pass' | 'manual_review' = 'fast_pass';
    if (!result.eligibleForFastPass) {
      if (!note) {
        throw new AppError('Host is not Fast Pass eligible: a review note is required', 400, 'NOTE_REQUIRED');
      }
      if (result.review.riskLevel === 'high') {
        throw new AppError('High-risk flags are open on this host; resolve them first', 409, 'HIGH_RISK');
      }
      basis = 'manual_review';
    }
    if (result.capUsd != null && amount > result.capUsd) {
      throw new AppError(`Amount exceeds the party reimbursement cap ($${result.capUsd})`, 400, 'OVER_CAP');
    }

    const requestedDeadline = req.body?.receiptDeadline ? new Date(req.body.receiptDeadline) : null;
    const receiptDeadline =
      requestedDeadline && !Number.isNaN(requestedDeadline.getTime())
        ? requestedDeadline
        : new Date((party.date ?? new Date()).getTime() + FAST_PASS_THRESHOLDS.receiptDeadlineDays * DAY_MS);

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
hostFastPassRouter.use(requireAuth);

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
