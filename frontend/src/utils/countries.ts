/**
 * bocconcino-92107: ISO 3166-1 alpha-2 country catalog for the tax-form
 * country pickers (W-8BEN "Country of citizenship", W-8BEN-E "Country of
 * incorporation").
 *
 * Mirrors caprino-92104's `utils/currencies.ts` design — a single static
 * dataset with a weighted free-text search over (code, name, aliases). The
 * canonical saved value is the FULL ENGLISH NAME (e.g. "Germany"), matching
 * the `parties.country` convention used elsewhere in the codebase and
 * compatible with the existing `taxTreaties.lookupTreaty()` resolver, which
 * accepts both ISO-2 codes and full names. Aliases are reused from the
 * `NAME_TO_CODE` map in `taxTreaties.ts` (Deutschland → DE, UK → GB, etc.)
 * to support native-language search.
 *
 * `flag` is an emoji flag derived from the ISO 3166 alpha-2 (regional
 * indicator math, pure string ops — no Intl runtime call). Reuses the
 * `flagEmoji()` helper from `lib/iso4217.ts`.
 */

import { flagEmoji } from '../lib/iso4217';

export interface Country {
  /** ISO 3166-1 alpha-2 code, uppercase. */
  code: string;
  /** Full English country name (canonical, the saved value). */
  name: string;
  /** Emoji flag (regional indicators for the alpha-2 code). */
  flag: string;
  /** Extra names/abbreviations that should match this country in search. */
  aliases?: string[];
}

/**
 * Full ISO 3166-1 alpha-2 set (~250 entries) sorted alphabetically by English
 * name. The picker renders this verbatim when the search box is empty.
 *
 * Aliases include native-language forms (Deutschland, España, 日本), common
 * abbreviations (UK, UAE, DRC), and historical / alternate names (Burma,
 * Holland, Ivory Coast, Swaziland).
 */
export const COUNTRY_DATA: Country[] = [
  { code: 'AF', name: 'Afghanistan' },
  { code: 'AX', name: 'Åland Islands', aliases: ['Aland Islands'] },
  { code: 'AL', name: 'Albania', aliases: ['Shqipëria', 'Shqiperia'] },
  { code: 'DZ', name: 'Algeria', aliases: ['الجزائر', 'Algérie'] },
  { code: 'AS', name: 'American Samoa' },
  { code: 'AD', name: 'Andorra' },
  { code: 'AO', name: 'Angola' },
  { code: 'AI', name: 'Anguilla' },
  { code: 'AQ', name: 'Antarctica' },
  { code: 'AG', name: 'Antigua and Barbuda' },
  { code: 'AR', name: 'Argentina' },
  { code: 'AM', name: 'Armenia', aliases: ['Հայաստան', 'Hayastan'] },
  { code: 'AW', name: 'Aruba' },
  { code: 'AU', name: 'Australia' },
  { code: 'AT', name: 'Austria', aliases: ['Österreich', 'Osterreich'] },
  { code: 'AZ', name: 'Azerbaijan', aliases: ['Azərbaycan', 'Azerbaycan'] },
  { code: 'BS', name: 'Bahamas' },
  { code: 'BH', name: 'Bahrain', aliases: ['البحرين'] },
  { code: 'BD', name: 'Bangladesh', aliases: ['বাংলাদেশ'] },
  { code: 'BB', name: 'Barbados' },
  { code: 'BY', name: 'Belarus', aliases: ['Беларусь'] },
  { code: 'BE', name: 'Belgium', aliases: ['België', 'Belgique', 'Belgie'] },
  { code: 'BZ', name: 'Belize' },
  { code: 'BJ', name: 'Benin', aliases: ['Bénin'] },
  { code: 'BM', name: 'Bermuda' },
  { code: 'BT', name: 'Bhutan', aliases: ['འབྲུག་ཡུལ་'] },
  { code: 'BO', name: 'Bolivia' },
  { code: 'BQ', name: 'Bonaire, Sint Eustatius and Saba', aliases: ['Caribbean Netherlands', 'BES Islands'] },
  { code: 'BA', name: 'Bosnia and Herzegovina', aliases: ['Bosna i Hercegovina'] },
  { code: 'BW', name: 'Botswana' },
  { code: 'BV', name: 'Bouvet Island' },
  { code: 'BR', name: 'Brazil', aliases: ['Brasil'] },
  { code: 'IO', name: 'British Indian Ocean Territory' },
  { code: 'BN', name: 'Brunei', aliases: ['Brunei Darussalam'] },
  { code: 'BG', name: 'Bulgaria', aliases: ['България', 'Balgariya'] },
  { code: 'BF', name: 'Burkina Faso' },
  { code: 'BI', name: 'Burundi' },
  { code: 'CV', name: 'Cabo Verde', aliases: ['Cape Verde'] },
  { code: 'KH', name: 'Cambodia', aliases: ['កម្ពុជា'] },
  { code: 'CM', name: 'Cameroon', aliases: ['Cameroun'] },
  { code: 'CA', name: 'Canada' },
  { code: 'KY', name: 'Cayman Islands' },
  { code: 'CF', name: 'Central African Republic', aliases: ['République centrafricaine', 'CAR'] },
  { code: 'TD', name: 'Chad', aliases: ['Tchad'] },
  { code: 'CL', name: 'Chile' },
  { code: 'CN', name: 'China', aliases: ['中国', "People's Republic of China", 'PRC', 'Zhōngguó'] },
  { code: 'CX', name: 'Christmas Island' },
  { code: 'CC', name: 'Cocos (Keeling) Islands' },
  { code: 'CO', name: 'Colombia' },
  { code: 'KM', name: 'Comoros' },
  { code: 'CG', name: 'Congo', aliases: ['Republic of the Congo', 'Congo-Brazzaville'] },
  { code: 'CD', name: 'Congo (Democratic Republic)', aliases: ['DRC', 'Democratic Republic of the Congo', 'Congo-Kinshasa', 'Zaire'] },
  { code: 'CK', name: 'Cook Islands' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'CI', name: "Côte d'Ivoire", aliases: ["Cote d'Ivoire", 'Ivory Coast'] },
  { code: 'HR', name: 'Croatia', aliases: ['Hrvatska'] },
  { code: 'CU', name: 'Cuba' },
  { code: 'CW', name: 'Curaçao', aliases: ['Curacao'] },
  { code: 'CY', name: 'Cyprus', aliases: ['Κύπρος', 'Kypros', 'Kıbrıs'] },
  { code: 'CZ', name: 'Czechia', aliases: ['Czech Republic', 'Česko', 'Cesko'] },
  { code: 'DK', name: 'Denmark', aliases: ['Danmark'] },
  { code: 'DJ', name: 'Djibouti' },
  { code: 'DM', name: 'Dominica' },
  { code: 'DO', name: 'Dominican Republic', aliases: ['República Dominicana'] },
  { code: 'EC', name: 'Ecuador' },
  { code: 'EG', name: 'Egypt', aliases: ['مصر', 'Misr'] },
  { code: 'SV', name: 'El Salvador' },
  { code: 'GQ', name: 'Equatorial Guinea', aliases: ['Guinea Ecuatorial'] },
  { code: 'ER', name: 'Eritrea' },
  { code: 'EE', name: 'Estonia', aliases: ['Eesti'] },
  { code: 'SZ', name: 'Eswatini', aliases: ['Swaziland'] },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'FK', name: 'Falkland Islands', aliases: ['Islas Malvinas', 'Malvinas'] },
  { code: 'FO', name: 'Faroe Islands' },
  { code: 'FJ', name: 'Fiji' },
  { code: 'FI', name: 'Finland', aliases: ['Suomi'] },
  { code: 'FR', name: 'France' },
  { code: 'GF', name: 'French Guiana', aliases: ['Guyane française'] },
  { code: 'PF', name: 'French Polynesia', aliases: ['Polynésie française', 'Tahiti'] },
  { code: 'TF', name: 'French Southern Territories' },
  { code: 'GA', name: 'Gabon' },
  { code: 'GM', name: 'Gambia' },
  { code: 'GE', name: 'Georgia', aliases: ['საქართველო', 'Sakartvelo'] },
  { code: 'DE', name: 'Germany', aliases: ['Deutschland'] },
  { code: 'GH', name: 'Ghana' },
  { code: 'GI', name: 'Gibraltar' },
  { code: 'GR', name: 'Greece', aliases: ['Ελλάδα', 'Hellas', 'Ellada'] },
  { code: 'GL', name: 'Greenland', aliases: ['Kalaallit Nunaat'] },
  { code: 'GD', name: 'Grenada' },
  { code: 'GP', name: 'Guadeloupe' },
  { code: 'GU', name: 'Guam' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'GG', name: 'Guernsey' },
  { code: 'GN', name: 'Guinea', aliases: ['Guinée'] },
  { code: 'GW', name: 'Guinea-Bissau', aliases: ['Guiné-Bissau'] },
  { code: 'GY', name: 'Guyana' },
  { code: 'HT', name: 'Haiti', aliases: ['Haïti'] },
  { code: 'HM', name: 'Heard Island and McDonald Islands' },
  { code: 'VA', name: 'Holy See', aliases: ['Vatican City', 'Vatican'] },
  { code: 'HN', name: 'Honduras' },
  { code: 'HK', name: 'Hong Kong', aliases: ['香港', 'Xiānggǎng'] },
  { code: 'HU', name: 'Hungary', aliases: ['Magyarország', 'Magyarorszag'] },
  { code: 'IS', name: 'Iceland', aliases: ['Ísland', 'Island'] },
  { code: 'IN', name: 'India', aliases: ['भारत', 'Bharat'] },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IR', name: 'Iran', aliases: ['ایران'] },
  { code: 'IQ', name: 'Iraq', aliases: ['العراق'] },
  { code: 'IE', name: 'Ireland', aliases: ['Éire', 'Eire'] },
  { code: 'IM', name: 'Isle of Man' },
  { code: 'IL', name: 'Israel', aliases: ['ישראל'] },
  { code: 'IT', name: 'Italy', aliases: ['Italia'] },
  { code: 'JM', name: 'Jamaica' },
  { code: 'JP', name: 'Japan', aliases: ['日本', 'Nippon', 'Nihon'] },
  { code: 'JE', name: 'Jersey' },
  { code: 'JO', name: 'Jordan', aliases: ['الأردن'] },
  { code: 'KZ', name: 'Kazakhstan', aliases: ['Қазақстан', 'Qazaqstan'] },
  { code: 'KE', name: 'Kenya' },
  { code: 'KI', name: 'Kiribati' },
  { code: 'KP', name: 'North Korea', aliases: ['DPRK', "Democratic People's Republic of Korea", '조선', 'Chosŏn'] },
  { code: 'KR', name: 'South Korea', aliases: ['Korea', 'Republic of Korea', 'ROK', '대한민국', 'Daehan Minguk', 'Hanguk'] },
  { code: 'KW', name: 'Kuwait', aliases: ['الكويت'] },
  { code: 'KG', name: 'Kyrgyzstan', aliases: ['Кыргызстан', 'Kyrgyz Republic'] },
  { code: 'LA', name: 'Laos', aliases: ["Lao People's Democratic Republic", 'Lao PDR'] },
  { code: 'LV', name: 'Latvia', aliases: ['Latvija'] },
  { code: 'LB', name: 'Lebanon', aliases: ['لبنان', 'Liban'] },
  { code: 'LS', name: 'Lesotho' },
  { code: 'LR', name: 'Liberia' },
  { code: 'LY', name: 'Libya', aliases: ['ليبيا'] },
  { code: 'LI', name: 'Liechtenstein' },
  { code: 'LT', name: 'Lithuania', aliases: ['Lietuva'] },
  { code: 'LU', name: 'Luxembourg', aliases: ['Lëtzebuerg', 'Luxemburg'] },
  { code: 'MO', name: 'Macao', aliases: ['Macau', '澳門'] },
  { code: 'MG', name: 'Madagascar', aliases: ['Madagasikara'] },
  { code: 'MW', name: 'Malawi' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'MV', name: 'Maldives' },
  { code: 'ML', name: 'Mali' },
  { code: 'MT', name: 'Malta' },
  { code: 'MH', name: 'Marshall Islands' },
  { code: 'MQ', name: 'Martinique' },
  { code: 'MR', name: 'Mauritania', aliases: ['موريتانيا'] },
  { code: 'MU', name: 'Mauritius', aliases: ['Maurice'] },
  { code: 'YT', name: 'Mayotte' },
  { code: 'MX', name: 'Mexico', aliases: ['México'] },
  { code: 'FM', name: 'Micronesia', aliases: ['Federated States of Micronesia'] },
  { code: 'MD', name: 'Moldova', aliases: ['Republica Moldova'] },
  { code: 'MC', name: 'Monaco' },
  { code: 'MN', name: 'Mongolia', aliases: ['Монгол улс', 'Mongol Uls'] },
  { code: 'ME', name: 'Montenegro', aliases: ['Crna Gora'] },
  { code: 'MS', name: 'Montserrat' },
  { code: 'MA', name: 'Morocco', aliases: ['المغرب', 'Maroc', 'Al-Maghrib'] },
  { code: 'MZ', name: 'Mozambique', aliases: ['Moçambique'] },
  { code: 'MM', name: 'Myanmar', aliases: ['Burma'] },
  { code: 'NA', name: 'Namibia' },
  { code: 'NR', name: 'Nauru' },
  { code: 'NP', name: 'Nepal', aliases: ['नेपाल'] },
  { code: 'NL', name: 'Netherlands', aliases: ['Nederland', 'Holland', 'The Netherlands'] },
  { code: 'NC', name: 'New Caledonia', aliases: ['Nouvelle-Calédonie'] },
  { code: 'NZ', name: 'New Zealand', aliases: ['Aotearoa'] },
  { code: 'NI', name: 'Nicaragua' },
  { code: 'NE', name: 'Niger' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'NU', name: 'Niue' },
  { code: 'NF', name: 'Norfolk Island' },
  { code: 'MK', name: 'North Macedonia', aliases: ['Macedonia', 'Северна Македонија', 'Severna Makedonija'] },
  { code: 'MP', name: 'Northern Mariana Islands' },
  { code: 'NO', name: 'Norway', aliases: ['Norge', 'Noreg'] },
  { code: 'OM', name: 'Oman', aliases: ['عُمان'] },
  { code: 'PK', name: 'Pakistan', aliases: ['پاکستان'] },
  { code: 'PW', name: 'Palau' },
  { code: 'PS', name: 'Palestine', aliases: ['State of Palestine', 'فلسطين'] },
  { code: 'PA', name: 'Panama', aliases: ['Panamá'] },
  { code: 'PG', name: 'Papua New Guinea', aliases: ['PNG'] },
  { code: 'PY', name: 'Paraguay' },
  { code: 'PE', name: 'Peru', aliases: ['Perú'] },
  { code: 'PH', name: 'Philippines', aliases: ['Pilipinas'] },
  { code: 'PN', name: 'Pitcairn' },
  { code: 'PL', name: 'Poland', aliases: ['Polska'] },
  { code: 'PT', name: 'Portugal' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'QA', name: 'Qatar', aliases: ['قطر'] },
  { code: 'RE', name: 'Réunion', aliases: ['Reunion'] },
  { code: 'RO', name: 'Romania', aliases: ['România'] },
  { code: 'RU', name: 'Russia', aliases: ['Russian Federation', 'Россия', 'Rossiya'] },
  { code: 'RW', name: 'Rwanda' },
  { code: 'BL', name: 'Saint Barthélemy', aliases: ['Saint Barthelemy', 'St Barts'] },
  { code: 'SH', name: 'Saint Helena, Ascension and Tristan da Cunha', aliases: ['Saint Helena'] },
  { code: 'KN', name: 'Saint Kitts and Nevis' },
  { code: 'LC', name: 'Saint Lucia' },
  { code: 'MF', name: 'Saint Martin', aliases: ['Saint Martin (French part)'] },
  { code: 'PM', name: 'Saint Pierre and Miquelon' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines' },
  { code: 'WS', name: 'Samoa' },
  { code: 'SM', name: 'San Marino' },
  { code: 'ST', name: 'São Tomé and Príncipe', aliases: ['Sao Tome and Principe'] },
  { code: 'SA', name: 'Saudi Arabia', aliases: ['المملكة العربية السعودية', 'KSA'] },
  { code: 'SN', name: 'Senegal', aliases: ['Sénégal'] },
  { code: 'RS', name: 'Serbia', aliases: ['Србија', 'Srbija'] },
  { code: 'SC', name: 'Seychelles' },
  { code: 'SL', name: 'Sierra Leone' },
  { code: 'SG', name: 'Singapore', aliases: ['新加坡'] },
  { code: 'SX', name: 'Sint Maarten', aliases: ['Sint Maarten (Dutch part)'] },
  { code: 'SK', name: 'Slovakia', aliases: ['Slovensko', 'Slovak Republic'] },
  { code: 'SI', name: 'Slovenia', aliases: ['Slovenija'] },
  { code: 'SB', name: 'Solomon Islands' },
  { code: 'SO', name: 'Somalia', aliases: ['Soomaaliya'] },
  { code: 'ZA', name: 'South Africa' },
  { code: 'GS', name: 'South Georgia and the South Sandwich Islands' },
  { code: 'SS', name: 'South Sudan' },
  { code: 'ES', name: 'Spain', aliases: ['España', 'Espana'] },
  { code: 'LK', name: 'Sri Lanka', aliases: ['ශ්‍රී ලංකාව'] },
  { code: 'SD', name: 'Sudan', aliases: ['السودان'] },
  { code: 'SR', name: 'Suriname' },
  { code: 'SJ', name: 'Svalbard and Jan Mayen' },
  { code: 'SE', name: 'Sweden', aliases: ['Sverige'] },
  { code: 'CH', name: 'Switzerland', aliases: ['Schweiz', 'Suisse', 'Svizzera', 'Svizra'] },
  { code: 'SY', name: 'Syria', aliases: ['سوريا', 'Syrian Arab Republic'] },
  { code: 'TW', name: 'Taiwan', aliases: ['臺灣', 'Republic of China', 'ROC'] },
  { code: 'TJ', name: 'Tajikistan', aliases: ['Тоҷикистон'] },
  { code: 'TZ', name: 'Tanzania', aliases: ['United Republic of Tanzania'] },
  { code: 'TH', name: 'Thailand', aliases: ['ประเทศไทย', 'Prathet Thai'] },
  { code: 'TL', name: 'Timor-Leste', aliases: ['East Timor'] },
  { code: 'TG', name: 'Togo' },
  { code: 'TK', name: 'Tokelau' },
  { code: 'TO', name: 'Tonga' },
  { code: 'TT', name: 'Trinidad and Tobago' },
  { code: 'TN', name: 'Tunisia', aliases: ['تونس', 'Tunisie'] },
  { code: 'TR', name: 'Türkiye', aliases: ['Turkey', 'Turkiye'] },
  { code: 'TM', name: 'Turkmenistan' },
  { code: 'TC', name: 'Turks and Caicos Islands' },
  { code: 'TV', name: 'Tuvalu' },
  { code: 'UG', name: 'Uganda' },
  { code: 'UA', name: 'Ukraine', aliases: ['Україна', 'Ukrayina'] },
  { code: 'AE', name: 'United Arab Emirates', aliases: ['UAE', 'Emirates', 'Dubai', 'Abu Dhabi'] },
  { code: 'GB', name: 'United Kingdom', aliases: ['UK', 'Great Britain', 'Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'] },
  { code: 'US', name: 'United States', aliases: ['United States of America', 'USA', 'America'] },
  { code: 'UM', name: 'United States Minor Outlying Islands' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'UZ', name: 'Uzbekistan', aliases: ["O'zbekiston", 'Uzbekiston'] },
  { code: 'VU', name: 'Vanuatu' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'VN', name: 'Vietnam', aliases: ['Việt Nam', 'Viet Nam'] },
  { code: 'VG', name: 'British Virgin Islands', aliases: ['Virgin Islands, British'] },
  { code: 'VI', name: 'U.S. Virgin Islands', aliases: ['US Virgin Islands', 'Virgin Islands, U.S.'] },
  { code: 'WF', name: 'Wallis and Futuna' },
  { code: 'EH', name: 'Western Sahara' },
  { code: 'YE', name: 'Yemen', aliases: ['اليمن'] },
  { code: 'ZM', name: 'Zambia' },
  { code: 'ZW', name: 'Zimbabwe' },
]
  .map((c) => ({ ...c, flag: flagEmoji(c.code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * Look up a country by ISO-2 code (case-insensitive). Returns undefined for
 * unknown codes.
 */
export function findCountryByCode(code: string | null | undefined): Country | undefined {
  if (!code) return undefined;
  const upper = code.trim().toUpperCase();
  if (upper.length !== 2) return undefined;
  return COUNTRY_DATA.find((c) => c.code === upper);
}

/**
 * Look up a country by its full English name (case-insensitive). Also matches
 * aliases as a fallback so a saved native-language value still round-trips
 * (e.g. "Deutschland" resolves to DE → "Germany").
 */
export function findCountryByName(name: string | null | undefined): Country | undefined {
  if (!name) return undefined;
  const lower = name.trim().toLowerCase();
  if (!lower) return undefined;
  // Direct name match first.
  const direct = COUNTRY_DATA.find((c) => c.name.toLowerCase() === lower);
  if (direct) return direct;
  // Then aliases.
  return COUNTRY_DATA.find((c) => (c.aliases ?? []).some((a) => a.toLowerCase() === lower));
}

/**
 * Free-text search over the catalog. Ranks (highest first): exact code 100,
 * code-prefix 80, name-prefix 60, alias-prefix 50, name-includes 30,
 * alias-includes 20, code-includes 10. Ties break by name. Empty query
 * returns the full catalog unchanged.
 */
export function searchCountries(query: string): Country[] {
  const q = query.trim().toLowerCase();
  if (!q) return COUNTRY_DATA;
  const scored: { c: Country; score: number }[] = [];
  for (const c of COUNTRY_DATA) {
    const code = c.code.toLowerCase();
    const name = c.name.toLowerCase();
    const aliases = (c.aliases ?? []).map((a) => a.toLowerCase());

    let score = -1;
    if (code === q) score = 100;
    else if (code.startsWith(q)) score = 80;
    else if (name.startsWith(q)) score = 60;
    else if (aliases.some((a) => a.startsWith(q))) score = 50;
    else if (name.includes(q)) score = 30;
    else if (aliases.some((a) => a.includes(q))) score = 20;
    else if (code.includes(q)) score = 10;

    if (score >= 0) scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name));
  return scored.map((s) => s.c);
}
