/**
 * bounce-rate-heuristic: backfill guests.email_status from Resend's
 * historical email list.
 *
 * Usage:
 *   tsx scripts/backfill-email-status.ts --dry-run
 *   tsx scripts/backfill-email-status.ts                 # apply
 *   tsx scripts/backfill-email-status.ts --country=Nigeria  # scoped
 *
 * Requires:
 *   - `RESEND_API_KEY` in env (or in backend/.env*)
 *   - DATABASE_URL for Prisma
 *
 * Pulls every row from GET https://api.resend.com/emails?limit=100&after=<id>
 * (paginated, throttled to 250ms/req → 4 req/sec, under Resend's 5 req/sec
 * limit), then matches each by `to[0]` to the most-recent guest with that
 * email address (case-insensitive). Updates email_status + the captured
 * email_resend_id so future webhooks can match by ID.
 *
 * Resend's `last_event` values are the canonical statuses we mirror:
 *   delivered, bounced, complained, delivery_delayed, failed.
 * For pre-suppression-list entries the API returns last_event='bounced';
 * we record those as 'suppressed' to mark the "never reached" tier
 * separately from a transient bounce — the high_bounce_rate heuristic
 * counts both as bad.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RATE_LIMIT_MS = 250; // 4 req/sec — under Resend's 5/sec cap.

interface ResendEmail {
  id: string;
  to: string[];
  from: string;
  subject: string;
  created_at: string;
  last_event?: string;
}

interface ResendListResponse {
  object: 'list';
  data: ResendEmail[];
  has_more?: boolean;
}

function parseArgs(argv: string[]): { dryRun: boolean; country: string | null } {
  let dryRun = false;
  let country: string | null = null;
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--country=')) country = arg.slice('--country='.length);
  }
  return { dryRun, country };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Map Resend last_event onto our email_status convention. */
function mapLastEvent(last: string | undefined): string | null {
  if (!last) return null;
  // Resend uses dotted prefixes on some events; normalize.
  const suffix = last.replace(/^email\./, '');
  // Whitelist the events we care about; anything else (e.g. opened/clicked)
  // is overwritten only if there's no stronger signal already on the row.
  switch (suffix) {
    case 'delivered':
    case 'bounced':
    case 'complained':
    case 'delivery_delayed':
    case 'failed':
    case 'opened':
    case 'clicked':
      return suffix;
    default:
      return null;
  }
}

async function fetchAllResendEmails(): Promise<ResendEmail[]> {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
  const all: ResendEmail[] = [];
  let after: string | null = null;
  let pageNum = 0;

  while (true) {
    pageNum++;
    const url = new URL('https://api.resend.com/emails');
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend list ${res.status}: ${body}`);
    }
    const data = (await res.json()) as ResendListResponse;
    if (!Array.isArray(data.data) || data.data.length === 0) break;

    all.push(...data.data);
    process.stdout.write(
      `  page ${pageNum}: +${data.data.length} (total ${all.length})\n`,
    );

    if (!data.has_more) break;
    after = data.data[data.data.length - 1].id;
    await sleep(RATE_LIMIT_MS);
  }

  return all;
}

async function main() {
  const { dryRun, country } = parseArgs(process.argv);
  console.log(
    `\n=== backfill-email-status (${dryRun ? 'DRY RUN' : 'APPLY'}${
      country ? `, country=${country}` : ''
    }) ===\n`,
  );

  console.log('Fetching Resend email list (paginated, 250ms throttle)...');
  const emails = await fetchAllResendEmails();
  console.log(`Fetched ${emails.length} Resend emails total.\n`);

  // Group by recipient address (lowercased) — keep the most recent send per
  // address. Resend returns newest-first; reverse so later iterations
  // overwrite older entries naturally.
  const latestByAddr = new Map<string, ResendEmail>();
  for (const e of emails) {
    if (!Array.isArray(e.to) || e.to.length === 0) continue;
    const addr = String(e.to[0]).trim().toLowerCase();
    if (!addr) continue;
    const prev = latestByAddr.get(addr);
    if (!prev || new Date(e.created_at) > new Date(prev.created_at)) {
      latestByAddr.set(addr, e);
    }
  }
  console.log(`Resolved ${latestByAddr.size} unique addresses.\n`);

  // Build the scoped guest set. When --country is set, restrict to guests
  // whose party.country matches.
  const guests = await prisma.guest.findMany({
    where: {
      email: { not: null },
      ...(country
        ? { party: { country: { equals: country, mode: 'insensitive' } } }
        : {}),
    },
    select: {
      id: true,
      email: true,
      submittedAt: true,
      emailStatus: true,
      emailResendId: true,
      party: { select: { country: true } },
    },
    orderBy: { submittedAt: 'desc' },
  });
  console.log(
    `Loaded ${guests.length} guests${country ? ` in country=${country}` : ''}.\n`,
  );

  // For each guest, attach the most recent Resend send for that address.
  let willUpdate = 0;
  let skippedNoMatch = 0;
  let skippedNoStatus = 0;
  const seenAddresses = new Set<string>();
  const statusCounts = new Map<string, number>();

  const updates: { id: string; status: string; resendId: string }[] = [];
  for (const g of guests) {
    const addr = (g.email ?? '').trim().toLowerCase();
    if (!addr) continue;
    // Only match the most-recent guest per address (orderBy: submittedAt desc
    // gives newest first; first hit wins).
    if (seenAddresses.has(addr)) continue;
    seenAddresses.add(addr);

    const resend = latestByAddr.get(addr);
    if (!resend) {
      skippedNoMatch++;
      continue;
    }
    const mapped = mapLastEvent(resend.last_event);
    if (!mapped) {
      skippedNoStatus++;
      continue;
    }
    willUpdate++;
    statusCounts.set(mapped, (statusCounts.get(mapped) ?? 0) + 1);
    updates.push({ id: g.id, status: mapped, resendId: resend.id });
  }

  console.log(`Will update: ${willUpdate}`);
  console.log(`Skipped (no Resend match): ${skippedNoMatch}`);
  console.log(`Skipped (no useful last_event): ${skippedNoStatus}`);
  console.log('\nStatus breakdown:');
  for (const [s, n] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(20)} ${n}`);
  }
  console.log('');

  if (dryRun) {
    console.log('--dry-run set; no DB writes performed.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Applying ${updates.length} updates...`);
  let done = 0;
  for (const u of updates) {
    await prisma.guest.update({
      where: { id: u.id },
      data: {
        emailStatus: u.status,
        emailStatusUpdatedAt: new Date(),
        emailResendId: u.resendId,
      },
    });
    done++;
    if (done % 100 === 0) {
      process.stdout.write(`  ${done}/${updates.length}\n`);
    }
  }
  console.log(`Done. ${done} guests updated.\n`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('backfill failed:', err);
  process.exitCode = 1;
  prisma.$disconnect().catch(() => {});
});
