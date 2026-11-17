/**
 * Guest attendance lookup for PizzaDAO's member app (service-to-service).
 *
 * Answers: "which events did the person behind these identifiers actually check in to?"
 * Used by pizzadao.org's "Events attended" profile section. HTTP surface and auth live in
 * routes/service.routes.ts (POST /api/service/guest-attendance).
 *
 * Identifiers:
 *   emailHashes  sha256 hex of lower(trim(email)) matched against guests.email (the same
 *                contract as /api/service/telegram/host-match). Hashed in Postgres with the
 *                built-in sha256(), so no extension and no plaintext address on the wire.
 *   wallets      guests.ethereum_address, compared case-insensitively (EVM addresses only).
 *
 * A row counts only when the guest was checked in (checked_in_at set), the guest row is not
 * cancelled/declined, the party is not cancelled and its type is standard, gpp, side or unset
 * (private events are never returned).
 *
 * The result carries no PII about anyone: per event only id, name, date, city, public URL,
 * which kind of identifier matched, and whether the host hides the guest list (so the caller
 * can show it to the member alone). Never other guests, counts, names, emails or wallets.
 */
import { prisma } from '../config/database.js';
import { brandUrl } from '../config/brand.js';
import { WALLET_RE, MAX_IDENTIFIERS_PER_KIND, IdentifierError } from './gppHostLookup.js';

export const MAX_DRY_RUN_HASHES = 25;
export const MAX_ATTENDED_EVENTS = 100;
const HASH_RE = /^[0-9a-f]{64}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
export const ATTENDANCE_EVENT_TYPES = ['standard', 'gpp', 'side'] as const;

export interface AttendanceQuery {
  dryRun: boolean;
  emailHashes: string[];
  wallets: string[];
}

export interface AttendedEvent {
  eventId: string;
  name: string;
  date: string | null;
  city: string | null;
  url: string | null;
  matchedBy: Array<'email' | 'wallet'>;
  hideGuestList: boolean;
}

function strings(v: unknown, name: string, max: number): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new IdentifierError(`${name} must be an array`);
  if (v.length > max) throw new IdentifierError(`At most ${max} ${name}`);
  return v;
}

/** Validate + normalize the body. Throws IdentifierError. */
export function parseAttendanceQuery(body: unknown): AttendanceQuery {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new IdentifierError('Body must be a JSON object');
  const b = body as Record<string, unknown>;
  if (b.dryRun !== undefined && typeof b.dryRun !== 'boolean') throw new IdentifierError('dryRun must be a boolean');
  const dryRun = b.dryRun === true;

  const hashes = new Set<string>();
  for (const h of strings(b.emailHashes, 'emailHashes', dryRun ? MAX_DRY_RUN_HASHES : MAX_IDENTIFIERS_PER_KIND)) {
    const v = typeof h === 'string' ? h.trim().toLowerCase() : '';
    if (!HASH_RE.test(v)) throw new IdentifierError('emailHashes must be lowercase sha256 hex strings');
    hashes.add(v);
  }
  if (dryRun && b.wallets !== undefined && !(Array.isArray(b.wallets) && b.wallets.length === 0)) {
    throw new IdentifierError('dryRun counts email hashes only');
  }
  const wallets = new Set<string>();
  for (const w of strings(b.wallets, 'wallets', MAX_IDENTIFIERS_PER_KIND)) {
    const t = typeof w === 'string' ? w.trim() : '';
    if (!WALLET_RE.test(t) || !EVM_RE.test(t)) throw new IdentifierError('wallets must be EVM addresses');
    wallets.add(t.toLowerCase());
  }
  if (hashes.size + wallets.size === 0) throw new IdentifierError('Provide at least one of emailHashes, wallets');
  return { dryRun, emailHashes: [...hashes], wallets: [...wallets] };
}

interface MatchRow {
  party_id: string;
  email_hash: string | null;
  wallet: string | null;
}

/** Real mode: the member's checked-in events. */
export async function findAttendedEvents(q: AttendanceQuery, db = prisma): Promise<AttendedEvent[]> {
  const rows = await matchRows(q, db);
  const kinds = new Map<string, Set<'email' | 'wallet'>>();
  for (const r of rows) {
    const s = kinds.get(r.party_id) ?? new Set<'email' | 'wallet'>();
    if (r.email_hash && q.emailHashes.includes(r.email_hash)) s.add('email');
    if (r.wallet && q.wallets.includes(r.wallet)) s.add('wallet');
    if (s.size) kinds.set(r.party_id, s);
  }
  if (!kinds.size) return [];

  const parties = await db.party.findMany({
    where: { id: { in: [...kinds.keys()] } },
    select: { id: true, name: true, date: true, city: true, customUrl: true, hideGuests: true, password: true, requireApproval: true },
    orderBy: { date: 'desc' },
    take: MAX_ATTENDED_EVENTS,
  });
  return parties.map((p) => ({
    eventId: p.id,
    name: p.name,
    date: p.date ? p.date.toISOString() : null,
    city: p.city ?? null,
    // Only an openly listed event gets a link: a vanity URL, no password, no approval gate, guest
    // list not hidden. The invite code is a capability for the rest, so it is never returned.
    url: p.customUrl && !p.password && !p.requireApproval && !p.hideGuests ? brandUrl(p.customUrl) : null,
    matchedBy: [...kinds.get(p.id)!].sort(),
    hideGuestList: p.hideGuests === true,
  }));
}

/** Dry-run mode: how many of the supplied email hashes have at least one qualifying check-in. */
export async function countMatchedMembers(q: AttendanceQuery, db = prisma): Promise<number> {
  const rows = await matchRows(q, db);
  const want = new Set(q.emailHashes);
  return new Set(rows.map((r) => r.email_hash).filter((h): h is string => !!h && want.has(h))).size;
}

/**
 * Two index-backed branches (see migrations/20261117000000_guest_attendance_indexes): email via
 * public.guest_email_sha256(email), wallet via lower(ethereum_address), both partial on
 * checked_in_at IS NOT NULL. The expressions here must stay identical to the index definitions.
 */
async function matchRows(q: AttendanceQuery, db = prisma): Promise<MatchRow[]> {
  return db.$queryRaw<MatchRow[]>`
    SELECT m.party_id::text AS party_id, m.email_hash, m.wallet
    FROM (
      SELECT g.party_id, public.guest_email_sha256(g.email) AS email_hash, NULL::text AS wallet
      FROM guests g
      WHERE g.checked_in_at IS NOT NULL
        AND g.status NOT IN ('CANCELLED', 'DECLINED')
        AND public.guest_email_sha256(g.email) = ANY(${q.emailHashes}::text[])
      UNION
      SELECT g.party_id, NULL::text AS email_hash, lower(g.ethereum_address) AS wallet
      FROM guests g
      WHERE g.checked_in_at IS NOT NULL
        AND g.status NOT IN ('CANCELLED', 'DECLINED')
        AND lower(g.ethereum_address) = ANY(${q.wallets}::text[])
    ) m
    JOIN parties p ON p.id = m.party_id
    WHERE p.cancelled_at IS NULL
      AND (p.event_type IS NULL OR p.event_type = ANY(${[...ATTENDANCE_EVENT_TYPES]}::text[]))
    LIMIT 2000`;
}
