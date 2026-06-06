/**
 * arancini-58492: Natural-language Event Assistant route.
 *
 * Mounted at `/api/parties` (alongside the many sibling routers). Endpoint:
 *   POST /:id/assistant   Propose a structured patch from a plain-English instruction.
 *
 * SAFETY: this endpoint NEVER writes to the DB. It returns a *candidate* diff;
 * the frontend applies the host-accepted subset through the existing trusted
 * PATCH /api/parties/:id path (which enforces auth, field-level authorization,
 * validation, whitelists, and webhooks).
 *
 * Auth: path-scoped `requireAuth` on `/:id/assistant` ONLY (an unconditioned
 * `router.use` here would gate every /api/parties/* request — see the payout
 * router for the same footgun). `canUserEditParty` gates access (404 if not).
 * Party approval is NOT required.
 */

import { Router, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth, AuthRequest, isAdmin, isSuperAdmin, isPaymentAdmin, isUnderboss } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty } from '../helpers/partyAccess.js';
import { prisma } from '../config/database.js';
import { runEventAssistant, type AssistantHistoryTurn } from '../services/eventAssistant.service.js';
import type { RequesterRole } from '../lib/eventEditSchema.js';

const router = Router();

// Test rollout: Event Assistant is enabled only for these event slugs
// (matched against customUrl OR inviteCode). Add slugs here to widen, or
// remove the gate entirely to enable for all hosts.
const ASSISTANT_ENABLED_SLUGS = new Set(['philadelphia']);

// Path-scope auth on /:id/assistant ONLY. Do NOT use an unconditioned
// router.use — it would gate every /api/parties/* request.
router.use('/:id/assistant', requireAuth);

const MAX_INSTRUCTION_LEN = 2000;

// Rate limit OpenAI usage: 30 calls/hour/user, keyed by userId (falls back to IP).
const assistantLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: 'Event Assistant rate limit reached (30/hour). Please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => {
    const auth = req as AuthRequest;
    return auth.userId || req.ip || 'unknown';
  },
});

router.post(
  '/:id/assistant',
  assistantLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { instruction, conversationHistory } = req.body || {};

      if (typeof instruction !== 'string' || instruction.trim().length === 0) {
        throw new AppError('instruction is required', 400, 'MISSING_INSTRUCTION');
      }
      if (instruction.length > MAX_INSTRUCTION_LEN) {
        throw new AppError(
          `instruction must be ${MAX_INSTRUCTION_LEN} characters or fewer`,
          400,
          'INSTRUCTION_TOO_LONG',
        );
      }

      const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
      if (!canEdit) {
        throw new AppError('Party not found', 404, 'NOT_FOUND');
      }

      // Test rollout gate: the Event Assistant is only enabled for an allowlist
      // of event slugs (currently just Philadelphia). Short-circuit with the
      // same NOT_FOUND shape BEFORE any OpenAI work runs so non-allowlisted
      // parties never reach the rate-limited LLM call. `/philadelphia` resolves
      // by inviteCode first, then customUrl, so we match either (case-insensitive).
      const slugRow = await prisma.party.findUnique({
        where: { id },
        select: { customUrl: true, inviteCode: true },
      });
      const cu = slugRow?.customUrl?.toLowerCase();
      const ic = slugRow?.inviteCode?.toLowerCase();
      const assistantEnabled =
        (!!cu && ASSISTANT_ENABLED_SLUGS.has(cu)) || (!!ic && ASSISTANT_ENABLED_SLUGS.has(ic));
      if (!assistantEnabled) {
        throw new AppError('Party not found', 404, 'NOT_FOUND');
      }

      // Determine catalog filtering role. "admin" unlocks admin-only proposable
      // fields (reimbursement_cap_usd, tax_form_required). We grant it to the
      // same roles that can actually WRITE those fields via PATCH: admin /
      // super_admin / payment_admin / underboss. Everyone else is a "host".
      const isAdminRole =
        (await isSuperAdmin(req.userEmail)) ||
        (await isAdmin(req.userEmail)) ||
        (await isPaymentAdmin(req.userEmail)) ||
        (await isUnderboss(req.userEmail));
      const role: RequesterRole = isAdminRole ? 'admin' : 'host';

      const history: AssistantHistoryTurn[] = Array.isArray(conversationHistory)
        ? conversationHistory
            .filter(
              (t: any) =>
                t &&
                (t.role === 'user' || t.role === 'assistant') &&
                typeof t.content === 'string',
            )
            .map((t: any) => ({ role: t.role, content: t.content }))
        : [];

      const result = await runEventAssistant({
        partyId: id,
        instruction,
        role,
        conversationHistory: history,
      });

      // gricia-58502: best-effort query/result log. NEVER fail the request on a
      // logging error — wrap the insert and swallow any failure. `proposalId`
      // is the created row id (or null if the insert failed) so the frontend
      // can later report accepted/rejected keys + apply outcome via /feedback.
      let proposalId: string | null = null;
      try {
        const logRow = await prisma.eventAssistantLog.create({
          data: {
            partyId: id,
            userId: req.userId ?? null,
            instruction,
            history: history.length > 0 ? (history as unknown as object) : undefined,
            proposedChanges: result.proposedChanges as unknown as object,
            clarifyingQuestion: result.clarifyingQuestion ?? null,
            model: result.model,
            promptTokens: result.usage.promptTokens ?? null,
            completionTokens: result.usage.completionTokens ?? null,
            latencyMs: result.latencyMs,
          },
          select: { id: true },
        });
        proposalId = logRow.id;
      } catch (logErr) {
        console.error('[eventAssistant] failed to write proposal log (continuing):', logErr);
      }

      res.json({
        assistantMessage: result.assistantMessage,
        clarifyingQuestion: result.clarifyingQuestion,
        proposedChanges: result.proposedChanges,
        proposalId,
      });
    } catch (error) {
      next(error);
    }
  },
);

// gricia-58502: feedback endpoint. The frontend reports which proposed keys the
// host accepted/rejected and whether the apply (trusted PATCH) succeeded. Same
// guards as the assistant route: path-scoped requireAuth (above) + canUserEditParty
// + the Philadelphia ASSISTANT_ENABLED_SLUGS gate. Everything is best-effort: a
// missing/foreign proposalId is a 204 no-op (never a 500), and the update is
// wrapped so logging never breaks the host's flow.
const MAX_APPLY_ERROR_LEN = 1000;

router.post(
  '/:id/assistant/feedback',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { proposalId, acceptedKeys, rejectedKeys, applied, error } = req.body || {};

      if (typeof proposalId !== 'string' || proposalId.trim().length === 0) {
        // Nothing to attribute the feedback to — no-op.
        return res.status(204).end();
      }

      const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
      if (!canEdit) {
        throw new AppError('Party not found', 404, 'NOT_FOUND');
      }

      // Same test-rollout gate as the assistant route.
      const slugRow = await prisma.party.findUnique({
        where: { id },
        select: { customUrl: true, inviteCode: true },
      });
      const cu = slugRow?.customUrl?.toLowerCase();
      const ic = slugRow?.inviteCode?.toLowerCase();
      const assistantEnabled =
        (!!cu && ASSISTANT_ENABLED_SLUGS.has(cu)) || (!!ic && ASSISTANT_ENABLED_SLUGS.has(ic));
      if (!assistantEnabled) {
        throw new AppError('Party not found', 404, 'NOT_FOUND');
      }

      // Best-effort update — never throw a 500 from here.
      try {
        const logRow = await prisma.eventAssistantLog.findUnique({
          where: { id: proposalId },
          select: { id: true, partyId: true },
        });
        // No such row, or it belongs to a different party → silent no-op.
        if (!logRow || logRow.partyId !== id) {
          return res.status(204).end();
        }

        const isApplied = applied === true;
        const applyError =
          typeof error === 'string' && error.length > 0
            ? error.slice(0, MAX_APPLY_ERROR_LEN)
            : null;

        await prisma.eventAssistantLog.update({
          where: { id: proposalId },
          data: {
            acceptedKeys: Array.isArray(acceptedKeys) ? (acceptedKeys as unknown as object) : undefined,
            rejectedKeys: Array.isArray(rejectedKeys) ? (rejectedKeys as unknown as object) : undefined,
            applied: isApplied,
            applyError,
            appliedAt: isApplied ? new Date() : null,
          },
        });
      } catch (updateErr) {
        console.error('[eventAssistant] failed to write feedback (continuing):', updateErr);
      }

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
