/**
 * FX conversion service for host payouts (arugula-38633).
 * Ported from pizza-faucet-v2/src/app/api/analyze-receipt/route.ts (convertToUSD).
 *
 * Cascade:
 *   1. jsdelivr (fawazahmed0 currency-api) — supports niche currencies (e.g. NGN)
 *   2. frankfurter.app
 *   3. Hardcoded FALLBACK_RATES_TO_USD
 *
 * IMPORTANT: rates returned here are LOCKED at submission time on the payout
 * row. Never re-fetch at payout-execution time — host amounts would drift.
 */

// Common currency codes and their typical symbols (used to normalize OCR output)
export const CURRENCY_MAP: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₦': 'NGN',
  N: 'NGN',     // Nigerian Naira is often written as N
  NGN: 'NGN',
  '₹': 'INR',
  R$: 'BRL',
  '₱': 'PHP',
  '฿': 'THB',
  kr: 'SEK',
  zł: 'PLN',
  CHF: 'CHF',
  A$: 'AUD',
  C$: 'CAD',
};

// Fallback exchange rates to USD (approximate, refresh periodically).
// Only used when both jsdelivr and frankfurter are unavailable.
export const FALLBACK_RATES_TO_USD: Record<string, number> = {
  NGN: 0.00063,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0067,
  INR: 0.012,
  BRL: 0.20,
  PHP: 0.018,
  THB: 0.029,
  SEK: 0.096,
  PLN: 0.25,
  CHF: 1.13,
  AUD: 0.66,
  CAD: 0.74,
  MXN: 0.058,
  KRW: 0.00075,
  CNY: 0.14,
  ZAR: 0.055,
};

export type FxSource = 'jsdelivr' | 'frankfurter' | 'fallback' | 'usd-passthrough' | 'unknown';

export interface FxConversionResult {
  usdAmount: number;
  exchangeRate: number;
  originalAmount: number;
  originalCurrency: string;
  source: FxSource;
}

/**
 * Convert an amount in `fromCurrency` to USD.
 * Returns a normalized `originalCurrency`, the locked `exchangeRate`,
 * and which provider supplied the rate (`source`).
 *
 * Never throws — falls back through the cascade and ultimately returns a
 * passthrough (rate=1) if no provider can serve the currency. Callers should
 * check `source === 'unknown'` if they want to flag suspicious conversions.
 */
export async function convertToUSD(amount: number, fromCurrency: string): Promise<FxConversionResult> {
  const normalizedCurrency = CURRENCY_MAP[fromCurrency] || fromCurrency.toUpperCase();

  if (normalizedCurrency === 'USD') {
    return {
      usdAmount: round2(amount),
      exchangeRate: 1,
      originalAmount: amount,
      originalCurrency: 'USD',
      source: 'usd-passthrough',
    };
  }

  // 1. Try jsdelivr (fawazahmed0 currency-api). Supports NGN + many obscure currencies.
  try {
    const response = await fetch(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${normalizedCurrency.toLowerCase()}.json`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (response.ok) {
      const data = await response.json();
      const rate = data[normalizedCurrency.toLowerCase()]?.usd;
      if (rate) {
        const usdAmount = amount * rate;
        return {
          usdAmount: round2(usdAmount),
          exchangeRate: rate,
          originalAmount: amount,
          originalCurrency: normalizedCurrency,
          source: 'jsdelivr',
        };
      }
    }
  } catch (error) {
    console.log('[fx] jsdelivr lookup failed:', error);
  }

  // 2. Fallback: frankfurter.app (doesn't support every currency, but reliable for majors).
  try {
    const fallbackResponse = await fetch(
      `https://api.frankfurter.app/latest?from=${normalizedCurrency}&to=USD`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (fallbackResponse.ok) {
      const fallbackData = await fallbackResponse.json();
      if (fallbackData.rates?.USD) {
        const usdAmount = amount * fallbackData.rates.USD;
        return {
          usdAmount: round2(usdAmount),
          exchangeRate: fallbackData.rates.USD,
          originalAmount: amount,
          originalCurrency: normalizedCurrency,
          source: 'frankfurter',
        };
      }
    }
  } catch (error) {
    console.log('[fx] frankfurter lookup failed:', error);
  }

  // 3. Hardcoded fallback table.
  const fallbackRate = FALLBACK_RATES_TO_USD[normalizedCurrency];
  if (fallbackRate) {
    const usdAmount = amount * fallbackRate;
    return {
      usdAmount: round2(usdAmount),
      exchangeRate: fallbackRate,
      originalAmount: amount,
      originalCurrency: normalizedCurrency,
      source: 'fallback',
    };
  }

  // 4. Last resort: rate=1 passthrough. Caller should flag this.
  console.warn(`[fx] Could not convert ${normalizedCurrency} to USD; no rate available, returning passthrough`);
  return {
    usdAmount: round2(amount),
    exchangeRate: 1,
    originalAmount: amount,
    originalCurrency: normalizedCurrency,
    source: 'unknown',
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
