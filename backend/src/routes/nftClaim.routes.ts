// claim-later-nft: claim an attendance NFT after the event, to any address.
//   GET  /api/nft/claim/:token            claim page data (uniform 404 for unknown/expired tokens)
//   POST /api/nft/claim/:token            { address } 0x or ENS -> mint
//   POST /api/nft/claim/guest/:guestId    same, for a logged-in guest / guest-token holder
//   GET|POST /api/cron/nft-claims         hourly cron (CRON_SECRET)
// No signature proof: the claimer can only send their own NFT, once; the UI confirms the address.
// Mounted before /api/nft in index.ts. Plan: plans/claim-later-nft.md.
import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/database.js';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { callerOwnsGuest, isUuid } from '../lib/guestToken.js';
import { resolveWalletInputWithMeta } from '../services/ens.service.js';
import { hashRateKey, prismaRateStore } from '../lib/authRateLimit.js';
import { normalizeIp } from '../lib/normalizeIp.js';
import {
  ClaimError,
  executeClaimMint,
  explorerTxUrl,
  findClaimByToken,
  isBlockedRecipient,
  issueClaim,
  loadEligibility,
  maskAddress,
  mintBudget,
} from '../lib/nftClaim.js';
import { runNftClaimCron } from '../lib/nftClaimCron.js';

const router = Router();
const cronRouter = Router();

const CLAIM_IP_BUCKET = 'nft_claim_ip';
const CLAIM_IP_LIMIT = 10; // POSTs per hour per IP (durable, cross-instance)
const rateStore = prismaRateStore(prisma);

router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: "You've been rate limited. Please wait a few minutes before trying again." },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
  }),
);

/** Durable per-IP budget for mint attempts. Fails closed (503) if the store is unavailable. */
async function reserveClaimAttempt(req: Request): Promise<boolean> {
  const ip = normalizeIp(req.ip);
  const res = await rateStore.reserve(
    [{ bucket: CLAIM_IP_BUCKET, key: hashRateKey(CLAIM_IP_BUCKET, ip), limit: CLAIM_IP_LIMIT }],
    60 * 60 * 1000,
  );
  return res.ids !== null;
}

function sendClaimError(res: Response, err: ClaimError) {
  res.status(err.http).json({ error: err.message, status: err.code });
}

/** NFT_MINT_DAILY_CAP unset/0 => paused; daily cap used up => try later. */
async function budgetBlock(): Promise<ClaimError | null> {
  const budget = await mintBudget();
  if (budget.cap === 0) return new ClaimError('paused', 503, 'NFT minting is paused');
  if (budget.remaining === 0) return new ClaimError('cap_reached', 503, 'Daily NFT mint limit reached, try again later');
  return null;
}

/** Parse the `address` body field (0x or ENS) into a lowercased 0x address plus what was typed. */
async function parseRecipient(body: unknown): Promise<{ address: string; input: string | null } | { error: string }> {
  const raw = typeof (body as any)?.address === 'string' ? (body as any).address.trim() : '';
  if (!raw || raw.length > 255) return { error: 'Enter a wallet address or ENS name' };
  try {
    const r = await resolveWalletInputWithMeta(raw);
    const address = r.address.toLowerCase();
    if (isBlockedRecipient(address)) return { error: 'That address cannot receive this NFT' };
    return { address, input: r.wasEns ? r.input : null };
  } catch {
    return { error: 'Enter a valid 0x address or an ENS name that resolves' };
  }
}

function claimBody(claim: { status: string; txHash: string | null; recipientAddress: string | null }, chain: string | null) {
  return {
    status: claim.status,
    txHash: claim.txHash,
    explorerUrl: explorerTxUrl(chain, claim.txHash),
    maskedRecipient: ['minting', 'minted'].includes(claim.status) ? maskAddress(claim.recipientAddress) : null,
  };
}

// GET /api/nft/claim/:token
router.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const claim = await findClaimByToken(req.params.token);
    if (!claim) return res.status(404).json({ error: 'This claim link is not valid' });
    const chain = claim.party.nftChain || 'base';
    const budget = await mintBudget();
    res.json({
      partyName: claim.party.name,
      eventImageUrl: claim.party.eventImageUrl,
      chain,
      expiresAt: claim.tokenExpiresAt,
      paused: budget.cap === 0,
      ...claimBody(claim, chain),
    });
  } catch (error) {
    next(error);
  }
});

/** Shared POST tail: reserve an attempt, resolve the address, mint, shape the response. */
async function claimFlow(req: Request, res: Response, guestId: string, chain: string | null) {
  // Budget gate first so a paused/capped state never burns the guest's attempts or the IP budget.
  const blocked = await budgetBlock();
  if (blocked) return sendClaimError(res, blocked);

  let allowed = false;
  try {
    allowed = await reserveClaimAttempt(req);
  } catch (err) {
    console.error('[nft-claim] rate store unavailable:', err);
    return res.status(503).json({ error: 'Please try again in a few minutes', status: 'unavailable' });
  }
  if (!allowed) return res.status(429).json({ error: "You've tried a lot of times. Please wait an hour.", status: 'rate_limited' });

  const recipient = await parseRecipient(req.body);
  if ('error' in recipient) return res.status(400).json({ error: recipient.error, status: 'invalid_address' });

  try {
    const out = await executeClaimMint(guestId, recipient.address, recipient.input);
    res.json({
      status: 'minted',
      txHash: out.txHash,
      explorerUrl: explorerTxUrl(chain, out.txHash),
      maskedRecipient: maskAddress(recipient.address),
    });
  } catch (err) {
    if (err instanceof ClaimError) return sendClaimError(res, err);
    throw err;
  }
}

// POST /api/nft/claim/guest/:guestId (declared before /:token; the paths can't collide, a token has no slash)
router.post('/guest/:guestId', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { guestId } = req.params;
    const guest = isUuid(guestId) ? await prisma.guest.findUnique({ where: { id: guestId } }) : null;
    if (!guest || !callerOwnsGuest(req, guest)) return res.status(404).json({ error: 'Not found' });

    const ctx = await loadEligibility(guest.id);
    if (!ctx) return res.status(404).json({ error: 'Not found' });
    if (ctx.claim?.status === 'minted') {
      return res.json({ ...claimBody(ctx.claim, ctx.party.nftChain || 'base'), status: 'minted' });
    }
    if (!ctx.eligible) return res.status(403).json({ error: 'You are not eligible for an NFT', status: 'not_eligible' });

    const blocked = await budgetBlock(); // before issueClaim: a paused build creates no rows
    if (blocked) return sendClaimError(res, blocked);
    await issueClaim(guest, 'logged_in', { withToken: false });
    await claimFlow(req, res, guest.id, ctx.party.nftChain || 'base');
  } catch (error) {
    next(error);
  }
});

// POST /api/nft/claim/:token
router.post('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const claim = await findClaimByToken(req.params.token);
    if (!claim) return res.status(404).json({ error: 'This claim link is not valid' });
    const chain = claim.party.nftChain || 'base';
    // Single use: once minted the token only reads back the result.
    if (claim.status === 'minted') return res.json({ ...claimBody(claim, chain), status: 'minted' });
    await claimFlow(req, res, claim.guestId, chain);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Cron: GET|POST /api/cron/nft-claims, gated by CRON_SECRET (Vercel cron sends GET).
// ---------------------------------------------------------------------------
const cronHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || (req.headers.authorization || '') !== `Bearer ${cronSecret}`) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }
    const result = await runNftClaimCron();
    res.json(result);
  } catch (error) {
    next(error);
  }
};
cronRouter.get('/nft-claims', cronHandler);
cronRouter.post('/nft-claims', cronHandler);

export { router as nftClaimRouter, cronRouter as nftClaimCronRouter };
export default router;
