/**
 * Admin party-management routes (fontina-91827).
 *
 * Mounted at `/api/admin/parties` (see backend/src/index.ts — registered
 * BEFORE the generic `/api/admin` catch-all so it isn't shadowed).
 *
 * Auth model:
 *  - All endpoints require `requireAuth` + admin/super_admin/payment_admin
 *    via `isPaymentAdmin` (mirrors admin-payout.routes.ts gate).
 *
 * Today's endpoints:
 *  - POST /:partyId/transfer-ownership — atomically reassign `parties.user_id`
 *    from one User to another, scrub the old owner from `co_hosts`, delete
 *    their `party_payment_opt_ins` row, and canonicalize the new owner in the
 *    cohost array. Audit row written to `deletion_log` when that table's
 *    Prisma model is available; otherwise the same payload is `console.warn`-ed
 *    for log retention.
 */
import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../config/database.js';
import {
  requireAuth,
  AuthRequest,
  isPaymentAdmin,
} from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

const router = Router();

/**
 * Middleware: allow admin / super_admin / payment_admin only.
 * Mirrors the gate in admin-payout.routes.ts. payment_admin qualifies because
 * they manage payment-routing concerns (the new owner inherits the prepay
 * candidate / payment-opt-in surface).
 */
async function requireAnyAdminOrPaymentAdmin(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) {
  try {
    if (!(await isPaymentAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/parties/:partyId/owner
 *
 * Lightweight admin lookup that returns the current primary-host email + name
 * for a party. Used by TransferOwnershipModal so the admin UI can render
 * "Currently owned by X (email)" without requiring the host-side cohosts/full
 * endpoint (which is gated by canUserEditParty — an admin who is not also the
 * host wouldn't qualify on every party).
 */
router.get(
  '/:partyId/owner',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { partyId } = req.params;
      const party = await prisma.party.findUnique({
        where: { id: partyId },
        select: {
          id: true,
          userId: true,
          user: { select: { id: true, email: true, name: true } },
        },
      });
      if (!party) {
        throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
      }
      res.json({
        partyId: party.id,
        ownerId: party.userId,
        ownerEmail: party.user?.email ?? null,
        ownerName: party.user?.name ?? null,
      });
    } catch (err) {
      next(err);
    }
  },
);

interface TransferOwnershipBody {
  newOwnerEmail?: unknown;
  removeOldFromCoHosts?: unknown;
  deleteOldOptIn?: unknown;
  note?: unknown;
}

interface CoHostEntry {
  id?: string;
  name?: string | null;
  email?: string | null;
  canEdit?: boolean;
  showOnEvent?: boolean;
  [key: string]: unknown;
}

/**
 * POST /api/admin/parties/:partyId/transfer-ownership
 *
 * Body:
 *   {
 *     newOwnerEmail: string;
 *     removeOldFromCoHosts?: boolean (default true);
 *     deleteOldOptIn?: boolean (default true);
 *     note?: string;
 *   }
 *
 * Behavior (all in a single $transaction so partial failures roll back):
 *   1. Look up party → 404 if missing.
 *   2. Lookup new owner User by email (case-insensitive) → 400 NEW_OWNER_NOT_FOUND.
 *   3. Reject same-owner no-op → 400 SAME_OWNER.
 *   4. Update parties.user_id = newOwner.id.
 *   5. Mutate parties.co_hosts JSONB:
 *        - filter out old-owner entries by email (case-insensitive) when
 *          removeOldFromCoHosts (default true);
 *        - ensure the new owner has an entry with canEdit:true,
 *          showOnEvent:true (append if missing, force flags if present).
 *   6. Delete party_payment_opt_ins row for {partyId, oldOwnerId} when
 *      deleteOldOptIn (default true).
 *   7. Write an audit row to deletion_log (raw SQL — Prisma model is not
 *      exposed in schema.prisma) with table_name='parties.user_id',
 *      record_id=partyId, record_data={old,new owner ids+emails},
 *      deleted_by=actorEmail, context='Ownership transfer[: <note>]'.
 *      On audit failure we console.warn but do NOT roll back the transfer —
 *      audit-best-effort matches how the rest of the codebase treats
 *      deletion_log writes.
 */
router.post(
  '/:partyId/transfer-ownership',
  requireAuth,
  requireAnyAdminOrPaymentAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { partyId } = req.params;
      const body = (req.body ?? {}) as TransferOwnershipBody;

      // Validate body.newOwnerEmail
      const rawEmail = typeof body.newOwnerEmail === 'string' ? body.newOwnerEmail.trim() : '';
      if (!rawEmail) {
        throw new AppError('newOwnerEmail is required', 400, 'INVALID_INPUT');
      }
      const newOwnerEmailLower = rawEmail.toLowerCase();

      const removeOldFromCoHosts =
        body.removeOldFromCoHosts === undefined ? true : body.removeOldFromCoHosts !== false;
      const deleteOldOptIn =
        body.deleteOldOptIn === undefined ? true : body.deleteOldOptIn !== false;
      const note =
        typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

      const actorEmail = req.userEmail?.toLowerCase() ?? 'unknown';

      const result = await prisma.$transaction(async (tx) => {
        // 1. Look up the party
        const party = await tx.party.findUnique({
          where: { id: partyId },
          select: {
            id: true,
            userId: true,
            coHosts: true,
          },
        });
        if (!party) {
          throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
        }

        const oldOwnerId = party.userId; // may be null for orphan parties

        // 2. Capture old owner email for cohost-scrub + audit context
        const oldOwner = oldOwnerId
          ? await tx.user.findUnique({
              where: { id: oldOwnerId },
              select: { id: true, email: true, name: true },
            })
          : null;
        const oldOwnerEmailLower = oldOwner?.email?.toLowerCase() ?? null;

        // 3. Look up new owner User (case-insensitive via findFirst+insensitive mode).
        //    Emails are stored lowercase on writes throughout the codebase, but
        //    historical rows are not guaranteed normalized — use the
        //    insensitive matcher to catch both cases.
        const newOwner = await tx.user.findFirst({
          where: { email: { equals: newOwnerEmailLower, mode: 'insensitive' } },
          select: { id: true, email: true, name: true },
        });
        if (!newOwner) {
          throw new AppError(
            `User ${rawEmail} doesn't exist on rsv.pizza yet — they need to log in once before they can be made owner.`,
            400,
            'NEW_OWNER_NOT_FOUND',
          );
        }

        // 4. Same-owner guard
        if (newOwner.id === oldOwnerId) {
          throw new AppError(
            'New owner is the same as the current owner.',
            400,
            'SAME_OWNER',
          );
        }

        // 5. Build new co_hosts array
        const existingCoHostsRaw = Array.isArray(party.coHosts) ? party.coHosts : [];
        const newOwnerEmailNormalized = newOwner.email.toLowerCase();

        let nextCoHosts: CoHostEntry[] = (existingCoHostsRaw as unknown as CoHostEntry[]).map(
          (entry) => ({ ...entry }),
        );

        // Optionally scrub the old owner from the cohost list (by email)
        if (removeOldFromCoHosts && oldOwnerEmailLower) {
          nextCoHosts = nextCoHosts.filter((h) => {
            const e = typeof h?.email === 'string' ? h.email.toLowerCase() : '';
            return e !== oldOwnerEmailLower;
          });
        }

        // Canonicalize the new owner entry: if present, force canEdit/showOnEvent
        // ON; if absent, append a fresh entry. This mirrors what a host would
        // see after the transfer (Primary host + persistent editor permissions).
        const newOwnerExistingIdx = nextCoHosts.findIndex((h) => {
          const e = typeof h?.email === 'string' ? h.email.toLowerCase() : '';
          return e === newOwnerEmailNormalized;
        });
        if (newOwnerExistingIdx >= 0) {
          nextCoHosts[newOwnerExistingIdx] = {
            ...nextCoHosts[newOwnerExistingIdx],
            canEdit: true,
            showOnEvent: true,
          };
        } else {
          nextCoHosts.push({
            id: randomUUID(),
            name: newOwner.name ?? newOwner.email,
            email: newOwner.email,
            canEdit: true,
            showOnEvent: true,
          });
        }

        // 6. Update party row (user_id + co_hosts)
        const updatedParty = await tx.party.update({
          where: { id: partyId },
          data: {
            userId: newOwner.id,
            coHosts: nextCoHosts as unknown as Prisma.InputJsonValue,
          },
          select: {
            id: true,
            userId: true,
            name: true,
            inviteCode: true,
            customUrl: true,
          },
        });

        // 7. Delete old owner's payment opt-in row for this party (if known)
        if (deleteOldOptIn && oldOwnerId) {
          await tx.partyPaymentOptIn.deleteMany({
            where: { partyId, userId: oldOwnerId },
          });
        }

        // 8. Audit — write to deletion_log via raw SQL because the model isn't
        //    exposed in Prisma. We don't want to introduce a Prisma model just
        //    for this single insert. On failure (e.g. table renamed, columns
        //    drifted) we console.warn the same payload so the trail still lands
        //    in Vercel logs and we don't fail the transfer.
        const auditPayload = {
          oldOwnerId,
          oldOwnerEmail: oldOwner?.email ?? null,
          newOwnerId: newOwner.id,
          newOwnerEmail: newOwner.email,
        };
        const auditContext = `Ownership transfer${note ? ': ' + note : ''}`;
        try {
          await tx.$executeRaw`
            INSERT INTO deletion_log (table_name, record_id, record_data, deleted_by, deleted_at, context)
            VALUES (
              'parties.user_id',
              ${partyId}::text,
              ${JSON.stringify(auditPayload)}::jsonb,
              ${actorEmail}::text,
              NOW(),
              ${auditContext}::text
            )
          `;
        } catch (auditErr) {
          // Audit-best-effort: don't roll back the transfer if logging fails.
          console.warn(
            '[fontina-91827] deletion_log audit insert failed; transfer still applied',
            {
              partyId,
              auditPayload,
              auditContext,
              actorEmail,
              error: auditErr instanceof Error ? auditErr.message : String(auditErr),
            },
          );
        }

        return {
          updatedParty,
          newOwner,
        };
      });

      res.json({
        ok: true,
        partyId: result.updatedParty.id,
        newOwnerId: result.newOwner.id,
        newOwnerEmail: result.newOwner.email,
        party: result.updatedParty,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
