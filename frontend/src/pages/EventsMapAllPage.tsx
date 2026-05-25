import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { fetchGppEventsForMap, GPPEventMapItem } from '../lib/api';

const GPPEventsMap = lazy(() => import('../components/GPPEventsMap'));

// focaccia-58293: public no-clustering variant of /map. Renders the same
// curated public payload as /map (events whose underbossStatus is NOT
// rejected/hidden) but disables marker clustering so every event shows as
// an individual Benny pin at every zoom level.
export function EventsMapAllPage() {
  const [events, setEvents] = useState<GPPEventMapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    // Approved-only (curated=true filters client-side to underbossStatus === 'approved').
    fetchGppEventsForMap(false, true)
      .then((data) => {
        setEvents(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch events:', err);
        setError(err.message || 'Failed to load events');
        setLoading(false);
      });
  }, []);

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

  return (
    <>
      <Helmet>
        <title>Global Pizza Party 2026 Map — All Pins | RSV.Pizza</title>
        <meta
          name="description"
          content="Every Global Pizza Party 2026 event as an individual pin (no clustering) — see every free pizza event on the world map for May 22, 2026."
        />
        <link rel="canonical" href="https://rsv.pizza/map/all" />
        <meta property="og:title" content="Global Pizza Party 2026 Map — All Pins | RSV.Pizza" />
        <meta
          property="og:description"
          content="Every Global Pizza Party 2026 event as an individual pin (no clustering) — see every free pizza event on the world map for May 22, 2026."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://rsv.pizza/map/all" />
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
        <header className="flex items-center gap-4 px-4 py-3 sm:px-6" style={{ height: 64 }}>
          <Link
            to="/gpp"
            className="flex items-center gap-1.5 text-sm font-medium text-white/80 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            Back to GPP
          </Link>
          <h1 className="text-lg font-bold text-white tracking-tight">
            GPP 2026 Map — All Pins
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

        <div className="flex-1 relative">
          {loading && !error && (
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
              </div>
            </div>
          )}

          {!loading && !error && events.length > 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-white/90 backdrop-blur-sm rounded-full px-5 py-1.5 shadow-lg border border-white/50 flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800">
                  {events.length.toLocaleString()} events across{' '}
                  {cityCount} {cityCount === 1 ? 'city' : 'cities'}
                  {countryCount > 0 && (
                    <>
                      {' '}in {countryCount}{' '}
                      {countryCount === 1 ? 'country' : 'countries'}
                    </>
                  )}
                </span>
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
            {!loading && !error && (
              <GPPEventsMap
                events={events}
                height="calc(100vh - 64px)"
                cluster={false}
              />
            )}
          </Suspense>
        </div>
      </div>
    </>
  );
}
