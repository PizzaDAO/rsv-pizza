import { describe, it, expect, vi } from 'vitest';
import { FxUnavailableError, getHistoricalUsdRate, getReceiptFx } from './historicalFx.js';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const miss = { ok: false, status: 404, json: async () => ({}) };

/** Route a mocked fetch by URL host. */
function mockFetch(routes: { frankfurter?: any; yahoo?: any; fawaz?: any }) {
  return vi.fn(async (url: string) => {
    if (url.includes('frankfurter')) return routes.frankfurter ?? miss;
    if (url.includes('yahoo')) return routes.yahoo ?? miss;
    if (url.includes('jsdelivr')) return routes.fawaz ?? miss;
    throw new Error(`unexpected url ${url}`);
  });
}
const base = { cachePath: null, overrides: {} } as const;

describe('getHistoricalUsdRate', () => {
  it('USD is a passthrough and makes no request', async () => {
    const f = mockFetch({});
    const r = await getHistoricalUsdRate('USD', '2022-05-21', { ...base, fetchImpl: f });
    expect(r).toEqual({ rate: 1, source: 'usd-passthrough', date: '2022-05-21' });
    expect(f).not.toHaveBeenCalled();
  });

  it('ECB currencies go to frankfurter (weekend resolves to the returned business day)', async () => {
    const f = mockFetch({ frankfurter: ok({ base: 'EUR', date: '2022-05-20', rates: { USD: 1.0575 } }) });
    const r = await getHistoricalUsdRate('eur', '2022-05-21', { ...base, fetchImpl: f });
    expect(r.rate).toBe(1.0575);
    expect(r.source).toBe('frankfurter:2022-05-20');
    expect(r.date).toBe('2022-05-20');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toContain('api.frankfurter.dev/v1/2022-05-21?base=EUR&symbols=USD');
  });

  it('currencies the ECB does not carry fall through to Yahoo (rate = 1 / close, last close on or before the date)', async () => {
    const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
    const f = mockFetch({
      yahoo: ok({ chart: { result: [{
        timestamp: [day('2022-05-18'), day('2022-05-19'), day('2022-05-20'), day('2022-05-23')],
        indicators: { quote: [{ close: [410, 415, null, 420] }] },
      }] } }),
    });
    const r = await getHistoricalUsdRate('NGN', '2022-05-21', { ...base, fetchImpl: f });
    expect(r.source).toBe('yahoo:2022-05-19'); // 05-20 close is null, 05-23 is after the receipt
    expect(r.rate).toBeCloseTo(1 / 415, 8);
    expect(f.mock.calls.map((c) => c[0]).some((u) => u.includes('NGN=X'))).toBe(true);
  });

  it('a manual override beats every network source', async () => {
    const f = mockFetch({ frankfurter: ok({ date: '2021-11-05', rates: { USD: 99 } }) });
    const r = await getHistoricalUsdRate('VES', '2021-11-05', {
      cachePath: null, fetchImpl: f, overrides: { 'VES:2021-11': { rate: 0.2381, source: 'BCV-oct-2021' } },
    });
    expect(r.rate).toBe(0.2381);
    expect(r.source).toBe('manual:BCV-oct-2021');
    expect(f).not.toHaveBeenCalled();
    // a day-specific override wins over the month one
    const d = await getHistoricalUsdRate('VES', '2021-11-05', {
      cachePath: null, fetchImpl: f, overrides: { 'VES:2021-11': { rate: 0.2 }, 'VES:2021-11-05': { rate: 0.25 } },
    });
    expect(d.rate).toBe(0.25);
  });

  it('fails (never guesses) when neither ECB nor Yahoo has the rate', async () => {
    await expect(getHistoricalUsdRate('LBP', '2021-03-01', { ...base, fetchImpl: mockFetch({}) })).rejects.toBeInstanceOf(FxUnavailableError);
    await expect(getHistoricalUsdRate('XX', '2021-03-01', base)).rejects.toBeInstanceOf(FxUnavailableError);
    await expect(getHistoricalUsdRate('EUR', 'yesterday', base)).rejects.toBeInstanceOf(FxUnavailableError);
  });

  it('cross-check warns when the fawazahmed0 snapshot disagrees by > 5% (2024-03-02 and later only)', async () => {
    const f = mockFetch({
      frankfurter: ok({ date: '2024-06-03', rates: { USD: 0.1 } }),
      fawaz: ok({ try: { usd: 0.2 } }),
    });
    const r = await getHistoricalUsdRate('TRY', '2024-06-03', { ...base, fetchImpl: f, crossCheck: true });
    expect(r.warning).toMatch(/cross-check/);
    const old = await getHistoricalUsdRate('TRY', '2023-06-03', { ...base, fetchImpl: f, crossCheck: true });
    expect(old.warning).toBeUndefined();
  });
});

describe('getReceiptFx', () => {
  it('uses the receipt date when present', async () => {
    const f = mockFetch({ frankfurter: ok({ date: '2022-05-20', rates: { USD: 1.05 } }) });
    const r = await getReceiptFx('EUR', '2022-05-20', 2022, { ...base, fetchImpl: f });
    expect(r.assumedDate).toBe(false);
    expect(r.source).toBe('frankfurter:2022-05-20');
  });

  it('assumes {year}-10-01 and tags the source when the date is missing', async () => {
    const f = mockFetch({ frankfurter: ok({ date: '2022-09-30', rates: { USD: 0.98 } }) });
    const r = await getReceiptFx('EUR', null, 2022, { ...base, fetchImpl: f });
    expect(r.assumedDate).toBe(true);
    expect(r.source).toBe('frankfurter:2022-09-30:assumed-date');
    expect(f.mock.calls[0][0]).toContain('/v1/2022-10-01?');
  });
});
