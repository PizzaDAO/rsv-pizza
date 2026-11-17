/**
 * Approve / reject / hide a brand-series event. One implementation shared by the super-admin router
 * (`/api/admin/series/:id/events/:partyId/status`) and the brand-admin router
 * (`/api/brand-admin/:seriesId/events/:partyId/status`), so both write the same audit trail.
 *
 * The party is always looked up by `{ id, eventSeriesId }`, so a party of another series is a 404.
 * Brand-admin decisions are final, but PizzaDAO keeps a durable veto: a super-admin (or underboss) can
 * set any status again, and once a PizzaDAO actor has set a status a brand admin can no longer change
 * it (409). Brand-admin audit rows are tagged reason 'brand admin' (lib/partyApproval.ts).
 */
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { writeStatusAudit } from '../helpers/statusAudit.js';
import { emailHostOfStatusChange } from '../services/partyStatusEmailNotify.js';
import { BRAND_ADMIN_REASON, isPizzadaoSet } from './partyApproval.js';
import { writeSeriesAudit, type SeriesActorKind } from './seriesAudit.js';

export const SETTABLE_EVENT_STATUSES = ['approved', 'rejected', 'hidden'] as const;
export const LISTABLE_EVENT_STATUSES = ['pending', 'approved', 'rejected', 'listed', 'hidden'] as const;

export const EVENT_LIST_SELECT = {
  id: true, name: true, customUrl: true, inviteCode: true, city: true, country: true,
  date: true, venueName: true, address: true, underbossStatus: true, createdAt: true,
  user: { select: { email: true, name: true } },
} as const;

export async function listSeriesEvents(seriesId: string, status: string) {
  return prisma.party.findMany({
    where: { eventSeriesId: seriesId, underbossStatus: status, cancelledAt: null },
    orderBy: [{ createdAt: 'desc' }],
    select: EVENT_LIST_SELECT,
    take: 500,
  });
}

export async function setSeriesEventStatus(opts: {
  seriesId: string;
  partyId: string;
  status: string;
  actorEmail: string;
  actorKind: SeriesActorKind;
}) {
  const { seriesId, partyId, status, actorEmail, actorKind } = opts;
  if (!(SETTABLE_EVENT_STATUSES as readonly string[]).includes(status)) {
    throw new AppError('status must be one of: approved, rejected, hidden', 400, 'VALIDATION_ERROR');
  }
  let priorStatus: string | null = null;
  const party = await prisma.$transaction(async (tx) => {
    const before = await tx.party.findFirst({
      where: { id: partyId, eventSeriesId: seriesId },
      select: { id: true, eventSeriesId: true, underbossStatus: true },
    });
    if (!before) throw new AppError('Party not found in this series', 404, 'NOT_FOUND');
    priorStatus = before.underbossStatus;
    if (actorKind === 'series_admin') {
      const last = await tx.partyStatusAudit.findFirst({
        where: { partyId },
        orderBy: { createdAt: 'desc' },
        select: { actorKind: true, reason: true },
      });
      if (isPizzadaoSet(last)) {
        throw new AppError("PizzaDAO has set this event's status", 409, 'PIZZADAO_DECIDED');
      }
    }
    const updated = await tx.party.update({
      where: { id: partyId },
      data: { underbossStatus: status },
      select: { id: true, underbossStatus: true },
    });
    await writeStatusAudit(
      tx, partyId, before.underbossStatus, status, actorEmail, 'admin',
      actorKind === 'series_admin' ? BRAND_ADMIN_REASON : undefined,
    );
    await writeSeriesAudit(tx, {
      seriesId, actorEmail, actorKind, action: 'event.status',
      changes: { partyId: { old: null, new: partyId }, underbossStatus: { old: before.underbossStatus, new: status } },
    });
    return updated;
  });
  // Tell the host of approve/reject (fire-and-forget, only on a real change).
  if ((status === 'approved' || status === 'rejected') && priorStatus !== status) {
    void emailHostOfStatusChange(partyId, status);
  }
  return party;
}
