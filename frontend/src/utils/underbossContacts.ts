/**
 * Region-based underboss Telegram contact lookup (arugula-38633).
 *
 * Used by the host-side Payments tab "underboss is reviewing your event"
 * notice to give the host a direct link to nudge the right underboss. Match
 * is on `party.country` (full English name, case-insensitive). Returns null
 * if the country doesn't resolve to a known region — caller hides the link.
 */

// Map ISO-3166 English country names (lowercased) → underboss Telegram handle.
// Snax-defined regional split as of 2026-05-20.
const COUNTRY_TO_HANDLE: Record<string, string> = {};

const register = (handle: string, countries: string[]) => {
  for (const c of countries) {
    COUNTRY_TO_HANDLE[c.toLowerCase()] = handle;
  }
};

// South Africa specifically (not other Southern African countries)
register('@pnsibanda', ['South Africa']);

// West, East, North, and other African countries share one underboss.
register('@BuildwithMc', [
  // West Africa
  'Nigeria', 'Ghana', 'Senegal', "Côte d'Ivoire", "Cote d'Ivoire", 'Ivory Coast',
  'Mali', 'Burkina Faso', 'Niger', 'Gambia', 'The Gambia', 'Guinea',
  'Liberia', 'Sierra Leone', 'Togo', 'Benin', 'Mauritania',
  'Guinea-Bissau', 'Cabo Verde', 'Cape Verde',
  // East Africa
  'Kenya', 'Tanzania', 'Uganda', 'Ethiopia', 'Eritrea', 'Djibouti',
  'Somalia', 'Rwanda', 'Burundi', 'South Sudan',
  // North Africa
  'Egypt', 'Libya', 'Tunisia', 'Algeria', 'Morocco', 'Sudan',
  // Other African countries — default into this bucket since only South Africa
  // is explicitly carved out
  'Botswana', 'Lesotho', 'Eswatini', 'Swaziland', 'Namibia', 'Zimbabwe',
  'Zambia', 'Malawi', 'Mozambique', 'Madagascar', 'Mauritius', 'Seychelles',
  'Comoros', 'Angola', 'Democratic Republic of the Congo', 'DRC', 'Congo',
  'Republic of the Congo', 'Gabon', 'Equatorial Guinea', 'Cameroon',
  'Central African Republic', 'Chad', 'São Tomé and Príncipe',
]);

// USA + Canada
register('@cauleneamagi', [
  'United States', 'USA', 'US', 'United States of America', 'Canada',
]);

// East + West Europe (all of Europe)
register('@APlazzi', [
  'United Kingdom', 'UK', 'Great Britain', 'England', 'Scotland', 'Wales',
  'Northern Ireland', 'Ireland', 'France', 'Germany', 'Spain', 'Italy',
  'Portugal', 'Netherlands', 'Belgium', 'Luxembourg', 'Austria',
  'Switzerland', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Iceland',
  'Poland', 'Czech Republic', 'Czechia', 'Slovakia', 'Hungary', 'Romania',
  'Bulgaria', 'Greece', 'Croatia', 'Slovenia', 'Serbia',
  'Bosnia and Herzegovina', 'North Macedonia', 'Macedonia', 'Albania',
  'Montenegro', 'Kosovo', 'Moldova', 'Ukraine', 'Belarus', 'Lithuania',
  'Latvia', 'Estonia', 'Cyprus', 'Malta', 'Vatican City', 'Monaco',
  'San Marino', 'Andorra', 'Liechtenstein',
]);

// Central + South America
register('@donmalbec', [
  'Mexico', 'Guatemala', 'Belize', 'El Salvador', 'Honduras', 'Nicaragua',
  'Costa Rica', 'Panama', 'Colombia', 'Venezuela', 'Guyana', 'Suriname',
  'French Guiana', 'Ecuador', 'Peru', 'Brazil', 'Brasil', 'Bolivia',
  'Paraguay', 'Chile', 'Argentina', 'Uruguay', 'Cuba', 'Dominican Republic',
  'Haiti', 'Jamaica', 'Trinidad and Tobago', 'Barbados', 'Bahamas',
  'Puerto Rico', 'Antigua and Barbuda', 'Dominica', 'Grenada',
  'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines',
]);

// India
register('@simarpreet_019', ['India']);

// Asia + China + Oceania (everything Asian + Pacific not covered above)
register('@lianna_adams', [
  'China', 'Japan', 'South Korea', 'Korea', 'North Korea', 'Taiwan',
  'Hong Kong', 'Macau', 'Macao', 'Vietnam', 'Thailand', 'Malaysia',
  'Singapore', 'Philippines', 'Indonesia', 'Myanmar', 'Burma', 'Cambodia',
  'Laos', 'Brunei', 'Timor-Leste', 'East Timor', 'Mongolia', 'Bangladesh',
  'Sri Lanka', 'Nepal', 'Bhutan', 'Maldives', 'Pakistan', 'Afghanistan',
  'Uzbekistan', 'Kazakhstan', 'Kyrgyzstan', 'Tajikistan', 'Turkmenistan',
  'Azerbaijan', 'Georgia', 'Armenia', 'Iran', 'Iraq', 'Syria', 'Jordan',
  'Lebanon', 'Israel', 'Palestine', 'Saudi Arabia', 'Yemen', 'Oman',
  'United Arab Emirates', 'UAE', 'Qatar', 'Bahrain', 'Kuwait', 'Turkey',
  'Russia', 'Australia', 'New Zealand', 'Fiji', 'Papua New Guinea',
  'Solomon Islands', 'Vanuatu', 'New Caledonia', 'French Polynesia',
  'Samoa', 'Tonga', 'Kiribati', 'Marshall Islands',
  'Federated States of Micronesia', 'Micronesia', 'Palau', 'Tuvalu', 'Nauru',
]);

export interface UnderbossContact {
  /** Telegram handle including the leading @ */
  handle: string;
  /** t.me URL for the handle (handle without @) */
  url: string;
}

export function getUnderbossContact(country: string | null | undefined): UnderbossContact | null {
  if (!country) return null;
  const key = country.trim().toLowerCase();
  if (!key) return null;
  const handle = COUNTRY_TO_HANDLE[key];
  if (!handle) return null;
  const slug = handle.startsWith('@') ? handle.slice(1) : handle;
  return { handle, url: `https://t.me/${slug}` };
}
