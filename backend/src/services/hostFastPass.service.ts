/**
 * Host fast pass: DB loading for the pure logic in lib/hostTrackRecord.ts.
 *
 * Read-only except for approve/revoke of HostFastPassApproval rows (done in the
 * route). Nothing here moves money or changes payout status.
 */
import { prisma } from '../config/database.js';
import {
  countRealRsvps,
  computeReviewAssist,
  computeTrackRecord,
  type HostPartyHistory,
  type ReviewAssist,
  type TrackRecord,
} from '../lib/hostTrackRecord.js';

/**
 * Mirror of PAID_HAS_PROOF_WHERE in routes/admin-payout.routes.ts (not exported
 * there; importing that 8k-line router here would be heavy). KEEP IN SYNC.
 */
export const PAID_HAS_PROOF_WHERE = {
  OR: [
    { payoutMethod: 'usdc_base', transactionHash: { not: null, notIn: [''] } },
    { payoutMethod: 'wire', wireReference: { not: null, notIn: [''] } },
    {
      payoutMethod: 'mercury_card',
      OR: [
        { mercuryCardLast4: { not: null, notIn: [''] } },
        { mercuryCardId: { not: null, notIn: [''] } },
      ],
    },
    { externalProofUrl: { not: null, notIn: [''] } },
  ],
};

function paidRowHasProof(row: {
  payoutMethod: string | null;
  transactionHash: string | null;
  wireReference: string | null;
  mercuryCardLast4: string | null;
  mercuryCardId: string | null;
  externalProofUrl: string | null;
}): boolean {
  const has = (v: string | null) => !!v && v.trim() !== '';
  if (has(row.externalProofUrl)) return true;
  if (row.payoutMethod === 'usdc_base') return has(row.transactionHash);
  if (row.payoutMethod === 'wire') return has(row.wireReference);
  if (row.payoutMethod === 'mercury_card') return has(row.mercuryCardLast4) || has(row.mercuryCardId);
  return false;
}

export async function loadHostTrackRecord(
  userId: string,
  now: Date = new Date(),
): Promise<{ track: TrackRecord; accountCreatedAt: Date } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true, email: true },
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
        select: {
          status: true,
          reviewedBy: true,
          payoutMethod: true,
          transactionHash: true,
          wireReference: true,
          mercuryCardLast4: true,
          mercuryCardId: true,
          externalProofUrl: true,
        },
      },
      payoutDocuments: {
        where: { kind: 'receipt' },
        select: { createdAt: true, isDuplicate: true, ineligible: true },
      },
      guests: { select: { email: true, status: true, approved: true } },
    },
  });

  // Only host-designated payout-role photos count: plain uploads are
  // approved by default and prove nothing.
  const photoWhere = { partyId: { in: parties.map((p) => p.id) }, status: 'approved', deletedAt: null };
  const [anyPhotos, rolePhotos] = await Promise.all([
    prisma.photo.groupBy({ by: ['partyId'], where: photoWhere, _count: { _all: true } }),
    prisma.photo.groupBy({
      by: ['partyId'],
      where: { ...photoWhere, payoutRole: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const photosByParty = new Map(anyPhotos.map((r) => [r.partyId, r._count._all]));
  const rolePhotosByParty = new Map(rolePhotos.map((r) => [r.partyId, r._count._all]));

  const history: HostPartyHistory[] = parties.map((p) => {
    const good = p.payoutDocuments.filter((d) => !d.isDuplicate && !d.ineligible);
    return {
      partyId: p.id,
      date: p.date,
      cancelledAt: p.cancelledAt,
      eventTags: p.eventTags ?? [],
      photoCount: photosByParty.get(p.id) ?? 0,
      rolePhotoCount: rolePhotosByParty.get(p.id) ?? 0,
      rsvpCount: countRealRsvps(p.guests),
      receiptCount: good.length,
      firstReceiptAt: good.length ? new Date(Math.min(...good.map((d) => d.createdAt.getTime()))) : null,
      hasDuplicateReceipts: p.payoutDocuments.some((d) => d.isDuplicate),
      payouts: p.payouts.map((po) => ({
        status: po.status,
        reviewedBy: po.reviewedBy,
        paidWithProof: po.status === 'paid' && paidRowHasProof(po),
      })),
    };
  });

  return { track: computeTrackRecord(history, user.createdAt, now, user.email), accountCreatedAt: user.createdAt };
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
  const email = actorEmail?.trim().toLowerCase();
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { userId: true, coHosts: true, user: { select: { email: true, payoutWalletAddress: true } } },
  });
  if (!party) return false;
  if (actorUserId && party.userId === actorUserId) return true;
  if (email && party.user?.email?.trim().toLowerCase() === email) return true;
  const coHosts = Array.isArray(party.coHosts) ? (party.coHosts as unknown[]) : [];
  if (
    email &&
    coHosts.some((c) => {
      const ce = (c as { email?: unknown } | null)?.email;
      return typeof ce === 'string' && ce.trim().toLowerCase() === email;
    })
  ) {
    return true;
  }
  if (actorUserId) {
    const own = await prisma.payout.findFirst({
      where: { partyId, hostUserId: actorUserId },
      select: { id: true },
    });
    if (own) return true;
    // The admin's own payout wallet is the payee of this party's payouts or its host.
    const actor = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { payoutWalletAddress: true },
    });
    const wallet = actor?.payoutWalletAddress?.trim().toLowerCase();
    if (wallet) {
      if (party.user?.payoutWalletAddress?.trim().toLowerCase() === wallet) return true;
      const sameWallet = await prisma.payout.findFirst({
        where: { partyId, payoutWalletAddress: { equals: wallet, mode: 'insensitive' } },
        select: { id: true },
      });
      if (sameWallet) return true;
    }
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
      guests: { select: { email: true, status: true, approved: true } },
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
    // Two indexed queries (url; file_name+file_size), no row limit, matched in memory.
    const [byUrl, byName] = await Promise.all([
      prisma.payoutDocument.findMany({
        where: { partyId: { not: partyId }, kind: 'receipt', url: { in: receipts.map((r) => r.url) } },
        select: { url: true },
      }),
      prisma.payoutDocument.findMany({
        where: {
          partyId: { not: partyId },
          kind: 'receipt',
          fileName: { in: Array.from(new Set(receipts.map((r) => r.fileName))) },
          fileSize: { in: Array.from(new Set(receipts.map((r) => r.fileSize))) },
        },
        select: { fileName: true, fileSize: true },
      }),
    ]);
    const urls = new Set(byUrl.map((o) => o.url));
    const nameSize = new Set(byName.map((o) => `${o.fileName}\u0000${o.fileSize}`));
    reusedReceiptCount = receipts.filter(
      (r) => urls.has(r.url) || nameSize.has(`${r.fileName}\u0000${r.fileSize}`),
    ).length;
  }

  // Includes already-paid rolling payouts so a paid-then-topped-up party is caught.
  const requested = await prisma.payout.aggregate({
    where: {
      partyId,
      purpose: 'event',
      OR: [
        { status: { in: ['pending', 'approved', 'queued'] } },
        // Paid rows count only with proof of send (zombie 'paid' rows do not).
        { status: 'paid', AND: [PAID_HAS_PROOF_WHERE] },
      ],
    },
    _sum: { finalAmountUsd: true },
  });
  // ONLY the underboss-validated column. The numeric event-tag fallback is
  // ignored here: tags are a softer channel and must not set a fast-pass cap.
  const capUsd =
    party.reimbursementCapUsd != null && Number.isFinite(Number(party.reimbursementCapUsd))
      ? Number(party.reimbursementCapUsd)
      : null;

  const review = computeReviewAssist({
    track: loaded.track,
    accountCreatedAt: loaded.accountCreatedAt,
    partyDate: party.date,
    rsvpCount: countRealRsvps(party.guests),
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
