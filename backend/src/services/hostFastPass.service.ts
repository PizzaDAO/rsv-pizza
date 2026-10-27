/**
 * Host fast pass: DB loading for the pure logic in lib/hostTrackRecord.ts.
 *
 * Read-only except for approve/revoke of HostFastPassApproval rows. Nothing
 * here moves money or changes payout status.
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
        select: { status: true, createdAt: true },
      },
      payoutDocuments: {
        where: { kind: 'receipt' },
        select: { createdAt: true, payoutId: true, isDuplicate: true },
      },
      _count: { select: { guests: true } },
    },
  });

  const photoCounts = await prisma.photo.groupBy({
    by: ['partyId'],
    where: { partyId: { in: parties.map((p) => p.id) }, status: 'approved', deletedAt: null },
    _count: { _all: true },
  });
  const photosByParty = new Map(photoCounts.map((r) => [r.partyId, r._count._all]));

  const history: HostPartyHistory[] = parties.map((p) => {
    const docs = p.payoutDocuments;
    const firstReceiptAt = docs.length
      ? new Date(Math.min(...docs.map((d) => d.createdAt.getTime())))
      : null;
    const duplicates = docs.filter((d) => d.isDuplicate).length;
    return {
      partyId: p.id,
      date: p.date,
      cancelledAt: p.cancelledAt,
      eventTags: p.eventTags ?? [],
      photoCount: photosByParty.get(p.id) ?? 0,
      rsvpCount: p._count.guests,
      // Receipts are party-level; attribute them to each payout of the party.
      payouts: p.payouts.map((po) => ({
        status: po.status,
        createdAt: po.createdAt,
        firstReceiptAt,
        receiptCount: docs.length,
        duplicateReceiptCount: duplicates,
      })),
    };
  });

  return { track: computeTrackRecord(history, user.createdAt, now), accountCreatedAt: user.createdAt };
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

  // Receipt reuse: same stored file, or same file name + size, or same
  // OCR amount/currency/summary, already on a different party.
  const receipts = await prisma.payoutDocument.findMany({
    where: { partyId, kind: 'receipt', isDuplicate: false },
    select: { url: true, fileName: true, fileSize: true, ocrAmount: true, ocrCurrency: true, ocrSummary: true },
  });
  let reusedReceiptCount = 0;
  for (const r of receipts) {
    const or: object[] = [{ url: r.url }, { fileName: r.fileName, fileSize: r.fileSize }];
    if (r.ocrAmount != null && r.ocrSummary) {
      or.push({ ocrAmount: r.ocrAmount, ocrCurrency: r.ocrCurrency, ocrSummary: r.ocrSummary });
    }
    const hit = await prisma.payoutDocument.findFirst({
      where: { partyId: { not: partyId }, kind: 'receipt', OR: or },
      select: { id: true },
    });
    if (hit) reusedReceiptCount++;
  }

  const requested = await prisma.payout.aggregate({
    where: { partyId, purpose: 'event', status: { in: ['pending', 'approved', 'queued'] } },
    _sum: { finalAmountUsd: true },
  });
  const capUsd = computeEffectiveCapUsd({
    reimbursementCapUsd: party.reimbursementCapUsd,
    eventTags: party.eventTags,
  });

  const review = computeReviewAssist({
    track: loaded.track,
    accountCreatedAt: loaded.accountCreatedAt,
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
