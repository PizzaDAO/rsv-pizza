import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { fetchGppEventsForMap, fetchUnderbossMe, GPPEventMapItem } from '../lib/api';
import { fetchSheetCities } from '../lib/cities';
import { useAuth } from '../contexts/AuthContext';
import { LoginModal } from '../components/LoginModal';

const GPPEventsMap = lazy(() => import('../components/GPPEventsMap'));

// cacciatore-72814: super-admin-only variant of /map showing SWC-flagged GPP events.
// Pin is the composite Molto Benny + SWC crypto-shield-on-a-stand.
export function EventsMapSwcPage() {
  const { user, loading: authLoading } = useAuth();
  const [events, setEvents] = useState<GPPEventMapItem[]>([]);
  const [cityChats, setCityChats] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  // null = unknown (still resolving), true = super admin, false = not super admin
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setIsSuperAdmin(false);
      return;
    }

    async function resolveAdminStatus() {
      try {
        const me = await fetchUnderbossMe();
        setIsSuperAdmin(me.isAdmin === true);
      } catch (err) {
        console.error('Failed to check admin status:', err);
        setIsSuperAdmin(false);
      }
    }

    resolveAdminStatus();
  }, [user, authLoading]);

  // Fetch SWC-only events once we've confirmed super-admin access.
  useEffect(() => {
    if (isSuperAdmin !== true) return;
    setLoading(true);
    setError(null);
    fetchGppEventsForMap(false, false, false, true)
      .then((data) => {
        setEvents(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch SWC events:', err);
        setError(err.message || 'Failed to load events');
        setLoading(false);
      });
  }, [isSuperAdmin]);

  // Fetch city chat URLs once on mount (independent of auth).
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

  const cityCount = useMemo(() => new Set(events.map((e) => e.city)).size, [events]);

  const showLoadingState = authLoading || isSuperAdmin === null || (isSuperAdmin === true && loading);
  const showGate = !authLoading && isSuperAdmin === false;

  return (
    <>
      <Helmet>
        <title>SWC Cities Map | RSV.Pizza</title>
        <meta name="robots" content="noindex" />
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
            SWC Cities Map
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
          {showLoadingState && !error && (
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

          {showGate && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/30">
              <div className="flex flex-col items-center gap-4 bg-white rounded-2xl p-8 shadow-lg max-w-sm text-center">
                <h2 className="text-lg font-bold text-gray-900">
                  Super admin access required
                </h2>
                <p className="text-sm text-gray-600">
                  {user
                    ? 'Your account doesn’t have super admin permissions for the SWC cities map.'
                    : 'Sign in with a super admin account to view the SWC cities map.'}
                </p>
                {!user && (
                  <button
                    onClick={() => setShowLoginModal(true)}
                    className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
                    style={{ background: '#E52828' }}
                  >
                    Sign in
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Floating stats badge */}
          {isSuperAdmin === true && !loading && !error && events.length > 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-white/90 backdrop-blur-sm rounded-full px-5 py-1.5 shadow-lg border border-white/50 flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800">
                  {events.length.toLocaleString()} events across{' '}
                  {cityCount} SWC {cityCount === 1 ? 'city' : 'cities'}
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
            {isSuperAdmin === true && !loading && !error && (
              <GPPEventsMap
                events={events}
                cityChats={cityChats}
                height="calc(100vh - 64px)"
                canModerate
                isModerator={false}
                iconUrl="/molto-benny-swc.svg"
                iconWidth={64}
                iconHeight={32}
                iconAnchorX={14}
                iconAnchorY={32}
                cluster={false}
              />
            )}
          </Suspense>
        </div>
      </div>

      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </>
  );
}
