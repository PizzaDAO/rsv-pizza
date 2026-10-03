/**
 * GPP host lookup for PizzaDAO's member app (service-to-service).
 *
 * Answers one question: "did the person with these identifiers host or
 * onboard an approved / listed Global Pizza Party (Bitcoin Pizza Day) event?"
 * Used by pizzadao.org's L6.1 mission verifier ("Onboard a Bitcoin Pizza Day
 * city"). See routes/service.routes.ts for the HTTP surface and auth.
 *
 * Identifiers (all optional, at least one required, max 10 of each):
 *   emails     User.email (owner) and co_hosts[].email (co-host / underboss)
 *   wallets    User.payout_wallet_address (owner) and payouts.payout_wallet_address
 *              (the host who filed a reimbursement for that party)
 *   telegrams  User.telegram (owner), co_hosts[].telegram, and
 *              party_telegram_hosts.username (bot-verified host chats)
 * Discord ids are not stored anywhere in this app, so they can't be matched.
 *
 * An event counts when event_type = 'gpp', underboss_status is 'approved' or
 * 'listed', and it isn't cancelled. The result carries no PII: per event only
 * the slug, city, status, type, date, the caller's role on it and which kind of
 * identifier matched.
 */
import { prisma } from '../config/database.js';
import { normalizeTgHandle } from '../routes/telegram-link-callback.routes.js';

export const GPP_HOST_STATUSES = ['approved', 'listed'] as const;
export const MAX_IDENTIFIERS_PER_KIND = 10;

export type MatchKind = 'email' | 'wallet' | 'telegram' | 'telegram_verified';
export type HostRole = 'host' | 'cohost' | 'underboss';

export interface HostIdentifiers {
  emails: string[];
  wallets: string[];
  telegrams: string[];
}

export interface GppHostEvent {
  slug: string;
  city: string | null;
  status: string;
  type: string;
  date: string | null;
  role: HostRole;
  matchedBy: MatchKind[];
}

export class IdentifierError extends Error {}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;
// EVM (0x + 40 hex) or a base58-ish address (Solana etc.). Compared case-insensitively.
const WALLET_RE = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
const TG_RE = /^[a-z0-9_]{3,32}$/;

function list(v: unknown, name: string): unknown[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  if (arr.length > MAX_IDENTIFIERS_PER_KIND) {
    throw new IdentifierError(`At most ${MAX_IDENTIFIERS_PER_KIND} ${name}`);
  }
  return arr;
}

/**
 * Validate + normalize the request body. Accepts `email` / `emails`,
 * `wallet` / `wallets`, `telegram` / `telegrams` (string or array).
 * Throws IdentifierError on malformed input or when nothing usable was given.
 */
export function parseIdentifiers(body: unknown): HostIdentifiers {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new IdentifierError('Body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const raw = (single: string, plural: string) => [...list(b[single], plural), ...list(b[plural], plural)];

  const emails = new Set<string>();
  for (const e of raw('email', 'emails')) {
    if (typeof e !== 'string') throw new IdentifierError('emails must be strings');
    const n = e.trim().toLowerCase();
    if (!n) continue;
    if (n.length > 254 || !EMAIL_RE.test(n)) throw new IdentifierError('Invalid email');
    emails.add(n);
  }
  const wallets = new Set<string>();
  for (const w of raw('wallet', 'wallets')) {
    if (typeof w !== 'string') throw new IdentifierError('wallets must be strings');
    const t = w.trim();
    if (!t) continue;
    if (!WALLET_RE.test(t)) throw new IdentifierError('Invalid wallet address');
    wallets.add(t.toLowerCase());
  }
  const telegrams = new Set<string>();
  for (const h of raw('telegram', 'telegrams')) {
    if (typeof h !== 'string') throw new IdentifierError('telegrams must be strings');
    const n = normalizeTgHandle(h);
    if (!n) continue;
    if (!TG_RE.test(n)) throw new IdentifierError('Invalid Telegram handle');
    telegrams.add(n);
  }
  for (const [name, s] of [['emails', emails], ['wallets', wallets], ['telegrams', telegrams]] as const) {
    if (s.size > MAX_IDENTIFIERS_PER_KIND) throw new IdentifierError(`At most ${MAX_IDENTIFIERS_PER_KIND} ${name}`);
  }
  if (emails.size + wallets.size + telegrams.size === 0) {
    throw new IdentifierError('Provide at least one of email, wallet, telegram');
  }
  return { emails: [...emails], wallets: [...wallets], telegrams: [...telegrams] };
}

/** The spellings a Telegram handle is stored under (free-text fields): foo, @foo, t.me/foo, https://t.me/foo. */
export function telegramVariants(handles: string[]): string[] {
  return handles.flatMap((h) => [h, `@${h}`, `t.me/${h}`, `https://t.me/${h}`, `http://t.me/${h}`]);
}

type CoHost = { email?: unknown; telegram?: unknown; isUnderboss?: unknown };

const sameWallet = (a: string | null | undefined, set: Set<string>) => !!a && set.has(a.trim().toLowerCase());

export async function findGppHostEvents(ids: HostIdentifiers, db = prisma): Promise<GppHostEvent[]> {
  const emailSet = new Set(ids.emails);
  const walletSet = new Set(ids.wallets);
  const tgSet = new Set(ids.telegrams);
  const tgVariants = telegramVariants(ids.telegrams);
  const statuses = [...GPP_HOST_STATUSES];

  // 1. user accounts behind the identifiers, and the parties linked
  //    directly (reimbursement wallet, bot-verified host Telegram chat).
  const [users, payouts, tgHosts] = await Promise.all([
    db.user.findMany({
      where: {
        OR: [
          ...(ids.emails.length ? [{ email: { in: ids.emails, mode: 'insensitive' as const } }] : []),
          ...(ids.wallets.length ? [{ payoutWalletAddress: { in: ids.wallets, mode: 'insensitive' as const } }] : []),
          ...(tgVariants.length ? [{ telegram: { in: tgVariants, mode: 'insensitive' as const } }] : []),
        ],
      },
      select: { id: true, email: true, telegram: true, payoutWalletAddress: true },
      take: 50,
    }),
    ids.wallets.length
      ? db.payout.findMany({
          where: { payoutWalletAddress: { in: ids.wallets, mode: 'insensitive' } },
          select: { partyId: true, hostUserId: true },
          distinct: ['partyId'],
          take: 200,
        })
      : Promise.resolve([] as Array<{ partyId: string; hostUserId: string }>),
    tgVariants.length
      ? db.partyTelegramHost.findMany({
          where: { username: { in: tgVariants, mode: 'insensitive' } },
          select: { partyId: true },
          take: 200,
        })
      : Promise.resolve([] as Array<{ partyId: string }>),
  ]);

  // Why each account matched (an owner's role inherits it).
  const userMatch = new Map<string, Set<MatchKind>>();
  const addUser = (id: string, k: MatchKind) => {
    const s = userMatch.get(id) ?? new Set<MatchKind>();
    s.add(k);
    userMatch.set(id, s);
  };
  for (const u of users) {
    if (emailSet.has(u.email.toLowerCase())) addUser(u.id, 'email');
    if (sameWallet(u.payoutWalletAddress, walletSet)) addUser(u.id, 'wallet');
    if (u.telegram && tgSet.has(normalizeTgHandle(u.telegram))) addUser(u.id, 'telegram');
  }
  for (const p of payouts) addUser(p.hostUserId, 'wallet');

  // Co-host entries are matched by email too: the queried emails, plus the
  // matched accounts' emails (which carry that account's match reasons).
  const cohostEmails = new Map<string, Set<MatchKind>>(ids.emails.map((e) => [e, new Set<MatchKind>(['email'])]));
  for (const u of users) {
    const why = userMatch.get(u.id);
    if (!why) continue;
    const e = u.email.toLowerCase();
    cohostEmails.set(e, new Set([...(cohostEmails.get(e) ?? []), ...why]));
  }

  const payoutParty = new Set(payouts.map((p) => p.partyId));
  const tgHostParty = new Set(tgHosts.map((t) => t.partyId));

  // 2. Co-host matches live in the co_hosts JSONB array (free-text emails and
  //    handles, any casing): scan only the qualifying GPP rows.
  const cohostRows =
    cohostEmails.size || ids.telegrams.length
      ? await db.$queryRaw<Array<{ id: string }>>`
          SELECT p.id::text AS id
          FROM parties p
          WHERE p.event_type = 'gpp'
            AND p.underboss_status = ANY(${statuses}::text[])
            AND p.cancelled_at IS NULL
            AND jsonb_typeof(p.co_hosts) = 'array'
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(p.co_hosts) e
              WHERE jsonb_typeof(e) = 'object'
                AND (lower(trim(e->>'email')) = ANY(${[...cohostEmails.keys()]}::text[])
                  OR lower(trim(e->>'telegram')) = ANY(${tgVariants.map((v) => v.toLowerCase())}::text[]))
            )
          LIMIT 200`
      : [];

  const partyIds = [...new Set([...payoutParty, ...tgHostParty, ...cohostRows.map((r) => r.id)])];
  const ownerIds = [...userMatch.keys()];
  if (!partyIds.length && !ownerIds.length) return [];

  // 3. The qualifying events, then the role + match reason per event.
  const parties = await db.party.findMany({
    where: {
      eventType: 'gpp',
      underbossStatus: { in: statuses },
      cancelledAt: null,
      OR: [
        ...(ownerIds.length ? [{ userId: { in: ownerIds } }] : []),
        ...(partyIds.length ? [{ id: { in: partyIds } }] : []),
      ],
    },
    select: {
      id: true,
      customUrl: true,
      inviteCode: true,
      city: true,
      underbossStatus: true,
      eventType: true,
      date: true,
      userId: true,
      coHosts: true,
    },
    orderBy: { date: 'desc' },
    take: 100,
  });

  const events: GppHostEvent[] = [];
  for (const p of parties) {
    const matchedBy = new Set<MatchKind>();
    let role: HostRole | null = null;

    if (p.userId && userMatch.has(p.userId)) {
      role = 'host';
      userMatch.get(p.userId)!.forEach((k) => matchedBy.add(k));
    }
    const cohosts: CoHost[] = Array.isArray(p.coHosts) ? (p.coHosts as CoHost[]) : [];
    for (const c of cohosts) {
      if (!c || typeof c !== 'object') continue;
      const byEmail = typeof c.email === 'string' ? cohostEmails.get(c.email.trim().toLowerCase()) : undefined;
      const byTg = typeof c.telegram === 'string' && tgSet.has(normalizeTgHandle(c.telegram));
      if (!byEmail && !byTg) continue;
      byEmail?.forEach((k) => matchedBy.add(k));
      if (byTg) matchedBy.add('telegram');
      if (role !== 'host') role = c.isUnderboss === true ? 'underboss' : role === 'underboss' ? 'underboss' : 'cohost';
    }
    if (tgHostParty.has(p.id)) {
      matchedBy.add('telegram_verified');
      role = role ?? 'host';
    }
    if (payoutParty.has(p.id)) {
      matchedBy.add('wallet');
      role = role ?? 'host';
    }
    if (!role) continue;

    events.push({
      slug: p.customUrl || p.inviteCode,
      city: p.city ?? null,
      status: p.underbossStatus,
      type: p.eventType ?? 'gpp',
      date: p.date ? p.date.toISOString() : null,
      role,
      matchedBy: [...matchedBy].sort(),
    });
  }
  return events;
}
