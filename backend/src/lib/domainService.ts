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
      if (e.status === 409 || e.status === 403 || e.status === 422 || e.status === 400) throw err(`${what} refused the request: ${e.message}`, 409, 'UPSTREAM_REFUSED');
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

/** A host already used by another series (site_url, alias or pending), or by this series' own site_url. */
async function assertHostFree(seriesId: string, host: string): Promise<void> {
  const others: any[] = await prisma.eventSeries.findMany({
    where: { id: { not: seriesId } },
    select: { id: true, siteUrl: true, siteAliases: true, pendingDomain: true },
  });
  for (const o of others) {
    const used = [hostOfOrigin(o.siteUrl), ...((o.siteAliases ?? []) as string[]).map(hostOfOrigin), o.pendingDomain ? String(o.pendingDomain).toLowerCase() : null];
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
  await assertHostFree(row.id, host);

  const pd = await upstream(v.addProjectDomain(project, host), 'Vercel');
  const res = await prisma.eventSeries.updateMany({
    where: { id: row.id, pendingDomain: host },
    data: { pendingDomainStatus: 'attached', pendingDomainCheckedAt: new Date() },
  });
  if (res.count === 1) {
    await writeSeriesAudit(prisma, {
      seriesId: row.id, ...args.actor, action: 'domain.attach',
      changes: { pendingDomainStatus: { old: row.pendingDomainStatus ?? null, new: 'attached' }, vercelProject: { old: null, new: project } },
    });
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
 * Ask Resend to re-verify and read the status. `verified` (with a matching from address) sets
 * `email_domain_verified_at`; `failed` / `not_started` clears it. `pending` / `temporary_failure`
 * change nothing. Used by the Check button and the hourly recheck.
 */
export async function checkEmailDomain(args: { seriesId: string; actor: Actor }) {
  const row = await loadSeries(args.seriesId);
  if (!row.resendDomainId || !row.emailDomain) throw err('No sending domain has been set up yet', 409, 'NO_EMAIL_DOMAIN');
  const resend = getResend();
  await upstream(resend.verifyDomain(row.resendDomainId), 'Resend');
  const d = await upstream(resend.getDomain(row.resendDomainId), 'Resend');

  const matches = d.name === String(row.emailDomain).toLowerCase() && !!row.emailFromAddress && addressUnderDomain(row.emailFromAddress, row.emailDomain);
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
  } else if ((d.status === 'failed' || d.status === 'not_started') && row.emailDomainVerifiedAt) {
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

/** Re-check pending web domains (DNS + Vercel state). Never attaches or cuts over. */
export async function recheckPendingDomains(limit = 25): Promise<{ checked: number; moved: number }> {
  const rows: any[] = await prisma.eventSeries.findMany({
    where: { pendingDomain: { not: null }, pendingDomainStatus: { in: ['requested', 'dns_ok', 'attached'] } },
    orderBy: { pendingDomainCheckedAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
    select: { id: true },
  });
  let moved = 0;
  for (const r of rows) {
    try {
      const v = await checkDomain({ seriesId: r.id, actor: SYSTEM_ACTOR });
      if (v.changed) moved++;
    } catch (e) {
      console.error('[domains] recheck failed for a series', (e as Error).message);
    }
  }
  return { checked: rows.length, moved };
}

/** Re-verify sending domains currently marked verified; clears verification when Resend says the records are gone. */
export async function recheckEmailDomains(limit = 50): Promise<{ checked: number; revoked: number }> {
  if (!adapterAvailability().resend) return { checked: 0, revoked: 0 };
  const rows: any[] = await prisma.eventSeries.findMany({
    where: { emailDomainVerifiedAt: { not: null }, resendDomainId: { not: null } },
    take: limit,
    select: { id: true },
  });
  let revoked = 0;
  for (const r of rows) {
    try {
      const v = await checkEmailDomain({ seriesId: r.id, actor: SYSTEM_ACTOR });
      if (v.changed && !v.verified) revoked++;
    } catch (e) {
      console.error('[email-domains] recheck failed for a series', (e as Error).message);
    }
  }
  return { checked: rows.length, revoked };
}
