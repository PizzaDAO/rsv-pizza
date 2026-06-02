/**
 * pomodoro-58219: canonical ISO 4217 fiat-currency catalog.
 *
 * Single source of truth for the receipt-editor currency picker
 * (`utils/currencies.ts` → `CurrencyPicker`) and the receipt-row override
 * dropdown (`lib/currencies.ts` → `CurrencyOverrideSelect`). Both legacy
 * catalogs now derive from this module, replacing two independently
 * hand-maintained ~40-code lists that drifted apart over time.
 *
 * Scope: all ACTIVE ISO 4217 **fiat** currencies (~157 codes). Excludes
 * precious metals (XAU/XAG/XPT/XPD), test/no-currency codes (XTS/XXX), the
 * IMF SDR (XDR), withdrawn codes (HRK→EUR, SLL→SLE, CUC) and crypto.
 * `convert-fx` (backend FX service via the fawazahmed0 currency-api) resolves
 * essentially all of these, so listing the full set is safe.
 *
 * `ISO_4217` is STATIC data — generated once from
 * `Intl.supportedValuesOf('currency')` + `Intl.DisplayNames` and pasted here.
 * The shipped module does NOT call those APIs at runtime (avoids tsconfig
 * `lib` requirements + browser-support risk); `flagEmoji` is pure
 * regional-indicator math.
 */

export interface Iso4217Entry {
  /** Uppercase ISO 4217 alpha code. */
  code: string;
  /** English currency name, e.g. "Zambian Kwacha". */
  name: string;
  /** Representative country/region, e.g. "Zambia" ("Eurozone" for EUR). */
  country: string;
  /** ISO 3166 alpha-2 for the flag ('EU' for EUR; never '' in this dataset). */
  cc: string;
  /** Extra country / colloquial names that should match in search. */
  aliases?: string[];
}

/**
 * Priority codes shown first in the picker (in this order), ahead of the
 * alphabetical-by-country remainder. Mirrors the old curated "top" set.
 */
export const PRIORITY_CODES: readonly string[] = ['USD', 'EUR', 'GBP', 'INR', 'NGN'];

/**
 * Full active ISO 4217 fiat set. Generated, then frozen as static data —
 * sorted by code here; consumer modules re-order as needed.
 */
export const ISO_4217: Iso4217Entry[] = [
  { code: "AED", name: "United Arab Emirates Dirham", country: "United Arab Emirates", cc: "AE", aliases: ["UAE","Dubai","Abu Dhabi"] },
  { code: "AFN", name: "Afghan Afghani", country: "Afghanistan", cc: "AF" },
  { code: "ALL", name: "Albanian Lek", country: "Albania", cc: "AL" },
  { code: "AMD", name: "Armenian Dram", country: "Armenia", cc: "AM" },
  { code: "ANG", name: "Netherlands Antillean Guilder", country: "Curaçao", cc: "CW", aliases: ["Netherlands Antilles","Sint Maarten"] },
  { code: "AOA", name: "Angolan Kwanza", country: "Angola", cc: "AO" },
  { code: "ARS", name: "Argentine Peso", country: "Argentina", cc: "AR" },
  { code: "AUD", name: "Australian Dollar", country: "Australia", cc: "AU" },
  { code: "AWG", name: "Aruban Florin", country: "Aruba", cc: "AW" },
  { code: "AZN", name: "Azerbaijani Manat", country: "Azerbaijan", cc: "AZ" },
  { code: "BAM", name: "Bosnia-Herzegovina Convertible Mark", country: "Bosnia and Herzegovina", cc: "BA" },
  { code: "BBD", name: "Barbadian Dollar", country: "Barbados", cc: "BB" },
  { code: "BDT", name: "Bangladeshi Taka", country: "Bangladesh", cc: "BD" },
  { code: "BGN", name: "Bulgarian Lev", country: "Bulgaria", cc: "BG" },
  { code: "BHD", name: "Bahraini Dinar", country: "Bahrain", cc: "BH" },
  { code: "BIF", name: "Burundian Franc", country: "Burundi", cc: "BI" },
  { code: "BMD", name: "Bermudan Dollar", country: "Bermuda", cc: "BM" },
  { code: "BND", name: "Brunei Dollar", country: "Brunei", cc: "BN" },
  { code: "BOB", name: "Bolivian Boliviano", country: "Bolivia", cc: "BO" },
  { code: "BRL", name: "Brazilian Real", country: "Brazil", cc: "BR" },
  { code: "BSD", name: "Bahamian Dollar", country: "Bahamas", cc: "BS" },
  { code: "BTN", name: "Bhutanese Ngultrum", country: "Bhutan", cc: "BT" },
  { code: "BWP", name: "Botswanan Pula", country: "Botswana", cc: "BW" },
  { code: "BYN", name: "Belarusian Ruble", country: "Belarus", cc: "BY" },
  { code: "BZD", name: "Belize Dollar", country: "Belize", cc: "BZ" },
  { code: "CAD", name: "Canadian Dollar", country: "Canada", cc: "CA" },
  { code: "CDF", name: "Congolese Franc", country: "Democratic Republic of the Congo", cc: "CD", aliases: ["DRC","Congo-Kinshasa"] },
  { code: "CHF", name: "Swiss Franc", country: "Switzerland", cc: "CH", aliases: ["Liechtenstein"] },
  { code: "CLP", name: "Chilean Peso", country: "Chile", cc: "CL" },
  { code: "CNY", name: "Chinese Yuan", country: "China", cc: "CN", aliases: ["Renminbi","RMB"] },
  { code: "COP", name: "Colombian Peso", country: "Colombia", cc: "CO" },
  { code: "CRC", name: "Costa Rican Colón", country: "Costa Rica", cc: "CR" },
  { code: "CUP", name: "Cuban Peso", country: "Cuba", cc: "CU" },
  { code: "CVE", name: "Cape Verdean Escudo", country: "Cape Verde", cc: "CV", aliases: ["Cabo Verde"] },
  { code: "CZK", name: "Czech Koruna", country: "Czechia", cc: "CZ", aliases: ["Czech Republic"] },
  { code: "DJF", name: "Djiboutian Franc", country: "Djibouti", cc: "DJ" },
  { code: "DKK", name: "Danish Krone", country: "Denmark", cc: "DK" },
  { code: "DOP", name: "Dominican Peso", country: "Dominican Republic", cc: "DO" },
  { code: "DZD", name: "Algerian Dinar", country: "Algeria", cc: "DZ" },
  { code: "EGP", name: "Egyptian Pound", country: "Egypt", cc: "EG" },
  { code: "ERN", name: "Eritrean Nakfa", country: "Eritrea", cc: "ER" },
  { code: "ETB", name: "Ethiopian Birr", country: "Ethiopia", cc: "ET" },
  { code: "EUR", name: "Euro", country: "Eurozone", cc: "EU", aliases: ["Germany","France","Spain","Italy","Portugal","Netherlands","Belgium","Austria","Ireland","Greece","Finland","Estonia","Latvia","Lithuania","Luxembourg","Slovakia","Slovenia","Malta","Cyprus","Croatia","Eurozone"] },
  { code: "FJD", name: "Fijian Dollar", country: "Fiji", cc: "FJ" },
  { code: "FKP", name: "Falkland Islands Pound", country: "Falkland Islands", cc: "FK" },
  { code: "GBP", name: "British Pound", country: "United Kingdom", cc: "GB", aliases: ["UK","Britain","England","Scotland","Wales"] },
  { code: "GEL", name: "Georgian Lari", country: "Georgia", cc: "GE" },
  { code: "GHS", name: "Ghanaian Cedi", country: "Ghana", cc: "GH" },
  { code: "GIP", name: "Gibraltar Pound", country: "Gibraltar", cc: "GI" },
  { code: "GMD", name: "Gambian Dalasi", country: "Gambia", cc: "GM" },
  { code: "GNF", name: "Guinean Franc", country: "Guinea", cc: "GN" },
  { code: "GTQ", name: "Guatemalan Quetzal", country: "Guatemala", cc: "GT" },
  { code: "GYD", name: "Guyanaese Dollar", country: "Guyana", cc: "GY" },
  { code: "HKD", name: "Hong Kong Dollar", country: "Hong Kong", cc: "HK" },
  { code: "HNL", name: "Honduran Lempira", country: "Honduras", cc: "HN" },
  { code: "HTG", name: "Haitian Gourde", country: "Haiti", cc: "HT" },
  { code: "HUF", name: "Hungarian Forint", country: "Hungary", cc: "HU" },
  { code: "IDR", name: "Indonesian Rupiah", country: "Indonesia", cc: "ID" },
  { code: "ILS", name: "Israeli New Shekel", country: "Israel", cc: "IL" },
  { code: "INR", name: "Indian Rupee", country: "India", cc: "IN" },
  { code: "IQD", name: "Iraqi Dinar", country: "Iraq", cc: "IQ" },
  { code: "IRR", name: "Iranian Rial", country: "Iran", cc: "IR" },
  { code: "ISK", name: "Icelandic Króna", country: "Iceland", cc: "IS" },
  { code: "JMD", name: "Jamaican Dollar", country: "Jamaica", cc: "JM" },
  { code: "JOD", name: "Jordanian Dinar", country: "Jordan", cc: "JO" },
  { code: "JPY", name: "Japanese Yen", country: "Japan", cc: "JP" },
  { code: "KES", name: "Kenyan Shilling", country: "Kenya", cc: "KE" },
  { code: "KGS", name: "Kyrgystani Som", country: "Kyrgyzstan", cc: "KG" },
  { code: "KHR", name: "Cambodian Riel", country: "Cambodia", cc: "KH" },
  { code: "KMF", name: "Comorian Franc", country: "Comoros", cc: "KM" },
  { code: "KPW", name: "North Korean Won", country: "North Korea", cc: "KP" },
  { code: "KRW", name: "South Korean Won", country: "South Korea", cc: "KR", aliases: ["Korea"] },
  { code: "KWD", name: "Kuwaiti Dinar", country: "Kuwait", cc: "KW" },
  { code: "KYD", name: "Cayman Islands Dollar", country: "Cayman Islands", cc: "KY" },
  { code: "KZT", name: "Kazakhstani Tenge", country: "Kazakhstan", cc: "KZ" },
  { code: "LAK", name: "Laotian Kip", country: "Laos", cc: "LA" },
  { code: "LBP", name: "Lebanese Pound", country: "Lebanon", cc: "LB" },
  { code: "LKR", name: "Sri Lankan Rupee", country: "Sri Lanka", cc: "LK" },
  { code: "LRD", name: "Liberian Dollar", country: "Liberia", cc: "LR" },
  { code: "LSL", name: "Lesotho Loti", country: "Lesotho", cc: "LS" },
  { code: "LYD", name: "Libyan Dinar", country: "Libya", cc: "LY" },
  { code: "MAD", name: "Moroccan Dirham", country: "Morocco", cc: "MA" },
  { code: "MDL", name: "Moldovan Leu", country: "Moldova", cc: "MD" },
  { code: "MGA", name: "Malagasy Ariary", country: "Madagascar", cc: "MG" },
  { code: "MKD", name: "Macedonian Denar", country: "North Macedonia", cc: "MK" },
  { code: "MMK", name: "Myanmar Kyat", country: "Myanmar", cc: "MM", aliases: ["Burma"] },
  { code: "MNT", name: "Mongolian Tugrik", country: "Mongolia", cc: "MN" },
  { code: "MOP", name: "Macanese Pataca", country: "Macau", cc: "MO", aliases: ["Macao"] },
  { code: "MRU", name: "Mauritanian Ouguiya", country: "Mauritania", cc: "MR" },
  { code: "MUR", name: "Mauritian Rupee", country: "Mauritius", cc: "MU" },
  { code: "MVR", name: "Maldivian Rufiyaa", country: "Maldives", cc: "MV" },
  { code: "MWK", name: "Malawian Kwacha", country: "Malawi", cc: "MW" },
  { code: "MXN", name: "Mexican Peso", country: "Mexico", cc: "MX" },
  { code: "MYR", name: "Malaysian Ringgit", country: "Malaysia", cc: "MY" },
  { code: "MZN", name: "Mozambican Metical", country: "Mozambique", cc: "MZ" },
  { code: "NAD", name: "Namibian Dollar", country: "Namibia", cc: "NA" },
  { code: "NGN", name: "Nigerian Naira", country: "Nigeria", cc: "NG" },
  { code: "NIO", name: "Nicaraguan Córdoba", country: "Nicaragua", cc: "NI" },
  { code: "NOK", name: "Norwegian Krone", country: "Norway", cc: "NO" },
  { code: "NPR", name: "Nepalese Rupee", country: "Nepal", cc: "NP" },
  { code: "NZD", name: "New Zealand Dollar", country: "New Zealand", cc: "NZ" },
  { code: "OMR", name: "Omani Rial", country: "Oman", cc: "OM" },
  { code: "PAB", name: "Panamanian Balboa", country: "Panama", cc: "PA" },
  { code: "PEN", name: "Peruvian Sol", country: "Peru", cc: "PE" },
  { code: "PGK", name: "Papua New Guinean Kina", country: "Papua New Guinea", cc: "PG" },
  { code: "PHP", name: "Philippine Peso", country: "Philippines", cc: "PH" },
  { code: "PKR", name: "Pakistani Rupee", country: "Pakistan", cc: "PK" },
  { code: "PLN", name: "Polish Zloty", country: "Poland", cc: "PL" },
  { code: "PYG", name: "Paraguayan Guarani", country: "Paraguay", cc: "PY" },
  { code: "QAR", name: "Qatari Riyal", country: "Qatar", cc: "QA" },
  { code: "RON", name: "Romanian Leu", country: "Romania", cc: "RO" },
  { code: "RSD", name: "Serbian Dinar", country: "Serbia", cc: "RS" },
  { code: "RUB", name: "Russian Ruble", country: "Russia", cc: "RU" },
  { code: "RWF", name: "Rwandan Franc", country: "Rwanda", cc: "RW" },
  { code: "SAR", name: "Saudi Riyal", country: "Saudi Arabia", cc: "SA" },
  { code: "SBD", name: "Solomon Islands Dollar", country: "Solomon Islands", cc: "SB" },
  { code: "SCR", name: "Seychellois Rupee", country: "Seychelles", cc: "SC" },
  { code: "SDG", name: "Sudanese Pound", country: "Sudan", cc: "SD" },
  { code: "SEK", name: "Swedish Krona", country: "Sweden", cc: "SE" },
  { code: "SGD", name: "Singapore Dollar", country: "Singapore", cc: "SG" },
  { code: "SHP", name: "St. Helena Pound", country: "Saint Helena", cc: "SH" },
  { code: "SLE", name: "Sierra Leonean Leone", country: "Sierra Leone", cc: "SL" },
  { code: "SOS", name: "Somali Shilling", country: "Somalia", cc: "SO" },
  { code: "SRD", name: "Surinamese Dollar", country: "Suriname", cc: "SR" },
  { code: "SSP", name: "South Sudanese Pound", country: "South Sudan", cc: "SS" },
  { code: "STN", name: "São Tomé & Príncipe Dobra", country: "São Tomé and Príncipe", cc: "ST", aliases: ["Sao Tome and Principe"] },
  { code: "SVC", name: "Salvadoran Colón", country: "El Salvador", cc: "SV" },
  { code: "SYP", name: "Syrian Pound", country: "Syria", cc: "SY" },
  { code: "SZL", name: "Swazi Lilangeni", country: "Eswatini", cc: "SZ", aliases: ["Swaziland"] },
  { code: "THB", name: "Thai Baht", country: "Thailand", cc: "TH" },
  { code: "TJS", name: "Tajikistani Somoni", country: "Tajikistan", cc: "TJ" },
  { code: "TMT", name: "Turkmenistani Manat", country: "Turkmenistan", cc: "TM" },
  { code: "TND", name: "Tunisian Dinar", country: "Tunisia", cc: "TN" },
  { code: "TOP", name: "Tongan Paʻanga", country: "Tonga", cc: "TO" },
  { code: "TRY", name: "Turkish Lira", country: "Türkiye", cc: "TR", aliases: ["Turkey"] },
  { code: "TTD", name: "Trinidad & Tobago Dollar", country: "Trinidad and Tobago", cc: "TT" },
  { code: "TWD", name: "New Taiwan Dollar", country: "Taiwan", cc: "TW" },
  { code: "TZS", name: "Tanzanian Shilling", country: "Tanzania", cc: "TZ" },
  { code: "UAH", name: "Ukrainian Hryvnia", country: "Ukraine", cc: "UA" },
  { code: "UGX", name: "Ugandan Shilling", country: "Uganda", cc: "UG" },
  { code: "USD", name: "US Dollar", country: "United States", cc: "US", aliases: ["USA","America"] },
  { code: "UYU", name: "Uruguayan Peso", country: "Uruguay", cc: "UY" },
  { code: "UZS", name: "Uzbekistani Som", country: "Uzbekistan", cc: "UZ" },
  { code: "VES", name: "Venezuelan Bolívar", country: "Venezuela", cc: "VE", aliases: ["Bolivar","Bolivares"] },
  { code: "VND", name: "Vietnamese Dong", country: "Vietnam", cc: "VN" },
  { code: "VUV", name: "Vanuatu Vatu", country: "Vanuatu", cc: "VU" },
  { code: "WST", name: "Samoan Tala", country: "Samoa", cc: "WS" },
  { code: "XAF", name: "Central African CFA Franc", country: "Cameroon", cc: "CM", aliases: ["Central African Republic","Chad","Equatorial Guinea","Gabon","Republic of the Congo","Congo-Brazzaville","Congo","CFA","Central Africa","CEMAC"] },
  { code: "XCD", name: "East Caribbean Dollar", country: "Eastern Caribbean", cc: "AG", aliases: ["Antigua and Barbuda","Dominica","Grenada","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","OECS"] },
  { code: "XCG", name: "Caribbean guilder", country: "Curaçao", cc: "CW", aliases: ["Caribbean Guilder","Sint Maarten"] },
  { code: "XOF", name: "West African CFA Franc", country: "Senegal", cc: "SN", aliases: ["Benin","Burkina Faso","Côte d'Ivoire","Cote d Ivoire","Ivory Coast","Guinea-Bissau","Guinea Bissau","Mali","Niger","Togo","CFA","West Africa","WAEMU","UEMOA"] },
  { code: "XPF", name: "CFP Franc", country: "French Polynesia", cc: "PF", aliases: ["New Caledonia","Wallis and Futuna","CFP"] },
  { code: "YER", name: "Yemeni Rial", country: "Yemen", cc: "YE" },
  { code: "ZAR", name: "South African Rand", country: "South Africa", cc: "ZA" },
  { code: "ZMW", name: "Zambian Kwacha", country: "Zambia", cc: "ZM" },
  { code: "ZWG", name: "Zimbabwean Gold", country: "Zimbabwe", cc: "ZW", aliases: ["Zimbabwe Gold","ZiG"] },
  { code: "ZWL", name: "Zimbabwean Dollar (2009–2024)", country: "Zimbabwe", cc: "ZW" },
];

const GLOBE = '🌐';

/**
 * Map an ISO 3166 alpha-2 country code to its emoji flag (two Unicode
 * regional-indicator symbols). 'EU' yields 🇪🇺 naturally. Returns 🌐 for an
 * empty / malformed code so a row never renders a blank flag cell. Pure
 * string math — no Intl, no runtime catalog lookups.
 */
export function flagEmoji(cc: string): string {
  if (!cc || cc.length !== 2) return GLOBE;
  const upper = cc.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return GLOBE;
  const base = 0x1f1e6; // regional indicator 'A'
  const a = upper.charCodeAt(0) - 65;
  const b = upper.charCodeAt(1) - 65;
  return String.fromCodePoint(base + a, base + b);
}

/**
 * Look up a currency entry by ISO code (case-insensitive). Returns null for
 * unknown codes so callers can render the raw value without crashing.
 */
export function findCurrency(code: string | null | undefined): Iso4217Entry | null {
  if (!code) return null;
  const upper = code.trim().toUpperCase();
  return ISO_4217.find((c) => c.code === upper) ?? null;
}

/**
 * Free-text search over the catalog. Ranks (highest first): exact code 100,
 * code-prefix 80, country-prefix 60, name-prefix 55, alias-prefix 50,
 * country-includes 30, name-includes 25, alias-includes 20, code-includes 10.
 * Ties break by code. Empty query returns the full catalog unchanged.
 */
export function searchCurrencies(query: string): Iso4217Entry[] {
  const q = query.trim().toLowerCase();
  if (!q) return ISO_4217;
  const scored: { c: Iso4217Entry; score: number }[] = [];
  for (const c of ISO_4217) {
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
