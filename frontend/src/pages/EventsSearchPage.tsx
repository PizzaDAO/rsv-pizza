import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, MapPin, Search, Users, X } from 'lucide-react';
import { Layout } from '../components/Layout';
import { IconInput } from '../components/IconInput';
import { fetchPublicEventsForSearch } from '../lib/api';
import { GPP_REGIONS } from '../types';
import { formatShortDate } from '../utils/dateUtils';
import {
  EMPTY_FILTERS,
  EventSearchFilters,
  SearchableEvent,
  eventContinent,
  filterEvents,
  filtersToSearchParams,
  searchParamsToFilters,
  uniqueSorted,
} from '../utils/eventSearch';

const SELECT_CLASS =
  'w-full px-3 py-3 bg-theme-surface border border-theme-stroke rounded-xl text-theme-text text-sm focus:outline-none focus:border-[#ff393a]';
const PAGE_SIZE = 60;

export function EventsSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => searchParamsToFilters(searchParams), [searchParams]);
  const [events, setEvents] = useState<SearchableEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  // Keyword is local state (debounced into the URL) so typing stays responsive.
  const [qInput, setQInput] = useState(filters.q);

  useEffect(() => {
    let cancelled = false;
    fetchPublicEventsForSearch()
      .then((data) => !cancelled && setEvents(data))
      .catch((err) => !cancelled && setError(err.message || 'Failed to load events'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch: Partial<EventSearchFilters>) => {
    setVisible(PAGE_SIZE);
    setSearchParams(filtersToSearchParams({ ...filters, ...patch }), { replace: true });
  };

  // Debounce keyword -> URL.
  useEffect(() => {
    if (qInput === filters.q) return;
    const h = setTimeout(() => update({ q: qInput }), 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  // Keep the input in sync when the URL changes externally (back button, clear).
  useEffect(() => {
    setQInput(filters.q);
  }, [filters.q]);

  const continents = useMemo(() => uniqueSorted(events.map(eventContinent)), [events]);
  // Country/region/city options narrow to the selected broader filters.
  const countries = useMemo(
    () => uniqueSorted(filterEvents(events, { ...EMPTY_FILTERS, continent: filters.continent }).map((e) => e.country)),
    [events, filters.continent]
  );
  const regions = useMemo(() => {
    const scoped = filterEvents(events, { ...EMPTY_FILTERS, continent: filters.continent, country: filters.country });
    const present = new Set(scoped.map((e) => (e.region || '').toLowerCase()));
    return GPP_REGIONS.filter((r) => present.has(r.id));
  }, [events, filters.continent, filters.country]);
  const cities = useMemo(
    () =>
      uniqueSorted(
        filterEvents(events, {
          ...EMPTY_FILTERS,
          continent: filters.continent,
          country: filters.country,
          region: filters.region,
        }).map((e) => e.city)
      ),
    [events, filters.continent, filters.country, filters.region]
  );

  const results = useMemo(
    () =>
      filterEvents(events, filters).sort((a, b) => {
        if (a.date && b.date) return new Date(a.date).getTime() - new Date(b.date).getTime();
        if (a.date) return -1;
        if (b.date) return 1;
        return a.city.localeCompare(b.city);
      }),
    [events, filters]
  );

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <Layout>
      <Helmet>
        <title>Find Events | RSV.Pizza</title>
        <meta name="description" content="Search pizza parties by keyword, continent, country, region, or city." />
      </Helmet>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-theme-text mb-1">Find events</h1>
        <p className="text-sm text-theme-text-muted mb-6">Search public pizza parties around the world.</p>

        <div className="space-y-3 mb-6">
          <IconInput
            icon={Search}
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search by event name, city, venue, or country"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <select
              aria-label="Continent"
              className={SELECT_CLASS}
              value={filters.continent}
              onChange={(e) => update({ continent: e.target.value, country: '', region: '', city: '' })}
            >
              <option value="">All continents</option>
              {continents.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              aria-label="Country"
              className={SELECT_CLASS}
              value={filters.country}
              onChange={(e) => update({ country: e.target.value, region: '', city: '' })}
            >
              <option value="">All countries</option>
              {countries.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              aria-label="Region"
              className={SELECT_CLASS}
              value={filters.region}
              onChange={(e) => update({ region: e.target.value, city: '' })}
            >
              <option value="">All regions</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
            <select
              aria-label="City"
              className={SELECT_CLASS}
              value={filters.city}
              onChange={(e) => update({ city: e.target.value })}
            >
              <option value="">All cities</option>
              {cities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between text-sm text-theme-text-muted">
            <span>{loading ? 'Loading…' : `${results.length} event${results.length === 1 ? '' : 's'}`}</span>
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setQInput('');
                  setVisible(PAGE_SIZE);
                  setSearchParams({}, { replace: true });
                }}
                className="inline-flex items-center gap-1 hover:text-theme-text"
              >
                <X size={14} /> Clear filters
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-theme-text-muted" size={28} />
          </div>
        ) : error ? (
          <p className="text-center text-red-400 py-16">{error}</p>
        ) : results.length === 0 ? (
          <p className="text-center text-theme-text-muted py-16">No events match your search.</p>
        ) : (
          <>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {results.slice(0, visible).map((e) => (
                <li key={e.id}>
                  <Link
                    to={`/${e.slug}`}
                    className="block h-full p-4 bg-theme-surface border border-theme-stroke rounded-xl hover:border-[#ff393a] transition-colors"
                  >
                    <div className="font-semibold text-theme-text truncate">{e.name}</div>
                    <div className="mt-1 flex items-center gap-1 text-sm text-theme-text-muted">
                      <MapPin size={14} className="shrink-0" />
                      <span className="truncate">
                        {[e.venueName, e.city, e.country].filter(Boolean).join(', ')}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-theme-text-muted">
                      <span>{e.date ? formatShortDate(e.date) : 'Date TBD'}</span>
                      {e.rsvpCount > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Users size={12} /> {e.rsvpCount}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {visible < results.length && (
              <div className="flex justify-center mt-6">
                <button
                  type="button"
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                  className="px-5 py-2 rounded-xl border border-theme-stroke text-theme-text hover:border-[#ff393a]"
                >
                  Show more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
