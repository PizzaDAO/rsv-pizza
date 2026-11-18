import { describe, it, expect, afterEach } from 'vitest';
import { computeSpendingLimitCents, redactCardData } from './virtualCard.service.js';

describe('computeSpendingLimitCents', () => {
  afterEach(() => {
    delete process.env.AI_PHONE_CARD_MAX_CENTS;
  });

  it('uses $18/pizza + 20%', () => {
    expect(computeSpendingLimitCents(1)).toBe(2160);
    expect(computeSpendingLimitCents(10)).toBe(21600);
  });

  it('caps at the max (default $500) and rejects bad counts', () => {
    expect(computeSpendingLimitCents(50)).toBe(50_000);
    process.env.AI_PHONE_CARD_MAX_CENTS = '10000';
    expect(computeSpendingLimitCents(10)).toBe(10_000);
    expect(() => computeSpendingLimitCents(0)).toThrow();
    expect(() => computeSpendingLimitCents(51)).toThrow();
    expect(() => computeSpendingLimitCents(1.5)).toThrow();
  });
});

describe('redactCardData', () => {
  const card = { number: '4000009990000001', cvc: '739', expMonth: 4, expYear: 2029 };

  it('masks the exact card, CVC and expiry', () => {
    const out = redactCardData('Number 4000 0099 9000 0001, exp 04 slash 29, code 739. Total $73.90', card);
    expect(out).not.toMatch(/0001|739(?!\.)|04 slash 29/);
    expect(out).toContain('$73.90');
  });

  it('always masks card-number-shaped digit runs, even without the card', () => {
    expect(redactCardData('it is 4242-4242-4242-4242 ok')).toBe('it is [redacted] ok');
    expect(redactCardData('call 555 010 1111')).toBe('call 555 010 1111');
  });

  it('handles empty input', () => {
    expect(redactCardData(null)).toBe('');
  });
});
