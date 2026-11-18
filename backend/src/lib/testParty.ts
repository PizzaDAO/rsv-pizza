/**
 * Conservative "obviously a test/probe party" rule, used to keep QA/probe data out of
 * PUBLIC listings (GPP public list, public series events). Moderators still see everything.
 *
 * Matches (case-insensitive):
 *   - name starts with "test" followed by a separator or "party" or end:
 *     "TEST — Invoice Numbering", "[TEST] Judge 2nd account", "Test", "Test Party"
 *     (but not "Test Kitchen Opening" or "Test Match Viewing")
 *   - name contains "probe party"
 *   - name contains "delete me"
 *
 * TEST_PARTY_SQL_PATTERNS mirrors the rules as Postgres regexes (`~*`) so listings can
 * exclude them in the DB query (consistent totals/pagination).
 */
const TEST_PARTY_RULES: RegExp[] = [/^\s*[[(]?test\s*([\])—–:-]|party\b|$)/i, /probe party/i, /delete me/i];

export const TEST_PARTY_SQL_PATTERNS: string[] = [
  '^\\s*[\\[(]?test\\s*([\\])—–:-]|party\\y|$)',
  'probe party',
  'delete me',
];

export function isTestParty(name: string | null | undefined): boolean {
  if (!name) return false;
  return TEST_PARTY_RULES.some((re) => re.test(name));
}
