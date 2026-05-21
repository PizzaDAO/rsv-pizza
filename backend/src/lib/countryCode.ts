/**
 * Map a free-text country name (English or localized, as returned by
 * Google Places when a GPP host picks a city) to an ISO-3166-1 alpha-2 code.
 *
 * Returns null for null/empty input AND for unmatched strings. Consumers
 * can therefore distinguish "no country on record" from "we don't recognize
 * this name". When we return null for an unmatched non-empty input we also
 * console.warn so the value shows up in logs and we can add it.
 *
 * Used by GET /api/gpp/events and GET /api/gpp/events/by-city/:citySlug
 * (via formatGppEvent in backend/src/routes/gpp.routes.ts).
 *
 * Source: ISO-3166-1 alpha-2. Aliases derived from production distinct()
 * values as of 2026-05-21 — see plan arrabbiata-42816.
 */

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  // A
  'afghanistan': 'AF', 'albania': 'AL', 'algeria': 'DZ', 'andorra': 'AD',
  'angola': 'AO', 'antigua and barbuda': 'AG', 'argentina': 'AR',
  'armenia': 'AM', 'australia': 'AU', 'austria': 'AT', 'azerbaijan': 'AZ',
  // B
  'bahamas': 'BS', 'bahrain': 'BH', 'bangladesh': 'BD', 'barbados': 'BB',
  'belarus': 'BY', 'belgium': 'BE', 'belize': 'BZ', 'benin': 'BJ',
  'bhutan': 'BT', 'bolivia': 'BO', 'bosnia and herzegovina': 'BA',
  'botswana': 'BW', 'brazil': 'BR', 'brunei': 'BN', 'bulgaria': 'BG',
  'burkina faso': 'BF', 'burundi': 'BI',
  // C
  'cambodia': 'KH', 'cameroon': 'CM', 'canada': 'CA', 'cape verde': 'CV',
  'central african republic': 'CF', 'chad': 'TD', 'chile': 'CL',
  'china': 'CN', 'colombia': 'CO', 'comoros': 'KM',
  'congo': 'CG',
  'democratic republic of the congo': 'CD', 'dr congo': 'CD',
  'costa rica': 'CR', "côte d'ivoire": 'CI', 'ivory coast': 'CI',
  'croatia': 'HR', 'cuba': 'CU', 'cyprus': 'CY', 'czechia': 'CZ',
  'czech republic': 'CZ',
  // D
  'denmark': 'DK', 'djibouti': 'DJ', 'dominica': 'DM',
  'dominican republic': 'DO',
  // E
  'ecuador': 'EC', 'egypt': 'EG', 'el salvador': 'SV',
  'equatorial guinea': 'GQ', 'eritrea': 'ER', 'estonia': 'EE',
  'eswatini': 'SZ', 'ethiopia': 'ET',
  // F
  'faroe islands': 'FO', 'fiji': 'FJ', 'finland': 'FI', 'france': 'FR',
  'french polynesia': 'PF',
  // G
  'gabon': 'GA', 'gambia': 'GM', 'georgia': 'GE', 'germany': 'DE',
  'ghana': 'GH', 'greece': 'GR', 'grenada': 'GD', 'guadeloupe': 'GP',
  'guatemala': 'GT', 'guernsey': 'GG', 'guinea': 'GN', 'guinea-bissau': 'GW',
  'guyana': 'GY',
  // H
  'haiti': 'HT', 'honduras': 'HN', 'hong kong': 'HK', 'hungary': 'HU',
  // I
  'iceland': 'IS', 'india': 'IN', 'indonesia': 'ID', 'iran': 'IR',
  'iraq': 'IQ', 'ireland': 'IE', 'isle of man': 'IM', 'israel': 'IL',
  'italy': 'IT',
  // J
  'jamaica': 'JM', 'japan': 'JP', 'jersey': 'JE', 'jordan': 'JO',
  // K
  'kazakhstan': 'KZ', 'kenya': 'KE', 'kiribati': 'KI', 'kosovo': 'XK',
  'kuwait': 'KW', 'kyrgyzstan': 'KG',
  // L
  'laos': 'LA', 'latvia': 'LV', 'lebanon': 'LB', 'lesotho': 'LS',
  'liberia': 'LR', 'libya': 'LY', 'liechtenstein': 'LI', 'lithuania': 'LT',
  'luxembourg': 'LU',
  // M
  'macau': 'MO', 'madagascar': 'MG', 'malawi': 'MW', 'malaysia': 'MY',
  'maldives': 'MV', 'mali': 'ML', 'malta': 'MT', 'marshall islands': 'MH',
  'mauritania': 'MR', 'mauritius': 'MU', 'mexico': 'MX',
  'moldova': 'MD', 'monaco': 'MC', 'mongolia': 'MN', 'montenegro': 'ME',
  'morocco': 'MA', 'mozambique': 'MZ', 'myanmar': 'MM',
  // N
  'namibia': 'NA', 'nauru': 'NR', 'nepal': 'NP', 'netherlands': 'NL',
  'new zealand': 'NZ', 'nicaragua': 'NI', 'niger': 'NE', 'nigeria': 'NG',
  'north korea': 'KP', 'north macedonia': 'MK', 'norway': 'NO',
  // O
  'oman': 'OM',
  // P
  'pakistan': 'PK', 'palau': 'PW',
  'palestine': 'PS', 'palestinian territories': 'PS',
  'panama': 'PA', 'papua new guinea': 'PG', 'paraguay': 'PY', 'peru': 'PE',
  'philippines': 'PH', 'poland': 'PL', 'portugal': 'PT', 'puerto rico': 'PR',
  // Q
  'qatar': 'QA',
  // R
  'romania': 'RO', 'russia': 'RU', 'rwanda': 'RW',
  // S
  'saint kitts and nevis': 'KN', 'saint lucia': 'LC',
  'saint vincent and the grenadines': 'VC', 'samoa': 'WS',
  'san marino': 'SM', 'são tomé and príncipe': 'ST',
  'saudi arabia': 'SA', 'senegal': 'SN', 'serbia': 'RS',
  'seychelles': 'SC', 'sierra leone': 'SL', 'singapore': 'SG',
  'slovakia': 'SK', 'slovenia': 'SI', 'solomon islands': 'SB',
  'somalia': 'SO', 'south africa': 'ZA', 'south korea': 'KR',
  'south sudan': 'SS', 'spain': 'ES', 'sri lanka': 'LK', 'sudan': 'SD',
  'suriname': 'SR', 'sweden': 'SE', 'switzerland': 'CH', 'syria': 'SY',
  // T
  'taiwan': 'TW', 'tajikistan': 'TJ', 'tanzania': 'TZ', 'thailand': 'TH',
  'timor-leste': 'TL', 'east timor': 'TL', 'togo': 'TG', 'tonga': 'TO',
  'trinidad and tobago': 'TT', 'tunisia': 'TN', 'turkey': 'TR',
  'turkmenistan': 'TM', 'tuvalu': 'TV',
  // U
  'uganda': 'UG', 'ukraine': 'UA', 'united arab emirates': 'AE',
  'united kingdom': 'GB', 'uk': 'GB', 'great britain': 'GB',
  'united states': 'US', 'usa': 'US', 'united states of america': 'US',
  'u.s. virgin islands': 'VI', 'us virgin islands': 'VI',
  'uruguay': 'UY', 'uzbekistan': 'UZ',
  // V
  'vanuatu': 'VU', 'vatican city': 'VA', 'venezuela': 'VE', 'vietnam': 'VN',
  // Y
  'yemen': 'YE',
  // Z
  'zambia': 'ZM', 'zimbabwe': 'ZW',
};

const COUNTRY_ALIASES: Record<string, string> = {
  // German
  'deutschland': 'DE', 'österreich': 'AT', 'schweiz': 'CH',
  // Spanish
  'españa': 'ES', 'méxico': 'MX', 'perú': 'PE', 'alemania': 'DE',
  'francia': 'FR', 'suiza': 'CH', 'república dominicana': 'DO',
  // Portuguese
  'brasil': 'BR',
  // Italian
  'italia': 'IT',
  // French
  'algérie': 'DZ', 'maroc': 'MA',
  'république démocratique du congo': 'CD',
  'république du congo': 'CG',
  // Dutch
  'nederland': 'NL',
  // Danish
  'danmark': 'DK',
  // Polish
  'polska': 'PL', 'wielka brytania': 'GB',
  // Hungarian
  'szlovákia': 'SK',
  // Romanian
  'románia': 'RO',
  // Turkish
  'türkiye': 'TR',
  // Vietnamese
  'việt nam': 'VN',
  // Bulgarian
  'българия': 'BG',
  // Russian
  'грузия': 'GE',
  // Arabic
  'الجزائر': 'DZ',
  'السعودية': 'SA',
  'العراق': 'IQ',
  'مصر': 'EG',
  // CJK
  '中国': 'CN',
  '日本': 'JP',
};

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function getCountryCode(country: string | null | undefined): string | null {
  if (!country || typeof country !== 'string') return null;
  const trimmed = country.trim();
  if (!trimmed) return null;

  const key = normalize(trimmed);
  const code = COUNTRY_NAME_TO_CODE[key] ?? COUNTRY_ALIASES[key];
  if (code) return code;

  console.warn(`[countryCode] unmatched country name: ${JSON.stringify(trimmed)}`);
  return null;
}
