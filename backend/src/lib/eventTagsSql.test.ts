/**
 * scam-flag-private: parity between the SQL strip function behind the anon-readable generated
 * column parties.public_event_tags and the JS internal-tag list.
 *
 * The migration's tag list and regexes must equal scripts/internal-event-tags.json, which the
 * backend and frontend eventTags tests already tie to INTERNAL_EVENT_TAGS / INTERNAL_TAG_PATTERNS.
 * If you add an internal tag, update the JSON, both eventTags.ts files AND ship a new migration
 * that CREATE OR REPLACEs strip_internal_event_tags (then `UPDATE parties SET event_tags =
 * event_tags` to recompute the stored column), and point MIGRATION below at it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { INTERNAL_EVENT_TAGS, INTERNAL_TAG_PATTERNS, publicTags } from './eventTags.js';

const ROOT = resolve(__dirname, '../../..');
const MIGRATION = 'backend/prisma/migrations/20261118_parties_public_event_tags/migration.sql';
const sql = readFileSync(resolve(ROOT, MIGRATION), 'utf8');
const fixture = JSON.parse(readFileSync(resolve(ROOT, 'scripts/internal-event-tags.json'), 'utf8')) as {
  tags: string[];
  patterns: { source: string; flags: string }[];
};

function between(begin: string, end: string): string {
  const i = sql.indexOf(begin);
  const j = sql.indexOf(end);
  if (i < 0 || j < 0 || j < i) throw new Error(`markers ${begin}/${end} not found in ${MIGRATION}`);
  return sql.slice(i + begin.length, j);
}

const sqlTags = [...between('-- internal-tags:begin', '-- internal-tags:end').matchAll(/'([^']*)'/g)].map((m) => m[1]);
const sqlPatterns = [...between('-- internal-patterns:begin', '-- internal-patterns:end').matchAll(/(~\*?)\s*'([^']*)'/g)].map(
  (m) => ({ source: m[2], flags: m[1] === '~*' ? 'i' : '' }),
);

/** JS model of strip_internal_event_tags built only from what the SQL file says. */
function sqlStripModel(tags: (string | null)[] | null): string[] {
  if (!Array.isArray(tags)) return [];
  const set = new Set(sqlTags);
  const res = sqlPatterns.map((p) => new RegExp(p.source, p.flags));
  return tags.filter((t): t is string => {
    if (t == null) return false;
    const s = t.replace(/^\s+|\s+$/g, '');
    return !(set.has(s.toLowerCase()) || res.some((re) => re.test(s)));
  });
}

describe('scam-flag-private: public_event_tags SQL parity', () => {
  it('the SQL tag list equals scripts/internal-event-tags.json and INTERNAL_EVENT_TAGS', () => {
    expect([...sqlTags].sort()).toEqual([...fixture.tags].sort());
    expect([...sqlTags].sort()).toEqual([...INTERNAL_EVENT_TAGS].sort());
    expect(new Set(sqlTags).size).toBe(sqlTags.length);
    // SQL compares lower(tag), so every list entry must already be lowercase.
    for (const t of sqlTags) expect(t).toBe(t.toLowerCase());
  });

  it('the SQL regexes equal the fixture and INTERNAL_TAG_PATTERNS (source + case flag)', () => {
    expect(sqlPatterns).toEqual(fixture.patterns);
    expect(sqlPatterns).toEqual(INTERNAL_TAG_PATTERNS.map((re) => ({ source: re.source, flags: re.flags })));
  });

  it('possible-scam and the payout/cap tags are stripped; public taxonomy tags survive', () => {
    const input = [
      'swc', 'SWC Hub', 'side', 'gpp2026', 'Global Pizza Party', 'wpc', 'ens', 'avax', 'swcbr',
      'possible-scam', 'POSSIBLE-SCAM', '  paid  ', 'prepay', 'go', 'Go', 'missed', 'refund', 'nonhub',
      'NonHub', 'nonpres', 'side-prelaunch', '200', '350.50', '350.5', '1.234', 'k40', 'K200.50', 'k',
      'gpp2027', 'GPP2027', 'gpp20270', '12a', 'going', 'paid-ish',
    ];
    const out = sqlStripModel(input);
    expect(out).toEqual(publicTags(input));
    expect(out).toEqual([
      'swc', 'SWC Hub', 'side', 'gpp2026', 'Global Pizza Party', 'wpc', 'ens', 'avax', 'swcbr',
      '1.234', 'k', 'gpp20270', '12a', 'going', 'paid-ish',
    ]);
  });

  it('NULL array -> {} and NULL elements are dropped', () => {
    expect(sqlStripModel(null)).toEqual([]);
    expect(sqlStripModel(['swc', null, 'paid'])).toEqual(['swc']);
  });

  it('the column is generated from the function and granted to anon + authenticated', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS public_event_tags text\[\]\s+GENERATED ALWAYS AS \(public\.strip_internal_event_tags\(event_tags\)\) STORED/);
    expect(sql).toMatch(/GRANT SELECT \(public_event_tags\) ON public\.parties TO anon, authenticated/);
    expect(sql).toMatch(/IMMUTABLE/);
    // Step 1 must stay additive: the revoke lives in its own, later migration.
    expect(sql).not.toMatch(/REVOKE/i);
  });

  it('the step-3 migration revokes exactly event_tags from anon + authenticated', () => {
    const revoke = readFileSync(resolve(ROOT, 'backend/prisma/migrations/20261119_revoke_anon_event_tags/migration.sql'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(revoke).toMatch(/REVOKE SELECT \(event_tags\) ON public\.parties FROM anon, authenticated/);
    expect(revoke).not.toMatch(/GRANT/i);
  });
});
