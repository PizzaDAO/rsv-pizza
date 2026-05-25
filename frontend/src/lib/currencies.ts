/**
 * focaccia-89172: ISO 4217 currency options for the receipt-row currency
 * override dropdown. OCR sometimes misreads `₹` as `$` (or similar) and the
 * FX conversion is then off by ~80x — hosts pick the correct code from this
 * list to re-trigger the conversion.
 *
 * The list is intentionally finite (~40 codes) — covers the major fiat
 * currencies + the ones we see most in GPP receipts (Africa, LATAM, MENA,
 * APAC). All five "Common" entries are popular OCR-misread targets.
 */

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
 * Full ~40-code list. Sorted alphabetically by label for the "All" optgroup.
 * Symbols are informational only — the FX lookup uses the ISO code.
 */
export const COMMON_CURRENCIES: CurrencyOption[] = [
  { code: 'AED', label: 'AED — UAE Dirham', symbol: 'د.إ' },
  { code: 'ARS', label: 'ARS — Argentine Peso', symbol: '$' },
  { code: 'AUD', label: 'AUD — Australian Dollar', symbol: 'A$' },
  { code: 'BRL', label: 'BRL — Brazilian Real', symbol: 'R$' },
  { code: 'CAD', label: 'CAD — Canadian Dollar', symbol: 'C$' },
  { code: 'CHF', label: 'CHF — Swiss Franc', symbol: 'CHF' },
  { code: 'CLP', label: 'CLP — Chilean Peso', symbol: '$' },
  { code: 'CNY', label: 'CNY — Chinese Yuan', symbol: '¥' },
  { code: 'COP', label: 'COP — Colombian Peso', symbol: '$' },
  { code: 'CZK', label: 'CZK — Czech Koruna', symbol: 'Kč' },
  { code: 'DKK', label: 'DKK — Danish Krone', symbol: 'kr' },
  { code: 'EGP', label: 'EGP — Egyptian Pound', symbol: 'E£' },
  { code: 'EUR', label: 'EUR — Euro', symbol: '€' },
  { code: 'GBP', label: 'GBP — British Pound', symbol: '£' },
  { code: 'GHS', label: 'GHS — Ghanaian Cedi', symbol: '₵' },
  { code: 'HKD', label: 'HKD — Hong Kong Dollar', symbol: 'HK$' },
  { code: 'HUF', label: 'HUF — Hungarian Forint', symbol: 'Ft' },
  { code: 'IDR', label: 'IDR — Indonesian Rupiah', symbol: 'Rp' },
  { code: 'ILS', label: 'ILS — Israeli Shekel', symbol: '₪' },
  { code: 'INR', label: 'INR — Indian Rupee', symbol: '₹' },
  { code: 'JPY', label: 'JPY — Japanese Yen', symbol: '¥' },
  { code: 'KES', label: 'KES — Kenyan Shilling', symbol: 'KSh' },
  { code: 'KRW', label: 'KRW — South Korean Won', symbol: '₩' },
  { code: 'MAD', label: 'MAD — Moroccan Dirham', symbol: 'د.م.' },
  { code: 'MXN', label: 'MXN — Mexican Peso', symbol: '$' },
  { code: 'MYR', label: 'MYR — Malaysian Ringgit', symbol: 'RM' },
  { code: 'NGN', label: 'NGN — Nigerian Naira', symbol: '₦' },
  { code: 'NOK', label: 'NOK — Norwegian Krone', symbol: 'kr' },
  { code: 'NZD', label: 'NZD — New Zealand Dollar', symbol: 'NZ$' },
  { code: 'PEN', label: 'PEN — Peruvian Sol', symbol: 'S/' },
  { code: 'PHP', label: 'PHP — Philippine Peso', symbol: '₱' },
  { code: 'PLN', label: 'PLN — Polish Złoty', symbol: 'zł' },
  { code: 'QAR', label: 'QAR — Qatari Riyal', symbol: 'ر.ق' },
  { code: 'RON', label: 'RON — Romanian Leu', symbol: 'lei' },
  { code: 'RUB', label: 'RUB — Russian Ruble', symbol: '₽' },
  { code: 'SAR', label: 'SAR — Saudi Riyal', symbol: 'ر.س' },
  { code: 'SEK', label: 'SEK — Swedish Krona', symbol: 'kr' },
  { code: 'SGD', label: 'SGD — Singapore Dollar', symbol: 'S$' },
  { code: 'THB', label: 'THB — Thai Baht', symbol: '฿' },
  { code: 'TRY', label: 'TRY — Turkish Lira', symbol: '₺' },
  { code: 'TWD', label: 'TWD — Taiwan Dollar', symbol: 'NT$' },
  { code: 'USD', label: 'USD — US Dollar', symbol: '$' },
  { code: 'VND', label: 'VND — Vietnamese Dong', symbol: '₫' },
  { code: 'ZAR', label: 'ZAR — South African Rand', symbol: 'R' },
];

/**
 * The set of codes that count as "common" — used by the dropdown to render
 * a top optgroup separately from the long alphabetical list.
 */
export const COMMON_CURRENCY_CODE_SET: ReadonlySet<string> = new Set(COMMON_CURRENCY_CODES);

/**
 * Look up a CurrencyOption by code (case-insensitive). Returns undefined when
 * the code isn't in our pre-populated list (which is fine — the dropdown
 * still renders the unknown code as a fallback option so the OCR-detected
 * value isn't lost).
 */
export function findCurrency(code: string | null | undefined): CurrencyOption | undefined {
  if (!code) return undefined;
  const upper = code.toUpperCase();
  return COMMON_CURRENCIES.find(c => c.code === upper);
}
