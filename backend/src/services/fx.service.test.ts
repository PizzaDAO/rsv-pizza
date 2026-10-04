import { describe, it, expect, vi, afterEach } from 'vitest';
import { convertToUSD, CURRENCY_MAP, FALLBACK_RATES_TO_USD } from './fx.service.js';

/**
 * Money-path safety tests for FX conversion. The critical invariant
 * (mortadella-92103): NEVER silently stamp a foreign amount as 1:1 USD when the
 * currency is unknown/unresolvable — that would write a wrong USD payout total.
 * Unresolvable → { usdAmount: null, source: 'unresolved', error:
 * 'CURRENCY_UNRESOLVED' } so the caller skips it from the sum (not $0).
 */
afterEach(() => vi.unstubAllGlobals());

/** Force both remote rate providers to fail so we exercise the offline cascade. */
function stubFetchDown() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
}

describe('convertToUSD — unresolved guard (no silent 1:1)', () => {
  it.each([null, undefined, '', '   ', 'UNKNOWN', 'unknown'])(
    'refuses to convert when currency is %p',
    async (cur) => {
      const r = await convertToUSD(1234.56, cur as any);
      expect(r.usdAmount).toBeNull();
      expect(r.exchangeRate).toBeNull();
      expect(r.source).toBe('unresolved');
      expect(r.error).toBe('CURRENCY_UNRESOLVED');
      expect(r.originalAmount).toBe(1234.56);
    },
  );

  it('flags UNRESOLVED (not 1:1) for an unknown currency when providers are down', async () => {
    stubFetchDown();
    const r = await convertToUSD(500, 'ZZZ');
    expect(r.usdAmount).toBeNull();
    expect(r.source).toBe('unresolved');
    expect(r.error).toBe('CURRENCY_UNRESOLVED');
  });
});

describe('convertToUSD — USD passthrough', () => {
  it('passes USD through at rate 1, rounded to 2dp', async () => {
    const r = await convertToUSD(10.999, 'USD');
    expect(r.source).toBe('usd-passthrough');
    expect(r.exchangeRate).toBe(1);
    expect(r.usdAmount).toBe(11); // round2(10.999)
    expect(r.originalCurrency).toBe('USD');
  });

  it('normalizes the $ symbol to USD passthrough (no network)', async () => {
    const r = await convertToUSD(42, '$');
    expect(r.source).toBe('usd-passthrough');
    expect(r.usdAmount).toBe(42);
    expect(CURRENCY_MAP['$']).toBe('USD');
  });
});

describe('convertToUSD — offline fallback table', () => {
  it('uses the hardcoded fallback rate when providers are down (NGN)', async () => {
    stubFetchDown();
    const r = await convertToUSD(100000, 'NGN');
    expect(r.source).toBe('fallback');
    expect(r.exchangeRate).toBe(FALLBACK_RATES_TO_USD.NGN);
    expect(r.usdAmount).toBe(63); // round2(100000 * 0.00063)
    expect(r.originalCurrency).toBe('NGN');
  });

  it('normalizes a symbol then falls back (€ -> EUR)', async () => {
    stubFetchDown();
    const r = await convertToUSD(100, '€');
    expect(r.source).toBe('fallback');
    expect(r.originalCurrency).toBe('EUR');
    expect(r.usdAmount).toBe(108); // round2(100 * 1.08)
  });

  it('a mapped currency with no fallback rate stays UNRESOLVED when offline (VES)', async () => {
    stubFetchDown();
    expect(CURRENCY_MAP['Bs']).toBe('VES');
    expect(FALLBACK_RATES_TO_USD.VES).toBeUndefined();
    const r = await convertToUSD(1000, 'Bs');
    expect(r.usdAmount).toBeNull();
    expect(r.source).toBe('unresolved');
  });
});

describe('convertToUSD — live provider (jsdelivr)', () => {
  it('uses the jsdelivr rate when available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ eur: { usd: 1.1 } }),
    }));
    const r = await convertToUSD(200, 'EUR');
    expect(r.source).toBe('jsdelivr');
    expect(r.exchangeRate).toBe(1.1);
    expect(r.usdAmount).toBe(220);
  });
});
