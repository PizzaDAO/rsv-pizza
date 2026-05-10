import { useState, useEffect, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { fetchGppPizzerias, GPPPizzeriaMapItem } from '../lib/api';

const GPPPizzeriasMap = lazy(() => import('../components/GPPPizzeriasMap'));

export function GPPPizzeriasPage() {
  const [pizzerias, setPizzerias] = useState<GPPPizzeriaMapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPizzerias = () => {
    setLoading(true);
    setError(null);
    fetchGppPizzerias()
      .then((data) => {
        setPizzerias(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch pizzerias:', err);
        setError(err.message || 'Failed to load pizzerias');
        setLoading(false);
      });
  };

  useEffect(() => {
    loadPizzerias();
  }, []);

  // Count unique cities
  const cityCount = new Set(pizzerias.map((p) => p.eventCity)).size;

  return (
    <>
      <Helmet>
        <title>GPP Pizzerias Map | RSV.Pizza</title>
        <meta
          name="description"
          content="Explore all pizzerias participating in the Global Pizza Party worldwide."
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
            GPP Pizzerias
          </h1>
        </header>

        {/* Map area */}
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/30">
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={36} className="animate-spin text-[#E52828]" />
                <span className="text-sm font-medium text-gray-700">
                  Loading pizzerias...
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/30">
              <div className="flex flex-col items-center gap-3 bg-white rounded-2xl p-8 shadow-lg">
                <p className="text-red-600 font-medium">{error}</p>
                <button
                  onClick={loadPizzerias}
                  className="px-5 py-2 rounded-xl text-sm font-medium text-white transition-all hover:-translate-y-0.5"
                  style={{ background: '#E52828' }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Floating stats badge */}
          {!loading && !error && pizzerias.length > 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-white/90 backdrop-blur-sm rounded-full px-5 py-2 shadow-lg border border-white/50">
                <span className="text-sm font-semibold text-gray-800">
                  {pizzerias.length.toLocaleString()} pizzerias across{' '}
                  {cityCount} {cityCount === 1 ? 'city' : 'cities'}
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
              <GPPPizzeriasMap
                pizzerias={pizzerias}
                height="calc(100vh - 64px)"
              />
            )}
          </Suspense>
        </div>
      </div>
    </>
  );
}
