import { Search, X } from 'lucide-react';
import { IconInput } from './IconInput';
import { TriStateFilterDropdown } from './TriStateFilterDropdown';
import {
  PartnersFilters,
  PartnersSortValue,
  DEFAULT_FILTERS,
  activeFilterCount,
} from '../pages/partnersUrlState';
import { PAYMENTS_REGION_LABELS, PaymentsRegionPortal } from '../utils/regions';

/* ── colour tokens (mirror PartnersPage `C`) ─────────────── */
const C = {
  darkText: '#1a1a1a',
  mutedText: '#555',
  cardBorder: 'rgba(0,0,0,0.12)',
};

const SORT_OPTIONS: { value: PartnersSortValue; label: string }[] = [
  { value: 'events_desc', label: 'Most events' },
  { value: 'name_asc', label: 'Name A → Z' },
  { value: 'name_desc', label: 'Name Z → A' },
  { value: 'eventcount_asc', label: 'Fewest events' },
];

// Tailwind classes shared by the search box + native selects so they all match
// the page's light theme (white card on the sky-blue gradient).
const FIELD_CLASS =
  'rounded-lg border bg-white/90 px-3 py-2 text-sm text-[#1a1a1a] placeholder:text-[#555]/60 focus:outline-none focus:border-black/30';

interface PartnersFilterBarProps {
  filters: PartnersFilters;
  onChange: (next: PartnersFilters) => void;
  categories: string[];
  cities: string[];
  /** region PORTAL keys present in the data (e.g. 'latam', 'westafrica') */
  regions: string[];
  countries: string[];
}

/** Human-readable category label: 'hardware_wallet' → 'Hardware wallet'. */
function categoryLabel(cat: string): string {
  return cat
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PartnersFilterBar({
  filters,
  onChange,
  categories,
  cities,
  regions,
  countries,
}: PartnersFilterBarProps) {
  const count = activeFilterCount(filters);

  return (
    <div
      className="mb-6 rounded-2xl border shadow-sm p-3 sm:p-4"
      style={{ background: 'rgba(255,255,255,0.85)', borderColor: C.cardBorder }}
    >
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <IconInput
            icon={Search}
            iconSize={18}
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Search partners…"
            className={FIELD_CLASS}
          />
        </div>

        {/* Category (single-select) */}
        <select
          value={filters.category}
          onChange={(e) => onChange({ ...filters, category: e.target.value })}
          className={FIELD_CLASS}
          aria-label="Category"
        >
          <option value="all">All categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {categoryLabel(cat)}
            </option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={filters.sort}
          onChange={(e) => onChange({ ...filters, sort: e.target.value as PartnersSortValue })}
          className={FIELD_CLASS}
          aria-label="Sort"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {/* City */}
        <TriStateFilterDropdown
          tone="light"
          align="right"
          label="City"
          items={cities}
          includes={filters.cityIncludes}
          excludes={filters.cityExcludes}
          onChange={({ includes, excludes }) =>
            onChange({ ...filters, cityIncludes: includes, cityExcludes: excludes })
          }
          searchPlaceholder="Search cities…"
          noMatchesLabel="No cities"
          clearLabel="Clear"
          includeLabel="Include"
          excludeLabel="Exclude"
        />

        {/* Region */}
        <TriStateFilterDropdown
          tone="light"
          align="right"
          label="Region"
          items={regions}
          includes={filters.regionIncludes}
          excludes={filters.regionExcludes}
          onChange={({ includes, excludes }) =>
            onChange({ ...filters, regionIncludes: includes, regionExcludes: excludes })
          }
          searchPlaceholder="Search regions…"
          noMatchesLabel="No regions"
          clearLabel="Clear"
          includeLabel="Include"
          excludeLabel="Exclude"
          labelFor={(item) =>
            PAYMENTS_REGION_LABELS[item as PaymentsRegionPortal] ?? item}
        />

        {/* Country */}
        <TriStateFilterDropdown
          tone="light"
          align="right"
          label="Country"
          items={countries}
          includes={filters.countryIncludes}
          excludes={filters.countryExcludes}
          onChange={({ includes, excludes }) =>
            onChange({ ...filters, countryIncludes: includes, countryExcludes: excludes })
          }
          searchPlaceholder="Search countries…"
          noMatchesLabel="No countries"
          clearLabel="Clear"
          includeLabel="Include"
          excludeLabel="Exclude"
        />

        {/* Active count + clear all */}
        {count > 0 && (
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_FILTERS })}
            className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors hover:bg-black/5"
            style={{ borderColor: C.cardBorder, color: C.mutedText }}
          >
            <X size={14} />
            Clear all ({count})
          </button>
        )}
      </div>
    </div>
  );
}
