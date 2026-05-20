import { describe, it, expect } from 'vitest';
import { computeEffectiveCapUsd, parseNumericCapFromTags } from './reimbursementCap';

describe('parseNumericCapFromTags', () => {
  it('returns null for empty / nullish input', () => {
    expect(parseNumericCapFromTags(null)).toBeNull();
    expect(parseNumericCapFromTags(undefined)).toBeNull();
    expect(parseNumericCapFromTags([])).toBeNull();
  });

  it('returns null when no tags are numeric', () => {
    expect(parseNumericCapFromTags(['pfp', 'cohost', 'abc'])).toBeNull();
  });

  it('returns the max numeric tag, ignoring non-numerics', () => {
    expect(parseNumericCapFromTags(['pfp', '200'])).toBe(200);
    expect(parseNumericCapFromTags(['100', '500', 'cohost'])).toBe(500);
  });

  it('parses 1-2 decimal places', () => {
    expect(parseNumericCapFromTags(['350.50'])).toBe(350.5);
    expect(parseNumericCapFromTags(['12.3'])).toBe(12.3);
  });

  it('rejects 3+ decimal places', () => {
    expect(parseNumericCapFromTags(['200.123'])).toBeNull();
  });

  it('trims whitespace before matching', () => {
    expect(parseNumericCapFromTags(['  500  '])).toBe(500);
  });

  it('ignores negative / signed values (regex is unsigned)', () => {
    expect(parseNumericCapFromTags(['-100'])).toBeNull();
    expect(parseNumericCapFromTags(['+100'])).toBeNull();
  });
});

describe('computeEffectiveCapUsd', () => {
  it('prefers underboss-validated cap over tags', () => {
    expect(
      computeEffectiveCapUsd({ reimbursementCapUsd: 300, eventTags: ['500'] })
    ).toBe(300);
  });

  it('falls back to numeric tag when raw cap is null', () => {
    expect(
      computeEffectiveCapUsd({ reimbursementCapUsd: null, eventTags: ['pfp', '200'] })
    ).toBe(200);
  });

  it('returns null when neither raw cap nor numeric tag exists', () => {
    expect(
      computeEffectiveCapUsd({ reimbursementCapUsd: null, eventTags: ['pfp'] })
    ).toBeNull();
    expect(
      computeEffectiveCapUsd({ reimbursementCapUsd: null, eventTags: [] })
    ).toBeNull();
    expect(
      computeEffectiveCapUsd({ reimbursementCapUsd: null, eventTags: null })
    ).toBeNull();
  });

  it('accepts string reimbursementCapUsd (Decimal from Prisma)', () => {
    expect(
      computeEffectiveCapUsd({ reimbursementCapUsd: '450.00', eventTags: [] })
    ).toBe(450);
  });
});
