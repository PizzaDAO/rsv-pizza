import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Loader2 } from 'lucide-react';
import { GPPClouds } from '../components/GPPClouds';
import { fetchGppPartners, GPPPartner } from '../lib/api';

/* ── colour tokens (from the 2026 flyer) ────────────────── */
const C = {
  skyTop:    '#7EC8E3',
  skyBot:    '#B6E4F7',
  red:       '#E52828',
  redHover:  '#CC2020',
  green:     '#2E7D32',
  yellow:    '#FFD600',
  darkText:  '#1a1a1a',
  mutedText: '#555',
  cardBg:    'rgba(255,255,255,0.92)',
  // Logo tiles use a mid-gray so both white/cream and dark logos remain readable.
  logoCardBg:'rgba(160,160,160,0.92)',
  cardBorder:'rgba(0,0,0,0.08)',
};

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
    <div
      className="min-h-screen relative overflow-hidden"
      style={{ background: `linear-gradient(180deg, ${C.skyTop} 0%, ${C.skyBot} 100%)` }}
    >
      <GPPClouds />

      <Helmet>
        <title>GPP Partners | RSV.Pizza</title>
        <meta
          name="description"
          content="Brands powering the Global Pizza Party 2026"
        />
      </Helmet>

      {/* ─── LIGHT HEADER ─── */}
      <header className="border-b border-black/10 relative z-50 overflow-visible" style={{ background: 'rgba(255,255,255,0.95)' }}>
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <img src="/logo.png" alt="RSV.Pizza" className="h-8 sm:h-10" />
            <span
              className="hidden sm:inline"
              style={{ fontFamily: "'Bangers', cursive", fontSize: '1.3rem', color: C.darkText }}
            >
              RSV.Pizza
            </span>
          </a>
        </div>
      </header>

      {/* ─── HERO ─── */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 pt-10 md:pt-16 pb-6 text-center">
        <h1
          className="mb-3"
          style={{
            fontFamily: "'Bangers', cursive",
            fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
            color: C.darkText,
            letterSpacing: '0.02em',
            lineHeight: 1.05,
          }}
        >
          GPP Partners
        </h1>
        <p
          className="max-w-2xl mx-auto text-base md:text-lg mb-6"
          style={{ color: C.mutedText }}
        >
          The brands powering the 2026 Global Pizza Party — slinging slices in cities around the world.
        </p>

        {!loading && !error && partners.length > 0 && (
          <div className="flex justify-center">
            <div
              className="rounded-full px-5 py-2 border shadow-sm"
              style={{
                background: C.cardBg,
                borderColor: C.cardBorder,
                color: C.darkText,
              }}
            >
              <span className="text-sm font-semibold">
                {partners.length.toLocaleString()} partners across{' '}
                {totalEvents.toLocaleString()} events
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ─── BODY ─── */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 pb-16">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={36} className="animate-spin" style={{ color: C.red }} />
              <span className="text-sm font-medium" style={{ color: C.mutedText }}>
                Loading partners...
              </span>
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center justify-center py-16 px-6">
            <div
              className="flex flex-col items-center gap-3 rounded-2xl p-8 border shadow-lg"
              style={{ background: C.cardBg, borderColor: C.cardBorder }}
            >
              <p className="font-medium" style={{ color: C.red }}>{error}</p>
              <button
                onClick={loadPartners}
                className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
                style={{ background: C.red }}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {!loading && !error && partners.length === 0 && (
          <div className="flex items-center justify-center py-20 px-6">
            <div
              className="rounded-2xl px-6 py-5 border shadow-sm"
              style={{ background: C.cardBg, borderColor: C.cardBorder }}
            >
              <p className="text-sm" style={{ color: C.mutedText }}>
                No partners yet — check back soon
              </p>
            </div>
          </div>
        )}

        {!loading && !error && partners.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {partners.map((partner) => {
              const tile = (
                <div
                  className="aspect-square flex items-center justify-center p-4 rounded-2xl border shadow-lg transition-transform duration-200 hover:scale-105"
                  style={{ background: C.logoCardBg, borderColor: C.cardBorder }}
                >
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
                  <div
                    className="text-xs mt-2 text-center font-semibold"
                    style={{ color: C.darkText }}
                  >
                    {partner.name}
                  </div>
                  <div className="mt-1 flex justify-center">
                    <span className="inline-block text-[10px] font-bold rounded-full px-2 py-0.5 bg-[#E52828]/20 text-[#E52828]">
                      in {partner.eventCount.toLocaleString()}{' '}
                      {partner.eventCount === 1 ? 'event' : 'events'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
