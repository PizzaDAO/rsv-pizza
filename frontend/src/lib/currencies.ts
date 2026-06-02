/**
 * focaccia-89172 / pomodoro-58219: ISO 4217 currency options for the
 * receipt-row currency override dropdown. OCR sometimes misreads `₹` as `$`
 * (or similar) and the FX conversion is then off by ~80x — hosts pick the
 * correct code from this list to re-trigger the conversion.
 *
 * As of pomodoro-58219 the list derives from the canonical `./iso4217`
 * dataset (full active ISO 4217 fiat set, ~157 codes) instead of a separate
 * hand-curated ~40-code list. The exported API is unchanged so
 * `CurrencyOverrideSelect.tsx` needs no edits. `COMMON_CURRENCY_CODES` still
 * drives the small "Common" optgroup; the full set fills the "All" optgroup.
 */
import { ISO_4217 } from './iso4217';

export interface CurrencyOption {
  code: string;
  label: string;
  symbol?: string;
}

/**
 * The handful of codes hosts most commonly need to swap to. Rendered above
 * the long alphabetical list in an `<optgroup>` for quick access.
 */
export const COMMON_CURRENCY_CODES: readonly string[] = [
  'USD',
  'EUR',
  'GBP',
  'INR',
  'NGN',
];

/**
 * Curated currency symbols, retained for the codes we historically displayed
 * with one. Symbols are informational only — the FX lookup uses the ISO code,
 * and codes not in this map simply render without a symbol.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  AED: 'د.إ',
  ARS: '$',
  AUD: 'A$',
  BRL: 'R$',
  CAD: 'C$',
  CHF: 'CHF',
  CLP: '$',
  CNY: '¥',
  COP: '$',
  CZK: 'Kč',
  DKK: 'kr',
  EGP: 'E£',
  EUR: '€',
  GBP: '£',
  GHS: '₵',
  HKD: 'HK$',
  HUF: 'Ft',
  IDR: 'Rp',
  ILS: '₪',
  INR: '₹',
  JPY: '¥',
  KES: 'KSh',
  KRW: '₩',
  MAD: 'د.م.',
  MXN: '$',
  MYR: 'RM',
  NGN: '₦',
  NOK: 'kr',
  NZD: 'NZ$',
  PEN: 'S/',
  PHP: '₱',
  PLN: 'zł',
  QAR: 'ر.ق',
  RON: 'lei',
  RUB: '₽',
  SAR: 'ر.س',
  SEK: 'kr',
  SGD: 'S$',
  THB: '฿',
  TRY: '₺',
  TWD: 'NT$',
  USD: '$',
  VND: '₫',
  ZAR: 'R',
};

/**
 * The FULL ISO 4217 fiat set (despite the legacy "COMMON" name, kept for
 * API compatibility). `label` is "CODE — Name"; `symbol` is present only for
 * the curated codes above. `CurrencyOverrideSelect` filters this with
 * `COMMON_CURRENCY_CODE_SET` for its "All" optgroup and sorts by label.
 */
export const COMMON_CURRENCIES: CurrencyOption[] = ISO_4217.map((e) => ({
  code: e.code,
  label: `${e.code} — ${e.name}`,
  ...(CURRENCY_SYMBOLS[e.code] ? { symbol: CURRENCY_SYMBOLS[e.code] } : {}),
}));

/**
 * The set of codes that count as "common" — used by the dropdown to render
 * a top optgroup separately from the long alphabetical list.
 */
export const COMMON_CURRENCY_CODE_SET: ReadonlySet<string> = new Set(COMMON_CURRENCY_CODES);

/**
 * Look up a CurrencyOption by code (case-insensitive). Returns undefined when
 * the code isn't in the set (the dropdown still renders the unknown code as a
 * fallback option so the OCR-detected value isn't lost).
 */
export function findCurrency(code: string | null | undefined): CurrencyOption | undefined {
  if (!code) return undefined;
  const upper = code.toUpperCase();
  return COMMON_CURRENCIES.find(c => c.code === upper);
}
