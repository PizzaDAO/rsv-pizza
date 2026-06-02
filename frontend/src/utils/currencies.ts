/**
 * caprino-92104 / pomodoro-58219: ISO 4217 currency catalog for the admin
 * receipt editor's searchable currency picker.
 *
 * As of pomodoro-58219 this module is a thin adapter over the canonical
 * `lib/iso4217.ts` dataset (full active ISO 4217 fiat set, ~157 codes) — it
 * was previously a hand-curated ~40-code list that drifted from the receipt
 * override dropdown's separate list. The exported API is unchanged so
 * `CurrencyPicker.tsx` needs no edits.
 *
 * `country` is the principal country whose name a user is most likely to
 * type when searching (e.g. typing "Egypt" matches EGP). For EUR the country
 * reads "Eurozone" but eurozone-member names match via the alias list. `flag`
 * is an emoji flag derived from the entry's ISO 3166 alpha-2 (`cc`).
 */
import {
  ISO_4217,
  PRIORITY_CODES,
  flagEmoji,
  findCurrency as findIso4217,
  searchCurrencies as searchIso4217,
  type Iso4217Entry,
} from '../lib/iso4217';

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

/** Attach the emoji flag to a canonical entry, producing a CurrencyOption. */
function toOption(e: Iso4217Entry): CurrencyOption {
  return {
    code: e.code,
    name: e.name,
    country: e.country,
    flag: flagEmoji(e.cc),
    ...(e.aliases ? { aliases: e.aliases } : {}),
  };
}

/**
 * Full catalog, ordered PRIORITY_CODES first (in that order) then the rest
 * alphabetical by `country`. The picker renders this verbatim when the search
 * box is empty.
 */
export const SUPPORTED_CURRENCIES: CurrencyOption[] = (() => {
  const prioritySet = new Set(PRIORITY_CODES);
  const priority = PRIORITY_CODES
    .map((code) => ISO_4217.find((e) => e.code === code))
    .filter((e): e is Iso4217Entry => Boolean(e))
    .map(toOption);
  const rest = ISO_4217
    .filter((e) => !prioritySet.has(e.code))
    .map(toOption)
    .sort((a, b) => a.country.localeCompare(b.country));
  return [...priority, ...rest];
})();

/**
 * Look up a currency option by ISO code (case-insensitive). Returns null for
 * unknown codes so the picker renders unknown values verbatim.
 */
export function findCurrencyByCode(code: string | null | undefined): CurrencyOption | null {
  const entry = findIso4217(code);
  return entry ? toOption(entry) : null;
}

/**
 * Filter currencies by a free-text query. Matches the ISO code, currency
 * name, principal country, and aliases — case-insensitive, ranked. Delegates
 * to the canonical ranking impl in `lib/iso4217.ts`.
 */
export function searchCurrencies(query: string): CurrencyOption[] {
  if (!query.trim()) return SUPPORTED_CURRENCIES;
  return searchIso4217(query).map(toOption);
}
