import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, X } from 'lucide-react';
import { GPPClouds } from '../components/GPPClouds';
import { fetchGppPartners, fetchUnderbossMe, GPPPartner } from '../lib/api';
import { PartnersFilterBar } from '../components/PartnersFilterBar';
import {
  PartnersFilters,
  filtersToSearchParams,
  searchParamsToFilters,
} from './partnersUrlState';
import {
  PAYMENTS_REGION_SCOPES,
  PAYMENTS_REGION_DISPLAY_ORDER,
  PaymentsRegionPortal,
} from '../utils/regions';

// Reverse map: a party.region slug (e.g. 'west-africa') → its portal key
// (e.g. 'westafrica'). Built once from PAYMENTS_REGION_SCOPES so the Region
// filter operates on the PAYMENTS_REGION_LABELS buckets.
const REGION_SLUG_TO_PORTAL: Record<string, PaymentsRegionPortal> = (() => {
  const map: Record<string, PaymentsRegionPortal> = {};
  // Iterate in display order; the Africa overlap (south-africa appears in both
  // 'africa' and 'southafrica') resolves to the most specific single-country
  // portal because the specific ones come later in PAYMENTS_REGION_DISPLAY_ORDER.
  for (const portal of PAYMENTS_REGION_DISPLAY_ORDER) {
    for (const slug of PAYMENTS_REGION_SCOPES[portal]) {
      map[slug] = portal;
    }
  }
  return map;
})();

/** Map a party.region slug to its portal key (or null if unknown/empty). */
function regionPortalFor(region: string | null | undefined): PaymentsRegionPortal | null {
  if (!region) return null;
  return REGION_SLUG_TO_PORTAL[region] ?? null;
}

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
  // Logo tiles use a pale cool-gray (between Tailwind gray-100 #f3f4f6 and
  // slate-100 #f1f5f9) at 92% opacity — matches the visual gray of the
  // host event-settings cards (bg-theme-card in the GPP/light theme), sitting
  // as a near-white card on the sky-blue gradient.
  logoCardBg:'rgba(241, 243, 246, 0.92)',
  cardBorder:'rgba(0,0,0,0.08)',
};

export function PartnersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [partners, setPartners] = useState<GPPPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lazy-init filters from the URL once on mount (mirrors PaymentsAdminPage).
  // The ref captures the initial searchParams so a later setSearchParams (from
  // the serialize effect) doesn't re-seed state.
  const initialSearchParamsRef = useRef(searchParams);
  const [filters, setFilters] = useState<PartnersFilters>(() =>
    searchParamsToFilters(initialSearchParamsRef.current)
  );

  // Serialize filters → URL (diff-against-defaults keeps URLs short).
  useEffect(() => {
    setSearchParams(filtersToSearchParams(filters), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Role detection (default to all-false — 401 / network errors are silent)
  const [roles, setRoles] = useState<{ isAdmin: boolean; isUnderboss: boolean; isGraphicsAdmin: boolean }>({
    isAdmin: false,
    isUnderboss: false,
    isGraphicsAdmin: false,
  });

  // Active modal partner (null = closed)
  const [modalPartner, setModalPartner] = useState<GPPPartner | null>(null);

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

  // Role check on mount. 401 / network errors -> logged-out user, default all-false.
  useEffect(() => {
    fetchUnderbossMe()
      .then((me) => {
        setRoles({
          isAdmin: !!me.isAdmin,
          isUnderboss: !!me.isUnderboss,
          isGraphicsAdmin: !!me.isGraphicsAdmin,
        });
      })
      .catch(() => {
        // 401 for logged-out users is expected; ignore silently
      });
  }, []);

  const canClick = roles.isAdmin || roles.isUnderboss || roles.isGraphicsAdmin;

  // ESC closes modal
  useEffect(() => {
    if (!modalPartner) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalPartner(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalPartner]);

  // Click on an event row inside the modal -> navigate based on role.
  // Check isGraphicsAdmin FIRST (most specific role) — admins/underbosses who also
  // hold the graphics-admin flag go to the flyer editor; everyone else goes to
  // the public event page.
  const handleEventClick = (slug: string, sponsorId: string) => {
    if (roles.isGraphicsAdmin) {
      navigate('/graphics/' + slug + '/edit?openSponsor=' + sponsorId);
    } else {
      navigate('/' + slug);
    }
    setModalPartner(null);
  };

  const uniqueEventCount = useMemo(
    () => new Set(partners.flatMap((p) => p.events.map((e) => e.slug))).size,
    [partners]
  );

  // ── Filter option lists (derived from the loaded partners) ──────────────
  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          partners
            .map((p) => p.category)
            .filter((c): c is string => !!c && c.trim().length > 0)
        )
      ).sort(),
    [partners]
  );

  const cityOptions = useMemo(
    () =>
      Array.from(
        new Set(
          partners.flatMap((p) =>
            p.events.map((e) => e.city).filter((c): c is string => !!c && c.trim().length > 0)
          )
        )
      ).sort(),
    [partners]
  );

  const countryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          partners.flatMap((p) =>
            p.events
              .map((e) => e.country)
              .filter((c): c is string => !!c && c.trim().length > 0)
          )
        )
      ).sort(),
    [partners]
  );

  // Region options = the PAYMENTS_REGION_LABELS portal keys actually present in
  // the data (derived from each event's region slug). Ordered by the canonical
  // display order.
  const regionOptions = useMemo(() => {
    const present = new Set<string>();
    for (const p of partners) {
      for (const e of p.events) {
        const portal = regionPortalFor(e.region);
        if (portal) present.add(portal);
      }
    }
    return PAYMENTS_REGION_DISPLAY_ORDER.filter((portal) => present.has(portal));
  }, [partners]);

  // ── Visible (filtered + sorted) partners ────────────────────────────────
  const visiblePartners = useMemo(() => {
    const q = filters.search.trim().toLowerCase();

    const matches = partners.filter((p) => {
      // Search: name + description + twitter + instagram (case-insensitive).
      if (q) {
        const hay = [p.name, p.brandDescription, p.brandTwitter, p.brandInstagram]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      // Category equality.
      if (filters.category !== 'all' && p.category !== filters.category) return false;

      // any-event include / none-exclude semantics for city.
      if (filters.cityIncludes.length || filters.cityExcludes.length) {
        const cities = p.events.map((e) => e.city).filter(Boolean) as string[];
        if (filters.cityExcludes.length && cities.some((c) => filters.cityExcludes.includes(c))) {
          return false;
        }
        if (filters.cityIncludes.length && !cities.some((c) => filters.cityIncludes.includes(c))) {
          return false;
        }
      }

      // Region (portal-key buckets).
      if (filters.regionIncludes.length || filters.regionExcludes.length) {
        const portals = p.events
          .map((e) => regionPortalFor(e.region))
          .filter((r): r is PaymentsRegionPortal => !!r);
        if (filters.regionExcludes.length && portals.some((r) => filters.regionExcludes.includes(r))) {
          return false;
        }
        if (filters.regionIncludes.length && !portals.some((r) => filters.regionIncludes.includes(r))) {
          return false;
        }
      }

      // Country.
      if (filters.countryIncludes.length || filters.countryExcludes.length) {
        const countries = p.events.map((e) => e.country).filter(Boolean) as string[];
        if (filters.countryExcludes.length && countries.some((c) => filters.countryExcludes.includes(c))) {
          return false;
        }
        if (filters.countryIncludes.length && !countries.some((c) => filters.countryIncludes.includes(c))) {
          return false;
        }
      }

      return true;
    });

    // Sort. Default 'events_desc' reproduces the backend order (eventCount
    // DESC, then name ASC).
    const sorted = [...matches];
    switch (filters.sort) {
      case 'name_asc':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name_desc':
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'eventcount_asc':
        sorted.sort((a, b) =>
          a.eventCount !== b.eventCount ? a.eventCount - b.eventCount : a.name.localeCompare(b.name)
        );
        break;
      case 'events_desc':
      default:
        sorted.sort((a, b) =>
          b.eventCount !== a.eventCount ? b.eventCount - a.eventCount : a.name.localeCompare(b.name)
        );
        break;
    }
    return sorted;
  }, [partners, filters]);

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
          The orgs powering the 2026 Global Pizza Party
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
                {uniqueEventCount.toLocaleString()} events
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

        {/* Filter bar — admin / underboss / graphics-admin only. Public and
            logged-out viewers never see it. */}
        {!loading && !error && partners.length > 0 && canClick && (
          <>
            <PartnersFilterBar
              filters={filters}
              onChange={setFilters}
              categories={categoryOptions}
              cities={cityOptions}
              regions={regionOptions}
              countries={countryOptions}
            />
            <div className="mb-4 text-sm font-medium" style={{ color: C.mutedText }}>
              {visiblePartners.length.toLocaleString()} of {partners.length.toLocaleString()} partners
            </div>
          </>
        )}

        {!loading && !error && partners.length > 0 && canClick && visiblePartners.length === 0 && (
          <div className="flex items-center justify-center py-16 px-6">
            <div
              className="rounded-2xl px-6 py-5 border shadow-sm text-center"
              style={{ background: C.cardBg, borderColor: C.cardBorder }}
            >
              <p className="text-sm" style={{ color: C.mutedText }}>
                No partners match your filters — try clearing some.
              </p>
            </div>
          </div>
        )}

        {!loading && !error && partners.length > 0 && !(canClick && visiblePartners.length === 0) && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {(canClick ? visiblePartners : partners).map((partner) => {
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

              const pillText = (
                <>
                  in {partner.eventCount.toLocaleString()}{' '}
                  {partner.eventCount === 1 ? 'event' : 'events'}
                </>
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
                  {canClick && (
                    <div className="mt-1 flex justify-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setModalPartner(partner);
                        }}
                        className="inline-block text-[10px] font-bold rounded-full px-2 py-0.5 bg-[#E52828]/20 text-[#E52828] cursor-pointer hover:scale-105 transition-transform"
                      >
                        {pillText}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── EVENTS MODAL (admin/underboss/graphics-admin only) ─── */}
      {modalPartner && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setModalPartner(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              type="button"
              onClick={() => setModalPartner(null)}
              aria-label="Close"
              className="absolute top-3 right-3 z-10 p-2 rounded-full hover:bg-black/5 transition-colors"
              style={{ color: C.darkText }}
            >
              <X size={20} />
            </button>

            {/* Header */}
            <div className="flex items-center gap-4 p-5 border-b" style={{ borderColor: C.cardBorder }}>
              <div
                className="flex-shrink-0 w-16 h-16 rounded-lg flex items-center justify-center p-2"
                style={{ background: C.logoCardBg }}
              >
                <img
                  src={modalPartner.logoUrl}
                  alt={modalPartner.name}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <div className="flex-1 min-w-0 pr-8">
                <div
                  className="truncate"
                  style={{
                    fontFamily: "'Bangers', cursive",
                    fontSize: '1.6rem',
                    color: C.darkText,
                    letterSpacing: '0.02em',
                    lineHeight: 1.1,
                  }}
                >
                  {modalPartner.name}
                </div>
                <div className="text-xs mt-1" style={{ color: C.mutedText }}>
                  in {modalPartner.eventCount.toLocaleString()}{' '}
                  {modalPartner.eventCount === 1 ? 'event' : 'events'}
                </div>
              </div>
            </div>

            {/* Event list */}
            <div className="overflow-y-auto max-h-[60vh]">
              {modalPartner.events.length === 0 ? (
                <div className="p-6 text-center text-sm" style={{ color: C.mutedText }}>
                  No events to show.
                </div>
              ) : (
                <ul className="divide-y" style={{ borderColor: C.cardBorder }}>
                  {modalPartner.events.map((ev, idx) => (
                    <li key={`${ev.sponsorId}-${idx}`}>
                      <button
                        type="button"
                        onClick={() => handleEventClick(ev.slug, ev.sponsorId)}
                        className="w-full text-left px-5 py-3 hover:bg-black/5 transition-colors flex items-center justify-between gap-3"
                      >
                        <span className="font-semibold text-sm truncate" style={{ color: C.darkText }}>
                          {ev.city}
                        </span>
                        <span className="text-xs font-mono truncate" style={{ color: C.mutedText }}>
                          /{ev.slug}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
