/**
 * Client for pizzadao.org's name-tag member lookup (POST /api/service/nametag-members).
 *
 * Only sha256 hashes of guest emails and wallet addresses leave this app (in the body, never the URL).
 * The key (env PIZZADAO_NAMETAG_KEY) and the identifiers are never logged. Never throws: any failure
 * (no key, timeout, bad status, bad body) returns null and the caller prints plain tags.
 *
 * Base URL: env PIZZADAO_NAMETAG_URL (previews), else app_config `pizzadao.nametags.url`
 * (JSON string), else https://pizzadao.org.
 */
import { prisma } from '../config/database.js';

export const DEFAULT_NAMETAG_URL = 'https://pizzadao.org';
export const NAMETAG_TIMEOUT_MS = 5000;
const URL_CONFIG_KEY = 'pizzadao.nametags.url';

export interface NametagMember {
  memberId: string;
  name: string;
  pfpUrl: string;
  crews?: { id: string; label: string; emoji?: string }[];
  city?: string;
  levelCompleted?: number;
  levelTitle?: string;
}

export interface NametagMatch {
  emailHash?: string;
  wallet?: string;
  member: NametagMember;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

/** Keep only the known, well-typed fields (a misbehaving upstream can never inject extra data into a tag). */
export function sanitizeMember(raw: unknown): NametagMember | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const memberId = str(m.memberId, 40);
  const name = str(m.name, 120);
  const pfpUrl = str(m.pfpUrl, 500);
  if (!memberId || !name || !pfpUrl || !/^https?:\/\//i.test(pfpUrl)) return null;
  const out: NametagMember = { memberId, name, pfpUrl };
  if (Array.isArray(m.crews)) {
    const crews = m.crews
      .slice(0, 6)
      .map((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        const id = str(o.id, 80);
        const label = str(o.label, 80);
        if (!id || !label) return null;
        const emoji = str(o.emoji, 16);
        return { id, label, ...(emoji ? { emoji } : {}) };
      })
      .filter((c): c is { id: string; label: string; emoji?: string } => c !== null);
    if (crews.length) out.crews = crews;
  }
  const city = str(m.city, 120);
  if (city) out.city = city;
  if (typeof m.levelCompleted === 'number' && Number.isInteger(m.levelCompleted) && m.levelCompleted >= 0 && m.levelCompleted <= 99) {
    out.levelCompleted = m.levelCompleted;
    const title = str(m.levelTitle, 80);
    if (title) out.levelTitle = title;
  }
  return out;
}

export async function nametagBaseUrl(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const fromEnv = env.PIZZADAO_NAMETAG_URL?.trim();
  let url = fromEnv || '';
  if (!url) {
    try {
      const row = await prisma.appConfig.findUnique({ where: { key: URL_CONFIG_KEY } });
      const v = row ? JSON.parse(row.value) : null;
      if (typeof v === 'string') url = v.trim();
    } catch {
      // default stands
    }
  }
  if (!/^https:\/\/[^\s/]+(\/.*)?$/.test(url) && !/^http:\/\/localhost(:\d+)?$/.test(url)) url = DEFAULT_NAMETAG_URL;
  return url.replace(/\/+$/, '');
}

const chunk = <T>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

export async function lookupNametagMembers(
  ids: { emailHashes: string[]; wallets: string[] },
  opts: { maxIdentifiers: number; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv },
): Promise<NametagMatch[] | null> {
  const env = opts.env ?? process.env;
  const key = env.PIZZADAO_NAMETAG_KEY?.trim();
  if (!key) return null;
  if (ids.emailHashes.length === 0 && ids.wallets.length === 0) return [];
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const base = await nametagBaseUrl(env);
    const max = Math.max(1, opts.maxIdentifiers);
    const hashChunks = chunk(ids.emailHashes, max);
    const walletChunks = chunk(ids.wallets, max);
    const n = Math.max(hashChunks.length, walletChunks.length);
    const matches: NametagMatch[] = [];
    for (let i = 0; i < n; i++) {
      const res = await doFetch(`${base}/api/service/nametag-members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ emailHashes: hashChunks[i] ?? [], wallets: walletChunks[i] ?? [] }),
        signal: AbortSignal.timeout(NAMETAG_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { ok?: unknown; matches?: unknown };
      if (body?.ok !== true || !Array.isArray(body.matches)) return null;
      for (const raw of body.matches) {
        const r = (raw ?? {}) as Record<string, unknown>;
        const member = sanitizeMember(r.member);
        if (!member) continue;
        const emailHash = typeof r.emailHash === 'string' && /^[0-9a-f]{64}$/.test(r.emailHash) ? r.emailHash : undefined;
        const wallet = typeof r.wallet === 'string' && /^0x[0-9a-f]{40}$/.test(r.wallet) ? r.wallet : undefined;
        if (!emailHash && !wallet) continue;
        matches.push({ ...(emailHash ? { emailHash } : {}), ...(wallet ? { wallet } : {}), member });
      }
    }
    return matches;
  } catch {
    // Never log the error object: it can carry the request URL or body.
    console.warn('[nametags] member lookup failed');
    return null;
  }
}
