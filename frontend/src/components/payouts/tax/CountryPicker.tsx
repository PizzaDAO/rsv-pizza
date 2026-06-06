import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Globe, ChevronDown } from 'lucide-react';
import {
  COUNTRY_DATA,
  findCountryByName,
  searchCountries,
  type Country,
} from '../../../utils/countries';

/**
 * bocconcino-92107: searchable country picker for the W-8BEN and W-8BEN-E
 * standalone country fields (Country of citizenship / Country of incorporation).
 *
 * Combobox pattern mirrored from caprino-92104's `CurrencyPicker` — a text
 * input that doubles as a search field + a dropdown panel of matching
 * countries. Matches on ISO-2 code, full English name, or alias (native
 * language / common abbreviations / historical names). Keyboard nav:
 * ArrowDown/Up to highlight, Enter to select, Esc to close.
 *
 * Rows render as: [flag] [Country name] [ISO-2 code]. The picker does NOT
 * call out to a network — the country catalog ships in
 * `utils/countries.ts` (~250 ISO-3166 entries).
 *
 * The saved value is the FULL ENGLISH NAME (e.g. "Germany"), matching the
 * `parties.country` convention used elsewhere in the codebase and compatible
 * with the existing `taxTreaties.lookupTreaty()` resolver. Unknown free-text
 * values (e.g. legacy drafts) round-trip verbatim — the picker shows the raw
 * string when the search box is not focused.
 */
interface CountryPickerProps {
  /** Currently-selected country (full English name as saved). */
  value: string;
  /** Fires with the new country's full English name. */
  onChange: (countryName: string) => void;
  /** Placeholder text for the input (e.g. "Country of citizenship"). */
  placeholder?: string;
  /** Disable interaction (e.g. saving in flight). */
  disabled?: boolean;
  /** Whether the underlying field is required (adds the `*` placeholder hint). */
  required?: boolean;
}

export const CountryPicker: React.FC<CountryPickerProps> = ({
  value,
  onChange,
  placeholder,
  disabled,
  required,
}) => {
  // ----- hooks (declared above any early returns per react-hooks rules) -----
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resolve the currently-selected country from `value` so the input can
  // display "🇩🇪 Germany" while not-focused. If the value doesn't match a known
  // country (e.g. legacy draft with a custom string), fall back to the raw
  // string so we never lose the host's input.
  const selected = useMemo(() => findCountryByName(value), [value]);
  const selectedLabel = selected ? `${selected.flag} ${selected.name}` : (value ?? '');

  // Filtered list — recomputed each query change. Empty query shows the full
  // alphabetical catalog so hosts can browse without typing.
  const filtered = useMemo<Country[]>(() => {
    return query.trim() ? searchCountries(query) : COUNTRY_DATA;
  }, [query]);

  // Reset highlight to the top whenever the filter changes.
  useEffect(() => {
    setHighlightedIdx(0);
  }, [query]);

  // Close on click outside the wrapper.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function commit(option: Country) {
    onChange(option.name);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlightedIdx((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = filtered[highlightedIdx];
      if (option) commit(option);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  }

  // Match IconInput's placeholder convention: required fields get a trailing `*`.
  const displayPlaceholder =
    placeholder && required && !placeholder.endsWith('*') ? `${placeholder} *` : placeholder;

  return (
    <div ref={wrapperRef} className="relative">
      {/* Mirror IconInput's icon-on-left layout so the picker visually matches
          surrounding tax-form fields. We can't use IconInput directly because
          it owns the <input> and we need the combobox open/close state. */}
      <Globe
        size={20}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none"
      />
      <input
        ref={inputRef}
        type="text"
        value={open ? query : selectedLabel}
        placeholder={displayPlaceholder}
        disabled={disabled}
        required={required}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => {
          setOpen(true);
          setQuery(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        className="w-full !pl-14 pr-8"
        autoComplete="off"
      />
      <ChevronDown
        size={14}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none"
      />

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-theme-stroke bg-theme-surface shadow-xl">
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-theme-text-muted">
              No countries match "{query}".
            </div>
          )}
          {filtered.map((c, idx) => {
            const isSelected = selected?.code === c.code;
            const isHighlighted = idx === highlightedIdx;
            return (
              <button
                key={c.code}
                type="button"
                onMouseEnter={() => setHighlightedIdx(idx)}
                // Use onMouseDown (not onClick) so the option commits before
                // the input's blur handler can close the dropdown — otherwise
                // the picker closes without the selection landing.
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(c);
                }}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
                  isHighlighted ? 'bg-theme-bg' : ''
                } ${isSelected ? 'text-theme-text font-medium' : 'text-theme-text'}`}
              >
                <span className="text-base leading-none" aria-hidden>
                  {c.flag}
                </span>
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-xs text-theme-text-muted">{c.code}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
