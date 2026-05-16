import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Loader2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { fetchGppPartners, GPPPartner } from '../lib/api';

export function PartnersPage() {
  const [partners, setPartners] = useState<GPPPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPartners = () => {
    setLoading(true);
    setError(null);
    fetchGppPartners()
      .then((data) => {
        setPartners(data.partners || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch partners:', err);
        setError(err.message || 'Failed to load partners');
        setLoading(false);
      });
  };

  useEffect(() => {
    loadPartners();
  }, []);

  const totalEvents = partners.reduce((sum, p) => sum + p.eventCount, 0);

  return (
    <>
      <Helmet>
        <title>GPP Partners | RSV.Pizza</title>
        <meta
          name="description"
          content="Brands powering the Global Pizza Party 2026"
        />
      </Helmet>

      <Layout>
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={36} className="animate-spin text-[#E52828]" />
              <span className="text-sm font-medium text-theme-text-faint">
                Loading partners...
              </span>
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center justify-center py-24 px-6">
            <div className="flex flex-col items-center gap-3 bg-theme-surface rounded-2xl p-8 border border-theme-stroke">
              <p className="text-red-500 font-medium">{error}</p>
              <button
                onClick={loadPartners}
                className="px-5 py-2 rounded-xl text-sm font-medium text-white transition-all hover:-translate-y-0.5"
                style={{ background: '#E52828' }}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {!loading && !error && partners.length === 0 && (
          <div className="flex items-center justify-center py-24 px-6">
            <p className="text-sm text-theme-text-faint">
              No partners yet — check back soon
            </p>
          </div>
        )}

        {!loading && !error && partners.length > 0 && (
          <div className="max-w-6xl mx-auto px-6 py-8">
            <div className="flex justify-center mb-6">
              <div className="bg-theme-surface border border-theme-stroke rounded-full px-5 py-2">
                <span className="text-sm font-semibold">
                  {partners.length.toLocaleString()} partners across{' '}
                  {totalEvents.toLocaleString()} events
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {partners.map((partner) => {
                const tile = (
                  <div className="bg-theme-surface aspect-square flex items-center justify-center p-4 rounded-2xl border border-theme-stroke">
                    <img
                      src={partner.logoUrl}
                      alt={partner.name}
                      className="max-w-full max-h-full object-contain"
                      loading="lazy"
                    />
                  </div>
                );

                return (
                  <div key={`${partner.name}-${partner.logoUrl}`} className="flex flex-col">
                    {partner.website ? (
                      <a
                        href={partner.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        {tile}
                      </a>
                    ) : (
                      tile
                    )}
                    <div className="text-xs text-theme-text-faint mt-2 text-center">
                      {partner.name}
                    </div>
                    <div className="text-[10px] text-theme-text-faint mt-1 text-center opacity-70">
                      in {partner.eventCount.toLocaleString()}{' '}
                      {partner.eventCount === 1 ? 'event' : 'events'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Layout>
    </>
  );
}
