/**
 * mortadella-92107: Static IRS Publication 901-derived map of foreign
 * countries to their US income-tax treaty status, used to auto-suggest
 * Part II (W-8BEN) / Part III (W-8BEN-E) treaty-claim values when a host
 * picks their country of residence.
 *
 * Values cover the "Other income" article (typically Article 21/22 — the
 * residual category that catches PizzaDAO honoraria/reimbursement-style
 * payments to foreign hosts with no US permanent establishment). The
 * rate is the reduced withholding rate; for most countries with a treaty
 * the rate is 0%.
 *
 * This is general guidance, not tax advice. Hosts can override every
 * auto-filled field. Treaty entries reflect treaties in force as of
 * the IRS Publication 901 (Rev. 2024) tables.
 */

export type TaxTreatyEntry = {
  /** True if a US income-tax treaty is in force with this country. */
  hasTreaty: boolean;
  /** Treaty article that covers "Other income" (e.g. "Article 21"). */
  article?: string;
  /** Reduced withholding % on "Other income" with no US permanent establishment. */
  otherIncomeRate: number;
  /** Optional human-readable note shown next to the auto-fill suggestion. */
  notes?: string;
};

/**
 * Keyed by ISO 3166-1 alpha-2 country code. Use `lookupTreaty(country)`
 * to resolve either a code or a full English country name.
 */
export const TAX_TREATY_DATA: Record<string, TaxTreatyEntry> = {
  // Europe — treaty countries (0% on Other Income, no US PE)
  GB: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  IE: { hasTreaty: true, article: 'Article 21', otherIncomeRate: 0 },
  FR: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  DE: { hasTreaty: true, article: 'Article 21', otherIncomeRate: 0 },
  NL: { hasTreaty: true, article: 'Article 23', otherIncomeRate: 0 },
  BE: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  ES: { hasTreaty: true, article: 'Article 23', otherIncomeRate: 0 },
  IT: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  CH: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  AT: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  SE: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  NO: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  DK: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  FI: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  IS: { hasTreaty: true, article: 'Article 21', otherIncomeRate: 0 },
  CZ: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  SK: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  SI: { hasTreaty: true, article: 'Article 21', otherIncomeRate: 0 },
  PL: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  HU: { hasTreaty: true, article: 'Article 21', otherIncomeRate: 0 },
  BG: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  RO: { hasTreaty: true, article: 'Article 21', otherIncomeRate: 0 },
  LV: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  LT: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  EE: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  LU: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  GR: { hasTreaty: true, article: 'Article XIV', otherIncomeRate: 0 },
  TR: { hasTreaty: true, article: 'Article 21', otherIncomeRate: 0 },
  RU: { hasTreaty: true, article: 'Article 21', otherIncomeRate: 0, notes: 'US-Russia treaty status is subject to ongoing review — verify before relying on it.' },
  UA: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  CY: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  MT: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },

  // Americas — treaty countries
  CA: { hasTreaty: true, article: 'Article XXII', otherIncomeRate: 0 },
  MX: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  TT: { hasTreaty: true, article: 'Article 26', otherIncomeRate: 0 },
  JM: { hasTreaty: true, article: 'Article 21', otherIncomeRate: 0 },
  BB: { hasTreaty: true, article: 'Article 23', otherIncomeRate: 0 },
  VE: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },

  // Asia / Oceania — treaty countries
  AU: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  NZ: { hasTreaty: true, article: 'Article 21', otherIncomeRate: 0 },
  JP: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  KR: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  IN: { hasTreaty: true, article: 'Article 23', otherIncomeRate: 0 },
  PH: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  ID: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  TH: { hasTreaty: true, article: 'Article 21', otherIncomeRate: 0 },
  CN: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0, notes: 'PRC mainland only — Hong Kong and Taiwan do not share this treaty.' },
  LK: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  BD: { hasTreaty: true, article: 'Article 21', otherIncomeRate: 0 },
  IL: { hasTreaty: true, article: 'Article 27', otherIncomeRate: 0 },

  // Africa — treaty countries
  ZA: { hasTreaty: true, article: 'Article 21', otherIncomeRate: 0 },
  EG: { hasTreaty: true, article: 'Article 24', otherIncomeRate: 0 },
  MA: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  TN: { hasTreaty: true, article: 'Article 22', otherIncomeRate: 0 },
  KZ: { hasTreaty: true, article: 'Article 21', otherIncomeRate: 0 },

  // No US treaty in force — leave blank, default 30% withholding applies
  BR: { hasTreaty: false, otherIncomeRate: 30 },
  AR: { hasTreaty: false, otherIncomeRate: 30 },
  CL: { hasTreaty: false, otherIncomeRate: 30 },
  PE: { hasTreaty: false, otherIncomeRate: 30, notes: 'A US-Peru treaty has been negotiated but is not in force.' },
  CO: { hasTreaty: false, otherIncomeRate: 30 },
  UY: { hasTreaty: false, otherIncomeRate: 30 },
  BO: { hasTreaty: false, otherIncomeRate: 30 },
  PY: { hasTreaty: false, otherIncomeRate: 30 },
  EC: { hasTreaty: false, otherIncomeRate: 30 },
  CR: { hasTreaty: false, otherIncomeRate: 30 },
  PA: { hasTreaty: false, otherIncomeRate: 30 },
  GT: { hasTreaty: false, otherIncomeRate: 30 },
  HN: { hasTreaty: false, otherIncomeRate: 30 },
  NI: { hasTreaty: false, otherIncomeRate: 30 },
  SV: { hasTreaty: false, otherIncomeRate: 30 },
  DO: { hasTreaty: false, otherIncomeRate: 30 },

  NG: { hasTreaty: false, otherIncomeRate: 30 },
  GH: { hasTreaty: false, otherIncomeRate: 30 },
  KE: { hasTreaty: false, otherIncomeRate: 30 },
  UG: { hasTreaty: false, otherIncomeRate: 30 },
  TZ: { hasTreaty: false, otherIncomeRate: 30 },
  ET: { hasTreaty: false, otherIncomeRate: 30 },
  DZ: { hasTreaty: false, otherIncomeRate: 30 },
  BW: { hasTreaty: false, otherIncomeRate: 30 },
  CI: { hasTreaty: false, otherIncomeRate: 30 },
  SN: { hasTreaty: false, otherIncomeRate: 30 },
  CM: { hasTreaty: false, otherIncomeRate: 30 },
  GA: { hasTreaty: false, otherIncomeRate: 30 },
  TD: { hasTreaty: false, otherIncomeRate: 30 },
  ML: { hasTreaty: false, otherIncomeRate: 30 },
  BF: { hasTreaty: false, otherIncomeRate: 30 },
  NE: { hasTreaty: false, otherIncomeRate: 30 },
  TG: { hasTreaty: false, otherIncomeRate: 30 },
  BJ: { hasTreaty: false, otherIncomeRate: 30 },
  MW: { hasTreaty: false, otherIncomeRate: 30 },
  ZW: { hasTreaty: false, otherIncomeRate: 30 },
  ZM: { hasTreaty: false, otherIncomeRate: 30 },

  VN: { hasTreaty: false, otherIncomeRate: 30 },
  KH: { hasTreaty: false, otherIncomeRate: 30 },
  LA: { hasTreaty: false, otherIncomeRate: 30 },
  MM: { hasTreaty: false, otherIncomeRate: 30 },
  MN: { hasTreaty: false, otherIncomeRate: 30 },
  HK: { hasTreaty: false, otherIncomeRate: 30, notes: 'Hong Kong is not covered by the US-China treaty.' },
  TW: { hasTreaty: false, otherIncomeRate: 30, notes: 'Taiwan is not covered by the US-China treaty.' },

  SA: { hasTreaty: false, otherIncomeRate: 30, notes: 'No general income-tax treaty; limited treaty covers shipping/air only.' },
  AE: { hasTreaty: false, otherIncomeRate: 30, notes: 'No general income-tax treaty; limited treaty covers shipping/air only.' },
  LB: { hasTreaty: false, otherIncomeRate: 30 },
};

// -------- Country-name → ISO-2 normalisation --------

/**
 * Pulled from `countryFlag.NAME_TO_CODE` minimal subset for the treaty-mapped
 * countries — kept inline so this module is dependency-free and can be unit
 * tested in isolation. `lookupTreaty` falls through to a case-insensitive
 * direct match against this map.
 */
const NAME_TO_CODE: Record<string, string> = {
  // Europe
  'united kingdom': 'GB', 'uk': 'GB', 'great britain': 'GB', 'england': 'GB',
  'scotland': 'GB', 'wales': 'GB', 'northern ireland': 'GB',
  'ireland': 'IE', 'éire': 'IE', 'eire': 'IE',
  'france': 'FR',
  'germany': 'DE', 'deutschland': 'DE',
  'netherlands': 'NL', 'the netherlands': 'NL', 'holland': 'NL',
  'belgium': 'BE',
  'spain': 'ES', 'españa': 'ES', 'espana': 'ES',
  'italy': 'IT', 'italia': 'IT',
  'switzerland': 'CH', 'schweiz': 'CH', 'suisse': 'CH', 'svizzera': 'CH',
  'austria': 'AT', 'österreich': 'AT', 'osterreich': 'AT',
  'sweden': 'SE', 'sverige': 'SE',
  'norway': 'NO', 'norge': 'NO',
  'denmark': 'DK', 'danmark': 'DK',
  'finland': 'FI', 'suomi': 'FI',
  'iceland': 'IS', 'ísland': 'IS', 'island': 'IS',
  'czech republic': 'CZ', 'czechia': 'CZ', 'česko': 'CZ', 'cesko': 'CZ',
  'slovakia': 'SK', 'slovak republic': 'SK',
  'slovenia': 'SI',
  'poland': 'PL', 'polska': 'PL',
  'hungary': 'HU', 'magyarország': 'HU',
  'bulgaria': 'BG',
  'romania': 'RO',
  'latvia': 'LV',
  'lithuania': 'LT',
  'estonia': 'EE',
  'luxembourg': 'LU',
  'greece': 'GR',
  'turkey': 'TR', 'türkiye': 'TR', 'turkiye': 'TR',
  'russia': 'RU', 'russian federation': 'RU',
  'ukraine': 'UA',
  'cyprus': 'CY',
  'malta': 'MT',

  // Americas
  'canada': 'CA',
  'mexico': 'MX', 'méxico': 'MX',
  'trinidad and tobago': 'TT',
  'jamaica': 'JM',
  'barbados': 'BB',
  'venezuela': 'VE',
  'brazil': 'BR', 'brasil': 'BR',
  'argentina': 'AR',
  'chile': 'CL',
  'peru': 'PE', 'perú': 'PE',
  'colombia': 'CO',
  'uruguay': 'UY',
  'bolivia': 'BO',
  'paraguay': 'PY',
  'ecuador': 'EC',
  'costa rica': 'CR',
  'panama': 'PA', 'panamá': 'PA',
  'guatemala': 'GT',
  'honduras': 'HN',
  'nicaragua': 'NI',
  'el salvador': 'SV',
  'dominican republic': 'DO',

  // Asia / Oceania
  'australia': 'AU',
  'new zealand': 'NZ',
  'japan': 'JP', '日本': 'JP',
  'south korea': 'KR', 'korea, republic of': 'KR', 'republic of korea': 'KR', 'korea': 'KR',
  'india': 'IN',
  'philippines': 'PH',
  'indonesia': 'ID',
  'thailand': 'TH',
  'china': 'CN', "people's republic of china": 'CN', 'prc': 'CN',
  'sri lanka': 'LK',
  'bangladesh': 'BD',
  'israel': 'IL',
  'vietnam': 'VN', 'viet nam': 'VN',
  'cambodia': 'KH',
  'laos': 'LA', "lao people's democratic republic": 'LA',
  'myanmar': 'MM', 'burma': 'MM',
  'mongolia': 'MN',
  'hong kong': 'HK',
  'taiwan': 'TW',
  'saudi arabia': 'SA',
  'united arab emirates': 'AE', 'uae': 'AE',
  'lebanon': 'LB',

  // Africa
  'south africa': 'ZA',
  'egypt': 'EG',
  'morocco': 'MA',
  'tunisia': 'TN',
  'kazakhstan': 'KZ',
  'nigeria': 'NG',
  'ghana': 'GH',
  'kenya': 'KE',
  'uganda': 'UG',
  'tanzania': 'TZ',
  'ethiopia': 'ET',
  'algeria': 'DZ',
  'botswana': 'BW',
  "côte d'ivoire": 'CI', "cote d'ivoire": 'CI', 'ivory coast': 'CI',
  'senegal': 'SN',
  'cameroon': 'CM',
  'gabon': 'GA',
  'chad': 'TD',
  'mali': 'ML',
  'burkina faso': 'BF',
  'niger': 'NE',
  'togo': 'TG',
  'benin': 'BJ',
  'malawi': 'MW',
  'zimbabwe': 'ZW',
  'zambia': 'ZM',
};

/**
 * Resolve a free-text country value (full English name, native variant, or
 * ISO-2 code) to an entry in `TAX_TREATY_DATA`. Returns `null` if the input
 * is empty or doesn't match any known country.
 */
export function lookupTreaty(country: string | undefined | null): TaxTreatyEntry | null {
  if (!country) return null;
  const raw = country.trim();
  if (!raw) return null;

  // Direct ISO-2 match (case-insensitive)
  const upper = raw.toUpperCase();
  if (upper.length === 2 && TAX_TREATY_DATA[upper]) {
    return TAX_TREATY_DATA[upper];
  }

  // Name-based normalisation
  const lower = raw.toLowerCase();
  const code = NAME_TO_CODE[lower];
  if (code && TAX_TREATY_DATA[code]) {
    return TAX_TREATY_DATA[code];
  }

  return null;
}

/**
 * Resolve a country to its canonical ISO-2 code (no treaty lookup). Used by
 * the form to detect whether a typed/selected country is one we recognise at
 * all (vs. an arbitrary free-text string we can't map).
 */
export function normalizeCountryCode(country: string | undefined | null): string | null {
  if (!country) return null;
  const raw = country.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.length === 2 && TAX_TREATY_DATA[upper]) return upper;
  const lower = raw.toLowerCase();
  return NAME_TO_CODE[lower] || null;
}
