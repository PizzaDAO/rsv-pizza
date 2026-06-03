/**
 * Shared payout-amount formatters used by both the host PayoutsList (PR 3) and
 * the admin PayoutsTable (PR 4). Keeping a single source so the two views
 * never disagree on what "$15.75 USD (€14.00 EUR)" should look like.
 */

const USD_FMT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return '—';
  return USD_FMT.format(Number(amount));
}

/**
 * Format an original-currency amount. Falls back to a plain numeric format if
 * Intl.NumberFormat doesn't recognize the currency code (common for niche
 * receipts).
 */
export function formatOriginalCurrency(amount: number, currency: string): string {
  try {
    const fmt = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return fmt.format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/**
 * Combined formatter: "$15.75 USD (€14.00 EUR)" style. If the original
 * currency is USD (or matches the USD amount) we just return the USD form
 * with no parenthetical footnote.
 *
 * marinara-62104: the parenthetical is now gated on a rate-faithfulness check.
 * The backend's parent-payout `originalAmount`/`originalCurrency` headline is
 * only the FIRST receipt's FX, and `finalAmountUsd` can be a cap-clamped total
 * of many receipts. Pairing those two numbers implies a bogus exchange rate
 * (e.g. "$625.00 USD (880 MYR)" for a 4-receipt, cap-clamped KL payout). We
 * only append "(orig CUR)" when `originalAmount * exchangeRate` actually
 * reconstructs the displayed USD — i.e. it's a faithful single conversion.
 */
export function formatPayoutAmount(
  usdAmount: number,
  originalAmount?: number | null,
  originalCurrency?: string | null,
  exchangeRate?: number | null,
): string {
  const usd = formatUsd(usdAmount);
  if (
    originalAmount == null ||
    !originalCurrency ||
    originalCurrency.toUpperCase() === 'USD' ||
    !(originalAmount > 0)
  ) {
    return usd;
  }
  // marinara-62104: only show the parenthetical when originalAmount * rate ≈
  // the displayed USD. Suppresses the misleading line for multi-receipt payouts
  // (parenthetical is only the first receipt) and cap-clamped payouts (the USD
  // is the capped total, not a conversion of originalAmount).
  const rate = exchangeRate ?? null;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const faithful =
    rate != null && rate > 0 &&
    Math.abs(round2(originalAmount * rate) - round2(usdAmount)) < 0.01;
  if (!faithful) return usd;
  return `${usd} (${formatOriginalCurrency(originalAmount, originalCurrency)})`;
}
