/**
 * Fake-event detection — composite review queue (blackolive-74932)
 *
 * Pure functions, one per heuristic, plus `scoreEvent` aggregator.
 * No DB access — caller supplies pre-fetched data.
 *
 * Plan: plans/blackolive-74932-fake-detection.md
 */

// ============================================
// Types
// ============================================

export interface FakeDetectionGuest {
  id?: string;
  name: string;
  email: string | null;
  ethereumAddress: string | null;
  submittedAt: Date;
  submittedVia: string;
  waitlistPosition: number | null;
  walletSource: string | null;
  likedToppings: string[];
  dislikedToppings: string[];
  likedBeverages: string[];
  dislikedBeverages: string[];
  dietaryRestrictions: string[];
  roles: string[];
  pizzeriaRankings: string[];
  suggestedPizzerias: unknown; // jsonb
  mailingListOptIn: boolean;
  // romana-30802: cookie-based per-browser session ID; null for legacy rows
  // (pre-2026-05) and for browsers that block cookies.
  visitorSessionId?: string | null;
}

export interface FakeDetectionCoHost {
  name?: string | null;
  twitter?: string | null;
  isUnderboss?: boolean;
  isPartner?: boolean;
}

export interface FakeDetectionParty {
  id: string;
  name: string;
  customUrl: string | null;
  country: string | null;
  region: string | null;
  timezone: string | null;
  maxGuests: number | null;
  createdAt: Date;
  underbossStatus: string | null;
  user: { id?: string; name: string | null; email: string | null } | null;
  coHosts?: unknown; // jsonb — array of co-host objects; validated inside checks
}

export interface FakeDetectionLinkClick {
  clickedAt: Date;
}

export interface FakeDetectionFunnelEvent {
  visitorHash: string;
  step: string;
  createdAt: Date;
}

export interface FlagResult {
  id: string;
  name: string;
  fired: boolean;
  weight: number;
  detail: string;
  evidence?: Record<string, unknown>;
}

export type Tier = 'high' | 'medium' | 'low' | 'clean';

export interface FakeDetectionRow {
  id: string;
  name: string;
  customUrl: string | null;
  country: string | null;
  region: string | null;
  underbossStatus: string | null;
  hostName: string | null;
  hostEmail: string | null;
  rsvpCount: number;
  maxGuests: number | null;
  score: number;
  tier: Tier;
  flags: FlagResult[];
}

// ============================================
// Weights (tunable without code surgery)
// ============================================

export const WEIGHTS = {
  cap_fill_no_waitlist: 15,
  low_domain_entropy: 10,
  wallet_too_low: 8,
  wallet_too_high_reuse: 8,
  wallet_reuse: 10,
  host_self_rsvp_mismatch: 20,
  pizzeria_fields_blank: 5,
  wallet_source_all_null: 5,
  one_word_name: 5,
  firstname_digits_email: 5,
  day_gap_pattern: 7,
  low_hour_entropy: 7,
  rapid_intersubmission: 8,
  cross_event_wallet: 15,
  low_funnel_coverage: 10,
  high_per_visitor_rsvp_saturation: 20,
  mailing_list_opt_in_extreme: 7,
  name_token_zscore: 8,
  lsh_field_sig_cluster: 10,
  email_digit_benford: 5,
  co_host_twitter_handles_missing: 12,
  repeat_session_rsvp_count: 20,
} as const;

// ============================================
// Helpers
// ============================================

/** Shannon entropy (log base 2). Returns 0 for empty input. */
export function shannon(values: string[]): number {
  if (values.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const n = values.length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / n;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Canonical field signature — arrays sorted before stringify. */
export function fieldSignature(g: FakeDetectionGuest): string {
  return JSON.stringify([
    [...g.likedToppings].sort(),
    [...g.dislikedToppings].sort(),
    [...g.likedBeverages].sort(),
    [...g.dislikedBeverages].sort(),
    [...g.dietaryRestrictions].sort(),
    [...g.roles].sort(),
  ]);
}

/** Extract domain (lowercase, trimmed) from an email. Returns empty string if no email. */
function emailDomain(email: string | null): string {
  if (!email) return '';
  const at = email.lastIndexOf('@');
  if (at === -1) return '';
  return email.slice(at + 1).trim().toLowerCase();
}

/** Get the local hour (0–23) of a timestamp in a given IANA timezone. */
function localHour(date: Date, timezone: string | null): number {
  if (!timezone) {
    return date.getUTCHours();
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const hourPart = parts.find(p => p.type === 'hour');
    if (!hourPart) return date.getUTCHours();
    const h = parseInt(hourPart.value, 10);
    // Intl can emit "24" for midnight in some implementations — normalize.
    return Number.isFinite(h) ? h % 24 : date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}

/** Get the local date string (YYYY-MM-DD) of a timestamp in a given IANA timezone. */
function localDateKey(date: Date, timezone: string | null): string {
  if (!timezone) {
    return date.toISOString().slice(0, 10);
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(date); // en-CA → YYYY-MM-DD
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Filter to direct RSVPs only (link/rsvp/api) — exclude invites/host/check-in. */
export function filterDirectRsvps(guests: FakeDetectionGuest[]): FakeDetectionGuest[] {
  return guests.filter(g => ['link', 'rsvp', 'api'].includes(g.submittedVia));
}

/**
 * FNV-1a 32-bit hash. Stable, dependency-free, fast.
 * Used as the per-token hash for SimHash.
 */
export function fnv32(input: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // Multiply by FNV prime (0x01000193) using Math.imul for 32-bit overflow semantics
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // coerce to unsigned 32-bit
}

/**
 * 32-bit SimHash over a token array.
 * Per bit position, accumulate +1 if token-hash bit is set else -1; final bit
 * = sign(accumulator). Empty input → 0.
 */
export function simhash32(tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const v = new Int32Array(32);
  for (const t of tokens) {
    const h = fnv32(t);
    for (let b = 0; b < 32; b++) {
      v[b] += (h >>> b) & 1 ? 1 : -1;
    }
  }
  let sig = 0;
  for (let b = 0; b < 32; b++) {
    if (v[b] > 0) sig |= 1 << b;
  }
  return sig >>> 0;
}

/** Hamming distance between two 32-bit unsigned integers. */
export function hammingDistance(a: number, b: number): number {
  let x = (a ^ b) >>> 0;
  let count = 0;
  while (x !== 0) {
    count += x & 1;
    x = x >>> 1;
  }
  return count;
}

/**
 * Canonical Benford's-law expected probabilities for leading digit 1..9.
 * P(d) = log10(1 + 1/d). Indexed [0] = digit 1, ... [8] = digit 9.
 * Hard-coded to avoid floating-point recompute and to keep the constants
 * inspectable. If empirical reference becomes preferable, swap this table.
 */
export const BENFORD_EXPECTED: readonly number[] = [
  0.301, // 1
  0.176, // 2
  0.125, // 3
  0.097, // 4
  0.079, // 5
  0.067, // 6
  0.058, // 7
  0.051, // 8
  0.046, // 9
] as const;

// ============================================
// Per-heuristic functions
// All accept the already-filtered direct-RSVP guest array.
// Each returns { fired, weight, detail, evidence? }.
// ============================================

function flag(
  id: keyof typeof WEIGHTS,
  fired: boolean,
  detail: string,
  evidence?: Record<string, unknown>,
): FlagResult {
  return {
    id,
    name: id,
    fired,
    weight: WEIGHTS[id],
    detail,
    evidence,
  };
}

/** 1. cap_fill_no_waitlist — capacity ≥90% full but zero waitlist. */
export function checkCapFillNoWaitlist(
  guests: FakeDetectionGuest[],
  maxGuests: number | null,
): FlagResult {
  const id = 'cap_fill_no_waitlist';
  const n = guests.length;
  if (n < 20 || !maxGuests || maxGuests <= 0) {
    return flag(id, false, `n=${n}, maxGuests=${maxGuests ?? 'null'} — below threshold`);
  }
  const fill = n / maxGuests;
  const waitlistCount = guests.filter(g => g.waitlistPosition !== null && g.waitlistPosition > 0).length;
  const fired = fill >= 0.9 && waitlistCount === 0;
  return flag(
    id,
    fired,
    `fill=${(fill * 100).toFixed(1)}%, waitlist=${waitlistCount}`,
    { fill, waitlistCount, n, maxGuests },
  );
}

/** 2. low_domain_entropy — email domains are too uniform. */
export function checkLowDomainEntropy(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'low_domain_entropy';
  const n = guests.length;
  if (n < 20) return flag(id, false, `n=${n} below 20`);
  const domains = guests.map(g => emailDomain(g.email)).filter(d => d.length > 0);
  if (domains.length === 0) return flag(id, false, 'no emails');
  const h = shannon(domains);
  const fired = h < 0.2;
  return flag(id, fired, `entropy=${h.toFixed(3)}`, { entropy: h, domainCount: domains.length });
}

/**
 * 3. sig_collapse — field signatures collapse to ≤ a few distinct patterns.
 *
 * DEPRECATED in calzone-75655 — superseded by `lsh_field_sig_cluster` which
 * tolerates 1–2 bit variations and catches the same pattern. No longer wired
 * into `scoreEvent` and no longer in `WEIGHTS`. Kept exported because other
 * code may still import it; uses a literal weight rather than `flag()`.
 */
export function checkSigCollapse(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'sig_collapse';
  const SIG_COLLAPSE_WEIGHT = 15; // legacy weight — see lsh_field_sig_cluster for current behavior
  const n = guests.length;
  if (n < 20) {
    return { id, name: id, fired: false, weight: SIG_COLLAPSE_WEIGHT, detail: `n=${n} below 20` };
  }
  const sigCounts = new Map<string, number>();
  for (const g of guests) {
    const s = fieldSignature(g);
    sigCounts.set(s, (sigCounts.get(s) ?? 0) + 1);
  }
  const unique = sigCounts.size;
  const sortedCounts = [...sigCounts.values()].sort((a, b) => b - a);
  const top3 = sortedCounts.slice(0, 3).reduce((a, b) => a + b, 0);
  const uniqueRatio = unique / n;
  const top3Share = top3 / n;
  const fired = uniqueRatio < 0.2 || top3Share > 0.7;
  return {
    id,
    name: id,
    fired,
    weight: SIG_COLLAPSE_WEIGHT,
    detail: `unique=${unique}/${n} (${(uniqueRatio * 100).toFixed(1)}%), top3=${(top3Share * 100).toFixed(1)}%`,
    evidence: { unique, top3, uniqueRatio, top3Share, n },
  };
}

/** 4a. wallet_too_low — almost nobody connected a wallet. */
export function checkWalletTooLow(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'wallet_too_low';
  const n = guests.length;
  if (n < 30) return flag(id, false, `n=${n} below 30`);
  const walletCount = guests.filter(g => g.ethereumAddress && g.ethereumAddress.length > 0).length;
  const ratio = walletCount / n;
  const fired = ratio < 0.05;
  return flag(id, fired, `wallets=${walletCount}/${n} (${(ratio * 100).toFixed(1)}%)`, { walletCount, n, ratio });
}

/** 4b. wallet_too_high_reuse — everyone has a wallet but lots of reuse. */
export function checkWalletTooHighReuse(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'wallet_too_high_reuse';
  const n = guests.length;
  if (n < 30) return flag(id, false, `n=${n} below 30`);
  const walletAddrs = guests
    .map(g => (g.ethereumAddress ?? '').toLowerCase())
    .filter(a => a.length > 0);
  const walletCount = walletAddrs.length;
  if (walletCount === 0) return flag(id, false, 'no wallets');
  const uniqueWallets = new Set(walletAddrs).size;
  const walletRatio = walletCount / n;
  const reuse = (walletCount - uniqueWallets) / walletCount;
  const fired = walletRatio > 0.95 && reuse > 0.3;
  return flag(
    id,
    fired,
    `wallets=${(walletRatio * 100).toFixed(1)}% of RSVPs, reuse=${(reuse * 100).toFixed(1)}%`,
    { walletRatio, reuse, walletCount, uniqueWallets, n },
  );
}

/** 5. wallet_reuse — same wallet address used multiple times on the same event. */
export function checkWalletReuse(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'wallet_reuse';
  const n = guests.length;
  if (n < 10) return flag(id, false, `n=${n} below 10`);
  const ethSubs = guests
    .map(g => (g.ethereumAddress ?? '').toLowerCase())
    .filter(a => a.length > 0);
  if (ethSubs.length === 0) return flag(id, false, 'no wallets');
  const uniqueEth = new Set(ethSubs).size;
  const reuse = (ethSubs.length - uniqueEth) / Math.max(ethSubs.length, 1);
  const fired = reuse >= 0.1;
  return flag(
    id,
    fired,
    `${ethSubs.length} wallets, ${uniqueEth} unique, reuse=${(reuse * 100).toFixed(1)}%`,
    { ethSubs: ethSubs.length, uniqueEth, reuse },
  );
}

/** 6. host_self_rsvp_mismatch — host RSVPed within 60s of event create under a different name. */
export function checkHostSelfRsvpMismatch(
  guests: FakeDetectionGuest[],
  party: FakeDetectionParty,
): FlagResult {
  const id = 'host_self_rsvp_mismatch';
  const hostName = (party.user?.name ?? '').trim().toLowerCase();
  const hostEmail = (party.user?.email ?? '').trim().toLowerCase();
  if (!party.createdAt) return flag(id, false, 'no createdAt');
  const createdAtMs = party.createdAt.getTime();

  const matches: { guestName: string; deltaSec: number }[] = [];
  for (const g of guests) {
    const deltaSec = (g.submittedAt.getTime() - createdAtMs) / 1000;
    if (deltaSec < 0 || deltaSec > 60) continue;
    const gName = (g.name ?? '').trim().toLowerCase();
    const gEmail = (g.email ?? '').trim().toLowerCase();
    // Mismatch = neither name nor email matches the host
    const nameMatch = hostName !== '' && gName === hostName;
    const emailMatch = hostEmail !== '' && gEmail === hostEmail;
    if (!nameMatch && !emailMatch) {
      matches.push({ guestName: g.name, deltaSec });
    }
  }
  const fired = matches.length > 0;
  return flag(
    id,
    fired,
    fired
      ? `${matches.length} sub-60s RSVP(s) with name mismatch (host=${hostName || hostEmail || 'unknown'})`
      : 'no sub-60s name-mismatch RSVPs',
    fired ? { matches: matches.slice(0, 5) } : undefined,
  );
}

/** 7. pizzeria_fields_blank — almost no RSVPs filled pizzeria rankings or suggestions. */
export function checkPizzeriaFieldsBlank(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'pizzeria_fields_blank';
  const n = guests.length;
  if (n < 20) return flag(id, false, `n=${n} below 20`);
  let blankRankings = 0;
  let blankSuggested = 0;
  for (const g of guests) {
    if (!Array.isArray(g.pizzeriaRankings) || g.pizzeriaRankings.length === 0) blankRankings++;
    const sp = g.suggestedPizzerias;
    if (!Array.isArray(sp) || sp.length === 0) blankSuggested++;
  }
  const r1 = blankRankings / n;
  const r2 = blankSuggested / n;
  const fired = r1 > 0.95 && r2 > 0.95;
  return flag(
    id,
    fired,
    `blankRankings=${(r1 * 100).toFixed(1)}%, blankSuggested=${(r2 * 100).toFixed(1)}%`,
    { blankRankings, blankSuggested, n },
  );
}

/** 8. wallet_source_all_null — every wallet_source is null. */
export function checkWalletSourceAllNull(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'wallet_source_all_null';
  const n = guests.length;
  if (n < 30) return flag(id, false, `n=${n} below 30`);
  const allNull = guests.every(g => g.walletSource === null);
  return flag(id, allNull, allNull ? 'every walletSource is null' : 'some walletSource set', { n });
}

/** 9. one_word_name — too many single-word guest names. */
export function checkOneWordName(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'one_word_name';
  const n = guests.length;
  if (n < 20) return flag(id, false, `n=${n} below 20`);
  let oneWord = 0;
  for (const g of guests) {
    const name = (g.name ?? '').trim();
    if (name.length === 0) continue;
    const wordCount = name.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount === 1) oneWord++;
  }
  const ratio = oneWord / n;
  const fired = ratio > 0.2;
  return flag(id, fired, `${oneWord}/${n} (${(ratio * 100).toFixed(1)}%) one-word names`, { oneWord, n, ratio });
}

/** 10. firstname_digits_email — emails follow firstname+digits pattern and domains are low-entropy. */
export function checkFirstnameDigitsEmail(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'firstname_digits_email';
  const n = guests.length;
  if (n < 20) return flag(id, false, `n=${n} below 20`);
  const emails = guests.map(g => (g.email ?? '').toLowerCase()).filter(e => e.length > 0);
  if (emails.length === 0) return flag(id, false, 'no emails');
  // firstname (letters) + digits (one or more) @ domain
  const pattern = /^[a-z]+\d+@/;
  const matches = emails.filter(e => pattern.test(e)).length;
  const ratio = matches / n;
  const domains = emails.map(e => e.slice(e.lastIndexOf('@') + 1)).filter(d => d.length > 0);
  const domainEntropy = shannon(domains);
  const fired = ratio > 0.95 && domainEntropy < 0.5;
  return flag(
    id,
    fired,
    `match=${(ratio * 100).toFixed(1)}%, domainEntropy=${domainEntropy.toFixed(3)}`,
    { matches, n, ratio, domainEntropy },
  );
}

/**
 * 11. day_gap_pattern — RSVP timeline has zero days bracketed by ≥5-RSVP days,
 * with no link_click spike on the zero days.
 * Skips cleanly when link_clicks is empty (older events).
 */
export function checkDayGapPattern(
  guests: FakeDetectionGuest[],
  party: FakeDetectionParty,
  linkClicks: FakeDetectionLinkClick[],
): FlagResult {
  const id = 'day_gap_pattern';
  const n = guests.length;
  if (n < 20) return flag(id, false, `n=${n} below 20`);
  if (!linkClicks || linkClicks.length === 0) {
    return flag(id, false, 'no link_clicks data — skipping');
  }
  const tz = party.timezone;

  // Bucket RSVPs by local-date
  const rsvpByDay = new Map<string, number>();
  for (const g of guests) {
    const k = localDateKey(g.submittedAt, tz);
    rsvpByDay.set(k, (rsvpByDay.get(k) ?? 0) + 1);
  }
  // Bucket clicks the same way
  const clicksByDay = new Map<string, number>();
  for (const c of linkClicks) {
    const k = localDateKey(c.clickedAt, tz);
    clicksByDay.set(k, (clicksByDay.get(k) ?? 0) + 1);
  }

  // Build contiguous day series from min RSVP date to max RSVP date
  const days = [...rsvpByDay.keys()].sort();
  if (days.length === 0) return flag(id, false, 'no RSVP days');
  const start = new Date(days[0] + 'T00:00:00Z').getTime();
  const end = new Date(days[days.length - 1] + 'T00:00:00Z').getTime();
  const series: { day: string; rsvps: number; clicks: number }[] = [];
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    series.push({ day: d, rsvps: rsvpByDay.get(d) ?? 0, clicks: clicksByDay.get(d) ?? 0 });
  }
  if (series.length < 4) return flag(id, false, `series length ${series.length} too short`);

  // Scan for [≥5 RSVPs] [≥2 consecutive zero RSVPs with no click spike] [≥5 RSVPs]
  for (let i = 1; i <= series.length - 3; i++) {
    if (series[i - 1].rsvps < 5) continue;
    // Find the zero-run starting at i
    let j = i;
    while (j < series.length && series[j].rsvps === 0) j++;
    const runLen = j - i;
    if (runLen < 2) continue;
    if (j >= series.length) continue;
    if (series[j].rsvps < 5) continue;
    // No click spike (we consider a "spike" as ≥3 clicks) during the zero days
    const anySpike = series.slice(i, j).some(d => d.clicks >= 3);
    if (!anySpike) {
      return flag(
        id,
        true,
        `${runLen}-day RSVP gap (${series[i].day}..${series[j - 1].day}) bracketed by ≥5-RSVP days with no click spike`,
        { gapStart: series[i].day, gapEnd: series[j - 1].day, runLen },
      );
    }
  }
  return flag(id, false, 'no qualifying day-gap pattern');
}

/** 12. low_hour_entropy — submissions cluster into too few local hours. */
export function checkLowHourEntropy(
  guests: FakeDetectionGuest[],
  party: FakeDetectionParty,
): FlagResult {
  const id = 'low_hour_entropy';
  const n = guests.length;
  if (n < 20) return flag(id, false, `n=${n} below 20`);
  const hours = guests.map(g => String(localHour(g.submittedAt, party.timezone)));
  const h = shannon(hours);
  const fired = h < 1.5;
  return flag(id, fired, `localHourEntropy=${h.toFixed(3)}`, { entropy: h, n });
}

/** 13. rapid_intersubmission — median delta between consecutive RSVPs is ≤ 60s. */
export function checkRapidIntersubmission(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'rapid_intersubmission';
  const n = guests.length;
  if (n < 30) return flag(id, false, `n=${n} below 30`);
  const sorted = [...guests].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    deltas.push((sorted[i].submittedAt.getTime() - sorted[i - 1].submittedAt.getTime()) / 1000);
  }
  if (deltas.length === 0) return flag(id, false, 'no deltas');
  const sortedDeltas = [...deltas].sort((a, b) => a - b);
  const mid = Math.floor(sortedDeltas.length / 2);
  const median =
    sortedDeltas.length % 2 === 0
      ? (sortedDeltas[mid - 1] + sortedDeltas[mid]) / 2
      : sortedDeltas[mid];
  const fired = median <= 60;
  return flag(id, fired, `medianDeltaSec=${median.toFixed(1)}`, { medianDeltaSec: median, n: deltas.length });
}

/** 14. cross_event_wallet — any guest wallet appears on the sybil-wallet set. */
export function checkCrossEventWallet(
  guests: FakeDetectionGuest[],
  sybilWallets: Set<string>,
): FlagResult {
  const id = 'cross_event_wallet';
  const matched: string[] = [];
  for (const g of guests) {
    const addr = (g.ethereumAddress ?? '').toLowerCase();
    if (addr && sybilWallets.has(addr)) {
      matched.push(addr);
    }
  }
  const fired = matched.length > 0;
  return flag(
    id,
    fired,
    fired ? `${matched.length} sybil wallet(s) on this event` : 'no sybil wallets',
    fired ? { wallets: matched.slice(0, 5) } : undefined,
  );
}

/**
 * 15. low_funnel_coverage — unique `rsvp_opened` visitors are too few relative to direct RSVPs.
 * Indicates RSVPs were not preceded by real page-open events (bot/scripted submissions).
 */
export function checkLowFunnelCoverage(
  guests: FakeDetectionGuest[],
  funnelEvents: FakeDetectionFunnelEvent[],
): FlagResult {
  const id = 'low_funnel_coverage';
  const n = guests.length;
  if (n < 30) return flag(id, false, `n=${n} below 30`);
  const opened = funnelEvents.filter(e => e.step === 'rsvp_opened');
  const uniqueVisitors = new Set(opened.map(e => e.visitorHash)).size;
  const ratio = uniqueVisitors / n;
  const fired = ratio < 0.15;
  return flag(
    id,
    fired,
    `coverage=${uniqueVisitors}/${n} (${(ratio * 100).toFixed(1)}%)`,
    { uniqueVisitors, linkRsvpCount: n, ratio },
  );
}

/**
 * 16. high_per_visitor_rsvp_saturation — one visitor's funnel timestamps temporally match many guest submissions.
 * Temporal join: for each visitorHash's funnel `createdAt` values, count distinct guests whose
 * `submittedAt` is within ±10 min of any of that visitor's funnel timestamps.
 *
 * Refined in parmesan-67529: we now also track `secondMax` and require either
 *   - only one visitor matched ≥1 guest (secondMax === 0), or
 *   - the top visitor padded much harder than the runner-up (max / secondMax ≥ 1.5).
 * This distinguishes the single-padder spike (Owerri [13,8,6], Bwejuu [17,4,3])
 * from flat QR-kiosk distributions (NYC Pizza Temple [10,10,10], Santa Cruz
 * [28,28,26]) where organizer phones happen to sit on the form during attendee
 * submission bursts.
 */
export function checkHighPerVisitorRsvpSaturation(
  guests: FakeDetectionGuest[],
  funnelEvents: FakeDetectionFunnelEvent[],
): FlagResult {
  const id = 'high_per_visitor_rsvp_saturation';
  if (funnelEvents.length === 0 || guests.length === 0) {
    return flag(id, false, 'no funnel data');
  }
  const TEN_MIN = 10 * 60 * 1000;
  const byVisitor = new Map<string, number[]>();
  for (const e of funnelEvents) {
    const arr = byVisitor.get(e.visitorHash) ?? [];
    arr.push(e.createdAt.getTime());
    byVisitor.set(e.visitorHash, arr);
  }
  let max = 0;
  let secondMax = 0;
  let worstVisitor = '';
  for (const [visitor, timestamps] of byVisitor) {
    const matched = new Set<string>();
    for (const g of guests) {
      const gms = g.submittedAt.getTime();
      if (timestamps.some(t => Math.abs(t - gms) <= TEN_MIN)) {
        matched.add(g.id ?? `${g.email ?? g.name}-${gms}`);
      }
    }
    if (matched.size > max) {
      secondMax = max;
      max = matched.size;
      worstVisitor = visitor;
    } else if (matched.size > secondMax) {
      secondMax = matched.size;
    }
  }
  const ratio = secondMax > 0 ? max / secondMax : Infinity;
  const fired = max >= 5 && (secondMax === 0 || ratio >= 1.5);
  return flag(
    id,
    fired,
    `max=${max}, secondMax=${secondMax} (ratio=${secondMax > 0 ? ratio.toFixed(2) : '∞'})`,
    { max, secondMax, ratio: secondMax > 0 ? ratio : null, visitorHash: worstVisitor.slice(0, 8) },
  );
}

/**
 * #3 — mailing_list_opt_in_extreme. The mailing-list opt-in checkbox is
 * always defaulted UNCHECKED, so both bounds (<5% AND >95%) are anomalous:
 * one human ticking/unticking the default for every fake guest is the tell.
 */
export function checkMailingListOptInExtreme(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'mailing_list_opt_in_extreme';
  const n = guests.length;
  if (n < 20) return flag(id, false, `n=${n} below 20`);
  const optIns = guests.filter(g => g.mailingListOptIn === true).length;
  const rate = optIns / n;
  const fired = rate < 0.05 || rate > 0.95;
  return flag(
    id,
    fired,
    `optInRate=${(rate * 100).toFixed(1)}% (${optIns}/${n})`,
    { optIns, n, rate },
  );
}

/**
 * #9 — name_token_zscore. Quantifies repetition of first-token names
 * (lowercase) across guests. Real African events have repeating common names
 * but the z-score of the *max* count over the per-event distribution is
 * bounded; an Ilemela-like "John ×8 / Juma ×7" pushes the max well past 3σ.
 *
 * Both conditions required: `maxCount >= 5` filters out small-tail noise,
 * `z > 3.0` filters out events where 5+ is the natural mode.
 */
export function checkNameTokenZscore(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'name_token_zscore';
  const n = guests.length;
  if (n < 30) return flag(id, false, `n=${n} below 30`);
  const counts = new Map<string, number>();
  for (const g of guests) {
    const first = (g.name ?? '').trim().toLowerCase().split(/\s+/)[0];
    if (!first) continue;
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  if (counts.size === 0) return flag(id, false, 'no names');
  const arr = [...counts.values()];
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  const stdev = Math.sqrt(variance);
  let maxCount = 0;
  let maxToken = '';
  for (const [tok, c] of counts) {
    if (c > maxCount) {
      maxCount = c;
      maxToken = tok;
    }
  }
  const z = stdev > 0 ? (maxCount - mean) / stdev : 0;
  const fired = maxCount >= 5 && z > 3.0;
  return flag(
    id,
    fired,
    `top first-token "${maxToken}" ×${maxCount}, z=${z.toFixed(2)} (mean=${mean.toFixed(2)}, stdev=${stdev.toFixed(2)})`,
    { maxToken, maxCount, mean, stdev, z, tokenCount: counts.size, n },
  );
}

/**
 * #21 — lsh_field_sig_cluster. Locality-sensitive hash over the same fields
 * `sig_collapse` watches, but tolerates 1–2 bit Hamming variations so it
 * survives the anchovies-default-mutation bug and similar near-duplicates.
 *
 * Compute SimHash per guest over feature tokens; for each guest, count how
 * many other guests are within Hamming distance ≤ 2. The largest such cluster
 * indicates how many guests share an "almost identical" field profile.
 * Fire if largest cluster > 40% of guests.
 */
export function checkLshFieldSigCluster(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'lsh_field_sig_cluster';
  const n = guests.length;
  if (n < 30) return flag(id, false, `n=${n} below 30`);
  const sigs: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const g = guests[i];
    const tokens: string[] = [];
    for (const t of g.likedToppings) tokens.push(`lt:${t}`);
    for (const t of g.dislikedToppings) tokens.push(`dt:${t}`);
    for (const t of g.likedBeverages) tokens.push(`lb:${t}`);
    for (const t of g.dislikedBeverages) tokens.push(`db:${t}`);
    for (const t of g.dietaryRestrictions) tokens.push(`dr:${t}`);
    for (const t of g.roles) tokens.push(`r:${t}`);
    sigs[i] = simhash32(tokens);
  }
  let maxCluster = 0;
  for (let i = 0; i < n; i++) {
    let cluster = 1; // count self
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (hammingDistance(sigs[i], sigs[j]) <= 2) cluster++;
    }
    if (cluster > maxCluster) maxCluster = cluster;
  }
  const share = maxCluster / n;
  const fired = share > 0.4;
  return flag(
    id,
    fired,
    `largestCluster=${maxCluster}/${n} (${(share * 100).toFixed(1)}%) within Hamming ≤ 2`,
    { maxCluster, n, share },
  );
}

/**
 * #22 — email_digit_benford. Padders generating fake "year suffix" emails
 * (mario78@, mario83@, mario91@) skew leading digits toward 7–9. Real digit
 * suffixes follow Benford-ish (leading digit 1 most common).
 *
 * Extract trailing digit run from each email's local-part; compute observed
 * leading-digit distribution over digits 1..9; sum-absolute-deviation from
 * canonical Benford. Fire if SAD > 0.40.
 */
export function checkEmailDigitBenford(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'email_digit_benford';
  const counts = new Array<number>(9).fill(0);
  let total = 0;
  for (const g of guests) {
    const e = (g.email ?? '').toLowerCase();
    const at = e.indexOf('@');
    if (at <= 0) continue;
    const local = e.slice(0, at);
    const m = local.match(/(\d+)$/);
    if (!m) continue;
    const digits = m[1];
    // Leading digit, ignoring leading zeros (e.g. "007" → '7', "0" → skip)
    let leadIdx = -1;
    for (let i = 0; i < digits.length; i++) {
      const d = digits.charCodeAt(i) - 48;
      if (d >= 1 && d <= 9) {
        leadIdx = d;
        break;
      }
    }
    if (leadIdx === -1) continue;
    counts[leadIdx - 1]++;
    total++;
  }
  if (total < 30) {
    return flag(id, false, `emails-with-digit-suffix=${total} below 30`);
  }
  let sad = 0;
  const observed: number[] = new Array<number>(9).fill(0);
  for (let i = 0; i < 9; i++) {
    observed[i] = counts[i] / total;
    sad += Math.abs(observed[i] - BENFORD_EXPECTED[i]);
  }
  const fired = sad > 0.4;
  return flag(
    id,
    fired,
    `SAD=${sad.toFixed(3)} over ${total} digit-suffix emails`,
    { sad, total, observed },
  );
}

/**
 * 17. co_host_twitter_handles_missing — among "real" co-hosts (excluding internal
 * underboss entries and partner-brand entries), too many are missing a twitter
 * handle. Real volunteer co-hosts almost always have an X/Twitter handle attached;
 * a high missing-rate suggests placeholder/padded co-hosts.
 *
 * Filters out `isUnderboss === true` and `isPartner === true` entries (their
 * twitter handles are often empty by design).
 *
 * Fires when filtered set has ≥2 entries and missing/filtered > 0.25.
 */
export function checkCoHostTwitterHandlesMissing(party: FakeDetectionParty): FlagResult {
  const id = 'co_host_twitter_handles_missing';
  const raw = Array.isArray(party.coHosts) ? party.coHosts : [];
  // Narrow to plain objects and exclude underboss/partner entries.
  const filtered: FakeDetectionCoHost[] = raw
    .filter((h): h is FakeDetectionCoHost => typeof h === 'object' && h !== null)
    .filter(h => h.isUnderboss !== true && h.isPartner !== true);

  const filteredTotal = filtered.length;
  if (filteredTotal < 2) {
    return flag(id, false, `filteredTotal=${filteredTotal} below min n=2`);
  }

  const missingEntries = filtered.filter(h => {
    const t = typeof h.twitter === 'string' ? h.twitter.trim() : '';
    return t.length === 0;
  });
  const missingCount = missingEntries.length;
  const missingRatio = missingCount / filteredTotal;
  const fired = missingRatio > 0.25;

  const missingNames = missingEntries
    .map(h => (typeof h.name === 'string' ? h.name : ''))
    .filter(n => n.length > 0)
    .slice(0, 10);

  return flag(
    id,
    fired,
    `${missingCount}/${filteredTotal} (${(missingRatio * 100).toFixed(1)}%) co-hosts missing twitter`,
    { missingCount, filteredTotal, missingRatio, missingNames },
  );
}

/**
 * romana-30802: `repeat_session_rsvp_count` — cookie-based padding detector.
 *
 * Each RSVP page mount stamps `_rsvp_sid` (a per-browser UUID) into the guest
 * row's `visitor_session_id`. If the same session ID repeats 5+ times on one
 * event, that's near-certain same-browser padding.
 *
 * Supplements (does not replace) `high_per_visitor_rsvp_saturation`, which uses
 * a SHA-256(IP+UA) proxy joined temporally.
 *
 * - Min-n: need ≥20 guests with non-null session_id to skip legacy events.
 * - Threshold: max repeats ≥ 5 (couples may share a device for 2; 3-4 is rare
 *   but possible; 5+ is padding).
 * - Nulls are ignored — they represent legacy rows and cookie-blocked browsers.
 */
export function checkRepeatSessionRsvpCount(guests: FakeDetectionGuest[]): FlagResult {
  const id = 'repeat_session_rsvp_count';
  const withSession = guests.filter(g => typeof g.visitorSessionId === 'string' && g.visitorSessionId);
  if (withSession.length < 20) {
    return flag(
      id,
      false,
      `only ${withSession.length}/${guests.length} have session_id (need ≥20)`,
    );
  }
  const counts = new Map<string, number>();
  for (const g of withSession) {
    const sid = g.visitorSessionId as string;
    counts.set(sid, (counts.get(sid) ?? 0) + 1);
  }
  let max = 0;
  let worst = '';
  for (const [sid, n] of counts) {
    if (n > max) {
      max = n;
      worst = sid;
    }
  }
  const fired = max >= 5;
  return flag(
    id,
    fired,
    `max repeats=${max} (n_with_session=${withSession.length})`,
    { maxRepeats: max, sessionsWithData: withSession.length, sessionPrefix: worst.slice(0, 8) },
  );
}

// ============================================
// Aggregator
// ============================================

export function tierFromScore(score: number): Tier {
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  if (score >= 10) return 'low';
  return 'clean';
}

export function scoreEvent(
  party: FakeDetectionParty,
  allGuests: FakeDetectionGuest[],
  linkClicks: FakeDetectionLinkClick[],
  sybilWallets: Set<string>,
  maxGuests: number | null,
  funnelEvents: FakeDetectionFunnelEvent[] = [],
): FakeDetectionRow {
  const guests = filterDirectRsvps(allGuests);

  const flags: FlagResult[] = [
    checkCapFillNoWaitlist(guests, maxGuests),
    checkLowDomainEntropy(guests),
    checkWalletTooLow(guests),
    checkWalletTooHighReuse(guests),
    checkWalletReuse(guests),
    checkHostSelfRsvpMismatch(guests, party),
    checkPizzeriaFieldsBlank(guests),
    checkWalletSourceAllNull(guests),
    checkOneWordName(guests),
    checkFirstnameDigitsEmail(guests),
    checkDayGapPattern(guests, party, linkClicks),
    checkLowHourEntropy(guests, party),
    checkRapidIntersubmission(guests),
    checkCrossEventWallet(guests, sybilWallets),
    checkLowFunnelCoverage(guests, funnelEvents),
    checkHighPerVisitorRsvpSaturation(guests, funnelEvents),
    checkMailingListOptInExtreme(guests),
    checkNameTokenZscore(guests),
    checkLshFieldSigCluster(guests),
    checkEmailDigitBenford(guests),
    checkCoHostTwitterHandlesMissing(party),
    checkRepeatSessionRsvpCount(guests),
  ];

  const score = Math.min(
    100,
    flags.filter(f => f.fired).reduce((sum, f) => sum + f.weight, 0),
  );

  return {
    id: party.id,
    name: party.name,
    customUrl: party.customUrl,
    country: party.country,
    region: party.region,
    underbossStatus: party.underbossStatus,
    hostName: party.user?.name ?? null,
    hostEmail: party.user?.email ?? null,
    rsvpCount: guests.length,
    maxGuests,
    score,
    tier: tierFromScore(score),
    flags,
  };
}

/**
 * Build the sybil-wallet set from the raw cross-event aggregation rows.
 * A wallet is sybil if it appears on ≥4 total events under ≥2 distinct names
 * (the threshold Snax confirmed: ≥4 events, ≥2 names).
 */
export function buildSybilWalletSet(
  rows: { ethereumAddress: string; partyIds: string[]; names: string[] }[],
): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    const distinctParties = new Set(row.partyIds).size;
    const distinctNames = new Set(row.names.map(n => n.trim().toLowerCase()).filter(n => n.length > 0)).size;
    if (distinctParties >= 4 && distinctNames >= 2) {
      set.add(row.ethereumAddress.toLowerCase());
    }
  }
  return set;
}
