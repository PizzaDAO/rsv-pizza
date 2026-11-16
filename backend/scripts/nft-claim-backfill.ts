/**
 * claim-later-nft backfill (plans/claim-later-nft.md). DRY RUN BY DEFAULT: prints per-party counts
 * and changes nothing. Nothing is written, minted or emailed without --apply plus an action flag.
 *
 *   cd backend && npx tsx --env-file=.env scripts/nft-claim-backfill.ts [options]
 *
 * Scope: ended NFT-enabled parties on/after --since (default 2026-05-11, the Privy outage), using
 * the same isNftEligible rules as the cron (checked in, no token yet, not branded, ...), minus the
 * cron's 7-day window.
 *
 * Actions (each needs --apply; combine freely):
 *   --mint-wallets-on-file   direct mints for eligible guests with a self-entered 0x wallet
 *   --issue-claims           create claim rows + tokens (120-day links) for everyone else; never
 *                            rotates a token that already exists, no email
 *   --send-emails            email claim links (rotates the token); also needs NFT_CLAIM_EMAILS=on.
 *                            Send in waves: --party <id> first, then --limit 100, then all.
 * Filters: --party <id>   --limit N (per action, across parties)   --since YYYY-MM-DD
 *
 * Minting needs NFT_MINT_DAILY_CAP > 0 (unset = paused: the script stops). Never a session SET
 * (DATABASE_URL is the 6543 transaction pooler). Prints counts and ids, never addresses/emails.
 */
import { prisma } from '../src/config/database.js';
import {
  BACKFILL_TTL_DAYS,
  ClaimError,
  executeClaimMint,
  issueClaim,
  loadEligibility,
  mintBudget,
  usableWalletOnFile,
} from '../src/lib/nftClaim.js';
import { nftClaimEmailsEnabled, sendNftClaimEmail } from '../src/lib/nftClaimEmail.js';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const has = (name: string) => process.argv.includes(name);

const APPLY = has('--apply');
const MINT = has('--mint-wallets-on-file');
const ISSUE = has('--issue-claims');
const EMAIL = has('--send-emails');
const PARTY = arg('--party');
const LIMIT = arg('--limit') ? parseInt(arg('--limit')!, 10) : Infinity;
const SINCE = new Date(`${arg('--since') || '2026-05-11'}T00:00:00Z`);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n=== nft-claim-backfill (${APPLY ? 'APPLY' : 'DRY RUN'}) since ${SINCE.toISOString().slice(0, 10)}${PARTY ? ` party ${PARTY}` : ''} ===`);
  if ((MINT || ISSUE || EMAIL) && !APPLY) console.log('(action flags given without --apply: dry run only)');
  const budget = await mintBudget();
  console.log(`NFT_MINT_DAILY_CAP: ${budget.cap || 'unset (minting paused)'}; used in last 24h: ${budget.used}`);
  console.log(`NFT_CLAIM_EMAILS: ${nftClaimEmailsEnabled() ? 'on' : 'off'}`);

  const parties = await prisma.party.findMany({
    where: {
      ...(PARTY ? { id: PARTY } : {}),
      nftEnabled: true,
      eventImageUrl: { not: null },
      OR: [{ endTime: { gte: SINCE } }, { endTime: null, date: { gte: SINCE } }],
    },
    orderBy: { date: 'asc' },
  });
  console.log(`${parties.length} NFT-enabled part${parties.length === 1 ? 'y' : 'ies'} in scope\n`);

  const totals = { eligible: 0, walletOnFile: 0, needsClaim: 0, privy: 0, minted: 0, issued: 0, emailed: 0, failed: 0 };
  let minting = true;
  let mintsLeft = LIMIT;
  let issuesLeft = LIMIT;
  let emailsLeft = LIMIT;

  for (const party of parties) {
    const guests = await prisma.guest.findMany({
      where: { partyId: party.id, checkedInAt: { not: null }, nftTokenId: null, approved: { not: false } },
    });
    const counts = { eligible: 0, walletOnFile: 0, needsClaim: 0, privy: 0 };
    for (const g of guests) {
      const ctx = await loadEligibility(g.id);
      if (!ctx?.eligible) continue;
      // Already handled (cron or an earlier run): leave rows that exist alone, except emails below.
      counts.eligible += 1;
      if (g.walletSource === 'privy-embedded') counts.privy += 1;
      const wallet = usableWalletOnFile(g);
      if (wallet) counts.walletOnFile += 1;
      else counts.needsClaim += 1;
      if (!APPLY) continue;

      if (wallet && MINT && minting && mintsLeft > 0 && ctx.claim?.status !== 'minted') {
        await issueClaim(g, 'wallet_on_file', { withToken: false });
        try {
          await executeClaimMint(g.id, wallet, null);
          totals.minted += 1;
          mintsLeft -= 1;
        } catch (err) {
          if (err instanceof ClaimError && (err.code === 'paused' || err.code === 'cap_reached')) {
            console.log(`  minting stopped: ${err.code}`);
            minting = false;
          } else totals.failed += 1;
        }
      }
      if (!wallet && ISSUE && issuesLeft > 0 && !ctx.claim) {
        await issueClaim(g, 'backfill', { withToken: true, ttlDays: BACKFILL_TTL_DAYS });
        totals.issued += 1;
        issuesLeft -= 1;
      }
    }
    console.log(`${party.id}  ${counts.eligible} eligible  ${counts.walletOnFile} wallet on file  ${counts.needsClaim} need a claim  (${counts.privy} privy)`);
    totals.eligible += counts.eligible;
    totals.walletOnFile += counts.walletOnFile;
    totals.needsClaim += counts.needsClaim;
    totals.privy += counts.privy;
  }

  if (APPLY && EMAIL) {
    if (!nftClaimEmailsEnabled()) console.log('\n--send-emails ignored: NFT_CLAIM_EMAILS is not "on"');
    else if (budget.cap === 0) console.log('\n--send-emails ignored: minting is paused (NFT_MINT_DAILY_CAP unset)');
    else {
      const pending = await prisma.nftClaim.findMany({
        where: {
          status: 'issued',
          source: { in: ['backfill', 'claim_link'] },
          emailSentAt: null,
          ...(PARTY ? { partyId: PARTY } : {}),
          party: { OR: [{ endTime: { gte: SINCE } }, { endTime: null, date: { gte: SINCE } }] },
          guest: { email: { not: null }, nftTokenId: null },
        },
        include: { guest: true, party: true },
        orderBy: { createdAt: 'asc' },
      });
      console.log(`\n${pending.length} claim link(s) awaiting email`);
      for (const c of pending) {
        if (emailsLeft <= 0) break;
        const { token } = await issueClaim(c.guest, c.source as 'backfill' | 'claim_link', { withToken: true, ttlDays: BACKFILL_TTL_DAYS });
        if (!token) continue;
        const id = await sendNftClaimEmail(c.party, { name: c.guest.name, email: c.guest.email! }, token);
        if (!id) {
          totals.failed += 1;
          continue;
        }
        await prisma.nftClaim.update({ where: { guestId: c.guestId }, data: { emailSentAt: new Date(), emailResendId: id } });
        totals.emailed += 1;
        emailsLeft -= 1;
        if (totals.emailed % 10 === 0) await sleep(500);
      }
    }
  }

  console.log('\ntotals:', totals);
  if (!APPLY) console.log('DRY RUN: nothing changed.');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('FAILED:', e);
    prisma.$disconnect();
    process.exit(1);
  });
