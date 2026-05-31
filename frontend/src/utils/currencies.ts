/**
 * caprino-92104: ISO 4217 currency catalog for the admin receipt editor's
 * searchable currency picker. Covers the GPP party set (~40 codes spanning
 * the regions we run events in). Hardcoded — these are stable, and we'd
 * rather not block the picker on a network round-trip just to render a list.
 *
 * `country` is the principal country whose name a user is most likely to
 * type when searching (e.g. typing "Egypt" should match EGP). For EUR/USD
 * which span many jurisdictions, the country reads as "Eurozone" / "United
 * States" — the picker matches on `code`, `name`, AND `country`, so users
 * who type "Germany" still get EUR via the alias list below.
 *
 * `flag` is an emoji flag (two regional-indicator code points). The picker
 * renders it as text; OS font fallback handles platforms without color
 * emoji.
 */
export interface CurrencyOption {
  /** ISO 4217 code, uppercase. */
  code: string;
  /** Currency name, e.g. "Egyptian Pound". */
  name: string;
  /** Principal country name the picker shows next to the flag. */
  country: string;
  /** Emoji flag (regional indicators for the country's ISO 3166 alpha-2). */
  flag: string;
  /** Extra country names that should also match this currency in search. */
  aliases?: string[];
}

export const SUPPORTED_CURRENCIES: CurrencyOption[] = [
  // Americas
  { code: 'USD', name: 'US Dollar', country: 'United States', flag: '🇺🇸', aliases: ['USA', 'America'] },
  { code: 'CAD', name: 'Canadian Dollar', country: 'Canada', flag: '🇨🇦' },
  { code: 'MXN', name: 'Mexican Peso', country: 'Mexico', flag: '🇲🇽' },
  { code: 'BRL', name: 'Brazilian Real', country: 'Brazil', flag: '🇧🇷' },
  { code: 'ARS', name: 'Argentine Peso', country: 'Argentina', flag: '🇦🇷' },
  { code: 'CLP', name: 'Chilean Peso', country: 'Chile', flag: '🇨🇱' },
  { code: 'COP', name: 'Colombian Peso', country: 'Colombia', flag: '🇨🇴' },
  { code: 'UYU', name: 'Uruguayan Peso', country: 'Uruguay', flag: '🇺🇾' },
  { code: 'PEN', name: 'Peruvian Sol', country: 'Peru', flag: '🇵🇪' },
  { code: 'VES', name: 'Venezuelan Bolívar', country: 'Venezuela', flag: '🇻🇪', aliases: ['Bolivar', 'Bolivares'] },

  // Europe
  {
    code: 'EUR',
    name: 'Euro',
    country: 'Eurozone',
    flag: '🇪🇺',
    aliases: [
      'Germany', 'France', 'Spain', 'Italy', 'Portugal', 'Netherlands',
      'Belgium', 'Austria', 'Ireland', 'Greece', 'Finland', 'Estonia',
      'Latvia', 'Lithuania', 'Luxembourg', 'Slovakia', 'Slovenia', 'Malta',
      'Cyprus', 'Croatia',
    ],
  },
  { code: 'GBP', name: 'British Pound', country: 'United Kingdom', flag: '🇬🇧', aliases: ['UK', 'Britain', 'England', 'Scotland', 'Wales'] },
  { code: 'CHF', name: 'Swiss Franc', country: 'Switzerland', flag: '🇨🇭' },
  { code: 'PLN', name: 'Polish Zloty', country: 'Poland', flag: '🇵🇱' },
  { code: 'CZK', name: 'Czech Koruna', country: 'Czechia', flag: '🇨🇿', aliases: ['Czech Republic'] },
  { code: 'SEK', name: 'Swedish Krona', country: 'Sweden', flag: '🇸🇪' },
  { code: 'NOK', name: 'Norwegian Krone', country: 'Norway', flag: '🇳🇴' },
  { code: 'DKK', name: 'Danish Krone', country: 'Denmark', flag: '🇩🇰' },
  { code: 'TRY', name: 'Turkish Lira', country: 'Türkiye', flag: '🇹🇷', aliases: ['Turkey'] },
  { code: 'RUB', name: 'Russian Ruble', country: 'Russia', flag: '🇷🇺' },
  { code: 'UAH', name: 'Ukrainian Hryvnia', country: 'Ukraine', flag: '🇺🇦' },

  // Africa
  { code: 'EGP', name: 'Egyptian Pound', country: 'Egypt', flag: '🇪🇬' },
  { code: 'NGN', name: 'Nigerian Naira', country: 'Nigeria', flag: '🇳🇬' },
  { code: 'ZAR', name: 'South African Rand', country: 'South Africa', flag: '🇿🇦' },
  { code: 'KES', name: 'Kenyan Shilling', country: 'Kenya', flag: '🇰🇪' },
  { code: 'GHS', name: 'Ghanaian Cedi', country: 'Ghana', flag: '🇬🇭' },
  { code: 'MAD', name: 'Moroccan Dirham', country: 'Morocco', flag: '🇲🇦' },
  { code: 'ETB', name: 'Ethiopian Birr', country: 'Ethiopia', flag: '🇪🇹' },
  { code: 'MWK', name: 'Malawian Kwacha', country: 'Malawi', flag: '🇲🇼' },
  {
    code: 'XOF',
    name: 'West African CFA franc',
    country: 'Togo',
    flag: '🇹🇬',
    aliases: [
      'Benin', 'Burkina Faso', "Côte d'Ivoire", 'Cote d Ivoire', 'Ivory Coast',
      'Guinea-Bissau', 'Guinea Bissau', 'Mali', 'Niger', 'Senegal',
      'CFA', 'West Africa', 'WAEMU', 'UEMOA',
    ],
  },
  {
    code: 'XAF',
    name: 'Central African CFA franc',
    country: 'Cameroon',
    flag: '🇨🇲',
    aliases: [
      'Central African Republic', 'Chad', 'Equatorial Guinea', 'Gabon',
      'Republic of the Congo', 'Congo-Brazzaville', 'Congo',
      'CFA', 'Central Africa', 'CEMAC',
    ],
  },

  // Middle East
  { code: 'AED', name: 'UAE Dirham', country: 'United Arab Emirates', flag: '🇦🇪', aliases: ['UAE', 'Dubai', 'Abu Dhabi'] },
  { code: 'SAR', name: 'Saudi Riyal', country: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'ILS', name: 'Israeli Shekel', country: 'Israel', flag: '🇮🇱' },

  // Asia
  { code: 'INR', name: 'Indian Rupee', country: 'India', flag: '🇮🇳' },
  { code: 'IDR', name: 'Indonesian Rupiah', country: 'Indonesia', flag: '🇮🇩' },
  { code: 'PHP', name: 'Philippine Peso', country: 'Philippines', flag: '🇵🇭' },
  { code: 'MYR', name: 'Malaysian Ringgit', country: 'Malaysia', flag: '🇲🇾' },
  { code: 'SGD', name: 'Singapore Dollar', country: 'Singapore', flag: '🇸🇬' },
  { code: 'JPY', name: 'Japanese Yen', country: 'Japan', flag: '🇯🇵' },
  { code: 'KRW', name: 'South Korean Won', country: 'South Korea', flag: '🇰🇷', aliases: ['Korea'] },
  { code: 'CNY', name: 'Chinese Yuan', country: 'China', flag: '🇨🇳', aliases: ['Renminbi', 'RMB'] },
  { code: 'HKD', name: 'Hong Kong Dollar', country: 'Hong Kong', flag: '🇭🇰' },
  { code: 'TWD', name: 'Taiwan Dollar', country: 'Taiwan', flag: '🇹🇼' },
  { code: 'THB', name: 'Thai Baht', country: 'Thailand', flag: '🇹🇭' },
  { code: 'VND', name: 'Vietnamese Dong', country: 'Vietnam', flag: '🇻🇳' },

  // Oceania
  { code: 'AUD', name: 'Australian Dollar', country: 'Australia', flag: '🇦🇺' },
  { code: 'NZD', name: 'New Zealand Dollar', country: 'New Zealand', flag: '🇳🇿' },
];

/**
 * Look up a currency option by ISO code (case-insensitive). Returns null
 * for unknown codes so the picker can render unknown values verbatim
 * without crashing.
 */
export function findCurrencyByCode(code: string | null | undefined): CurrencyOption | null {
  if (!code) return null;
  const upper = code.trim().toUpperCase();
  return SUPPORTED_CURRENCIES.find((c) => c.code === upper) ?? null;
}

/**
 * Filter currencies by a free-text query. Matches against the ISO code,
 * currency name, principal country, and aliases — all case-insensitive
 * substring matches. Results are ranked: exact code match first, then
 * code prefix, then country prefix / name prefix, then any-substring.
 */
export function searchCurrencies(query: string): CurrencyOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return SUPPORTED_CURRENCIES;
  const scored: { c: CurrencyOption; score: number }[] = [];
  for (const c of SUPPORTED_CURRENCIES) {
    const code = c.code.toLowerCase();
    const name = c.name.toLowerCase();
    const country = c.country.toLowerCase();
    const aliases = (c.aliases ?? []).map((a) => a.toLowerCase());

    let score = -1;
    if (code === q) score = 100;
    else if (code.startsWith(q)) score = 80;
    else if (country.startsWith(q)) score = 60;
    else if (name.startsWith(q)) score = 55;
    else if (aliases.some((a) => a.startsWith(q))) score = 50;
    else if (country.includes(q)) score = 30;
    else if (name.includes(q)) score = 25;
    else if (aliases.some((a) => a.includes(q))) score = 20;
    else if (code.includes(q)) score = 10;

    if (score >= 0) scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.code.localeCompare(b.c.code));
  return scored.map((s) => s.c);
}
