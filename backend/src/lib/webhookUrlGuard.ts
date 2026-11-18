import { lookup as dnsLookup } from 'dns/promises';
import { isIP } from 'net';

/** Thrown when a webhook target is not a public http(s) endpoint. Never retried. */
export class BlockedWebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedWebhookUrlError';
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4(ip: number, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

/** Expand an IPv6 literal to 8 16-bit groups, or null if unparseable. */
function expandV6(ip: string): number[] | null {
  let addr = ip.split('%')[0].toLowerCase();
  // Trailing embedded IPv4 (::ffff:1.2.3.4)
  const v4Tail = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const n = ipv4ToInt(v4Tail[1]);
    addr = addr.slice(0, -v4Tail[1].length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const out = groups.map((g) => parseInt(g, 16));
  return out.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : out;
}

/** True for any address a webhook must never reach (private, loopback, link-local, metadata, reserved). Unparseable => true. */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => inV4(n, base, bits));
  }
  if (kind === 6) {
    const g = expandV6(ip);
    if (!g) return true;
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the embedded v4
    const first5Zero = g.slice(0, 5).every((x) => x === 0);
    if (first5Zero && (g[5] === 0xffff || g[5] === 0)) {
      if (g.slice(0, 7).every((x) => x === 0) && g[7] <= 1) return true; // :: and ::1
      return isBlockedIp(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    }
    if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64
    if (g[0] === 0x2002) return true; // 6to4 (embeds an IPv4; block the whole prefix)
    if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo 2001::/32
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
    return false;
  }
  return true;
}

type LookupFn = (host: string) => Promise<Array<{ address: string }>>;

const defaultLookup: LookupFn = (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * Throws BlockedWebhookUrlError unless `rawUrl` is http(s) and EVERY address its host resolves to
 * is public. Call it right before each delivery attempt (DNS is re-resolved each time) and pair it
 * with `redirect: 'manual'` so a 3xx can't bounce the request to an internal address.
 */
export async function assertPublicWebhookUrl(rawUrl: string, lookup: LookupFn = defaultLookup): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedWebhookUrlError('Invalid webhook URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedWebhookUrlError('Webhook URL must be http or https');
  }
  if (url.username || url.password) {
    throw new BlockedWebhookUrlError('Webhook URL must not contain credentials');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost')) {
    throw new BlockedWebhookUrlError('Webhook URL host is not allowed');
  }
  let addresses: Array<{ address: string }>;
  if (isIP(host)) {
    addresses = [{ address: host }];
  } else {
    try {
      addresses = await lookup(host);
    } catch {
      throw new BlockedWebhookUrlError('Webhook URL host could not be resolved');
    }
  }
  if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address))) {
    throw new BlockedWebhookUrlError('Webhook URL resolves to a non-public address');
  }
}

/** Read at most `maxChars` of a response body (never buffers a large/hostile body), then cancel. */
export async function readTruncatedBody(response: Response, maxChars = 500): Promise<string> {
  try {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let out = '';
    while (out.length < maxChars) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => {});
    return out.slice(0, maxChars);
  } catch {
    return '';
  }
}
