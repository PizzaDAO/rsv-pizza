import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, ArrowRight, Loader2, RefreshCw, SlidersHorizontal, ThumbsUp, ThumbsDown } from 'lucide-react';
import { fetchGppEventsForMap, fetchUnderbossMe, GPPEventMapItem } from '../lib/api';
import { fetchSheetCities } from '../lib/cities';
import { useAuth } from '../contexts/AuthContext';
import { LoginModal } from '../components/LoginModal';

const GPPEventsMap = lazy(() => import('../components/GPPEventsMap'));

const STATUS_FILTER_KEYS = ['approved', 'pending', 'listed', 'rejected'] as const;
type StatusFilterKey = (typeof STATUS_FILTER_KEYS)[number];

// Semantic colors used by the marker icons + legend, keyed on underbossStatus.
// Keep in sync with STATUS_COLORS in GPPEventsMap.tsx.
const STATUS_LEGEND: { key: string; label: string; color: string }[] = [
  { key: 'approved', label: 'Approved', color: '#22c55e' },
  { key: 'listed', label: 'Listed', color: '#3b82f6' },
  { key: 'pending', label: 'Pending', color: '#eab308' },
  { key: 'rejected', label: 'Rejected', color: '#ef4444' },
  { key: 'hidden', label: 'Hidden', color: '#6b7280' },
];

export function EventsMapPage() {
  const { user, loading: authLoading } = useAuth();
  const [events, setEvents] = useState<GPPEventMapItem[]>([]);
  const [cityChats, setCityChats] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [canModerate, setCanModerate] = useState<boolean | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Moderator-only: toggle between curated (approved+listed) and all-events
  // (including rejected/hidden). Drives the backend `?statuses=all` request.
  const [showAll, setShowAll] = useState(false);

  // Filter state (only renders for moderators, but declared unconditionally for hook rules)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusIncludes, setStatusIncludes] = useState<string[]>([]);
  const [statusExcludes, setStatusExcludes] = useState<string[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const [debouncedSearchQ, setDebouncedSearchQ] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');

  const loadEvents = (moderator: boolean, includeAll: boolean) => {
    setLoading(true);
    setError(null);
    // Non-moderators always get the curated (approved+listed) view.
    // Moderators see the filtered (non-rejected/hidden) view by default and
    // can opt into the all-events view via the "Show all events" toggle.
    fetchGppEventsForMap(false, !moderator, moderator && includeAll)
      .then((data) => {
        setEvents(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch events:', err);
        setError(err.message || 'Failed to load events');
        setLoading(false);
      });
  };

  const refreshEvents = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const data = await fetchGppEventsForMap(
        true,
        !canModerate,
        !!canModerate && showAll
      );
      setEvents(data);
    } catch (err) {
      console.error('Failed to refresh events:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setCanModerate(false);
      loadEvents(false, false);
      return;
    }

    async function resolveModeratorStatus() {
      try {
        const me = await fetchUnderbossMe();
        const isMod = !!(me.isAdmin || me.isUnderboss);
        setCanModerate(isMod);
        loadEvents(isMod, showAll);
      } catch (err) {
        console.error('Failed to check moderator status:', err);
        setCanModerate(false);
        loadEvents(false, false);
      }
    }

    resolveModeratorStatus();
    // showAll intentionally omitted — toggle handled by separate effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  // Re-fetch when the moderator toggles "Show all events" on/off.
  // Skips the initial mount (handled by the auth effect above) and any
  // non-moderator render (toggle is hidden for non-mods).
  useEffect(() => {
    if (canModerate === null || !canModerate) return;
    loadEvents(true, showAll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

  // Debounce search input (200ms) — mirrors EventTable behavior.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearchQ(searchQ), 200);
    return () => clearTimeout(handle);
  }, [searchQ]);

  // Fetch city chat URLs once on mount (independent of auth).
  // Used as a fallback Telegram link when an event has no per-event override.
  useEffect(() => {
    fetchSheetCities()
      .then((cities) => {
        const map = new Map<string, string>();
        for (const c of cities) {
          if (c.chatUrl) map.set(c.city.toLowerCase().trim(), c.chatUrl);
        }
        setCityChats(map);
      })
      .catch(() => { /* silent — Telegram links just won't show */ });
  }, []);

  function getStatusFilterState(key: string): 'neutral' | 'include' | 'exclude' {
    if (statusIncludes.includes(key)) return 'include';
    if (statusExcludes.includes(key)) return 'exclude';
    return 'neutral';
  }

  function setStatusFilterState(key: string, newState: 'neutral' | 'include' | 'exclude') {
    setStatusIncludes((prev) => prev.filter((k) => k !== key));
    setStatusExcludes((prev) => prev.filter((k) => k !== key));
    if (newState === 'include') {
      setStatusIncludes((prev) => [...prev, key]);
    } else if (newState === 'exclude') {
      setStatusExcludes((prev) => [...prev, key]);
    }
  }

  const availableTags = useMemo(
    () => Array.from(new Set(events.flatMap((e) => e.eventTags ?? []))).sort(),
    [events]
  );
  const availableCountries = useMemo(
    () =>
      Array.from(
        new Set(
          events
            .map((e) => e.country)
            .filter((c): c is string => !!c)
        )
      ).sort(),
    [events]
  );

  // Match an event against a status key. "pending" treats null/undefined as pending too.
  function eventMatchesStatus(e: GPPEventMapItem, key: string): boolean {
    if (key === 'pending') {
      return e.underbossStatus === 'pending' || e.underbossStatus == null;
    }
    return e.underbossStatus === key;
  }

  const filteredEvents = useMemo(() => {
    let result = events;

    if (statusIncludes.length > 0) {
      result = result.filter((e) => statusIncludes.every((k) => eventMatchesStatus(e, k)));
    }
    if (statusExcludes.length > 0) {
      result = result.filter((e) => statusExcludes.every((k) => !eventMatchesStatus(e, k)));
    }

    const q = debouncedSearchQ.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (e) =>
          e.name?.toLowerCase().includes(q) ||
          e.city?.toLowerCase().includes(q) ||
          e.venueName?.toLowerCase().includes(q) ||
          e.address?.toLowerCase().includes(q) ||
          e.country?.toLowerCase().includes(q)
      );
    }

    if (tagFilter !== 'all') {
      result = result.filter((e) => e.eventTags?.includes(tagFilter));
    }

    if (countryFilter !== 'all') {
      result = result.filter((e) => e.country === countryFilter);
    }

    return result;
  }, [events, statusIncludes, statusExcludes, debouncedSearchQ, tagFilter, countryFilter]);

  const activeFilterCount =
    statusIncludes.length +
    statusExcludes.length +
    (debouncedSearchQ.trim() === '' ? 0 : 1) +
    (tagFilter !== 'all' ? 1 : 0) +
    (countryFilter !== 'all' ? 1 : 0);

  function clearFilters() {
    setStatusIncludes([]);
    setStatusExcludes([]);
    setSearchQ('');
    setDebouncedSearchQ('');
    setTagFilter('all');
    setCountryFilter('all');
  }

  // Count unique cities (use full events count for the non-moderator pill,
  // filteredEvents for the moderator "X of Y" pill).
  const cityCount = useMemo(() => new Set(events.map((e) => e.city)).size, [events]);
  const countryCount = useMemo(
    () =>
      new Set(
        events
          .map((e) => e.country)
          .filter((c): c is string => !!c && c.trim() !== '')
      ).size,
    [events]
  );
  const filteredCityCount = useMemo(
    () => new Set(filteredEvents.map((e) => e.city)).size,
    [filteredEvents]
  );
  const filteredCountryCount = useMemo(
    () =>
      new Set(
        filteredEvents
          .map((e) => e.country)
          .filter((c): c is string => !!c && c.trim() !== '')
      ).size,
    [filteredEvents]
  );

  return (
    <>
      <Helmet>
        <title>Global Pizza Party 2026 Map | RSV.Pizza</title>
        <meta
          name="description"
          content="See every Global Pizza Party 2026 event on the world map — find a free pizza event near you on May 22, 2026."
        />
        <link rel="canonical" href="https://rsv.pizza/map" />
        <meta property="og:title" content="Global Pizza Party 2026 Map | RSV.Pizza" />
        <meta
          property="og:description"
          content="See every Global Pizza Party 2026 event on the world map — find a free pizza event near you on May 22, 2026."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://rsv.pizza/map" />
        <meta property="og:image" content="https://rsv.pizza/gpp-flyer-2026-og.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="https://rsv.pizza/gpp-flyer-2026-og.jpg" />
      </Helmet>

      <div
        className="min-h-screen flex flex-col"
        style={{
          background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)',
        }}
      >
        {/* Header */}
        <header className="flex items-center gap-4 px-4 py-3 sm:px-6" style={{ height: 64 }}>
          <Link
            to="/gpp"
            className="flex items-center gap-1.5 text-sm font-medium text-white/80 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            Back to GPP
          </Link>
          <h1 className="text-lg font-bold text-white tracking-tight">
            GPP 2026 Map
          </h1>
          <Link
            to="/gpp"
            className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
            style={{ background: '#E52828' }}
          >
            Host one
            <ArrowRight size={14} />
          </Link>
        </header>

        {/* Map area */}
        <div className="flex-1 relative">
          {(authLoading || canModerate === null || loading) && !error && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/30">
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={36} className="animate-spin text-[#E52828]" />
                <span className="text-sm font-medium text-gray-700">
                  Loading events...
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/30">
              <div className="flex flex-col items-center gap-3 bg-white rounded-2xl p-8 shadow-lg">
                <p className="text-red-600 font-medium">{error}</p>
                <button
                  onClick={() => loadEvents(!!canModerate, !!canModerate && showAll)}
                  className="px-5 py-2 rounded-xl text-sm font-medium text-white transition-all hover:-translate-y-0.5"
                  style={{ background: '#E52828' }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* "Show all events" toggle — moderators only */}
          {canModerate && !loading && !error && (
            <div className="absolute top-3 right-3 z-10">
              <button
                onClick={() => setShowAll((v) => !v)}
                className="bg-white/90 backdrop-blur-sm rounded-full px-4 py-2 shadow-lg border border-white/50 text-sm font-semibold text-gray-800 hover:bg-white transition"
                aria-pressed={showAll}
              >
                {showAll ? 'Show approved only' : 'Show all events'}
              </button>
            </div>
          )}

          {/* Status legend — moderator-only, shown when viewing all events */}
          {canModerate && showAll && !loading && !error && (
            <div className="absolute bottom-3 left-3 z-10">
              <div className="bg-white/90 backdrop-blur-sm rounded-xl px-3 py-2 shadow-lg border border-white/50">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">
                  Status
                </div>
                <div className="flex flex-col gap-1">
                  {STATUS_LEGEND.map((s) => (
                    <div key={s.key} className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full border border-white"
                        style={{ background: s.color }}
                      />
                      <span className="text-xs text-gray-800">{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Floating stats badge */}
          {!loading && !error && events.length > 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-white/90 backdrop-blur-sm rounded-full pl-5 pr-2 py-1.5 shadow-lg border border-white/50 flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800">
                  {canModerate && activeFilterCount > 0 ? (
                    <>
                      {filteredEvents.length.toLocaleString()} of{' '}
                      {events.length.toLocaleString()} events across{' '}
                      {filteredCityCount} {filteredCityCount === 1 ? 'city' : 'cities'}
                      {filteredCountryCount > 0 && (
                        <>
                          {' '}in {filteredCountryCount}{' '}
                          {filteredCountryCount === 1 ? 'country' : 'countries'}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {events.length.toLocaleString()} events across{' '}
                      {cityCount} {cityCount === 1 ? 'city' : 'cities'}
                      {countryCount > 0 && (
                        <>
                          {' '}in {countryCount}{' '}
                          {countryCount === 1 ? 'country' : 'countries'}
                        </>
                      )}
                    </>
                  )}
                </span>
                {canModerate && (
                  <button
                    onClick={() => setFiltersOpen((v) => !v)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                      activeFilterCount > 0
                        ? 'bg-[#E52828]/10 text-[#E52828] hover:bg-[#E52828]/15'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                    aria-label="Toggle filters"
                  >
                    <SlidersHorizontal size={12} />
                    Filters ({activeFilterCount})
                  </button>
                )}
                <button
                  onClick={refreshEvents}
                  disabled={isRefreshing}
                  className="p-1.5 rounded-full text-gray-600 hover:text-[#E52828] hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Refresh events"
                  aria-label="Refresh events"
                >
                  <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>
          )}

          {/* Filter panel — moderator only */}
          {canModerate && filtersOpen && !loading && !error && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 w-[calc(100vw-2rem)] max-w-[640px]">
              <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl border border-white/50 p-4 space-y-3">
                {/* Status row */}
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    Status
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {STATUS_FILTER_KEYS.map((key) => {
                      const state = getStatusFilterState(key);
                      return (
                        <div
                          key={key}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${
                            state === 'include'
                              ? 'bg-[#39d98a]/20 border-[#39d98a]/40'
                              : state === 'exclude'
                                ? 'bg-[#ff393a]/20 border-[#ff393a]/40'
                                : 'bg-gray-50 border-gray-200'
                          }`}
                        >
                          <button
                            onClick={() =>
                              setStatusFilterState(key, state === 'include' ? 'neutral' : 'include')
                            }
                            className="flex items-center gap-1.5 flex-1 py-0.5 hover:opacity-70 transition-opacity"
                            title={`Must be ${key}`}
                          >
                            <ThumbsUp
                              size={12}
                              className={`transition-all ${
                                state === 'include' ? 'text-[#39d98a]' : 'text-gray-400'
                              }`}
                            />
                            <span className="text-gray-800 text-xs capitalize">{key}</span>
                          </button>
                          <button
                            onClick={() =>
                              setStatusFilterState(key, state === 'exclude' ? 'neutral' : 'exclude')
                            }
                            className="p-0.5 hover:opacity-70 transition-opacity"
                            title={`Must NOT be ${key}`}
                          >
                            <ThumbsDown
                              size={12}
                              className={`transition-all ${
                                state === 'exclude' ? 'text-[#ff393a]' : 'text-gray-400'
                              }`}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Search row */}
                <div>
                  <input
                    type="text"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="Search by city, host, venue…"
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm placeholder:text-gray-400 focus:outline-none focus:border-gray-300"
                  />
                </div>

                {/* Tag row */}
                <div>
                  <select
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-gray-300"
                  >
                    <option value="all">All tags</option>
                    {availableTags.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Country row */}
                <div>
                  <select
                    value={countryFilter}
                    onChange={(e) => setCountryFilter(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-gray-300"
                  >
                    <option value="all">All countries</option>
                    {availableCountries.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Footer — Clear filters link */}
                {activeFilterCount > 0 && (
                  <div className="flex justify-end">
                    <button
                      onClick={clearFilters}
                      className="text-xs text-[#E52828] hover:underline"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <Suspense
            fallback={
              <div
                className="flex items-center justify-center"
                style={{ height: 'calc(100vh - 64px)' }}
              >
                <Loader2 size={36} className="animate-spin text-[#E52828]" />
              </div>
            }
          >
            {!loading && !error && canModerate !== null && (
              <GPPEventsMap
                events={canModerate ? filteredEvents : events}
                cityChats={cityChats}
                height="calc(100vh - 64px)"
                canModerate={canModerate}
                isModerator={!!canModerate}
              />
            )}
          </Suspense>
        </div>
      </div>

      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </>
  );
}
