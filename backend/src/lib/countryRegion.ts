// Country -> underboss region inference (moved from routes/gpp.routes.ts so scripts can reuse it).

// Map ISO country codes to underboss regions
// soppressata-50927: exported so the GPP27 (2027) create flow can reuse the
// exact same region-inference logic as the 2026 create path.
export function countryCodeToRegion(countryCode: string): string | null {
  const cc = countryCode.toUpperCase();

  // USA
  if (cc === 'US') return 'usa';

  // Canada
  if (cc === 'CA') return 'canada';

  // Central America
  const centralAmerica = ['MX', 'GT', 'BZ', 'HN', 'SV', 'NI', 'CR', 'PA', 'CU', 'JM', 'HT', 'DO', 'PR', 'TT', 'BB', 'BS', 'AG', 'DM', 'GD', 'KN', 'LC', 'VC'];
  if (centralAmerica.includes(cc)) return 'central-america';

  // South America
  const southAmerica = ['BR', 'AR', 'CL', 'CO', 'PE', 'VE', 'EC', 'BO', 'PY', 'UY', 'GY', 'SR', 'GF'];
  if (southAmerica.includes(cc)) return 'south-america';

  // Western Europe
  const westernEurope = ['GB', 'FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU', 'IE', 'AT', 'CH', 'DK', 'NO', 'SE', 'FI', 'IS', 'MT', 'MC', 'AD', 'LI', 'SM', 'VA'];
  if (westernEurope.includes(cc)) return 'western-europe';

  // Eastern Europe
  const easternEurope = ['PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'SI', 'RS', 'BA', 'ME', 'MK', 'AL', 'XK', 'UA', 'BY', 'MD', 'LT', 'LV', 'EE', 'GE', 'AM', 'AZ', 'GR', 'CY', 'TR', 'RU'];
  if (easternEurope.includes(cc)) return 'eastern-europe';

  // India
  if (cc === 'IN') return 'india';

  // China
  if (cc === 'CN' || cc === 'HK' || cc === 'MO' || cc === 'TW') return 'china';

  // Middle East
  const middleEast = ['SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'YE', 'IQ', 'IR', 'SY', 'JO', 'LB', 'IL', 'PS', 'EG'];
  if (middleEast.includes(cc)) return 'middle-east';

  // West Africa
  const westAfrica = ['NG', 'GH', 'SN', 'CI', 'CM', 'ML', 'BF', 'NE', 'TD', 'GN', 'BJ', 'TG', 'SL', 'LR', 'MR', 'GA', 'CG', 'CF', 'GQ', 'ST', 'CV', 'GM', 'GW'];
  if (westAfrica.includes(cc)) return 'west-africa';

  // East Africa (includes North African countries)
  const eastAfrica = ['KE', 'ET', 'TZ', 'UG', 'RW', 'MZ', 'MG', 'MW', 'DJ', 'ER', 'SO', 'SD', 'SS', 'CD', 'KM', 'SC', 'MU', 'TN', 'DZ', 'MA', 'LY', 'BI'];
  if (eastAfrica.includes(cc)) return 'east-africa';

  // South Africa
  const southAfrica = ['ZA', 'AO', 'ZW', 'ZM', 'BW', 'NA', 'LS', 'SZ'];
  if (southAfrica.includes(cc)) return 'south-africa';

  // Oceania
  const oceania = ['AU', 'NZ', 'FJ', 'PG', 'WS', 'TO', 'VU', 'SB', 'KI', 'FM', 'MH', 'PW', 'TV', 'NR', 'GU', 'NC', 'PF'];
  if (oceania.includes(cc)) return 'oceania';

  // Asia (catch-all for remaining Asian countries)
  const asia = ['JP', 'KR', 'TH', 'VN', 'PH', 'MY', 'SG', 'ID', 'MM', 'KH', 'LA', 'BN', 'TL', 'MN', 'KZ', 'UZ', 'TM', 'KG', 'TJ', 'AF', 'PK', 'BD', 'LK', 'NP', 'BT'];
  if (asia.includes(cc)) return 'asia';

  return null; // Unknown country
}

// Fallback: map country NAMES to regions when countryCode is missing
// soppressata-50927: exported for reuse by the GPP27 create flow.
export function countryNameToRegion(country: string): string | null {
  const name = country.toLowerCase().trim();
  const map: Record<string, string> = {
    'united states': 'usa', 'usa': 'usa',
    'canada': 'canada',
    'mexico': 'central-america', 'guatemala': 'central-america', 'honduras': 'central-america',
    'el salvador': 'central-america', 'nicaragua': 'central-america', 'costa rica': 'central-america',
    'panama': 'central-america', 'cuba': 'central-america', 'jamaica': 'central-america',
    'haiti': 'central-america', 'dominican republic': 'central-america', 'puerto rico': 'central-america',
    'trinidad and tobago': 'central-america', 'bahamas': 'central-america',
    'brazil': 'south-america', 'argentina': 'south-america', 'chile': 'south-america',
    'colombia': 'south-america', 'peru': 'south-america', 'venezuela': 'south-america',
    'ecuador': 'south-america', 'bolivia': 'south-america', 'paraguay': 'south-america',
    'uruguay': 'south-america', 'guyana': 'south-america', 'suriname': 'south-america',
    'united kingdom': 'western-europe', 'france': 'western-europe', 'germany': 'western-europe',
    'deutschland': 'western-europe', 'italy': 'western-europe', 'italia': 'western-europe',
    'spain': 'western-europe', 'portugal': 'western-europe', 'netherlands': 'western-europe',
    'belgium': 'western-europe', 'luxembourg': 'western-europe', 'ireland': 'western-europe',
    'austria': 'western-europe', 'switzerland': 'western-europe', 'denmark': 'western-europe',
    'norway': 'western-europe', 'sweden': 'western-europe', 'finland': 'western-europe',
    'iceland': 'western-europe', 'malta': 'western-europe', 'monaco': 'western-europe',
    'russia': 'eastern-europe', 'poland': 'eastern-europe', 'czechia': 'eastern-europe',
    'czech republic': 'eastern-europe', 'slovakia': 'eastern-europe', 'hungary': 'eastern-europe',
    'romania': 'eastern-europe', 'bulgaria': 'eastern-europe', 'croatia': 'eastern-europe',
    'slovenia': 'eastern-europe', 'serbia': 'eastern-europe', 'bosnia and herzegovina': 'eastern-europe',
    'montenegro': 'eastern-europe', 'north macedonia': 'eastern-europe', 'macedonia': 'eastern-europe',
    'albania': 'eastern-europe', 'ukraine': 'eastern-europe', 'belarus': 'eastern-europe',
    'moldova': 'eastern-europe', 'lithuania': 'eastern-europe', 'latvia': 'eastern-europe',
    'estonia': 'eastern-europe', 'georgia': 'eastern-europe', 'armenia': 'eastern-europe',
    'azerbaijan': 'eastern-europe', 'greece': 'eastern-europe', 'cyprus': 'eastern-europe',
    'turkey': 'eastern-europe',
    'india': 'india',
    'china': 'china', 'taiwan': 'china', 'hong kong': 'china',
    'saudi arabia': 'middle-east', 'united arab emirates': 'middle-east', 'uae': 'middle-east',
    'qatar': 'middle-east', 'kuwait': 'middle-east', 'bahrain': 'middle-east',
    'oman': 'middle-east', 'yemen': 'middle-east', 'iraq': 'middle-east',
    'iran': 'middle-east', 'syria': 'middle-east', 'jordan': 'middle-east',
    'lebanon': 'middle-east', 'israel': 'middle-east', 'egypt': 'middle-east',
    'nigeria': 'west-africa', 'ghana': 'west-africa', 'senegal': 'west-africa',
    "côte d'ivoire": 'west-africa', 'ivory coast': 'west-africa', 'cameroon': 'west-africa',
    'mali': 'west-africa', 'burkina faso': 'west-africa', 'niger': 'west-africa',
    'benin': 'west-africa', 'togo': 'west-africa', 'sierra leone': 'west-africa',
    'liberia': 'west-africa', 'guinea': 'west-africa',
    'kenya': 'east-africa', 'ethiopia': 'east-africa', 'tanzania': 'east-africa',
    'uganda': 'east-africa', 'rwanda': 'east-africa', 'mozambique': 'east-africa',
    'madagascar': 'east-africa', 'malawi': 'east-africa', 'burundi': 'east-africa',
    'somalia': 'east-africa', 'sudan': 'east-africa', 'south sudan': 'east-africa',
    'drc': 'east-africa', 'congo': 'east-africa', 'tunisia': 'east-africa',
    'algeria': 'east-africa', 'morocco': 'east-africa', 'libya': 'east-africa',
    'south africa': 'south-africa', 'zimbabwe': 'south-africa', 'zambia': 'south-africa',
    'botswana': 'south-africa', 'namibia': 'south-africa', 'angola': 'south-africa',
    'australia': 'oceania', 'new zealand': 'oceania',
    'japan': 'asia', 'south korea': 'asia', 'korea': 'asia',
    'thailand': 'asia', 'vietnam': 'asia', 'philippines': 'asia',
    'malaysia': 'asia', 'singapore': 'asia', 'indonesia': 'asia',
    'cambodia': 'asia', 'laos': 'asia', 'myanmar': 'asia',
    'mongolia': 'asia', 'kazakhstan': 'asia', 'pakistan': 'asia',
    'bangladesh': 'asia', 'sri lanka': 'asia', 'nepal': 'asia',
    'afghanistan': 'asia', 'bhutan': 'asia',
  };
  return map[name] || null;
}
