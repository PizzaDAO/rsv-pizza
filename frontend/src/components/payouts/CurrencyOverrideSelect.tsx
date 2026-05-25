import React, { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  COMMON_CURRENCIES,
  COMMON_CURRENCY_CODES,
  COMMON_CURRENCY_CODE_SET,
} from '../../lib/currencies';
import { convertFx, ConvertFxResult } from '../../lib/api';

interface CurrencyOverrideSelectProps {
  /** Party id — required for the authed convert-fx call. */
  partyId: string;
  /** The amount in the currently-selected currency. */
  originalAmount: number;
  /** The currently-selected currency code (3-letter ISO). */
  currentCurrency: string;
  /** Fired with the new FX result after a successful convert-fx call. */
  onConverted: (result: ConvertFxResult) => void;
}

/**
 * focaccia-89172: native `<select>` for overriding the OCR-detected currency
 * on a receipt row. On change, calls `convertFx` and forwards the new USD
 * amount + rate to `onConverted`. On error, surfaces an inline message and
 * reverts the dropdown to its previous selection.
 *
 * Native (not IconInput / a custom popover) because mobile UX for a 40-item
 * currency list is best handled by the OS picker.
 */
export const CurrencyOverrideSelect: React.FC<CurrencyOverrideSelectProps> = ({
  partyId,
  originalAmount,
  currentCurrency,
  onConverted,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the current code isn't in our pre-populated list, surface it as an
  // extra option so we don't lose the OCR-detected value when rendering.
  const extraCurrent = useMemo(() => {
    const upper = (currentCurrency || '').toUpperCase();
    if (!upper) return null;
    const known = COMMON_CURRENCIES.some(c => c.code === upper);
    return known ? null : upper;
  }, [currentCurrency]);

  const allSorted = useMemo(
    () =>
      [...COMMON_CURRENCIES]
        .filter(c => !COMMON_CURRENCY_CODE_SET.has(c.code))
        .sort((a, b) => a.label.localeCompare(b.label)),
    []
  );

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    const previous = currentCurrency;
    if (!next || next === previous) return;

    setError(null);
    setBusy(true);
    try {
      const result = await convertFx(partyId, {
        originalAmount,
        originalCurrency: next,
      });
      onConverted(result);
    } catch (err: any) {
      setError(err?.message || 'Could not look up exchange rate');
      // Revert: react-controlled <select>'s `value` prop is `currentCurrency`
      // which we haven't changed yet, so React snaps the DOM back on re-render.
      // Force a re-render via state so the user sees the revert immediately.
      // No-op: setBusy(false) below already triggers a render.
      void previous;
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={currentCurrency.toUpperCase()}
        onChange={handleChange}
        disabled={busy}
        // Keep the visual treatment minimal — this lives inline inside a
        // receipt row's existing details strip, so it should feel like a
        // small adjustment widget, not a form field.
        className="text-xs bg-theme-surface border border-theme-stroke rounded px-1.5 py-0.5 text-theme-text hover:border-[#ff393a]/40 focus:border-[#ff393a] focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Override currency"
        onClick={e => e.stopPropagation()}
      >
        {extraCurrent && (
          <option value={extraCurrent}>
            {extraCurrent} (detected)
          </option>
        )}
        <optgroup label="Common">
          {COMMON_CURRENCY_CODES.map(code => {
            const c = COMMON_CURRENCIES.find(x => x.code === code);
            return c ? (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ) : null;
          })}
        </optgroup>
        <optgroup label="All">
          {allSorted.map(c => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </optgroup>
      </select>
      {busy && <Loader2 size={12} className="animate-spin text-theme-text-muted" />}
      {error && (
        <span className="text-xs text-red-300" role="alert">
          {error}
        </span>
      )}
    </span>
  );
};
