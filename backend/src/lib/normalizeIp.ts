/**
 * Client IP normalization for abuse-review hashes (pizza index submissions, hackathon votes).
 * Pure, no dependencies.
 */

/** IPv4 as-is; IPv6 reduced to its /64 prefix (a single device/home can rotate the rest at will). */
export function normalizeIp(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('%')[0].split('::');
  const a = head ? head.split(':') : [];
  const b = ip.includes('::') && tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
