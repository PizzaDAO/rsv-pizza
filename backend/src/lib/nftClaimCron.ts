// claim-later-nft: hourly cron body (POST/GET /api/cron/nft-claims).
//   a. retry failed / stale-minting claims (same locked recipient)
//   b. parties that ended 12h-7d ago: eligible guests with no claim row get one; a manual wallet
//      on file mints directly (no email), everyone else gets a claim_link row
//   c. email claim links (only when NFT_CLAIM_EMAILS=on)
// NFT_MINT_DAILY_CAP unset/0 => paused: returns immediately, touches nothing.
import { prisma } from '../config/database.js';
import {
  ClaimError,
  MAX_ATTEMPTS,
  MINTING_STALE_MS,
  executeClaimMint,
  isNftEligible,
  issueClaim,
  loadEligibility,
  mintBudget,
  usableWalletOnFile,
} from './nftClaim.js';
import { brandedSiteForParty } from './siteBrand.js';
import { nftClaimEmailsEnabled, sendNftClaimEmail } from './nftClaimEmail.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const EMAIL_BATCH_SIZE = 10;
const EMAIL_BATCH_GAP_MS = 500;
const MAX_EMAILS_PER_RUN = 200;
const MAX_RETRIES_PER_RUN = 50;

export interface NftClaimCronResult {
  paused: boolean;
  retried: number;
  minted: number;
  issued: number;
  emailed: number;
  failed: number;
  stoppedEarly: boolean;
}

export async function runNftClaimCron(
  opts: { now?: Date; deadlineMs?: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<NftClaimCronResult> {
  const now = opts.now ?? new Date();
  const deadline = Date.now() + (opts.deadlineMs ?? 240_000);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const result: NftClaimCronResult = { paused: false, retried: 0, minted: 0, issued: 0, emailed: 0, failed: 0, stoppedEarly: false };

  if ((await mintBudget(now)).cap === 0) return { ...result, paused: true };

  const outOfTime = () => {
    if (Date.now() >= deadline) result.stoppedEarly = true;
    return result.stoppedEarly;
  };
  /** One mint through the shared path. Returns false when the run should stop minting (cap reached). */
  const tryMint = async (guestId: string, recipient: string): Promise<boolean> => {
    try {
      await executeClaimMint(guestId, recipient, null, opts.fetchImpl);
      result.minted += 1;
    } catch (err) {
      if (err instanceof ClaimError && (err.code === 'paused' || err.code === 'cap_reached')) return false;
      // mint_failed / conflict / not_eligible: row state already records it; next run retries.
      result.failed += 1;
    }
    return true;
  };

  // a. retries
  const retryable = await prisma.nftClaim.findMany({
    where: {
      recipientAddress: { not: null },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        { status: 'failed' },
        { status: 'minting', mintingStartedAt: { lt: new Date(now.getTime() - MINTING_STALE_MS) } },
      ],
    },
    select: { guestId: true, recipientAddress: true },
    orderBy: { updatedAt: 'asc' },
    take: MAX_RETRIES_PER_RUN,
  });
  for (const row of retryable) {
    if (outOfTime()) return result;
    result.retried += 1;
    if (!(await tryMint(row.guestId, row.recipientAddress!))) return result;
  }

  // b. new eligible guests at parties that ended 12h-7d ago
  const from = new Date(now.getTime() - 7 * DAY_MS);
  const to = new Date(now.getTime() - 12 * HOUR_MS);
  const parties = await prisma.party.findMany({
    where: {
      nftEnabled: true,
      eventImageUrl: { not: null },
      OR: [
        { endTime: { gte: from, lte: to } },
        // No end_time: eventEndedAt() is start + 6h, so shift the window by 6h.
        { endTime: null, date: { gte: new Date(from.getTime() - 6 * HOUR_MS), lte: new Date(to.getTime() - 6 * HOUR_MS) } },
      ],
    },
  });
  for (const party of parties) {
    if (outOfTime()) return result;
    if (await brandedSiteForParty(party)) continue;
    const guests = await prisma.guest.findMany({
      where: {
        partyId: party.id,
        checkedInAt: { not: null },
        nftTokenId: null,
        approved: { not: false },
        nftClaim: { is: null },
      },
    });
    for (const g of guests) {
      if (outOfTime()) return result;
      // Per-guest verdict from the DB (same rules as the claim endpoints, incl. same-email dedupe).
      const ctx = await loadEligibility(g.id, now);
      if (!ctx?.eligible) continue;
      const wallet = usableWalletOnFile(g);
      await issueClaim(g, wallet ? 'wallet_on_file' : 'claim_link', { withToken: false, now });
      result.issued += 1;
      if (wallet && !(await tryMint(g.id, wallet))) return result;
    }
  }

  // c. claim-link emails (the token is rotated here: only the hash is stored, so a link can't be re-sent)
  if (!nftClaimEmailsEnabled()) return result;
  const pending = await prisma.nftClaim.findMany({
    where: {
      source: 'claim_link',
      status: 'issued',
      emailSentAt: null,
      party: {
        nftEnabled: true,
        OR: [{ endTime: { gte: from, lte: now } }, { endTime: null, date: { gte: new Date(from.getTime() - 6 * HOUR_MS), lte: now } }],
      },
      guest: { email: { not: null }, nftTokenId: null },
    },
    include: { guest: true, party: true },
    take: MAX_EMAILS_PER_RUN,
  });
  for (let i = 0; i < pending.length; i += EMAIL_BATCH_SIZE) {
    if (outOfTime()) return result;
    await Promise.all(
      pending.slice(i, i + EMAIL_BATCH_SIZE).map(async (c) => {
        // Re-check eligibility (a mint or edit may have landed since the row was created).
        if (!isNftEligible(c.guest, c.party, { now, branded: false, duplicateMinted: false }).eligible) return;
        const { token } = await issueClaim(c.guest, 'claim_link', { withToken: true, now });
        if (!token) return;
        const id = await sendNftClaimEmail(c.party, { name: c.guest.name, email: c.guest.email! }, token, opts.fetchImpl);
        if (!id) {
          result.failed += 1;
          return;
        }
        await prisma.nftClaim.update({ where: { guestId: c.guestId }, data: { emailSentAt: now, emailResendId: id } });
        result.emailed += 1;
      }),
    );
    if (i + EMAIL_BATCH_SIZE < pending.length) await sleep(EMAIL_BATCH_GAP_MS);
  }
  return result;
}
