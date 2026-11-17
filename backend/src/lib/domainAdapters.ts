/**
 * Thin adapters for the three outside systems the partner domain / sending-domain flow talks to
 * (plans/wl-self-serve-brands.md PR 16): the Vercel domains API, the Resend domains API and DNS.
 * `lib/domainService.ts` only sees the interfaces below, so tests inject fakes and never reach the
 * network.
 *
 * Secrets (env only, never logged, never returned to a client):
 *   VERCEL_DOMAINS_TOKEN + VERCEL_TEAM_ID  PizzaDAO-team token, project-domain calls only
 *   RESEND_ADMIN_KEY                       full-access Resend key, domains API only. The existing
 *                                          RESEND_API_KEY stays a send-only key and is never used here.
 * A missing secret makes the matching adapter getter throw 503 NOT_CONFIGURED; nothing else is affected.
 * Every HTTP call has a short timeout.
 */
import { Resolver } from 'node:dns/promises';
import { AppError } from '../middleware/error.js';

export const ADAPTER_TIMEOUT_MS = 8000;

// ---------- interfaces ----------

export interface VercelDomainVerification { type: string; domain: string; value: string; reason?: string }
export interface VercelProjectDomain {
  name: string;
  verified: boolean;
  /** TXT challenge Vercel wants when the domain is attached to another Vercel account. */
  verification: VercelDomainVerification[];
  redirect: string | null;
}
export interface VercelDomainConfig {
  misconfigured: boolean;
  /** Recommended CNAME target for a subdomain, without a trailing dot. */
  cnameTarget: string | null;
}
export interface VercelAdapter {
  addProjectDomain(projectId: string, host: string): Promise<VercelProjectDomain>;
  getProjectDomain(projectId: string, host: string): Promise<VercelProjectDomain | null>;
  verifyProjectDomain(projectId: string, host: string): Promise<VercelProjectDomain>;
  getDomainConfig(host: string): Promise<VercelDomainConfig>;
  /** `target` null clears the redirect. Always a 308. */
  setRedirect(projectId: string, host: string, target: string | null): Promise<void>;
}

export type ResendDomainStatus = 'not_started' | 'pending' | 'verified' | 'failed' | 'temporary_failure' | string;
export interface ResendRecord { record: string; name: string; type: string; value: string; ttl: string; status: string; priority?: number }
export interface ResendDomain { id: string; name: string; status: ResendDomainStatus; records: ResendRecord[] }
export interface ResendAdapter {
  createDomain(name: string): Promise<ResendDomain>;
  getDomain(id: string): Promise<ResendDomain>;
  verifyDomain(id: string): Promise<void>;
  removeDomain(id: string): Promise<void>;
}

export interface DnsAdapter {
  /** TXT values at `name` (chunks joined). Empty when the name has none. */
  resolveTxt(name: string): Promise<string[]>;
  /** CNAME targets at `name`, lowercase, no trailing dot. Empty when none. */
  resolveCname(name: string): Promise<string[]>;
}

export class DomainApiError extends Error {
  constructor(public provider: 'vercel' | 'resend', public status: number, message: string, public code?: string) {
    super(message);
    this.name = 'DomainApiError';
  }
}

// ---------- config ----------

const notConfigured = (what: string) => new AppError(`${what} is not configured on this server yet`, 503, 'NOT_CONFIGURED');

export function vercelConfigured(): boolean {
  return !!(process.env.VERCEL_DOMAINS_TOKEN && process.env.VERCEL_TEAM_ID);
}
export function resendConfigured(): boolean {
  return !!process.env.RESEND_ADMIN_KEY;
}

// ---------- http ----------

async function http(provider: 'vercel' | 'resend', url: string, init: { method: string; headers: Record<string, string>; body?: unknown }, fetchImpl: typeof fetch = fetch): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ADAPTER_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: init.method,
      headers: { ...init.headers, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
    if (!res.ok) {
      const msg = String(json?.error?.message ?? json?.message ?? `HTTP ${res.status}`).slice(0, 300);
      throw new DomainApiError(provider, res.status, msg, json?.error?.code ?? json?.name);
    }
    return json;
  } catch (e: any) {
    if (e instanceof DomainApiError) throw e;
    if (e?.name === 'AbortError') throw new DomainApiError(provider, 504, `${provider} did not answer in time`);
    throw new DomainApiError(provider, 502, `${provider} could not be reached`);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Vercel ----------

const toProjectDomain = (j: any): VercelProjectDomain => ({
  name: String(j?.name ?? ''),
  verified: j?.verified === true,
  verification: Array.isArray(j?.verification)
    ? j.verification.filter((v: any) => v && typeof v.value === 'string').map((v: any) => ({ type: String(v.type), domain: String(v.domain), value: String(v.value), reason: typeof v.reason === 'string' ? v.reason : undefined }))
    : [],
  redirect: typeof j?.redirect === 'string' && j.redirect ? j.redirect : null,
});

export function createVercelAdapter(token: string, teamId: string, fetchImpl?: typeof fetch): VercelAdapter {
  const base = 'https://api.vercel.com';
  const q = `teamId=${encodeURIComponent(teamId)}`;
  const call = (method: string, path: string, body?: unknown) =>
    http('vercel', `${base}${path}${path.includes('?') ? '&' : '?'}${q}`, { method, headers: { Authorization: `Bearer ${token}` }, body }, fetchImpl);
  const seg = encodeURIComponent;
  return {
    async addProjectDomain(projectId, host) {
      return toProjectDomain(await call('POST', `/v10/projects/${seg(projectId)}/domains`, { name: host }));
    },
    async getProjectDomain(projectId, host) {
      try {
        return toProjectDomain(await call('GET', `/v9/projects/${seg(projectId)}/domains/${seg(host)}`));
      } catch (e) {
        if (e instanceof DomainApiError && e.status === 404) return null;
        throw e;
      }
    },
    async verifyProjectDomain(projectId, host) {
      return toProjectDomain(await call('POST', `/v9/projects/${seg(projectId)}/domains/${seg(host)}/verify`));
    },
    async getDomainConfig(host) {
      const j = await call('GET', `/v6/domains/${seg(host)}/config`);
      const rec = Array.isArray(j?.recommendedCNAME) ? [...j.recommendedCNAME].sort((a: any, b: any) => (a?.rank ?? 99) - (b?.rank ?? 99))[0] : null;
      return {
        misconfigured: j?.misconfigured !== false,
        cnameTarget: typeof rec?.value === 'string' ? rec.value.replace(/\.$/, '').toLowerCase() : null,
      };
    },
    async setRedirect(projectId, host, target) {
      await call('PATCH', `/v9/projects/${seg(projectId)}/domains/${seg(host)}`, { redirect: target, redirectStatusCode: target ? 308 : null });
    },
  };
}

// ---------- Resend ----------

const toResendDomain = (j: any): ResendDomain => ({
  id: String(j?.id ?? ''),
  name: String(j?.name ?? '').toLowerCase(),
  status: String(j?.status ?? 'not_started'),
  records: Array.isArray(j?.records)
    ? j.records.map((r: any) => ({
        record: String(r?.record ?? ''), name: String(r?.name ?? ''), type: String(r?.type ?? ''), value: String(r?.value ?? ''),
        ttl: String(r?.ttl ?? 'Auto'), status: String(r?.status ?? 'not_started'),
        ...(typeof r?.priority === 'number' ? { priority: r.priority } : {}),
      }))
    : [],
});

export function createResendAdapter(adminKey: string, fetchImpl?: typeof fetch): ResendAdapter {
  const base = 'https://api.resend.com';
  const call = (method: string, path: string, body?: unknown) =>
    http('resend', `${base}${path}`, { method, headers: { Authorization: `Bearer ${adminKey}` }, body }, fetchImpl);
  return {
    async createDomain(name) {
      return toResendDomain(await call('POST', '/domains', { name }));
    },
    async getDomain(id) {
      return toResendDomain(await call('GET', `/domains/${encodeURIComponent(id)}`));
    },
    async verifyDomain(id) {
      await call('POST', `/domains/${encodeURIComponent(id)}/verify`);
    },
    async removeDomain(id) {
      await call('DELETE', `/domains/${encodeURIComponent(id)}`);
    },
  };
}

// ---------- DNS ----------

export function createDnsAdapter(): DnsAdapter {
  const resolver = () => new Resolver({ timeout: 4000, tries: 1 });
  const none = (e: any) => ['ENODATA', 'ENOTFOUND', 'NXDOMAIN', 'NOTFOUND', 'ESERVFAIL', 'ETIMEOUT', 'ECONNREFUSED', 'EBADRESP'].includes(e?.code);
  return {
    async resolveTxt(name) {
      try {
        return (await resolver().resolveTxt(name)).map((chunks) => chunks.join(''));
      } catch (e) {
        if (none(e)) return [];
        throw e;
      }
    },
    async resolveCname(name) {
      try {
        return (await resolver().resolveCname(name)).map((c) => c.replace(/\.$/, '').toLowerCase());
      } catch (e) {
        if (none(e)) return [];
        throw e;
      }
    },
  };
}

// ---------- accessors (overridable in tests) ----------

let overrides: { vercel?: VercelAdapter | null; resend?: ResendAdapter | null; dns?: DnsAdapter } = {};
/** Tests: inject fakes. `null` forces "not configured"; call with `{}` to reset. */
export function setDomainAdaptersForTest(o: typeof overrides): void {
  overrides = o;
}

export function getVercel(): VercelAdapter {
  if (overrides.vercel !== undefined) {
    if (overrides.vercel === null) throw notConfigured('Domain hosting');
    return overrides.vercel;
  }
  if (!vercelConfigured()) throw notConfigured('Domain hosting');
  return createVercelAdapter(process.env.VERCEL_DOMAINS_TOKEN as string, process.env.VERCEL_TEAM_ID as string);
}
export function getResend(): ResendAdapter {
  if (overrides.resend !== undefined) {
    if (overrides.resend === null) throw notConfigured('Email domains');
    return overrides.resend;
  }
  if (!resendConfigured()) throw notConfigured('Email domains');
  return createResendAdapter(process.env.RESEND_ADMIN_KEY as string);
}
export function getDns(): DnsAdapter {
  return overrides.dns ?? createDnsAdapter();
}
/** Whether each outside system is configured (flags only, never the secrets). */
export function adapterAvailability(): { vercel: boolean; resend: boolean } {
  return {
    vercel: overrides.vercel !== undefined ? overrides.vercel !== null : vercelConfigured(),
    resend: overrides.resend !== undefined ? overrides.resend !== null : resendConfigured(),
  };
}
