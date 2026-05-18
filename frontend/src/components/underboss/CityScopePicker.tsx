import React, { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconInput } from '../IconInput';
import { fetchEventCities, EventCity } from '../../lib/api';

interface CityScopePickerProps {
  /** Selected city values, in original casing (e.g. "Lagos"). */
  selected: string[];
  /** Setter for selected cities. */
  onChange: (cities: string[]) => void;
  /** Optional className for the outer wrapper. */
  className?: string;
}

/**
 * Searchable multi-select for cities currently hosting a GPP event.
 *
 * The list is sourced from the `parties.city` column (via `/api/cities`).
 * The legacy GPP cities sheet is no longer consulted — events are the
 * single source of truth.
 *
 * Used in AdminPage and the UnderbossDashboard add-underboss modal to scope
 * an underboss to specific cities (in addition to or in lieu of regions).
 */
export function CityScopePicker({ selected, onChange, className = '' }: CityScopePickerProps) {
  const { t } = useTranslation('admin');
  const [cities, setCities] = useState<EventCity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEventCities()
      .then((rows) => { if (!cancelled) setCities(rows); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Normalize selected for fast lookup (case-insensitive)
  const selectedSet = useMemo(() => {
    return new Set(selected.map((c) => c.toLowerCase().trim()));
  }, [selected]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let rows = cities;
    if (q) {
      rows = rows.filter((c) => c.city.toLowerCase().includes(q));
    }
    return rows.slice(0, 200); // cap for performance
  }, [cities, search]);

  function toggle(city: string) {
    const key = city.toLowerCase().trim();
    if (selectedSet.has(key)) {
      // Remove (match case-insensitively but preserve any entry the caller stored)
      onChange(selected.filter((c) => c.toLowerCase().trim() !== key));
    } else {
      onChange([...selected, city]);
    }
  }

  function removeChip(city: string) {
    const key = city.toLowerCase().trim();
    onChange(selected.filter((c) => c.toLowerCase().trim() !== key));
  }

  return (
    <div className={className}>
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-500 border border-red-500/30 text-xs font-medium"
            >
              {c}
              <button
                type="button"
                onClick={() => removeChip(c)}
                className="hover:text-red-300"
                aria-label={`Remove ${c}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="mb-2">
        <IconInput
          icon={Search}
          iconSize={14}
          type="text"
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          placeholder={t('underboss.searchCitiesPlaceholder', 'Search cities…')}
        />
      </div>

      {/* List */}
      <div className="max-h-48 overflow-y-auto rounded-lg border border-theme-stroke bg-theme-surface">
        {loading ? (
          <p className="px-3 py-2 text-xs text-theme-text-faint">{t('underboss.loadingCities', 'Loading cities…')}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-theme-text-faint">{t('underboss.noCitiesMatch', 'No cities match your search')}</p>
        ) : (
          filtered.map((c) => {
            const key = c.city.toLowerCase().trim();
            const isSelected = selectedSet.has(key);
            return (
              <button
                key={c.city}
                type="button"
                onClick={() => toggle(c.city)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-theme-surface-hover transition-colors ${
                  isSelected ? 'text-red-500 font-medium' : 'text-theme-text-secondary'
                }`}
              >
                <span
                  className={`w-3.5 h-3.5 rounded border flex-shrink-0 ${
                    isSelected ? 'bg-red-500 border-red-500' : 'border-theme-stroke-hover'
                  }`}
                />
                <span className="flex-1">{c.city}</span>
                <span className="text-[10px] text-theme-text-faint">
                  {c.count} {c.count === 1 ? 'event' : 'events'}
                </span>
              </button>
            );
          })
        )}
      </div>
      <p className="text-xs text-theme-text-faint mt-1">
        {t('underboss.cityScopeHint', 'Cities are additive to regions.')}
      </p>
    </div>
  );
}
