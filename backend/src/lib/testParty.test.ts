import { describe, it, expect } from 'vitest';
import { isTestParty } from './testParty.js';

describe('isTestParty', () => {
  it('flags obvious test/probe parties', () => {
    for (const n of ['TEST — Invoice Numbering', '[TEST] Judge 2nd account (delete me)', 'zz32557 probe party', ' test party', 'Test', '(test) x', 'please DELETE ME', 'Test: foo', 'Test - foo']) {
      expect(isTestParty(n)).toBe(true);
    }
  });
  it('leaves real events alone', () => {
    for (const n of ['Global Pizza Party Austin', 'Testaccio Pizza Night', 'Contest Night', 'Latest Slice', 'Pizza Test Kitchen', 'Test Kitchen Opening', 'Test Match Viewing', '', null, undefined]) {
      expect(isTestParty(n)).toBe(false);
    }
  });
});
