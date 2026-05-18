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
 */
export function formatPayoutAmount(
  usdAmount: number,
  originalAmount?: number | null,
  originalCurrency?: string | null,
): string {
  const usd = formatUsd(usdAmount);
  if (originalAmount == null || !originalCurrency || originalCurrency.toUpperCase() === 'USD') {
    return usd;
  }
  return `${usd} (${formatOriginalCurrency(originalAmount, originalCurrency)})`;
}
