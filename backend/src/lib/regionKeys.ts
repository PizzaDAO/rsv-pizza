/**
 * basil-14648 P2 (price priors): region keys, ported VERBATIM from pizza-mcp
 * `src/services/region-keys.ts` (the source of truth). Both repos run the same
 * fixture: `__fixtures__/region-keys.vectors.json` is a byte copy of pizza-mcp
 * `tests/fixtures/region-keys.vectors.json`. Change pizza-mcp first, then copy
 * the file and the fixture here; never edit the logic on this side only.
 *
 *   country:<ISO2>                     country:US
 *   state:<ISO2>-<sub>                 state:US-MA   (US and CA only)
 *   city:<ISO2>[-<sub>]:<slug>         city:US-MA:boston, city:IN:bengaluru
 *
 * `regionKeys()` returns them most specific first (city, state, country). pizza-mcp is the source of truth;
 * rsv-pizza ports this file and runs the same fixture (tests/fixtures/region-keys.vectors.json).
 */

const US: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};
const CA: Record<string, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};
const SUBDIVISIONS: Record<string, Record<string, string>> = { US, CA };

/**
 * City aliases, each scoped to the place it is true: `country` always, `state` too where the alias only holds
 * inside one US / CA state. "Roma, TX", "Bombay, NY" and a city really named "La" are therefore left alone.
 */
export const CITY_ALIASES: Record<
  string,
  { country: string; state?: string; to: string }
> = {
  bangalore: { country: "IN", to: "bengaluru" },
  bombay: { country: "IN", to: "mumbai" },
  calcutta: { country: "IN", to: "kolkata" },
  madras: { country: "IN", to: "chennai" },
  "new-york-city": { country: "US", state: "NY", to: "new-york" },
  nyc: { country: "US", state: "NY", to: "new-york" },
  "washington-dc": { country: "US", state: "DC", to: "washington" },
  "washington-d-c": { country: "US", state: "DC", to: "washington" },
  philly: { country: "US", state: "PA", to: "philadelphia" },
  "saint-louis": { country: "US", state: "MO", to: "st-louis" },
  roma: { country: "IT", to: "rome" },
  milano: { country: "IT", to: "milan" },
  firenze: { country: "IT", to: "florence" },
  napoli: { country: "IT", to: "naples" },
  munchen: { country: "DE", to: "munich" },
  koln: { country: "DE", to: "cologne" },
  "ciudad-de-mexico": { country: "MX", to: "mexico-city" },
  saigon: { country: "VN", to: "ho-chi-minh-city" },
  la: { country: "US", state: "CA", to: "los-angeles" },
  sf: { country: "US", state: "CA", to: "san-francisco" },
};

/** US territories keep their own ISO country code (a US-addressed "Puerto Rico" is country PR, not a state). */
const TERRITORIES: Record<string, string> = {
  PR: "Puerto Rico",
  GU: "Guam",
  VI: "U.S. Virgin Islands",
  AS: "American Samoa",
  MP: "Northern Mariana Islands",
};

/** Letters NFKD does not decompose, folded to ASCII before the accent strip. */
const TRANSLIT: Record<string, string> = {
  "\u0142": "l", // ł
  "\u00df": "ss", // ß
  "\u0111": "d", // đ
  "\u00f0": "d", // ð
  "\u00f8": "o", // ø
  "\u00e6": "ae", // æ
  "\u0153": "oe", // œ
  "\u00fe": "th", // þ
  "\u0127": "h", // ħ
  "\u0131": "i", // ı
  "\u0167": "t", // ŧ
  "\u014b": "ng", // ŋ
};

const COUNTRY_NAMES: Record<string, string> = {
  "united-states": "US",
  "united-states-of-america": "US",
  usa: "US",
  canada: "CA",
  "united-kingdom": "GB",
  uk: "GB",
  "great-britain": "GB",
  india: "IN",
  nigeria: "NG",
  mexico: "MX",
  brazil: "BR",
  germany: "DE",
  france: "FR",
  italy: "IT",
  spain: "ES",
  australia: "AU",
};

/** NFKD, ASCII-folded, lowercase, non-alphanumerics to `-`, trimmed. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /[\u0142\u00df\u0111\u00f0\u00f8\u00e6\u0153\u00fe\u0127\u0131\u0167\u014b]/g,
      (c) => TRANSLIT[c]!,
    )
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export function countryCode(country: unknown): string | null {
  if (typeof country !== "string") return null;
  const t = country.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return COUNTRY_NAMES[slugify(t)] ?? null;
}

/** US / CA subdivision code from a code ("MA") or a full name ("Massachusetts"); null when unknown. */
export function subdivisionCode(
  country: string,
  region: unknown,
): string | null {
  const table = SUBDIVISIONS[country];
  if (!table || typeof region !== "string") return null;
  const t = region.trim();
  if (!t) return null;
  const up = t.toUpperCase().replace(/\./g, "");
  if (table[up]) return up;
  const s = slugify(t);
  for (const [code, name] of Object.entries(table))
    if (slugify(name) === s) return code;
  return null;
}

export const REGION_KEY_RE =
  /^(country:[A-Z]{2}|state:(US|CA)-[A-Z]{2}|city:[A-Z]{2}(-[A-Z]{2})?:[a-z0-9]+(-[a-z0-9]+)*)$/;

export interface RegionInput {
  country?: unknown;
  region?: unknown;
  city?: unknown;
}

/** The territory code ("PR") when `region` names one of the US territories, else null. */
function territoryCode(region: unknown): string | null {
  if (typeof region !== "string") return null;
  const t = region.trim().toUpperCase().replace(/\./g, "");
  if (TERRITORIES[t]) return t;
  const s = slugify(region);
  for (const [code, name] of Object.entries(TERRITORIES))
    if (slugify(name) === s || (code === "VI" && s === "virgin-islands"))
      return code;
  return null;
}

/**
 * Most specific first: city, state, country. Empty when the country is unknown. For US and CA a city key is
 * emitted only when the state resolves (a city is only unique inside its state); otherwise the keys fall back to
 * the country. A US-addressed territory (Puerto Rico, Guam, ...) is its own country code.
 */
export function regionKeys(i: RegionInput): string[] {
  let cc = countryCode(i.country);
  if (!cc) return [];
  if (cc === "US") {
    const terr = territoryCode(i.region);
    if (terr) cc = terr;
  }
  const sub = subdivisionCode(cc, i.region);
  const keys: string[] = [];
  const needsState = cc === "US" || cc === "CA";
  if (typeof i.city === "string" && (sub || !needsState)) {
    const raw = slugify(i.city);
    const alias = CITY_ALIASES[raw];
    const slug =
      alias && alias.country === cc && (!alias.state || alias.state === sub)
        ? alias.to
        : raw;
    if (slug) keys.push(`city:${cc}${sub ? `-${sub}` : ""}:${slug}`);
  }
  if (sub) keys.push(`state:${cc}-${sub}`);
  keys.push(`country:${cc}`);
  return keys;
}
