/**
 * Host trust: DB loading for the pure scorer in lib/hostTrust.ts (read-only).
 *
 * Batched: a page of hosts is loaded with a fixed number of queries, not per host. Nothing here
 * writes anything, approves anything, or changes a budget or payout.
 */
import { prisma } from '../config/database.js';
import { countRealRsvps, computeTrackRecord, isCompletedParty } from '../lib/hostTrackRecord.js';
import {
  computeHostTrust,
  type HostTrustParty,
  type HostTrustResult,
  type MemberSignals,
} from '../lib/hostTrust.js';
import type { HostTrustConfig } from '../lib/hostTrustSettings.js';
import {
  checkCheckinRatioExtreme,
  checkCheckinTimestampCollapse,
  checkCheckinVelocitySuperhuman,
  type FakeDetectionGuest,
} from '../lib/fakeDetection.js';
import { paidRowHasProof } from './hostFastPass.service.js';
import { buildSybilWalletSetFromDb, scorePartiesByIds } from '../lib/fakeDetectionScan.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_REPORT_PAGE = 50;
export const DEFAULT_REPORT_PAGE = 25;

export interface HostCandidate {
  userId: string;
  name: string | null;
  email: string;
}

/**
 * Hosts worth listing: an upcoming (60 days) non-cancelled party, or an event payout in the last
 * 90 days. `q` narrows by name or email. Ordered by name for stable paging.
 */
export async function listHostCandidates(
  opts: { q?: string; offset: number; limit: number },
  now: Date,
): Promise<{ hosts: HostCandidate[]; total: number }> {
  const [upcoming, recent] = await Promise.all([
    prisma.party.findMany({
      where: {
        userId: { not: null },
        cancelledAt: null,
        date: { gte: now, lte: new Date(now.getTime() + 60 * DAY_MS) },
      },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.payout.findMany({
      where: { purpose: 'event', createdAt: { gte: new Date(now.getTime() - 90 * DAY_MS) } },
      select: { hostUserId: true },
      distinct: ['hostUserId'],
    }),
  ]);
  const ids = Array.from(
    new Set([...upcoming.map((p) => p.userId), ...recent.map((p) => p.hostUserId)].filter((x): x is string => !!x)),
  );
  const q = opts.q?.trim();
  const where = {
    id: { in: ids },
    ...(q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { email: { contains: q, mode: 'insensitive' as const } }] }
      : {}),
  };
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: opts.offset,
      take: opts.limit,
    }),
  ]);
  return { hosts: users.map((u) => ({ userId: u.id, name: u.name, email: u.email })), total };
}

export interface HostPartyRow {
  partyId: string;
  name: string;
  date: string | null;
  completed: boolean;
  rsvps: number;
  checkIns: number;
  reportedAttendance: number | null;
  photos: number;
  payoutPhotos: number;
  receiptsOnTime: boolean;
  payoutStatuses: string[];
  fakeRisk: 'high' | 'medium' | 'low' | 'clean' | 'unscored';
}

export interface HostTrustRow {
  userId: string;
  name: string | null;
  email: string;
  trust: HostTrustResult;
  /** Today's constant-based Fast Pass tier (shadow column). */
  todayTier: 'fast_pass' | 'building' | 'new' | 'flagged';
  /** New tier and today's tier disagree about "trusted". */
  disagrees: boolean;
  /** Fake-event risk was not scored, so a missing fake_risk blocker or penalty may change the tier. */
  provisional: boolean;
  parties: HostPartyRow[];
}

/**
 * Compute trust for a set of hosts. `scoreFakeRisk` runs the (heavy) fake-event scorer over the
 * completed GPP parties; on any failure those parties are "unscored" and count neither way.
 */
export async function loadHostTrustRows(
  userIds: string[],
  config: HostTrustConfig,
  now: Date,
  opts: { scoreFakeRisk: boolean },
): Promise<HostTrustRow[]> {
  if (userIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true, createdAt: true, payoutWalletAddress: true },
  });
  const parties = await prisma.party.findMany({
    where: { userId: { in: userIds } },
    select: {
      id: true,
      userId: true,
      name: true,
      date: true,
      cancelledAt: true,
      eventTags: true,
      eventType: true,
      estimatedAttendance: true,
      underbossStatus: true,
      payouts: {
        where: { purpose: 'event' },
        select: {
          status: true,
          reviewedBy: true,
          hostUserId: true,
          payoutWalletAddress: true,
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
        select: { url: true, fileName: true, fileSize: true, createdAt: true, isDuplicate: true, ineligible: true },
      },
      guests: { select: { email: true, status: true, approved: true, checkedInAt: true } },
    },
  });

  const partyIds = parties.map((p) => p.id);
  const photoWhere = { partyId: { in: partyIds }, status: 'approved', deletedAt: null };
  const [anyPhotos, rolePhotos] = await Promise.all([
    prisma.photo.groupBy({ by: ['partyId'], where: photoWhere, _count: { _all: true } }),
    prisma.photo.groupBy({ by: ['partyId'], where: { ...photoWhere, payoutRole: { not: null } }, _count: { _all: true } }),
  ]);
  const photosByParty = new Map(anyPhotos.map((r) => [r.partyId, r._count._all]));
  const rolePhotosByParty = new Map(rolePhotos.map((r) => [r.partyId, r._count._all]));

  // ---- shared payee: other accounts that used any wallet this host used
  const walletsByUser = new Map<string, Set<string>>();
  const addWallet = (uid: string | null, w: string | null | undefined) => {
    const lw = w?.trim().toLowerCase();
    if (!uid || !lw) return;
    if (!walletsByUser.has(uid)) walletsByUser.set(uid, new Set());
    walletsByUser.get(uid)!.add(lw);
  };
  for (const u of users) addWallet(u.id, u.payoutWalletAddress);
  // Only payouts whose recipient is the host: admins can pay a co-host or other recipient on this party.
  for (const p of parties) for (const po of p.payouts) if (po.hostUserId === p.userId) addWallet(p.userId, po.payoutWalletAddress);
  const allWallets = Array.from(new Set(Array.from(walletsByUser.values()).flatMap((s) => Array.from(s))));
  const usersByWallet = new Map<string, Set<string>>();
  if (allWallets.length) {
    const [viaPayouts, viaUsers] = await Promise.all([
      prisma.payout.findMany({
        where: { payoutWalletAddress: { in: allWallets, mode: 'insensitive' } },
        select: { hostUserId: true, payoutWalletAddress: true },
      }),
      prisma.user.findMany({
        where: { payoutWalletAddress: { in: allWallets, mode: 'insensitive' } },
        select: { id: true, payoutWalletAddress: true },
      }),
    ]);
    const put = (w: string | null, uid: string) => {
      const lw = w?.trim().toLowerCase();
      if (!lw) return;
      if (!usersByWallet.has(lw)) usersByWallet.set(lw, new Set());
      usersByWallet.get(lw)!.add(uid);
    };
    for (const r of viaPayouts) put(r.payoutWalletAddress, r.hostUserId);
    for (const r of viaUsers) put(r.payoutWalletAddress, r.id);
  }
  const sharedPayeeFor = (uid: string): number => {
    const others = new Set<string>();
    for (const w of walletsByUser.get(uid) ?? []) {
      for (const other of usersByWallet.get(w) ?? []) if (other !== uid) others.add(other);
    }
    return others.size;
  };

  // ---- reused receipts: same url, or same file name + size, on another party
  const docs = parties.flatMap((p) =>
    p.payoutDocuments.filter((d) => !d.isDuplicate).map((d) => ({ partyId: p.id, ...d })),
  );
  const reusedByParty = new Map<string, number>();
  if (docs.length) {
    const [byUrl, byName] = await Promise.all([
      prisma.payoutDocument.findMany({
        where: { kind: 'receipt', url: { in: Array.from(new Set(docs.map((d) => d.url))) } },
        select: { partyId: true, url: true },
      }),
      prisma.payoutDocument.findMany({
        where: {
          kind: 'receipt',
          fileName: { in: Array.from(new Set(docs.map((d) => d.fileName))) },
          fileSize: { in: Array.from(new Set(docs.map((d) => d.fileSize))) },
        },
        select: { partyId: true, fileName: true, fileSize: true },
      }),
    ]);
    const urlParties = new Map<string, Set<string>>();
    for (const r of byUrl) {
      if (!urlParties.has(r.url)) urlParties.set(r.url, new Set());
      urlParties.get(r.url)!.add(r.partyId);
    }
    const nameParties = new Map<string, Set<string>>();
    for (const r of byName) {
      const k = `${r.fileName}\u0000${r.fileSize}`;
      if (!nameParties.has(k)) nameParties.set(k, new Set());
      nameParties.get(k)!.add(r.partyId);
    }
    const onOther = (set: Set<string> | undefined, pid: string) => !!set && Array.from(set).some((x) => x !== pid);
    for (const d of docs) {
      if (onOther(urlParties.get(d.url), d.partyId) || onOther(nameParties.get(`${d.fileName}\u0000${d.fileSize}`), d.partyId)) {
        reusedByParty.set(d.partyId, (reusedByParty.get(d.partyId) ?? 0) + 1);
      }
    }
  }

  // ---- fake-event risk on completed GPP parties (heavy; optional)
  const riskByParty = new Map<string, 'high' | 'medium' | 'low' | 'clean'>();
  if (opts.scoreFakeRisk) {
    const ids = parties.filter((p) => p.eventType === 'gpp' && isCompletedParty(toHistory(p, 0, 0, 0, 0, 0), now)).map((p) => p.id);
    if (ids.length) {
      try {
        const rows = await scorePartiesByIds(ids, await buildSybilWalletSetFromDb());
        for (const r of rows) riskByParty.set(r.id, r.tier);
      } catch (err) {
        console.warn('[hostTrust] fake-risk scoring failed; parties left unscored.', err);
      }
    }
  }

  const member: MemberSignals = 'not_checked'; // PizzaDAO check is a later phase
  const out: HostTrustRow[] = [];
  for (const u of users) {
    const mine = parties.filter((p) => p.userId === u.id);
    const history: HostTrustParty[] = mine.map((p) => {
      const good = p.payoutDocuments.filter((d) => !d.isDuplicate && !d.ineligible);
      const checked = p.guests.filter((g) => g.checkedInAt != null);
      const guestsForCheck = p.guests.map((g) => ({ checkedInAt: g.checkedInAt })) as unknown as FakeDetectionGuest[];
      const bulk =
        checked.length > 0 &&
        [checkCheckinVelocitySuperhuman, checkCheckinTimestampCollapse, checkCheckinRatioExtreme].some(
          (f) => f(guestsForCheck).fired,
        );
      const risk = riskByParty.get(p.id);
      return {
        ...toHistory(p, photosByParty.get(p.id) ?? 0, rolePhotosByParty.get(p.id) ?? 0, countRealRsvps(p.guests), good.length,
          good.length ? Math.min(...good.map((d) => d.createdAt.getTime())) : 0),
        hasDuplicateReceipts: p.payoutDocuments.some((d) => d.isDuplicate),
        payouts: p.payouts.map((po) => ({
          status: po.status,
          reviewedBy: po.reviewedBy,
          paidWithProof: po.status === 'paid' && paidRowHasProof(po),
        })),
        checkedInCount: checked.length,
        bulkCheckin: bulk,
        reportedAttendance: p.estimatedAttendance ?? null,
        fakeRiskHigh: risk ? risk === 'high' : null,
        underbossOk: p.underbossStatus === 'approved' || p.underbossStatus === 'listed',
        reusedReceiptCount: reusedByParty.get(p.id) ?? 0,
      };
    });

    const trust = computeHostTrust(
      { history, accountCreatedAt: u.createdAt, hostEmail: u.email, otherHostsSharingPayee: sharedPayeeFor(u.id), member },
      config,
      now,
    );
    const today = computeTrackRecord(history, u.createdAt, now, u.email);
    const rows: HostPartyRow[] = history.map((h, i) => ({
      partyId: h.partyId,
      name: mine[i].name,
      date: h.date ? h.date.toISOString() : null,
      completed: isCompletedParty(h, now),
      rsvps: h.rsvpCount,
      checkIns: h.checkedInCount,
      reportedAttendance: h.reportedAttendance,
      photos: h.photoCount,
      payoutPhotos: h.rolePhotoCount,
      receiptsOnTime:
        !!h.date && !!h.firstReceiptAt && h.firstReceiptAt.getTime() <= h.date.getTime() + config.gates.receiptDeadlineDays * DAY_MS,
      payoutStatuses: h.payouts.map((p) => p.status),
      fakeRisk: riskByParty.get(h.partyId) ?? 'unscored',
    }));
    rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    out.push({
      userId: u.id,
      name: u.name,
      email: u.email,
      trust,
      todayTier: today.tier,
      disagrees: (trust.tier === 'trusted') !== (today.tier === 'fast_pass'),
      provisional: !opts.scoreFakeRisk,
      parties: rows,
    });
  }
  return out;
}

/** The HostPartyHistory fields shared by every row. */
function toHistory(
  p: { id: string; date: Date | null; cancelledAt: Date | null; eventTags: string[] | null },
  photoCount: number,
  rolePhotoCount: number,
  rsvpCount: number,
  receiptCount: number,
  firstReceiptMs: number,
) {
  return {
    partyId: p.id,
    date: p.date,
    cancelledAt: p.cancelledAt,
    eventTags: p.eventTags ?? [],
    photoCount,
    rolePhotoCount,
    rsvpCount,
    receiptCount,
    firstReceiptAt: firstReceiptMs ? new Date(firstReceiptMs) : null,
    hasDuplicateReceipts: false,
    payouts: [],
  };
}
