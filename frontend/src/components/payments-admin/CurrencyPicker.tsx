import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  SUPPORTED_CURRENCIES,
  findCurrencyByCode,
  searchCurrencies,
  type CurrencyOption,
} from '../../utils/currencies';

/**
 * caprino-92104: searchable currency picker for the admin receipt editor.
 *
 * Combobox pattern: a text input that doubles as a search field + a dropdown
 * panel of matching currencies. Matches on ISO code, country name, currency
 * name, OR country alias (e.g. "Germany" → EUR, "UK" → GBP). Keyboard nav:
 * ArrowDown/Up to highlight, Enter to select, Esc to close.
 *
 * Renders rows as: [flag] [Country] — [Code] · [Currency name]. The picker
 * does NOT call out to a network — the currency catalog ships in
 * `utils/currencies.ts` (~40 ISO codes covering the GPP party set).
 */
interface CurrencyPickerProps {
  /** Currently-selected ISO code. */
  value: string | null | undefined;
  /** Fires with the new ISO code (always uppercase). */
  onChange: (code: string) => void;
  /** Disable interaction (e.g. saving in flight). */
  disabled?: boolean;
  /** Optional className passthrough for the outer wrapper. */
  className?: string;
}

export const CurrencyPicker: React.FC<CurrencyPickerProps> = ({
  value,
  onChange,
  disabled,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resolve the currently-selected option from `value` so the input can
  // display "Egypt — EGP" while not-focused. If value is an unknown code
  // (legacy receipt with a custom string), fall back to the raw code.
  const selected = useMemo(() => findCurrencyByCode(value ?? null), [value]);
  const selectedLabel = selected
    ? `${selected.flag} ${selected.country} — ${selected.code}`
    : (value ?? '');

  // Filtered list — recomputed each query change. When query is empty we
  // show the full catalog so admins can browse without typing.
  const filtered = useMemo<CurrencyOption[]>(() => {
    return query.trim() ? searchCurrencies(query) : SUPPORTED_CURRENCIES;
  }, [query]);

  // Keep highlighted row in range when the filter changes.
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

  function commit(option: CurrencyOption) {
    onChange(option.code);
    setOpen(false);
    setQuery('');
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

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={open ? query : selectedLabel}
          placeholder={selected ? selected.code : 'Currency'}
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(e) => {
            setOpen(true);
            setQuery(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          className="w-full pl-3 pr-8 py-2 rounded-lg border border-theme-stroke bg-theme-surface text-theme-text text-sm disabled:opacity-50"
        />
        <ChevronDown
          size={14}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none"
        />
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-theme-stroke bg-theme-surface shadow-xl">
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-theme-text-muted">
              No currencies match "{query}".
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
                // the input's blur handler can close the dropdown first —
                // otherwise the picker closes without the selection landing.
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(c);
                }}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
                  isHighlighted ? 'bg-theme-bg' : ''
                } ${isSelected ? 'text-theme-text font-medium' : 'text-theme-text'}`}
              >
                <span className="text-base leading-none" aria-hidden>{c.flag}</span>
                <span className="flex-1 truncate">{c.country}</span>
                <span className="text-xs text-theme-text-muted">{c.code}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
