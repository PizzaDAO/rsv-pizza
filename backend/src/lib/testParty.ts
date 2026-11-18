/**
 * Conservative "obviously a test/probe party" rule, used to keep QA/probe data out of
 * PUBLIC listings (GPP public list, public series events). Moderators still see everything.
 *
 * Matches (case-insensitive):
 *   - name starts with "test" / "[test" / "(test" (word boundary):
 *     "TEST — Invoice Numbering", "[TEST] Judge 2nd account"
 *   - name contains "probe party"
 *   - name contains "delete me"
 */
const TEST_PARTY_RULES: RegExp[] = [/^\s*[[(]?test\b/i, /probe party/i, /delete me/i];

export function isTestParty(name: string | null | undefined): boolean {
  if (!name) return false;
  return TEST_PARTY_RULES.some((re) => re.test(name));
}
