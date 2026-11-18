/**
 * Partner custom web domain + sending (email) domain flow (plans/wl-self-serve-brands.md PR 16).
 * Everything outside the DB goes through `lib/domainAdapters.ts`, so tests inject fakes.
 *
 * WEB DOMAIN  (event_series.pending_domain*, no schema change)
 *   status: requested -> dns_ok -> attached -> ready -> live        (null = nothing requested)
 *   requested  brand admin asked for a host; we issued the ownership token
 *   dns_ok     the `_rsvpizza.<host>` TXT matches the token (proof of DNS control)
 *   attached   super-admin attached the host to the brand's Vercel project (ONLY after dns_ok)
 *   ready      Vercel reports the host verified and correctly configured
 *   live       super-admin cut over: site_url = the host, the old origin is kept in site_aliases
 *   Brand admins can request, check and cancel (before attach). Attach, cutover and rollback are
 *   super-admin only (enforced here and in the routes). Every step writes a `series_audit` row.
 *   Nothing is attached and no host-to-series mapping exists before the TXT proves control, and a
 *   host already used by another series (site_url, alias or pending) is refused.
 *
 * EMAIL DOMAIN  (event_series.email_domain / resend_domain_id / email_domain_verified_at)
 *   The partner sets a sending subdomain + from address; we create the domain in Resend, show its
 *   records, and `email_domain_verified_at` is set ONLY here, when Resend reports `verified` and the
 *   from address is on that domain. A later `failed`/`not_started` result clears it (cron/check).
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { invalidateSiteBrandCache } from './siteBrand.js';
import { writeSeriesAudit, type SeriesActorKind } from './seriesAudit.js';
import { adapterAvailability, getDns, getResend, getVercel, DomainApiError, type ResendDomain } from './domainAdapters.js';
import { hostOfOrigin, hostsOverlap, normalizePartnerHost, originOf } from './domainHost.js';
import { addressUnderDomain, assertSenderConsistent, emailOrNull, MAX_SITE_ALIASES } from './seriesEmailFields.js';

export interface Actor { actorEmail: string; actorKind: SeriesActorKind }
export const SYSTEM_ACTOR: Actor = { actorEmail: 'system:domain-recheck', actorKind: 'system' };

export const DOMAIN_STATUSES = ['requested', 'dns_ok', 'attached', 'ready', 'live'] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];
const TXT_LABEL = '_rsvpizza';
const DEFAULT_CNAME_TARGET = 'cname.vercel-dns.com';

const err = (msg: string, status: number, code: string) => new AppError(msg, status, code);
const isStatus = (s: unknown): s is DomainStatus => (DOMAIN_STATUSES as readonly string[]).includes(s as string);

/** Provider failures become a short, secret-free message; a timeout is a 504. */
function upstream<T>(p: Promise<T>, what: string): Promise<T> {
  return p.catch((e) => {
    if (e instanceof AppError) throw e;
    if (e instanceof DomainApiError) {
      if (e.status === 504) throw err(`${what} did not answer in time. Try again in a moment.`, 504, 'UPSTREAM_TIMEOUT');
      if (e.status === 401 || e.status === 403) {
        // A bad / under-scoped token or a plan limit: never show the provider's text to a client.
        console.error(`[domains] ${what} rejected our credentials or plan (${e.status}): ${e.message}`);
        throw err('The domain service has a configuration problem. PizzaDAO has been notified.', 502, 'UPSTREAM_CONFIG');
      }
      if (e.status === 409 || e.status === 422 || e.status === 400) throw err(`${what} refused the request: ${e.message}`, 409, 'UPSTREAM_REFUSED');
      throw err(`${what} is unavailable right now. Try again shortly.`, 502, 'UPSTREAM_ERROR');
    }
    throw e;
  });
}

// ---------- config ----------

/** `BRAND_VERCEL_PROJECTS`: JSON object `{"<series slug>": "<Vercel project id or name>"}`. */
export function brandProjectFor(slug: string): string | null {
  const raw = process.env.BRAND_VERCEL_PROJECTS;
  if (!raw) return null;
  try {
    const map = JSON.parse(raw);
    const v = map && typeof map === 'object' && !Array.isArray(map) ? map[slug] : null;
    return typeof v === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Max partner sending domains (the Resend plan's domain cap minus our own). Default 5. */
export function partnerEmailDomainLimit(): number {
  const n = Number.parseInt(process.env.PARTNER_EMAIL_DOMAIN_LIMIT || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

// ---------- shared ----------

async function loadSeries(seriesId: string): Promise<any> {
  const row = await prisma.eventSeries.findFirst({ where: { id: seriesId } });
  if (!row) throw err('Not found', 404, 'NOT_FOUND');
  return row;
}

function requireSuper(actor: Actor): void {
  if (actor.actorKind !== 'super_admin') throw err('Only PizzaDAO admins can do this', 403, 'FORBIDDEN');
}

export interface DnsRecord {
  purpose: 'ownership' | 'site' | 'vercel_verification' | 'email';
  type: string;
  /** Full DNS name. */
  name: string;
  value: string;
  priority?: number;
  /** Per-record status (email records), or a short hint. */
  status?: string;
  note?: string;
}

const ownershipRecord = (host: string, token: string): DnsRecord => ({
  purpose: 'ownership', type: 'TXT', name: `${TXT_LABEL}.${host}`, value: `rsvpizza-verify=${token}`,
  note: 'Proves you control this domain. Keep it in place.',
});

// ======================================================================
// Web domain
// ======================================================================

export interface DomainChecks {
  txtOk: boolean;
  cnameOk: boolean;
  /** Only once attached: what Vercel reports. */
  vercel?: { attached: boolean; verified: boolean; configured: boolean };
  dnsError?: boolean;
}

export function domainView(row: any, extra: { cnameTarget?: string | null; vercelRecords?: DnsRecord[]; checks?: DomainChecks; steps?: string[]; changed?: boolean } = {}) {
  const host: string | null = row.pendingDomain ?? null;
  const records: DnsRecord[] = [];
  if (host && row.pendingDomainToken) {
    records.push(ownershipRecord(host, row.pendingDomainToken));
    records.push({ purpose: 'site', type: 'CNAME', name: host, value: extra.cnameTarget || DEFAULT_CNAME_TARGET, note: 'Points your domain at the site. If you use Cloudflare, set it to DNS only (grey cloud).' });
    records.push(...(extra.vercelRecords ?? []));
  }
  return {
    siteUrl: row.siteUrl ?? null,
    aliases: (row.siteAliases ?? []) as string[],
    domain: host,
    status: isStatus(row.pendingDomainStatus) ? row.pendingDomainStatus : null,
    checkedAt: row.pendingDomainCheckedAt ?? null,
    records,
    checks: extra.checks ?? null,
    steps: extra.steps ?? [],
    changed: extra.changed ?? undefined,
    projectMapped: !!brandProjectFor(row.slug),
    configured: adapterAvailability(),
  };
}

/** An unproven (`requested`) claim never blocks anyone and expires after this long. */
export const REQUEST_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const PROVEN: readonly string[] = ['dns_ok', 'attached', 'ready', 'live'];
const ATTACHED: readonly string[] = ['attached', 'ready', 'live'];

/**
 * A host already used by another series. site_url and aliases always block. A pending claim blocks
 * only once TXT-proven: at request time `dns_ok` and later; at attach time only claims already
 * attached (so the first to prove TXT and attach wins, and a `requested` squat blocks nobody).
 */
async function assertHostFree(seriesId: string, host: string, mode: 'request' | 'attach' = 'request', db: any = prisma): Promise<void> {
  const blocking = mode === 'attach' ? ATTACHED : PROVEN;
  const others: any[] = await db.eventSeries.findMany({
    where: { id: { not: seriesId } },
    select: { id: true, siteUrl: true, siteAliases: true, pendingDomain: true, pendingDomainStatus: true },
  });
  for (const o of others) {
    const used = [hostOfOrigin(o.siteUrl), ...((o.siteAliases ?? []) as string[]).map(hostOfOrigin), o.pendingDomain && blocking.includes(o.pendingDomainStatus) ? String(o.pendingDomain).toLowerCase() : null];
    if (used.includes(host)) throw err('That domain is already in use by another brand', 409, 'DOMAIN_TAKEN');
  }
}

export async function getDomain(seriesId: string) {
  return domainView(await loadSeries(seriesId));
}

export async function requestDomain(args: { seriesId: string; actor: Actor; domain: unknown }) {
  const host = normalizePartnerHost(args.domain, 'domain');
  const row = await loadSeries(args.seriesId);
  if (hostOfOrigin(row.siteUrl) === host) throw err('That is already this brand\'s site address', 409, 'DOMAIN_TAKEN');
  if (['attached', 'ready', 'live'].includes(row.pendingDomainStatus)) {
    throw err('This brand already has a domain in progress. Ask PizzaDAO to change it.', 409, 'DOMAIN_LOCKED');
  }
  await assertHostFree(row.id, host);
  if (row.pendingDomain === host && row.pendingDomainToken) return domainView(row, { changed: false });

  const token = randomBytes(16).toString('hex');
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.eventSeries.update({
      where: { id: row.id },
      data: { pendingDomain: host, pendingDomainToken: token, pendingDomainStatus: 'requested', pendingDomainCheckedAt: null },
    });
    await writeSeriesAudit(tx, {
      seriesId: row.id, ...args.actor, action: 'domain.request',
      changes: { pendingDomain: { old: row.pendingDomain ?? null, new: host }, pendingDomainStatus: { old: row.pendingDomainStatus ?? null, new: 'requested' } },
    });
    return u;
  });
  return domainView(updated, { changed: true });
}

export async function cancelDomain(args: { seriesId: string; actor: Actor }) {
  const row = await loadSeries(args.seriesId);
  if (!row.pendingDomain) return domainView(row, { changed: false });
  if (!['requested', 'dns_ok'].includes(row.pendingDomainStatus)) {
    throw err('This domain is already attached. Ask PizzaDAO to remove it.', 409, 'DOMAIN_LOCKED');
  }
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.eventSeries.update({
      where: { id: row.id },
      data: { pendingDomain: null, pendingDomainToken: null, pendingDomainStatus: null, pendingDomainCheckedAt: null },
    });
    await writeSeriesAudit(tx, {
      seriesId: row.id, ...args.actor, action: 'domain.cancel',
      changes: { pendingDomain: { old: row.pendingDomain, new: null } },
    });
    return u;
  });
  return domainView(updated, { changed: true });
}

async function txtMatches(host: string, token: string): Promise<{ ok: boolean; dnsError: boolean }> {
  try {
    const values = await getDns().resolveTxt(`${TXT_LABEL}.${host}`);
    return { ok: values.some((v) => v.trim() === `rsvpizza-verify=${token}`), dnsError: false };
  } catch {
    return { ok: false, dnsError: true };
  }
}

/**
 * Live status check: TXT ownership, CNAME hint, and (once attached) Vercel's verified/configured
 * state. Moves the status forward or back and audits every change. Never attaches anything.
 */
export async function checkDomain(args: { seriesId: string; actor: Actor }) {
  const row = await loadSeries(args.seriesId);
  const host: string | null = row.pendingDomain;
  if (!host || !row.pendingDomainToken || !isStatus(row.pendingDomainStatus)) throw err('No domain has been requested yet', 409, 'NO_DOMAIN');
  const status: DomainStatus = row.pendingDomainStatus;

  const txt = await txtMatches(host, row.pendingDomainToken);
  let newStatus: DomainStatus = status;
  if (!txt.dnsError) {
    if (status === 'requested' && txt.ok) newStatus = 'dns_ok';
    else if (status === 'dns_ok' && !txt.ok) newStatus = 'requested';
  }

  let cnameTarget: string | null = null;
  let vercelRecords: DnsRecord[] = [];
  let vercel: DomainChecks['vercel'];
  if (['attached', 'ready', 'live'].includes(status)) {
    const project = brandProjectFor(row.slug);
    if (!project) throw err('This brand is not mapped to a Vercel project yet', 409, 'NO_PROJECT');
    const v = getVercel();
    let pd = await upstream(v.getProjectDomain(project, host), 'Vercel');
    if (!pd) {
      vercel = { attached: false, verified: false, configured: false };
      if (status !== 'live') newStatus = txt.ok ? 'dns_ok' : 'requested';
    } else {
      if (!pd.verified) pd = await upstream(v.verifyProjectDomain(project, host), 'Vercel').catch(() => pd as NonNullable<typeof pd>);
      const cfg = await upstream(v.getDomainConfig(host), 'Vercel');
      cnameTarget = cfg.cnameTarget;
      const configured = pd.verified && !cfg.misconfigured;
      vercel = { attached: true, verified: pd.verified, configured };
      vercelRecords = pd.verification.map((x) => ({ purpose: 'vercel_verification', type: x.type.toUpperCase(), name: x.domain, value: x.value, note: x.reason || 'Required by the hosting provider to confirm the domain.' }));
      if (status === 'attached' && configured) newStatus = 'ready';
      else if (status === 'ready' && !configured) newStatus = 'attached';
    }
  } else {
    // Informational only before attach: the live Vercel recommendation, when configured.
    if (adapterAvailability().vercel) {
      try { cnameTarget = (await getVercel().getDomainConfig(host)).cnameTarget; } catch { /* default target */ }
    }
  }

  let cnameOk = false;
  try {
    const target = (cnameTarget || DEFAULT_CNAME_TARGET).toLowerCase();
    cnameOk = (await getDns().resolveCname(host)).some((c) => c === target || c.endsWith('.vercel-dns.com'));
  } catch { /* informational */ }

  const now = new Date();
  const moved = newStatus !== status;
  const res = await prisma.eventSeries.updateMany({
    where: { id: row.id, pendingDomain: host, pendingDomainStatus: status },
    data: { pendingDomainStatus: newStatus, pendingDomainCheckedAt: now },
  });
  if (moved && res.count === 1) {
    await writeSeriesAudit(prisma, {
      seriesId: row.id, ...args.actor, action: 'domain.status',
      changes: { pendingDomainStatus: { old: status, new: newStatus } },
    });
  }
  const fresh = { ...row, pendingDomainStatus: res.count === 1 ? newStatus : status, pendingDomainCheckedAt: now };
  return domainView(fresh, { cnameTarget, vercelRecords, checks: { txtOk: txt.ok, cnameOk, vercel, dnsError: txt.dnsError || undefined }, changed: moved });
}

/** `[wl-audit]` line (same shape as admin-series) for every change to site_url / site_aliases, which CORS trusts. */
function logOriginChange(slug: string, actor: Actor, changes: Record<string, unknown>): void {
  console.log(`[wl-audit] series ${slug} origin change by ${actor.actorEmail}: ${JSON.stringify(changes)}`);
}

/** Super-admin: attach the TXT-verified host to the brand's Vercel project. */
export async function attachDomain(args: { seriesId: string; actor: Actor }) {
  requireSuper(args.actor);
  const row = await loadSeries(args.seriesId);
  const host: string | null = row.pendingDomain;
  if (!host || !row.pendingDomainToken) throw err('No domain has been requested yet', 409, 'NO_DOMAIN');
  if (['attached', 'ready', 'live'].includes(row.pendingDomainStatus)) return domainView(row, { changed: false });

  const project = brandProjectFor(row.slug);
  if (!project) throw err('This brand is not mapped to a Vercel project yet. Add it to BRAND_VERCEL_PROJECTS.', 409, 'NO_PROJECT');
  const v = getVercel(); // 503 when the Vercel secrets are missing

  // Fresh proof right now, not the cached status: no TXT, no attach.
  const txt = await txtMatches(host, row.pendingDomainToken);
  if (!txt.ok) {
    if (row.pendingDomainStatus === 'dns_ok') {
      await prisma.eventSeries.updateMany({ where: { id: row.id, pendingDomain: host, pendingDomainStatus: 'dns_ok' }, data: { pendingDomainStatus: 'requested', pendingDomainCheckedAt: new Date() } });
    }
    throw err('The ownership TXT record was not found, so the domain was not attached', 409, 'TXT_MISSING');
  }
  await assertHostFree(row.id, host, 'attach');

  const pd = await upstream(v.addProjectDomain(project, host), 'Vercel');
  try {
    await prisma.$transaction(async (tx) => {
      // Lock the row, then re-read: the claim may have changed while we were talking to Vercel.
      await tx.$queryRaw`SELECT id FROM event_series WHERE id = ${row.id}::uuid FOR UPDATE`;
      const cur: any = await tx.eventSeries.findFirst({ where: { id: row.id } });
      if (!cur || cur.pendingDomain !== host || cur.pendingDomainToken !== row.pendingDomainToken || ATTACHED.includes(cur.pendingDomainStatus)) {
        throw err('The domain changed while attaching. Check it and try again.', 409, 'CONFLICT');
      }
      await assertHostFree(row.id, host, 'attach', tx);
      const res = await tx.eventSeries.updateMany({
        where: { id: row.id, pendingDomain: host, pendingDomainToken: row.pendingDomainToken, pendingDomainStatus: { in: ['requested', 'dns_ok'] } },
        data: { pendingDomainStatus: 'attached', pendingDomainCheckedAt: new Date() },
      });
      if (res.count !== 1) throw err('The domain changed while attaching. Check it and try again.', 409, 'CONFLICT');
      await writeSeriesAudit(tx, {
        seriesId: row.id, ...args.actor, action: 'domain.attach',
        changes: { pendingDomainStatus: { old: row.pendingDomainStatus ?? null, new: 'attached' }, vercelProject: { old: null, new: project } },
      });
    });
  } catch (e) {
    // We attached on Vercel but could not record it: undo the attach (best effort) and say so in the audit.
    let detached = false;
    try { await v.removeProjectDomain(project, host); detached = true; } catch { /* reported in the audit row */ }
    await writeSeriesAudit(prisma, {
      seriesId: row.id, ...args.actor, action: 'domain.attach_undone',
      changes: { pendingDomain: { old: host, new: null }, vercelDetached: { old: null, new: detached } },
    }).catch(() => undefined);
    throw e;
  }
  const vercelRecords: DnsRecord[] = pd.verification.map((x) => ({ purpose: 'vercel_verification', type: x.type.toUpperCase(), name: x.domain, value: x.value, note: x.reason || 'Required by the hosting provider to confirm the domain.' }));
  return domainView({ ...row, pendingDomainStatus: 'attached' }, { vercelRecords, changed: true });
}

/** Super-admin: make the host the site address. Needs the DNS checks to be green right now. */
export async function cutoverDomain(args: { seriesId: string; actor: Actor; redirectOld?: boolean }) {
  requireSuper(args.actor);
  const before = await loadSeries(args.seriesId);
  if (before.pendingDomainStatus === 'live') return domainView(before, { changed: false });
  if (!['attached', 'ready'].includes(before.pendingDomainStatus)) throw err('Attach the domain and wait for the DNS checks to pass first', 409, 'NOT_READY');

  const checked = await checkDomain({ seriesId: args.seriesId, actor: args.actor }); // live re-check (503 without Vercel)
  if (checked.status !== 'ready' || !checked.checks?.txtOk) throw err('The DNS checks are not all passing yet, so the cutover was not done', 409, 'NOT_READY');

  const row = await loadSeries(args.seriesId);
  const host: string = row.pendingDomain;
  const newOrigin = originOf(host);
  const oldOrigin: string | null = row.siteUrl ?? null;
  if (!oldOrigin) throw err('This brand has no site address to move from', 409, 'NO_SITE_URL');
  if (oldOrigin.toLowerCase() === newOrigin) throw err('The domain is already the site address', 409, 'ALREADY_LIVE');
  const aliases = [...new Set([...((row.siteAliases ?? []) as string[]).filter((a) => a.toLowerCase() !== newOrigin), oldOrigin.toLowerCase()])];
  if (aliases.length > MAX_SITE_ALIASES) throw err(`Too many site aliases (max ${MAX_SITE_ALIASES})`, 409, 'TOO_MANY_ALIASES');

  await prisma.$transaction(async (tx) => {
    const r = await tx.eventSeries.updateMany({
      where: { id: row.id, pendingDomain: host, pendingDomainStatus: 'ready' },
      data: { siteUrl: newOrigin, siteAliases: aliases, pendingDomainStatus: 'live', configVersion: { increment: 1 } },
    });
    if (r.count !== 1) throw err('The domain changed while cutting over. Check it and try again.', 409, 'CONFLICT');
    await writeSeriesAudit(tx, {
      seriesId: row.id, ...args.actor, action: 'domain.cutover',
      changes: {
        siteUrl: { old: oldOrigin, new: newOrigin },
        siteAliases: { old: row.siteAliases ?? [], new: aliases },
        pendingDomainStatus: { old: 'ready', new: 'live' },
      },
    });
  });
  invalidateSiteBrandCache();
  logOriginChange(row.slug, args.actor, { siteUrl: { old: oldOrigin, new: newOrigin }, siteAliases: { old: row.siteAliases ?? [], new: aliases } });

  const steps: string[] = [];
  const project = brandProjectFor(row.slug);
  const oldHost = hostOfOrigin(oldOrigin);
  let redirected = false;
  if (args.redirectOld !== false && project && oldHost && oldHost !== host) {
    try {
      await upstream(getVercel().setRedirect(project, oldHost, host), 'Vercel');
      redirected = true;
      await writeSeriesAudit(prisma, { seriesId: row.id, ...args.actor, action: 'domain.redirect', changes: { redirect: { old: null, new: { from: oldHost, to: host, status: 308 } } } });
    } catch {
      /* reported as a manual step below */
    }
  }
  if (!redirected && oldHost && oldHost !== host && args.redirectOld !== false) {
    steps.push(`Set ${oldHost} to redirect (308) to ${host}: Vercel > ${project ?? 'the brand project'} > Settings > Domains. The old domain stays attached for printed flyer QR codes.`);
  }
  steps.push(`Update the VITE_BRAND_DOMAIN env var to ${host} on the ${project ?? 'brand'} Vercel project (Production and Preview) and redeploy production, so the OG preview rewriter and event pages use the new domain. This is not done automatically.`);
  steps.push(`Add https://${host} to the Reown / WalletConnect allowed domains.`);
  steps.push('Tell the brand\'s users they will need to log in once more on the new domain.');
  return domainView({ ...row, siteUrl: newOrigin, siteAliases: aliases, pendingDomainStatus: 'live' }, { steps, changed: true, checks: checked.checks ?? undefined });
}

/** Super-admin: undo the cutover (idempotent). The new host stays attached and stays an alias; the old host is never detached. */
export async function rollbackDomain(args: { seriesId: string; actor: Actor }) {
  requireSuper(args.actor);
  const row = await loadSeries(args.seriesId);
  if (row.pendingDomainStatus !== 'live') return domainView(row, { changed: false });

  const last = await prisma.seriesAudit.findFirst({ where: { seriesId: row.id, action: 'domain.cutover' }, orderBy: { createdAt: 'desc' } });
  const oldOrigin = (last?.changes as any)?.siteUrl?.old;
  const oldHost = typeof oldOrigin === 'string' && oldOrigin.startsWith('https://') ? hostOfOrigin(oldOrigin) : null;
  if (!oldHost) throw err('No cutover record found to roll back to', 409, 'NO_CUTOVER_RECORD');
  const restored = originOf(oldHost);
  const newOrigin = String(row.siteUrl).toLowerCase();
  const aliases = [...new Set([...((row.siteAliases ?? []) as string[]).filter((a) => a.toLowerCase() !== restored), newOrigin])].filter((a) => a !== restored);
  if (aliases.length > MAX_SITE_ALIASES) throw err(`Too many site aliases (max ${MAX_SITE_ALIASES})`, 409, 'TOO_MANY_ALIASES');

  await prisma.$transaction(async (tx) => {
    const r = await tx.eventSeries.updateMany({
      where: { id: row.id, pendingDomainStatus: 'live' },
      data: { siteUrl: restored, siteAliases: aliases, pendingDomainStatus: 'ready', configVersion: { increment: 1 } },
    });
    if (r.count !== 1) throw err('The domain changed while rolling back. Check it and try again.', 409, 'CONFLICT');
    await writeSeriesAudit(tx, {
      seriesId: row.id, ...args.actor, action: 'domain.rollback',
      changes: {
        siteUrl: { old: row.siteUrl, new: restored },
        siteAliases: { old: row.siteAliases ?? [], new: aliases },
        pendingDomainStatus: { old: 'live', new: 'ready' },
      },
    });
  });
  invalidateSiteBrandCache();
  logOriginChange(row.slug, args.actor, { siteUrl: { old: row.siteUrl, new: restored }, siteAliases: { old: row.siteAliases ?? [], new: aliases } });

  const steps: string[] = [];
  const project = brandProjectFor(row.slug);
  let cleared = false;
  if (project) {
    try {
      await upstream(getVercel().setRedirect(project, oldHost, null), 'Vercel');
      cleared = true;
      await writeSeriesAudit(prisma, { seriesId: row.id, ...args.actor, action: 'domain.redirect', changes: { redirect: { old: { from: oldHost }, new: null } } });
    } catch { /* manual step below */ }
  }
  if (!cleared) steps.push(`Remove the redirect on ${oldHost}: Vercel > ${project ?? 'the brand project'} > Settings > Domains.`);
  steps.push(`If you changed VITE_BRAND_DOMAIN during the cutover, set it back to ${oldHost} and redeploy production.`);
  return domainView({ ...row, siteUrl: restored, siteAliases: aliases, pendingDomainStatus: 'ready' }, { steps, changed: true });
}

/** Super-admin: remove one origin from site_aliases (e.g. the old host once nothing points at it any more). Re-add via the admin series PATCH. */
export async function removeAlias(args: { seriesId: string; actor: Actor; alias: unknown }) {
  requireSuper(args.actor);
  const alias = typeof args.alias === 'string' ? args.alias.trim().toLowerCase() : '';
  const row = await loadSeries(args.seriesId);
  const aliases: string[] = (row.siteAliases ?? []) as string[];
  if (!alias || !aliases.map((a) => a.toLowerCase()).includes(alias)) throw err('That alias is not set on this brand', 404, 'NOT_FOUND');
  const next = aliases.filter((a) => a.toLowerCase() !== alias);
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.eventSeries.update({ where: { id: row.id }, data: { siteAliases: next, configVersion: { increment: 1 } } });
    await writeSeriesAudit(tx, { seriesId: row.id, ...args.actor, action: 'domain.alias_removed', changes: { siteAliases: { old: aliases, new: next } } });
    return u;
  });
  invalidateSiteBrandCache();
  logOriginChange(row.slug, args.actor, { siteAliases: { old: aliases, new: next } });
  return domainView(updated, { changed: true, steps: [`Links and CORS for ${alias} stop working. To undo, add it back under site aliases in the series admin.`] });
}

/**
 * Super-admin: drop a domain claim (not while live: roll back first). Clears the pending fields and
 * the new host's alias; with `detachVercel` also removes the pending host from the brand's Vercel
 * project (best effort; a failure becomes a manual step). Never touches site_url or the old host.
 * Reversible: the audit row keeps the old values, and the host can be requested and attached again.
 */
export async function resetDomain(args: { seriesId: string; actor: Actor; detachVercel?: boolean }) {
  requireSuper(args.actor);
  const row = await loadSeries(args.seriesId);
  const host: string | null = row.pendingDomain;
  if (!host) return domainView(row, { changed: false });
  if (row.pendingDomainStatus === 'live' || hostOfOrigin(row.siteUrl) === host) throw err('This domain is live. Roll it back first.', 409, 'DOMAIN_LIVE');
  const origin = originOf(host);
  const aliases: string[] = (row.siteAliases ?? []) as string[];
  const nextAliases = aliases.filter((a) => a.toLowerCase() !== origin);
  const wasAttached = ATTACHED.includes(row.pendingDomainStatus);

  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.eventSeries.updateMany({
      where: { id: row.id, pendingDomain: host, pendingDomainStatus: { not: 'live' } },
      data: { pendingDomain: null, pendingDomainToken: null, pendingDomainStatus: null, pendingDomainCheckedAt: null, siteAliases: nextAliases, ...(nextAliases.length !== aliases.length ? { configVersion: { increment: 1 } } : {}) },
    });
    if (r.count !== 1) throw err('The domain changed while resetting. Check it and try again.', 409, 'CONFLICT');
    await writeSeriesAudit(tx, {
      seriesId: row.id, ...args.actor, action: 'domain.reset',
      changes: {
        pendingDomain: { old: host, new: null }, pendingDomainStatus: { old: row.pendingDomainStatus ?? null, new: null },
        ...(nextAliases.length !== aliases.length ? { siteAliases: { old: aliases, new: nextAliases } } : {}),
      },
    });
    return { ...row, pendingDomain: null, pendingDomainToken: null, pendingDomainStatus: null, pendingDomainCheckedAt: null, siteAliases: nextAliases };
  });
  if (nextAliases.length !== aliases.length) {
    invalidateSiteBrandCache();
    logOriginChange(row.slug, args.actor, { siteAliases: { old: aliases, new: nextAliases } });
  }

  const steps: string[] = [];
  if (args.detachVercel && wasAttached) {
    const project = brandProjectFor(row.slug);
    let done = false;
    if (project && adapterAvailability().vercel) {
      try {
        await upstream(getVercel().removeProjectDomain(project, host), 'Vercel');
        done = true;
        await writeSeriesAudit(prisma, { seriesId: row.id, ...args.actor, action: 'domain.detach', changes: { vercelDomain: { old: { project, host }, new: null } } });
      } catch { /* manual step below */ }
    }
    if (!done) steps.push(`Remove ${host} from the ${project ?? 'brand'} Vercel project (Settings > Domains) by hand.`);
  } else if (wasAttached) {
    steps.push(`${host} is still attached to the Vercel project. Remove it there if the partner no longer uses it.`);
  }
  return domainView(updated, { changed: true, steps });
}

// ======================================================================
// Email (sending) domain
// ======================================================================

const emailRecords = (d: ResendDomain | null): DnsRecord[] =>
  (d?.records ?? []).map((r) => ({
    purpose: 'email' as const, type: r.type.toUpperCase(), name: r.name, value: r.value, status: r.status,
    ...(typeof r.priority === 'number' ? { priority: r.priority } : {}), note: r.record,
  }));

export function emailView(row: any, domain: ResendDomain | null, extra: { changed?: boolean; error?: string } = {}) {
  return {
    emailDomain: row.emailDomain ?? null,
    emailFromAddress: row.emailFromAddress ?? null,
    verified: !!row.emailDomainVerifiedAt,
    verifiedAt: row.emailDomainVerifiedAt ?? null,
    status: domain?.status ?? null,
    records: emailRecords(domain),
    changed: extra.changed,
    error: extra.error,
    configured: adapterAvailability(),
  };
}

export async function getEmailDomain(seriesId: string) {
  const row = await loadSeries(seriesId);
  if (!row.resendDomainId || !adapterAvailability().resend) return emailView(row, null);
  try {
    return emailView(row, await getResend().getDomain(row.resendDomainId));
  } catch {
    return emailView(row, null, { error: 'Could not load the DNS records right now. Try again shortly.' });
  }
}

async function assertEmailDomainFree(seriesId: string, domain: string): Promise<void> {
  const others: any[] = await prisma.eventSeries.findMany({ where: { id: { not: seriesId } }, select: { emailDomain: true } });
  if (others.some((o) => o.emailDomain && hostsOverlap(o.emailDomain, domain))) {
    throw err('That sending domain is already in use by another brand', 409, 'DOMAIN_TAKEN');
  }
}

export async function setEmailDomain(args: { seriesId: string; actor: Actor; emailDomain: unknown; emailFromAddress: unknown }) {
  const domain = normalizePartnerHost(args.emailDomain, 'emailDomain');
  const from = emailOrNull(args.emailFromAddress, 'emailFromAddress');
  if (!from) throw err('emailFromAddress is required', 400, 'VALIDATION_ERROR');
  assertSenderConsistent(from, domain);
  const row = await loadSeries(args.seriesId);
  if (row.emailDomain === domain && row.emailFromAddress === from && row.resendDomainId) return getEmailDomain(row.id);

  await assertEmailDomainFree(row.id, domain);
  const sameDomain = row.emailDomain === domain && !!row.resendDomainId;
  let resendId: string = row.resendDomainId;
  let created: ResendDomain | null = null;
  const resend = getResend(); // 503 when RESEND_ADMIN_KEY is missing
  if (!sameDomain) {
    const others = await prisma.eventSeries.count({ where: { id: { not: row.id }, resendDomainId: { not: null } } });
    if (others >= partnerEmailDomainLimit()) {
      throw err(`The limit of ${partnerEmailDomainLimit()} partner sending domains has been reached. Ask PizzaDAO to raise it.`, 409, 'EMAIL_DOMAIN_LIMIT');
    }
    created = await upstream(resend.createDomain(domain), 'Resend');
    resendId = created.id;
  }

  let updated: any;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // A new sender is re-verified from scratch: the default sender keeps being used until then.
      const u = await tx.eventSeries.update({
        where: { id: row.id },
        data: { emailDomain: domain, emailFromAddress: from, resendDomainId: resendId, emailDomainVerifiedAt: null, configVersion: { increment: 1 } },
      });
      await writeSeriesAudit(tx, {
        seriesId: row.id, ...args.actor, action: 'email.domain_set',
        changes: {
          emailDomain: { old: row.emailDomain ?? null, new: domain },
          emailFromAddress: { old: row.emailFromAddress ?? null, new: from },
          emailDomainVerifiedAt: { old: row.emailDomainVerifiedAt ?? null, new: null },
        },
      });
      return u;
    });
  } catch (e) {
    if (created) await resend.removeDomain(created.id).catch(() => undefined);
    throw e;
  }
  invalidateSiteBrandCache();
  if (created && row.resendDomainId && row.resendDomainId !== created.id) await resend.removeDomain(row.resendDomainId).catch(() => undefined);
  const view = created ?? (await resend.getDomain(resendId).catch(() => null));
  return emailView(updated, view, { changed: true });
}

export async function removeEmailDomain(args: { seriesId: string; actor: Actor }) {
  const row = await loadSeries(args.seriesId);
  if (!row.emailDomain && !row.resendDomainId && !row.emailFromAddress) return emailView(row, null, { changed: false });
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.eventSeries.update({
      where: { id: row.id },
      data: { emailDomain: null, emailFromAddress: null, resendDomainId: null, emailDomainVerifiedAt: null, configVersion: { increment: 1 } },
    });
    await writeSeriesAudit(tx, {
      seriesId: row.id, ...args.actor, action: 'email.domain_removed',
      changes: { emailDomain: { old: row.emailDomain ?? null, new: null }, emailFromAddress: { old: row.emailFromAddress ?? null, new: null }, emailDomainVerifiedAt: { old: row.emailDomainVerifiedAt ?? null, new: null } },
    });
    return u;
  });
  invalidateSiteBrandCache();
  if (row.resendDomainId && adapterAvailability().resend) await getResend().removeDomain(row.resendDomainId).catch(() => undefined);
  return emailView(updated, null, { changed: true });
}

/**
 * Read Resend's status for the sending domain. `verified` (with a matching from address) sets
 * `email_domain_verified_at`. A previously verified domain is cleared only when Resend says the domain
 * is `failed` / `not_found`, or reports a record as `failed` / `not_found`; `pending` and
 * `temporary_failure` never clear it. `mode: 'manual'` (the Check button) asks Resend to re-verify
 * first, but only when the domain is not already verified; the cron (`mode: 'cron'`) only reads (GET).
 */
export async function checkEmailDomain(args: { seriesId: string; actor: Actor; mode?: 'manual' | 'cron' }) {
  const row = await loadSeries(args.seriesId);
  if (!row.resendDomainId || !row.emailDomain) throw err('No sending domain has been set up yet', 409, 'NO_EMAIL_DOMAIN');
  const resend = getResend();
  let d = await upstream(resend.getDomain(row.resendDomainId), 'Resend');
  if ((args.mode ?? 'manual') === 'manual' && d.status !== 'verified') {
    await upstream(resend.verifyDomain(row.resendDomainId), 'Resend');
    d = await upstream(resend.getDomain(row.resendDomainId), 'Resend');
  }

  const matches = d.name === String(row.emailDomain).toLowerCase() && !!row.emailFromAddress && addressUnderDomain(row.emailFromAddress, row.emailDomain);
  const gone = d.status === 'failed' || d.status === 'not_found' || d.records.some((r) => r.status === 'failed' || r.status === 'not_found');
  let changed = false;
  let verifiedAt: Date | null = row.emailDomainVerifiedAt ?? null;
  const guard = { id: row.id, resendDomainId: row.resendDomainId, emailDomain: row.emailDomain, emailFromAddress: row.emailFromAddress };
  if (d.status === 'verified' && matches && !row.emailDomainVerifiedAt) {
    const now = new Date();
    const r = await prisma.eventSeries.updateMany({ where: { ...guard, emailDomainVerifiedAt: null }, data: { emailDomainVerifiedAt: now } });
    if (r.count === 1) {
      changed = true;
      verifiedAt = now;
      await writeSeriesAudit(prisma, { seriesId: row.id, ...args.actor, action: 'email.verified', changes: { emailDomainVerifiedAt: { old: null, new: now.toISOString() } } });
    }
  } else if (d.status !== 'verified' && gone && row.emailDomainVerifiedAt) {
    const r = await prisma.eventSeries.updateMany({ where: guard, data: { emailDomainVerifiedAt: null } });
    if (r.count === 1) {
      changed = true;
      verifiedAt = null;
      await writeSeriesAudit(prisma, { seriesId: row.id, ...args.actor, action: 'email.verification_revoked', changes: { emailDomainVerifiedAt: { old: 'verified', new: null }, resendStatus: { old: null, new: d.status } } });
    }
  }
  if (changed) invalidateSiteBrandCache();
  return emailView({ ...row, emailDomainVerifiedAt: verifiedAt }, d, { changed });
}

// ======================================================================
// Cron
// ======================================================================

export const CRON_CONCURRENCY = 4;
export const CRON_BUDGET_MS = 240_000;

/** Run `fn` over `items` with a small worker pool; stop starting new items once `deadline` passes. Returns how many ran. */
async function pool<T>(items: T[], deadline: number, fn: (item: T) => Promise<void>): Promise<number> {
  let next = 0;
  let ran = 0;
  const worker = async () => {
    while (next < items.length && Date.now() < deadline) {
      const item = items[next++];
      ran++;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CRON_CONCURRENCY, items.length) }, worker));
  return ran;
}

/** Expected conditions (a missing secret, a 4xx) are not log noise; real failures are. */
function logCronError(tag: string, e: unknown): void {
  if (e instanceof AppError && e.statusCode < 500) return;
  if (e instanceof AppError && e.code === 'NOT_CONFIGURED') return;
  console.error(`[${tag}] recheck failed for a series`, (e as Error).message);
}

/** Clear a `requested` claim older than REQUEST_TTL_MS (measured from its latest domain.request audit row). */
async function expireIfStale(rowId: string, now: number): Promise<boolean> {
  const last: any = await prisma.seriesAudit.findFirst({ where: { seriesId: rowId, action: 'domain.request' }, orderBy: { createdAt: 'desc' } });
  if (!last?.createdAt || now - new Date(last.createdAt).getTime() < REQUEST_TTL_MS) return false;
  const row = await loadSeries(rowId);
  if (row.pendingDomainStatus !== 'requested' || !row.pendingDomain) return false;
  const r = await prisma.eventSeries.updateMany({
    where: { id: rowId, pendingDomain: row.pendingDomain, pendingDomainStatus: 'requested' },
    data: { pendingDomain: null, pendingDomainToken: null, pendingDomainStatus: null, pendingDomainCheckedAt: null },
  });
  if (r.count !== 1) return false;
  await writeSeriesAudit(prisma, { seriesId: rowId, ...SYSTEM_ACTOR, action: 'domain.expire', changes: { pendingDomain: { old: row.pendingDomain, new: null }, pendingDomainStatus: { old: 'requested', new: null } } });
  return true;
}

/**
 * Re-check pending web domains (DNS + Vercel state). Never attaches or cuts over. Unproven
 * `requested` claims older than 14 days are cleared. Rows that need Vercel are skipped quietly
 * when its secrets are missing.
 */
export async function recheckPendingDomains(opts: { limit?: number; budgetMs?: number; now?: number } = {}): Promise<{ checked: number; moved: number; expired: number; skipped: number }> {
  const now = opts.now ?? Date.now();
  const rows: any[] = await prisma.eventSeries.findMany({
    where: { pendingDomain: { not: null }, pendingDomainStatus: { in: ['requested', 'dns_ok', 'attached'] } },
    orderBy: { pendingDomainCheckedAt: { sort: 'asc', nulls: 'first' } },
    take: opts.limit ?? 25,
    select: { id: true, pendingDomainStatus: true },
  });
  const vercelOk = adapterAvailability().vercel;
  let moved = 0, expired = 0, skipped = 0;
  const todo = rows.filter((r) => (r.pendingDomainStatus === 'attached' && !vercelOk ? (skipped++, false) : true));
  const ran = await pool(todo, now + (opts.budgetMs ?? CRON_BUDGET_MS), async (r) => {
    try {
      if (r.pendingDomainStatus === 'requested' && (await expireIfStale(r.id, now))) { expired++; return; }
      if ((await checkDomain({ seriesId: r.id, actor: SYSTEM_ACTOR })).changed) moved++;
    } catch (e) {
      logCronError('domains', e);
    }
  });
  return { checked: ran, moved, expired, skipped };
}

/**
 * Daily health check of `ready` / `live` hosts (TXT, CNAME, Vercel state). A failure writes a
 * `domain.health_failed` audit row and a `[wl-domain-alert]` log line (no email); it never removes or
 * changes anything on its own. Skipped quietly when Vercel is not configured.
 */
export async function recheckLiveDomains(opts: { limit?: number; budgetMs?: number } = {}): Promise<{ checked: number; failing: number; skipped: number }> {
  if (!adapterAvailability().vercel) return { checked: 0, failing: 0, skipped: 0 };
  const rows: any[] = await prisma.eventSeries.findMany({
    where: { pendingDomain: { not: null }, pendingDomainStatus: { in: ['ready', 'live'] } },
    take: opts.limit ?? 50,
    select: { id: true, slug: true, pendingDomain: true },
  });
  let failing = 0;
  const ran = await pool(rows, Date.now() + (opts.budgetMs ?? CRON_BUDGET_MS), async (r) => {
    try {
      const v = await checkDomain({ seriesId: r.id, actor: SYSTEM_ACTOR });
      const c = v.checks;
      if (c && !c.dnsError && !(c.txtOk && c.cnameOk && c.vercel?.attached && c.vercel.configured)) {
        failing++;
        const summary = { txtOk: c.txtOk, cnameOk: c.cnameOk, vercelAttached: !!c.vercel?.attached, vercelConfigured: !!c.vercel?.configured };
        console.error(`[wl-domain-alert] series ${r.slug} domain ${r.pendingDomain} is failing its health check: ${JSON.stringify(summary)}`);
        await writeSeriesAudit(prisma, { seriesId: r.id, ...SYSTEM_ACTOR, action: 'domain.health_failed', changes: { checks: { old: null, new: summary } } });
      }
    } catch (e) {
      logCronError('domains', e);
    }
  });
  return { checked: ran, failing, skipped: rows.length - ran };
}

/**
 * Re-read (GET only, never POST /verify) the status of sending domains marked verified, and clear
 * verification when Resend says the domain or its records are failed / not found.
 */
export async function recheckEmailDomains(opts: { limit?: number; budgetMs?: number } = {}): Promise<{ checked: number; revoked: number }> {
  if (!adapterAvailability().resend) return { checked: 0, revoked: 0 };
  const rows: any[] = await prisma.eventSeries.findMany({
    where: { emailDomainVerifiedAt: { not: null }, resendDomainId: { not: null } },
    take: opts.limit ?? 50,
    select: { id: true },
  });
  let revoked = 0;
  const ran = await pool(rows, Date.now() + (opts.budgetMs ?? CRON_BUDGET_MS), async (r) => {
    try {
      const v = await checkEmailDomain({ seriesId: r.id, actor: SYSTEM_ACTOR, mode: 'cron' });
      if (v.changed && !v.verified) revoked++;
    } catch (e) {
      logCronError('email-domains', e);
    }
  });
  return { checked: ran, revoked };
}
