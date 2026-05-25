import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, Play, MapPin, ChevronLeft, ChevronRight, ChevronDown, Check, Search, X } from 'lucide-react';
import { Layout } from '../components/Layout';
import { cdnUrl } from '../lib/supabase';
import {
  getPhotosFeed,
  getPhotosFeedFacets,
  getMyPartnerTags,
  FeedPhoto,
} from '../lib/api';
import { countryNameToAlpha2, alpha2ToCountryNames, alpha2ToCanonicalName } from '../utils/countryFlag';
import { gppCityBySlug } from '../utils/gppCity';
import { GPP_REGIONS, GPPRegion } from '../types';

const FLAG_BASE = 'https://cdn.jsdelivr.net/npm/circle-flags@2.8.3/flags';

function CircleFlag({ country, code, size = 14 }: { country?: string | null; code?: string | null; size?: number }) {
  const c = code ?? countryNameToAlpha2(country ?? null);
  if (!c) return null;
  return (
    <img
      src={`${FLAG_BASE}/${c}.svg`}
      alt={country || c}
      width={size}
      height={size}
      loading="lazy"
      className="rounded-full inline-block shrink-0"
      style={{ width: size, height: size }}
    />
  );
}

// --- URL <-> state helpers (sicilian-58129) ----------------------------------

function parseCsvParam(v: string | null): string[] {
  if (!v) return [];
  return Array.from(new Set(v.split(',').map((s) => s.trim()).filter(Boolean)));
}

// -----------------------------------------------------------------------------

export function PhotosFeedPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Filter state — initialized from URL once on mount.
  const [activeCountries, setActiveCountries] = useState<string[]>(() => parseCsvParam(searchParams.get('countries')));
  const [activeRegions, setActiveRegions] = useState<string[]>(() => parseCsvParam(searchParams.get('regions')));
  const [activePartnerTag, setActivePartnerTag] = useState<string | null>(() => searchParams.get('partnerTag') || null);

  // Facets + partner tags
  const [facetCountries, setFacetCountries] = useState<Array<{ name: string; count: number }>>([]);
  const [myPartnerTags, setMyPartnerTags] = useState<string[]>([]);

  // Feed
  const [photos, setPhotos] = useState<FeedPhoto[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);

  // Refs that reflect the latest filter values — used inside loadPage so that
  // the same memoized callback always reads the current filters without
  // becoming stale.
  const countriesRef = useRef(activeCountries);
  const regionsRef = useRef(activeRegions);
  const partnerTagRef = useRef(activePartnerTag);
  countriesRef.current = activeCountries;
  regionsRef.current = activeRegions;
  partnerTagRef.current = activePartnerTag;

  // Sync filter state -> URL so refresh / sharing work.
  useEffect(() => {
    const next = new URLSearchParams();
    if (activeCountries.length > 0) next.set('countries', activeCountries.join(','));
    if (activeRegions.length > 0) next.set('regions', activeRegions.join(','));
    if (activePartnerTag) next.set('partnerTag', activePartnerTag);
    // Replace (don't push) to keep history clean.
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCountries, activeRegions, activePartnerTag]);

  // Build the raw-country list to send to the backend by expanding each
  // selected alpha-2 to all known locale variants intersected with what
  // actually exists in the facet data (so we don't push 30 unused names).
  const buildCountriesForBackend = useCallback((codes: string[]): string[] => {
    if (codes.length === 0) return [];
    const facetSet = new Set(facetCountries.map((c) => c.name));
    const out = new Set<string>();
    for (const code of codes) {
      const variants = alpha2ToCountryNames(code);
      for (const v of variants) {
        if (facetSet.has(v)) out.add(v);
      }
      // Fallback: if no facet variants matched (e.g. facets not loaded yet),
      // still send all known variants so the backend can match.
      if (out.size === 0) {
        for (const v of variants) out.add(v);
      }
    }
    return Array.from(out);
  }, [facetCountries]);

  const loadPage = useCallback(async (isInitial: boolean) => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    if (isInitial) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      const filters = {
        countries: buildCountriesForBackend(countriesRef.current),
        regions: regionsRef.current,
        partnerTag: partnerTagRef.current,
      };
      const res = await getPhotosFeed(cursorRef.current, 24, filters);
      if (!res) {
        setError('Could not load photos right now.');
        hasMoreRef.current = false;
        setHasMore(false);
      } else {
        setPhotos((prev) => (isInitial ? res.photos : [...prev, ...res.photos]));
        cursorRef.current = res.nextCursor;
        hasMoreRef.current = !!res.nextCursor;
        setHasMore(!!res.nextCursor);
      }
    } catch {
      setError('Could not load photos right now.');
    } finally {
      loadingRef.current = false;
      if (isInitial) setLoading(false); else setLoadingMore(false);
    }
  }, [buildCountriesForBackend]);

  // Reset + reload whenever a filter changes.
  const filterKey = useMemo(
    () => `${activeCountries.slice().sort().join(',')}|${activeRegions.slice().sort().join(',')}|${activePartnerTag || ''}`,
    [activeCountries, activeRegions, activePartnerTag]
  );

  useEffect(() => {
    cursorRef.current = null;
    hasMoreRef.current = true;
    setPhotos([]);
    setHasMore(true);
    loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // Fetch facets once on mount.
  useEffect(() => {
    let cancelled = false;
    getPhotosFeedFacets().then((res) => {
      if (cancelled || !res) return;
      setFacetCountries(res.countries);
    });
    return () => { cancelled = true; };
  }, []);

  // Fetch partner tags once on mount (gracefully handles anon).
  useEffect(() => {
    let cancelled = false;
    getMyPartnerTags().then((res) => {
      if (cancelled || !res) return;
      setMyPartnerTags(res.tags || []);
    });
    return () => { cancelled = true; };
  }, []);

  // Infinite scroll sentinel.
  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadPage(false);
    }, { rootMargin: '600px 0px' });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [loadPage]);

  // Lightbox keyboard nav.
  useEffect(() => {
    if (selectedIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedIdx(null);
      else if (e.key === 'ArrowLeft') {
        setSelectedIdx((i) => (i !== null && i > 0 ? i - 1 : i));
      } else if (e.key === 'ArrowRight') {
        setSelectedIdx((i) => (i !== null && i < photos.length - 1 ? i + 1 : i));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIdx, photos.length]);

  // Country facet — collapse locale variants into one entry per alpha-2.
  const countryOptions = useMemo(() => {
    const byCode = new Map<string, { code: string; name: string; count: number; rawNames: Set<string> }>();
    for (const c of facetCountries) {
      const alpha2 = countryNameToAlpha2(c.name);
      const code = alpha2 ? alpha2.toUpperCase() : `__unmapped__${c.name}`;
      const existing = byCode.get(code);
      if (existing) {
        existing.count += c.count;
        existing.rawNames.add(c.name);
      } else {
        byCode.set(code, {
          code,
          name: alpha2 ? alpha2ToCanonicalName(code) : c.name,
          count: c.count,
          rawNames: new Set([c.name]),
        });
      }
    }
    return Array.from(byCode.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [facetCountries]);

  const clearAllFilters = () => {
    setActiveCountries([]);
    setActiveRegions([]);
    setActivePartnerTag(null);
  };

  const anyFiltersActive = activeCountries.length > 0 || activeRegions.length > 0 || !!activePartnerTag;

  return (
    <Layout>
      <Helmet>
        <title>Photos from Pizza Parties Around the World | RSV.Pizza</title>
        <meta name="description" content="A live feed of starred photos from approved pizza parties hosted around the world." />
        <meta property="og:title" content="Pizza Party Photos" />
        <meta property="og:description" content="A live feed of starred photos from approved pizza parties hosted around the world." />
      </Helmet>

      <div className="max-w-[1400px] mx-auto px-4 py-8">
        <header className="mb-4">
          <h1 className="text-3xl font-bold text-theme-text">Photos</h1>
          <p className="text-theme-text-secondary mt-1">Highlights from pizza parties around the world.</p>
        </header>

        {/* Sticky filter bar */}
        <div className="sticky top-0 z-30 -mx-4 px-4 py-3 mb-4 bg-theme-bg/95 backdrop-blur-sm border-b border-theme-stroke flex flex-wrap items-center gap-2">
          <CountryFilterButton
            options={countryOptions}
            selected={activeCountries}
            onChange={setActiveCountries}
          />
          <RegionFilterButton
            selected={activeRegions}
            onChange={setActiveRegions}
          />
          {myPartnerTags.length > 0 && (
            <PartnerFilterButton
              tags={myPartnerTags}
              selected={activePartnerTag}
              onChange={setActivePartnerTag}
            />
          )}
          {anyFiltersActive && (
            <button
              onClick={clearAllFilters}
              className="ml-auto text-sm text-theme-text-muted hover:text-theme-text inline-flex items-center gap-1"
            >
              <X size={14} />
              Clear filters
            </button>
          )}
        </div>

        {loading && photos.length === 0 ? (
          <SkeletonGrid />
        ) : photos.length === 0 ? (
          <EmptyState anyFiltersActive={anyFiltersActive} onClear={clearAllFilters} />
        ) : (
          <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-3">
            {photos.map((p, idx) => <FeedTile key={p.id} photo={p} onOpen={() => setSelectedIdx(idx)} />)}
          </div>
        )}

        <div ref={sentinelRef} className="h-12" />
        {loadingMore && (
          <div className="flex justify-center py-6">
            <Loader2 className="w-6 h-6 text-theme-text-muted animate-spin" />
          </div>
        )}
        {error && (
          <div className="text-center py-6">
            <p className="text-amber-400">{error}</p>
            <button onClick={() => { hasMoreRef.current = true; setHasMore(true); loadPage(false); }} className="mt-2 underline text-theme-text">Try again</button>
          </div>
        )}
      </div>

      {selectedIdx !== null && photos[selectedIdx] && (
        <FeedLightbox
          photo={photos[selectedIdx]}
          hasPrev={selectedIdx > 0}
          hasNext={selectedIdx < photos.length - 1}
          onPrev={() => setSelectedIdx((i) => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() => setSelectedIdx((i) => (i !== null && i < photos.length - 1 ? i + 1 : i))}
          onClose={() => setSelectedIdx(null)}
        />
      )}
    </Layout>
  );
}

// --- Filter bar buttons ------------------------------------------------------

function FilterDropdownShell({
  label,
  count,
  open,
  onToggle,
  children,
  panelClassName = '',
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  panelClassName?: string;
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors ${
          count > 0
            ? 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20'
            : 'bg-theme-surface border-theme-stroke text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text'
        }`}
      >
        <span>{label}</span>
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-red-500 text-white">
            {count}
          </span>
        )}
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onToggle} />
          <div className={`absolute top-full left-0 mt-2 z-50 bg-theme-card border border-theme-stroke rounded-xl shadow-2xl py-2 min-w-[260px] max-h-[60vh] overflow-y-auto ${panelClassName}`}>
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function CountryFilterButton({
  options, selected, onChange,
}: {
  options: Array<{ code: string; name: string; count: number; rawNames: Set<string> }>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (code: string) => {
    if (selected.includes(code)) onChange(selected.filter((c) => c !== code));
    else onChange([...selected, code]);
  };

  return (
    <FilterDropdownShell
      label="Country"
      count={selected.length}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      panelClassName="w-[300px]"
    >
      <div className="px-3 pb-2 sticky top-0 bg-theme-card border-b border-theme-stroke">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-theme-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search countries..."
            className="w-full pl-7 pr-2 py-1.5 text-sm bg-theme-surface border border-theme-stroke rounded-lg text-theme-text placeholder-theme-text-muted focus:outline-none focus:border-red-500/40"
          />
        </div>
      </div>
      {selected.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="w-full text-left px-4 py-2 text-xs text-theme-text-faint hover:bg-theme-surface transition-colors"
        >
          Clear ({selected.length})
        </button>
      )}
      {filtered.length === 0 ? (
        <div className="px-4 py-3 text-sm text-theme-text-muted">No matches</div>
      ) : (
        filtered.map((opt) => {
          const isSel = selected.includes(opt.code);
          return (
            <button
              key={opt.code}
              onClick={() => toggle(opt.code)}
              className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2 ${
                isSel
                  ? 'text-red-500 font-medium'
                  : 'text-theme-text-secondary hover:bg-theme-surface hover:text-theme-text'
              }`}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                isSel ? 'bg-red-500 border-red-500' : 'border-theme-stroke-hover'
              }`}>
                {isSel && <Check size={12} className="text-theme-text" />}
              </div>
              {opt.code.startsWith('__unmapped__')
                ? <MapPin size={14} className="text-theme-text-muted" />
                : <CircleFlag code={opt.code.toLowerCase()} size={16} />}
              <span className="flex-1 truncate">{opt.name}</span>
              <span className="text-xs text-theme-text-muted">{opt.count}</span>
            </button>
          );
        })
      )}
    </FilterDropdownShell>
  );
}

function RegionFilterButton({
  selected, onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const allIds = GPP_REGIONS.map((r) => r.id);

  const toggle = (id: GPPRegion) => {
    if (selected.includes(id)) onChange(selected.filter((r) => r !== id));
    else onChange([...selected, id]);
  };

  const allSelected = selected.length === allIds.length;

  return (
    <FilterDropdownShell
      label="Region"
      count={selected.length}
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      <button
        onClick={() => onChange(allSelected ? [] : allIds)}
        className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
          allSelected
            ? 'text-red-500 font-medium'
            : 'text-theme-text-secondary hover:bg-theme-surface hover:text-theme-text'
        }`}
      >
        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
          allSelected ? 'bg-red-500 border-red-500' : 'border-theme-stroke-hover'
        }`}>
          {allSelected && <Check size={12} className="text-theme-text" />}
        </div>
        {allSelected ? 'Clear all' : 'Select all'}
      </button>
      <div className="border-b border-theme-stroke my-1" />
      {GPP_REGIONS.map((r) => {
        const isSel = selected.includes(r.id);
        return (
          <button
            key={r.id}
            onClick={() => toggle(r.id)}
            className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
              isSel
                ? 'text-red-500 font-medium'
                : 'text-theme-text-secondary hover:bg-theme-surface hover:text-theme-text'
            }`}
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
              isSel ? 'bg-red-500 border-red-500' : 'border-theme-stroke-hover'
            }`}>
              {isSel && <Check size={12} className="text-theme-text" />}
            </div>
            {r.label}
          </button>
        );
      })}
    </FilterDropdownShell>
  );
}

function PartnerFilterButton({
  tags, selected, onChange,
}: {
  tags: string[];
  selected: string | null;
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = selected ? 1 : 0;
  return (
    <FilterDropdownShell
      label="Partner"
      count={count}
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      {selected && (
        <button
          onClick={() => onChange(null)}
          className="w-full text-left px-4 py-2 text-xs text-theme-text-faint hover:bg-theme-surface transition-colors"
        >
          Clear
        </button>
      )}
      {tags.map((tag) => {
        const isSel = selected === tag;
        return (
          <button
            key={tag}
            onClick={() => onChange(isSel ? null : tag)}
            className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
              isSel
                ? 'text-red-500 font-medium'
                : 'text-theme-text-secondary hover:bg-theme-surface hover:text-theme-text'
            }`}
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
              isSel ? 'bg-red-500 border-red-500' : 'border-theme-stroke-hover'
            }`}>
              {isSel && <Check size={12} className="text-theme-text" />}
            </div>
            <span className="flex-1 truncate">{tag}</span>
          </button>
        );
      })}
    </FilterDropdownShell>
  );
}

// --- Tiles + lightbox (unchanged from pre-sicilian-58129) --------------------

function FeedTile({ photo, onOpen }: { photo: FeedPhoto; onOpen: () => void }) {
  const isVideo = photo.mimeType?.startsWith('video/');
  const src = cdnUrl(photo.url);
  const aspectRatio = photo.width && photo.height
    ? `${photo.width} / ${photo.height}`
    : undefined;

  // Prefer GPP city manifest entry; fall back to address-derived city/country.
  const gpp = gppCityBySlug(photo.party.slug);
  const displayCity = gpp?.name ?? photo.party.city ?? photo.party.name;
  const displayCountry = gpp?.country ?? photo.party.country;

  return (
    <button onClick={onOpen} className="mb-3 block w-full break-inside-avoid rounded-lg overflow-hidden bg-theme-surface hover:opacity-90 transition-opacity">
      <div className="relative w-full" style={{ aspectRatio }}>
        {isVideo ? (
          <>
            <video src={src} preload="metadata" muted className="w-full h-full object-cover block" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-black/50 rounded-full p-3">
                <Play size={24} className="text-white fill-white" />
              </div>
            </div>
          </>
        ) : (
          <img src={src} alt={photo.caption || ''} loading="lazy" className="w-full h-full object-cover block" />
        )}
      </div>
      {(displayCity || photo.party.name) && (
        <div className="px-2 py-1.5 text-xs text-theme-text-muted flex items-center gap-1.5">
          {countryNameToAlpha2(displayCountry)
            ? <CircleFlag country={displayCountry} size={14} />
            : <MapPin size={11} />}
          <span className="truncate">{displayCity}</span>
        </div>
      )}
    </button>
  );
}

function FeedLightbox({
  photo, onClose, onPrev, onNext, hasPrev, hasNext,
}: {
  photo: FeedPhoto;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const isVideo = photo.mimeType?.startsWith('video/');

  // Prefer GPP city manifest entry; fall back to address-derived city/country.
  const gpp = gppCityBySlug(photo.party.slug);
  const displayCity = gpp?.name ?? photo.party.city;
  const displayCountry = gpp?.country ?? photo.party.country;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <button
        onClick={(e) => { e.stopPropagation(); onPrev(); }}
        disabled={!hasPrev}
        aria-label="Previous photo"
        className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronLeft size={28} />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onNext(); }}
        disabled={!hasNext}
        aria-label="Next photo"
        className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronRight size={28} />
      </button>
      <div className="max-w-5xl w-full max-h-[90vh] bg-theme-header rounded-xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex-1 flex items-center justify-center bg-black min-h-0">
          {isVideo ? (
            <video src={cdnUrl(photo.url)} controls autoPlay className="max-w-full max-h-[75vh]" />
          ) : (
            <img src={cdnUrl(photo.url)} alt={photo.caption || ''} className="max-w-full max-h-[75vh] object-contain" />
          )}
        </div>
        <div className="p-4 border-t border-theme-stroke">
          {photo.caption && <p className="text-theme-text mb-2">{photo.caption}</p>}
          <p className="text-theme-text-muted text-sm flex items-center gap-2">
            {countryNameToAlpha2(displayCountry)
              ? <CircleFlag country={displayCountry} size={18} />
              : <MapPin size={12} />}
            <Link to={`/${photo.party.slug}`} className="hover:underline text-theme-text">
              {photo.party.name}
            </Link>
            {displayCity && <span>· {displayCity}{displayCountry ? `, ${displayCountry}` : ''}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-3">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="mb-3 w-full rounded-lg bg-theme-surface animate-pulse" style={{ aspectRatio: i % 3 === 0 ? '3 / 4' : i % 3 === 1 ? '1 / 1' : '4 / 5' }} />
      ))}
    </div>
  );
}

function EmptyState({ anyFiltersActive, onClear }: { anyFiltersActive: boolean; onClear: () => void }) {
  return (
    <div className="text-center py-20">
      <p className="text-theme-text text-lg">
        {anyFiltersActive ? 'No photos match these filters.' : 'No starred photos yet.'}
      </p>
      <p className="text-theme-text-muted mt-2">
        {anyFiltersActive
          ? <button onClick={onClear} className="underline hover:text-theme-text">Clear filters</button>
          : 'Check back after the next pizza party.'}
      </p>
    </div>
  );
}
