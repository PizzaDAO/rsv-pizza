import { useState, useEffect, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Loader2, Shield, RefreshCw } from 'lucide-react';
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
  const [accessChecked, setAccessChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadEvents = () => {
    setLoading(true);
    setError(null);
    fetchGppEventsForMap()
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
      const data = await fetchGppEventsForMap(true);
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
      setAccessChecked(true);
      return;
    }

    async function checkAccess() {
      try {
        const me = await fetchUnderbossMe();
        if (me.isAdmin || me.isUnderboss) {
          setAuthorized(true);
          loadEvents();
        } else {
          setAccessError('You are not authorized to view this page.');
        }
      } catch (err: any) {
        setAccessError(err.message || 'Failed to check access');
      } finally {
        setAccessChecked(true);
      }
    }

    checkAccess();
  }, [user, authLoading]);

  // Count unique cities
  const cityCount = new Set(events.map((e) => e.city)).size;

  return (
    <>
      <Helmet>
        <title>Global Pizza Party 2026 Map | RSV.Pizza</title>
        <meta
          name="description"
          content="See every Global Pizza Party 2026 event on the world map. Free pizza events on May 22, 2026, hosted worldwide."
        />
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
        </header>

        {/* Map area */}
        <div className="flex-1 relative">
          {(!accessChecked || authLoading) ? (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/30">
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={36} className="animate-spin text-[#E52828]" />
              </div>
            </div>
          ) : !user ? (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/30">
              <div className="bg-white rounded-2xl p-8 shadow-lg flex flex-col items-center gap-3">
                <Shield size={32} className="text-[#E52828]" />
                <h2 className="text-lg font-bold text-gray-800">Underboss access required</h2>
                <p className="text-sm text-gray-600 text-center max-w-xs">
                  Sign in with your underboss email to view the events map.
                </p>
                <button
                  onClick={() => setShowLoginModal(true)}
                  className="px-5 py-2 rounded-xl text-sm font-medium text-white transition-all hover:-translate-y-0.5"
                  style={{ background: '#E52828' }}
                >
                  Sign in
                </button>
              </div>
            </div>
          ) : accessError ? (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/30">
              <div className="bg-white rounded-2xl p-8 shadow-lg flex flex-col items-center gap-3">
                <p className="text-red-600 font-medium">{accessError}</p>
              </div>
            </div>
          ) : authorized ? (
            <>
              {loading && (
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
                      onClick={loadEvents}
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
                {!loading && !error && (
                  <GPPEventsMap
                    events={events}
                    height="calc(100vh - 64px)"
                  />
                )}
              </Suspense>
            </>
          ) : null}
        </div>
      </div>

      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </>
  );
}
