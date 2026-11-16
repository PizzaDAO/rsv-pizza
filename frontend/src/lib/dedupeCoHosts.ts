export interface DedupableCoHost {
  id?: string;
  name?: string | null;
  avatar_url?: string | null;
  website?: string | null;
  twitter?: string | null;
  instagram?: string | null;
  showOnEvent?: boolean;
}

export const normalizeHostName = (name?: string | null): string =>
  (name ?? '').trim().toLowerCase();

const richness = (h: DedupableCoHost): number =>
  [h.avatar_url, h.website, h.twitter, h.instagram].filter(Boolean).length;

/**
 * Remove duplicate co-hosts by normalized name (trim + case-insensitive).
 * Keeps first-occurrence position, but swaps in a later duplicate if it has
 * strictly more data (avatar/website/twitter/instagram). Entries without a
 * name are only collapsed when they share an id. Drops entries matching the
 * main host name.
 */
export function dedupeCoHosts<T extends DedupableCoHost>(
  coHosts: T[] | null | undefined,
  hostName?: string | null,
): T[] {
  if (!Array.isArray(coHosts)) return [];
  const host = normalizeHostName(hostName);
  const result: T[] = [];
  const index = new Map<string, number>();
  for (const h of coHosts) {
    if (!h) continue;
    const n = normalizeHostName(h.name);
    if (n && host && n === host) continue;
    const key = n ? `n:${n}` : h.id ? `i:${h.id}` : null;
    if (key === null) {
      result.push(h);
      continue;
    }
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, result.length);
      result.push(h);
    } else if (richness(h) > richness(result[at])) {
      result[at] = h;
    }
  }
  return result;
}
