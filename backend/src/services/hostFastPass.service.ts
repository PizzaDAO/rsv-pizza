/**
 * Host fast pass: DB loading for the pure logic in lib/hostTrackRecord.ts.
 *
 * Read-only except for approve/revoke of HostFastPassApproval rows (done in the
 * route). Nothing here moves money or changes payout status.
 */
import { prisma } from '../config/database.js';
import { computeEffectiveCapUsd } from '../helpers/reimbursementCap.js';
import {
  computeReviewAssist,
  computeTrackRecord,
  type HostPartyHistory,
  type ReviewAssist,
  type TrackRecord,
} from '../lib/hostTrackRecord.js';

export async function loadHostTrackRecord(
  userId: string,
  now: Date = new Date(),
): Promise<{ track: TrackRecord; accountCreatedAt: Date } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  });
  if (!user) return null;

  const parties = await prisma.party.findMany({
    where: { userId },
    select: {
      id: true,
      date: true,
      cancelledAt: true,
      eventTags: true,
      payouts: {
        where: { purpose: 'event' },
        select: { status: true, reviewedBy: true },
      },
      payoutDocuments: {
        where: { kind: 'receipt' },
        select: { createdAt: true, isDuplicate: true, ineligible: true },
      },
      _count: { select: { guests: true } },
    },
  });

  // Only host-designated payout-role photos count: plain uploads are
  // approved by default and prove nothing.
  const photoCounts = await prisma.photo.groupBy({
    by: ['partyId'],
    where: {
      partyId: { in: parties.map((p) => p.id) },
      status: 'approved',
      deletedAt: null,
      payoutRole: { not: null },
    },
    _count: { _all: true },
  });
  const photosByParty = new Map(photoCounts.map((r) => [r.partyId, r._count._all]));

  const history: HostPartyHistory[] = parties.map((p) => {
    const good = p.payoutDocuments.filter((d) => !d.isDuplicate && !d.ineligible);
    return {
      partyId: p.id,
      date: p.date,
      cancelledAt: p.cancelledAt,
      eventTags: p.eventTags ?? [],
      photoCount: photosByParty.get(p.id) ?? 0,
      rsvpCount: p._count.guests,
      receiptCount: good.length,
      firstReceiptAt: good.length ? new Date(Math.min(...good.map((d) => d.createdAt.getTime()))) : null,
      hasDuplicateReceipts: p.payoutDocuments.some((d) => d.isDuplicate),
      payouts: p.payouts.map((po) => ({ status: po.status, adminReviewed: !!po.reviewedBy })),
    };
  });

  return { track: computeTrackRecord(history, user.createdAt, now), accountCreatedAt: user.createdAt };
}

/**
 * True when the acting admin is the host, a co-host, or the host user of any
 * payout on this party. Such admins may view but never pre-approve.
 */
export async function isSelfInterested(
  partyId: string,
  actorUserId: string | undefined,
  actorEmail: string | undefined,
): Promise<boolean> {
  const email = actorEmail?.toLowerCase();
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { userId: true, coHosts: true, user: { select: { email: true } } },
  });
  if (!party) return false;
  if (actorUserId && party.userId === actorUserId) return true;
  if (email && party.user?.email?.toLowerCase() === email) return true;
  const coHosts = Array.isArray(party.coHosts) ? (party.coHosts as Array<{ email?: string }>) : [];
  if (email && coHosts.some((c) => c?.email?.toLowerCase() === email)) return true;
  if (actorUserId) {
    const own = await prisma.payout.findFirst({
      where: { partyId, hostUserId: actorUserId },
      select: { id: true },
    });
    if (own) return true;
  }
  return false;
}

/** Admin-only. Gathers the cross-host signals and runs the flag rules. */
export async function loadReviewAssist(
  partyId: string,
  now: Date = new Date(),
): Promise<{
  hostUserId: string;
  hostEmail: string;
  track: TrackRecord;
  review: ReviewAssist;
  capUsd: number | null;
  eligibleForFastPass: boolean;
} | null> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: {
      id: true,
      userId: true,
      date: true,
      reimbursementCapUsd: true,
      eventTags: true,
      _count: { select: { guests: true } },
    },
  });
  if (!party?.userId) return null;

  const host = await prisma.user.findUnique({
    where: { id: party.userId },
    select: { email: true, payoutWalletAddress: true },
  });
  const loaded = await loadHostTrackRecord(party.userId, now);
  if (!host || !loaded) return null;

  // Payee reuse: wallets this host has used, matched against other users.
  const hostPayouts = await prisma.payout.findMany({
    where: { hostUserId: party.userId, payoutWalletAddress: { not: null } },
    select: { payoutWalletAddress: true },
  });
  const wallets = Array.from(
    new Set(
      [...hostPayouts.map((p) => p.payoutWalletAddress), host.payoutWalletAddress]
        .filter((w): w is string => !!w)
        .map((w) => w.toLowerCase()),
    ),
  );
  let otherHostsSharingPayee = 0;
  if (wallets.length) {
    const [viaPayouts, viaUsers] = await Promise.all([
      prisma.payout.findMany({
        where: {
          hostUserId: { not: party.userId },
          payoutWalletAddress: { in: wallets, mode: 'insensitive' },
        },
        select: { hostUserId: true },
      }),
      prisma.user.findMany({
        where: { id: { not: party.userId }, payoutWalletAddress: { in: wallets, mode: 'insensitive' } },
        select: { id: true },
      }),
    ]);
    otherHostsSharingPayee = new Set([
      ...viaPayouts.map((p) => p.hostUserId),
      ...viaUsers.map((u) => u.id),
    ]).size;
  }

  // Receipt reuse: same stored file, or same file name + size, already on a
  // different party. One batched query (indexed on url), matched in memory.
  const receipts = await prisma.payoutDocument.findMany({
    where: { partyId, kind: 'receipt', isDuplicate: false },
    select: { url: true, fileName: true, fileSize: true },
  });
  let reusedReceiptCount = 0;
  if (receipts.length) {
    const others = await prisma.payoutDocument.findMany({
      where: {
        partyId: { not: partyId },
        kind: 'receipt',
        OR: [
          { url: { in: receipts.map((r) => r.url) } },
          ...receipts.map((r) => ({ fileName: r.fileName, fileSize: r.fileSize })),
        ],
      },
      select: { url: true, fileName: true, fileSize: true },
      take: 500,
    });
    const urls = new Set(others.map((o) => o.url));
    const nameSize = new Set(others.map((o) => `${o.fileName}\u0000${o.fileSize}`));
    reusedReceiptCount = receipts.filter(
      (r) => urls.has(r.url) || nameSize.has(`${r.fileName}\u0000${r.fileSize}`),
    ).length;
  }

  // Includes already-paid rolling payouts so a paid-then-topped-up party is caught.
  const requested = await prisma.payout.aggregate({
    where: { partyId, purpose: 'event', status: { in: ['pending', 'approved', 'queued', 'paid'] } },
    _sum: { finalAmountUsd: true },
  });
  const capUsd = computeEffectiveCapUsd({
    reimbursementCapUsd: party.reimbursementCapUsd,
    eventTags: party.eventTags,
  });

  const review = computeReviewAssist({
    track: loaded.track,
    accountCreatedAt: loaded.accountCreatedAt,
    partyDate: party.date,
    rsvpCount: party._count.guests,
    otherHostsSharingPayee,
    reusedReceiptCount,
    receiptCount: receipts.length,
    requestedUsd: requested._sum.finalAmountUsd != null ? Number(requested._sum.finalAmountUsd) : null,
    capUsd,
    now,
  });

  return {
    hostUserId: party.userId,
    hostEmail: host.email,
    track: loaded.track,
    review,
    capUsd,
    eligibleForFastPass: loaded.track.eligibleForFastPass,
  };
}
