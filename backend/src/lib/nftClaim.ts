// claim-later-nft: backend-minted attendance NFTs. A guest who was checked in at an NFT-enabled
// event either gets a direct mint to the wallet they typed (cron, no email) or a private claim
// link / logged-in claim to any address. One `nft_claims` row per guest; plan: plans/claim-later-nft.md.
//
// Safety rails:
//  - NFT_MINT_DAILY_CAP unset or 0 => cap 0 => nothing mints anywhere (cron and claim endpoints).
//  - The claim token is random and stored only as a sha256 hash; the recipient address is locked
//    at the first mint attempt, so retries can't redirect the NFT.
//  - The mint itself goes through the `mint-nft` edge function (minter key never in the backend).
import { createHash, randomBytes } from 'crypto';
import { prisma } from '../config/database.js';
import { brandedSiteForParty } from './siteBrand.js';
import { callMintEdge, type MintEdgeResult } from './nftMint.js';

export const CLAIM_TTL_DAYS = 90;
export const BACKFILL_TTL_DAYS = 120;
export const MAX_ATTEMPTS = 5;
/** A `minting` row older than this is treated as a crashed attempt and retried. */
export const MINTING_STALE_MS = 10 * 60 * 1000;
/** Fallback end of an event with no end_time: start + 6h. */
const DEFAULT_EVENT_MS = 6 * 60 * 60 * 1000;

export type ClaimSource = 'wallet_on_file' | 'claim_link' | 'logged_in' | 'backfill';

/** Thrown for expected claim failures; routes turn it into `{ error, status: code }` with `http`. */
export class ClaimError extends Error {
  constructor(
    public code:
      | 'paused'
      | 'cap_reached'
      | 'not_eligible'
      | 'conflict'
      | 'mint_failed'
      | 'not_found',
    public http: number,
    message: string,
  ) {
    super(message);
    this.name = 'ClaimError';
  }
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
export function newClaimToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashClaimToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// ---------------------------------------------------------------------------
// Daily cap (go-live switch)
// ---------------------------------------------------------------------------
/** NFT_MINT_DAILY_CAP; unset, empty or invalid => 0 => minting paused. */
export function dailyMintCap(): number {
  const n = parseInt(process.env.NFT_MINT_DAILY_CAP || '', 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export async function mintBudget(now: Date = new Date()): Promise<{ cap: number; used: number; remaining: number }> {
  const cap = dailyMintCap();
  if (cap === 0) return { cap, used: 0, remaining: 0 };
  const used = await prisma.nftClaim.count({
    where: { mintedAt: { gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
  });
  return { cap, used, remaining: Math.max(0, cap - used) };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------
export interface EligibilityParty {
  nftEnabled: boolean;
  eventImageUrl: string | null;
  endTime: Date | null;
  date: Date | null;
  requireApproval: boolean;
}

export interface EligibilityGuest {
  checkedInAt: Date | null;
  approved: boolean | null;
  nftTokenId: number | null;
}

export interface EligibilityContext {
  now?: Date;
  /** The party belongs to a live branded series (NFTs are PizzaDAO-only). */
  branded: boolean;
  /** Another guest row at the party with the same email already has a token or a minted claim. */
  duplicateMinted: boolean;
}

export function eventEndedAt(party: Pick<EligibilityParty, 'endTime' | 'date'>): Date | null {
  if (party.endTime) return party.endTime;
  if (party.date) return new Date(party.date.getTime() + DEFAULT_EVENT_MS);
  return null;
}

export function isNftEligible(
  guest: EligibilityGuest,
  party: EligibilityParty,
  ctx: EligibilityContext,
): { eligible: boolean; reason?: string } {
  const now = ctx.now ?? new Date();
  if (!party.nftEnabled || !party.eventImageUrl) return { eligible: false, reason: 'nft-disabled' };
  if (ctx.branded) return { eligible: false, reason: 'branded' };
  const ended = eventEndedAt(party);
  if (!ended || ended.getTime() > now.getTime()) return { eligible: false, reason: 'not-ended' };
  if (!guest.checkedInAt) return { eligible: false, reason: 'not-checked-in' };
  if (guest.approved === false) return { eligible: false, reason: 'declined' };
  // The edge function refuses approval-required events for unapproved guests; mirror it.
  if (party.requireApproval && guest.approved !== true) return { eligible: false, reason: 'not-approved' };
  if (guest.nftTokenId !== null && guest.nftTokenId !== undefined) return { eligible: false, reason: 'already-minted' };
  if (ctx.duplicateMinted) return { eligible: false, reason: 'duplicate-email' };
  return { eligible: true };
}

async function hasMintedDuplicate(guest: { id: string; email: string | null; partyId: string }): Promise<boolean> {
  const email = guest.email?.trim();
  if (!email) return false;
  const dup = await prisma.guest.findFirst({
    where: {
      partyId: guest.partyId,
      id: { not: guest.id },
      email: { equals: email, mode: 'insensitive' },
      OR: [{ nftTokenId: { not: null } }, { nftClaim: { is: { status: { in: ['minted', 'minting'] } } } }],
    },
    select: { id: true },
  });
  return !!dup;
}

/** Guest + party + claim row + the eligibility verdict, from the DB. Null if the guest is unknown. */
export async function loadEligibility(guestId: string, now: Date = new Date()) {
  const guest = await prisma.guest.findUnique({
    where: { id: guestId },
    include: { party: true, nftClaim: true },
  });
  if (!guest) return null;
  const [branded, duplicateMinted] = await Promise.all([
    brandedSiteForParty(guest.party).then((s) => !!s),
    hasMintedDuplicate(guest),
  ]);
  const verdict = isNftEligible(guest, guest.party, { now, branded, duplicateMinted });
  return { guest, party: guest.party, claim: guest.nftClaim, ...verdict };
}

// ---------------------------------------------------------------------------
// Claim rows
// ---------------------------------------------------------------------------
/**
 * Create the guest's claim row, or (re)issue its token. `withToken` false = a row with no link
 * (direct mints, logged-in claims). Re-issuing rotates the token. Rows that are minting, minted
 * or revoked are left alone and come back with `token: null`.
 */
export async function issueClaim(
  guest: { id: string; partyId: string },
  source: ClaimSource,
  opts: { withToken: boolean; ttlDays?: number; now?: Date } = { withToken: false },
) {
  const now = opts.now ?? new Date();
  const existing = await prisma.nftClaim.findUnique({ where: { guestId: guest.id } });
  if (existing && !['issued', 'failed'].includes(existing.status)) return { claim: existing, token: null };

  const token = opts.withToken ? newClaimToken() : null;
  const tokenData = token
    ? {
        tokenHash: hashClaimToken(token),
        tokenExpiresAt: new Date(now.getTime() + (opts.ttlDays ?? CLAIM_TTL_DAYS) * 24 * 60 * 60 * 1000),
      }
    : {};
  if (existing) {
    return { claim: await prisma.nftClaim.update({ where: { guestId: guest.id }, data: tokenData }), token };
  }
  try {
    const claim = await prisma.nftClaim.create({
      data: { guestId: guest.id, partyId: guest.partyId, source, ...tokenData },
    });
    return { claim, token };
  } catch (err) {
    // A concurrent caller created the row first (P2002): use theirs, and don't hand out our token.
    if ((err as { code?: string })?.code !== 'P2002') throw err;
    const claim = await prisma.nftClaim.findUnique({ where: { guestId: guest.id } });
    if (!claim) throw err;
    return { claim, token: null };
  }
}

/** Claim + guest + party by plaintext token. Null for unknown, malformed, revoked or expired tokens. */
export async function findClaimByToken(token: string, now: Date = new Date()) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const claim = await prisma.nftClaim.findUnique({
    where: { tokenHash: hashClaimToken(token) },
    include: { guest: true, party: true },
  });
  if (!claim || claim.status === 'revoked') return null;
  // A minted claim stays readable after expiry (read-back of the result).
  if (claim.status !== 'minted' && (!claim.tokenExpiresAt || claim.tokenExpiresAt.getTime() < now.getTime())) {
    return null;
  }
  return claim;
}

/**
 * The atomic lock: only one caller moves the row to `minting`, and only with the locked recipient
 * (the first attempt sets it). Then, in the same transaction, the guest row gets the recipient as
 * its wallet (the edge function and the metadata route both key on guests.ethereum_address).
 */
export async function startMint(
  guestId: string,
  recipient: string,
  input: string | null,
  now: Date = new Date(),
): Promise<void> {
  const staleBefore = new Date(now.getTime() - MINTING_STALE_MS);
  await prisma.$transaction(async (tx) => {
    const locked = await tx.nftClaim.updateMany({
      where: {
        guestId,
        attempts: { lt: MAX_ATTEMPTS },
        AND: [
          {
            OR: [
              { status: { in: ['issued', 'failed'] } },
              { status: 'minting', mintingStartedAt: { lt: staleBefore } },
            ],
          },
          { OR: [{ recipientAddress: null }, { recipientAddress: recipient }] },
        ],
      },
      data: {
        status: 'minting',
        recipientAddress: recipient,
        ...(input ? { recipientInput: input } : {}),
        attempts: { increment: 1 },
        mintingStartedAt: now,
        lastError: null,
      },
    });
    if (locked.count !== 1) throw new ClaimError('conflict', 409, 'This claim is already in progress or locked to another address');

    const guest = await tx.guest.findUnique({
      where: { id: guestId },
      select: { ethereumAddress: true },
    });
    const current = guest?.ethereumAddress?.trim().toLowerCase() || null;
    if (current !== recipient) {
      // Only remember the first wallet we replaced (never overwrite it, never write NULL).
      if (current) {
        await tx.nftClaim.updateMany({ where: { guestId, previousAddress: null }, data: { previousAddress: current } });
      }
      await tx.guest.update({
        where: { id: guestId },
        data: { ethereumAddress: recipient, walletSource: 'claim' },
      });
    }
  });
}

/** Record the edge-function result on the claim row (and guests.nft_* on success). `alreadyMinted` counts as success. */
export async function finishMint(guestId: string, result: MintEdgeResult, now: Date = new Date()): Promise<boolean> {
  if (result.ok) {
    await prisma.$transaction([
      prisma.nftClaim.update({
        where: { guestId },
        data: {
          status: 'minted',
          mintedAt: now,
          txHash: result.txHash ?? null,
          tokenId: result.tokenId ?? null,
          lastError: null,
        },
      }),
      prisma.guest.update({
        where: { id: guestId },
        data: {
          ...(result.tokenId !== undefined ? { nftTokenId: result.tokenId } : {}),
          ...(result.txHash ? { nftTransactionHash: result.txHash } : {}),
          nftMintedAt: now,
        },
      }),
    ]);
    return true;
  }
  await prisma.nftClaim.update({
    where: { guestId },
    data: { status: 'failed', lastError: (result.error || 'mint-failed').slice(0, 500) },
  });
  return false;
}

export interface ClaimOutcome {
  txHash: string | null;
  tokenId: number | null;
  alreadyMinted: boolean;
}

/**
 * cap check -> eligibility -> lock -> edge mint -> record. Throws ClaimError; a failed mint leaves
 * the row `failed` (the cron retries it, same locked recipient).
 */
export async function executeClaimMint(
  guestId: string,
  recipient: string,
  input: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ClaimOutcome> {
  const budget = await mintBudget();
  if (budget.cap === 0) throw new ClaimError('paused', 503, 'NFT minting is paused');
  if (budget.remaining === 0) throw new ClaimError('cap_reached', 503, 'Daily NFT mint limit reached, try again later');

  const ctx = await loadEligibility(guestId);
  if (!ctx) throw new ClaimError('not_found', 404, 'Not found');
  if (!ctx.eligible) throw new ClaimError('not_eligible', 403, 'This guest is not eligible for an NFT');
  if (!ctx.claim) throw new ClaimError('not_found', 404, 'Not found');

  const to = recipient.trim().toLowerCase();
  await startMint(guestId, to, input);
  const result = await callMintEdge(ctx.party, ctx.guest, to, fetchImpl);
  const ok = await finishMint(guestId, result);
  if (!ok) {
    console.error(`[nftClaim] mint failed for guest ${guestId}:`, result.error);
    throw new ClaimError('mint_failed', 502, 'The mint did not go through. We will retry automatically.');
  }
  return { txHash: result.txHash ?? null, tokenId: result.tokenId ?? null, alreadyMinted: !!result.alreadyMinted };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
export function maskAddress(addr: string | null | undefined): string | null {
  if (!addr) return null;
  return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

export function explorerTxUrl(chain: string | null | undefined, txHash: string | null | undefined): string | null {
  if (!txHash) return null;
  return chain === 'monad' ? `https://monadscan.com/tx/${txHash}` : `https://basescan.org/tx/${txHash}`;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead';

/** Addresses an NFT must never be sent to: zero, dead, and anything in NFT_CLAIM_BLOCKED_ADDRESSES (comma list, e.g. the contracts). */
export function isBlockedRecipient(address: string): boolean {
  const a = address.trim().toLowerCase();
  if (a === ZERO_ADDRESS || a === DEAD_ADDRESS) return true;
  return (process.env.NFT_CLAIM_BLOCKED_ADDRESSES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(a);
}

/** True when the guest has a self-entered 0x wallet we can mint to directly (Privy embedded wallets don't count). */
export function usableWalletOnFile(guest: { ethereumAddress: string | null; walletSource: string | null }): string | null {
  const a = guest.ethereumAddress?.trim() || '';
  if (!/^0x[a-fA-F0-9]{40}$/.test(a)) return null;
  if (guest.walletSource === 'privy-embedded' || guest.walletSource === 'claim') return null;
  if (isBlockedRecipient(a)) return null;
  return a.toLowerCase();
}

/** What the event page needs for the claim card (self only). */
export async function claimStateForGuest(guestId: string) {
  const none = { eligible: false, status: null as string | null, txHash: null as string | null, paused: false };
  try {
    const ctx = await loadEligibility(guestId);
    if (!ctx) return none;
    const minted = ctx.claim?.status === 'minted' || ctx.guest.nftTokenId !== null;
    return {
      eligible: !!ctx.eligible,
      status: minted ? 'minted' : (ctx.claim?.status ?? null),
      txHash: ctx.claim?.txHash ?? ctx.guest.nftTransactionHash ?? null,
      /** NFT_MINT_DAILY_CAP unset: the card stays hidden until minting is switched on. */
      paused: dailyMintCap() === 0,
    };
  } catch (err) {
    // Never break my-guest over the claim card (e.g. nft_claims not applied yet).
    console.error('[nftClaim] claimStateForGuest failed:', err);
    return none;
  }
}
