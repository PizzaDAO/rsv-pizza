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

      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
