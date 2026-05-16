import { useState, useEffect, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { fetchGppEventsForMap, fetchUnderbossMe, GPPEventMapItem } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { LoginModal } from '../components/LoginModal';

const GPPEventsMap = lazy(() => import('../components/GPPEventsMap'));

export function EventsMapPage() {
  const { user, loading: authLoading } = useAuth();
  const [events, setEvents] = useState<GPPEventMapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [canModerate, setCanModerate] = useState<boolean | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadEvents = (moderator: boolean) => {
    setLoading(true);
    setError(null);
    fetchGppEventsForMap(false, !moderator)
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
      const data = await fetchGppEventsForMap(true, !canModerate);
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
      loadEvents(false);
      return;
    }

    async function resolveModeratorStatus() {
      try {
        const me = await fetchUnderbossMe();
        const isMod = !!(me.isAdmin || me.isUnderboss);
        setCanModerate(isMod);
        loadEvents(isMod);
      } catch (err) {
        console.error('Failed to check moderator status:', err);
        setCanModerate(false);
        loadEvents(false);
      }
    }

    resolveModeratorStatus();
  }, [user, authLoading]);

  // Count unique cities
  const cityCount = new Set(events.map((e) => e.city)).size;

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
                  onClick={() => loadEvents(!!canModerate)}
                  className="px-5 py-2 rounded-xl text-sm font-medium text-white transition-all hover:-translate-y-0.5"
                  style={{ background: '#E52828' }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Floating stats badge */}
          {!loading && !error && events.length > 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-white/90 backdrop-blur-sm rounded-full pl-5 pr-2 py-1.5 shadow-lg border border-white/50 flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800">
                  {events.length.toLocaleString()} events across{' '}
                  {cityCount} {cityCount === 1 ? 'city' : 'cities'}
                </span>
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
                events={events}
                height="calc(100vh - 64px)"
                canModerate={canModerate}
              />
            )}
          </Suspense>
        </div>
      </div>

      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </>
  );
}
