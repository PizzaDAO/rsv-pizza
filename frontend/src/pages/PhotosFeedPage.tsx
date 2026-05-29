import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, Play, MapPin, ChevronLeft, ChevronRight, ChevronDown, Check, Search, X, ThumbsUp, Shuffle, Download } from 'lucide-react';
import { Layout } from '../components/Layout';
import { ThemeProvider } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { cdnUrl } from '../lib/supabase';
import {
  getPhotosFeed,
  getPhotosFeedFacets,
  getMyPartnerTags,
  togglePhotoVote,
  togglePayoutPhotoVote,
  FeedPhoto,
} from '../lib/api';
import { countryNameToAlpha2, alpha2ToCountryNames, alpha2ToCanonicalName } from '../utils/countryFlag';
import { gppCityBySlug } from '../utils/gppCity';
import { GPP_REGIONS, GPPRegion } from '../types';
import { CircleFlag } from '../components/CircleFlag';

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

  // sicilian-58195: shuffle state. sortMode='random' + seed makes the order
  // deterministic for that seed so the backend's keyset cursor can paginate
  // through the shuffled feed. URL params survive refresh / sharing.
  const [sortMode, setSortMode] = useState<'newest' | 'random'>(
    () => (searchParams.get('sort') === 'random' && searchParams.get('seed') ? 'random' : 'newest')
  );
  const [seed, setSeed] = useState<string | null>(
    () => (searchParams.get('sort') === 'random' ? searchParams.get('seed') : null)
  );

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
  const sortModeRef = useRef(sortMode);
  const seedRef = useRef(seed);
  countriesRef.current = activeCountries;
  regionsRef.current = activeRegions;
  partnerTagRef.current = activePartnerTag;
  sortModeRef.current = sortMode;
  seedRef.current = seed;

  // Sync filter state -> URL so refresh / sharing work.
  useEffect(() => {
    const next = new URLSearchParams();
    if (activeCountries.length > 0) next.set('countries', activeCountries.join(','));
    if (activeRegions.length > 0) next.set('regions', activeRegions.join(','));
    if (activePartnerTag) next.set('partnerTag', activePartnerTag);
    if (sortMode === 'random' && seed) {
      next.set('sort', 'random');
      next.set('seed', seed);
    }
    // Replace (don't push) to keep history clean.
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCountries, activeRegions, activePartnerTag, sortMode, seed]);

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
        sort: sortModeRef.current,
        seed: seedRef.current,
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

  // Reset + reload whenever a filter changes. sicilian-58195: include sort
  // + seed so picking Shuffle (or reshuffling with a new seed) re-pages.
  const filterKey = useMemo(
    () => `${activeCountries.slice().sort().join(',')}|${activeRegions.slice().sort().join(',')}|${activePartnerTag || ''}|${sortMode}|${seed || ''}`,
    [activeCountries, activeRegions, activePartnerTag, sortMode, seed]
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
    // sicilian-58195: clearing also returns to default newest-first order.
    setSortMode('newest');
    setSeed(null);
  };

  // sicilian-58195: shuffle handler. Generates a new seed and switches to
  // random sort. Clicking while already shuffled reshuffles with a fresh seed.
  const handleShuffle = () => {
    const newSeed = String(Math.floor(Math.random() * 1e9));
    setSortMode('random');
    setSeed(newSeed);
  };

  // Revert just the shuffle (preserve other filters).
  const clearShuffle = () => {
    setSortMode('newest');
    setSeed(null);
  };

  // salame-58291: ZIP download of all photos matching the current filters.
  // Auth lives in localStorage as a Bearer token (see apiRequest), so an
  // `<a download>` won't carry it — we fetch with the header, then create a
  // blob URL and click an anchor to trigger the save dialog.
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();

  const buildDownloadParams = useCallback((): string => {
    const params = new URLSearchParams();
    const expandedCountries = buildCountriesForBackend(activeCountries);
    if (expandedCountries.length > 0) params.append('countries', expandedCountries.join(','));
    if (activeRegions.length > 0) params.append('regions', activeRegions.join(','));
    if (activePartnerTag) params.append('partnerTag', activePartnerTag);
    if (sortMode === 'random' && seed) {
      params.append('sort', 'random');
      params.append('seed', seed);
    }
    return params.toString();
  }, [activeCountries, activeRegions, activePartnerTag, sortMode, seed, buildCountriesForBackend]);

  const handleDownloadZip = async () => {
    if (downloading || !activePartnerTag) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        setDownloadError('Please log in to download.');
        return;
      }
      const res = await fetch(`${API_URL}/api/photos/feed/download?${buildDownloadParams()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = res.status === 404
          ? 'No photos match the current filters.'
          : `Download failed (${res.status})`;
        setDownloadError(msg);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `${activePartnerTag}-photos-${dateStr}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setDownloadError('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  // salame-58195: propagate vote changes back into the photos array so the
  // count + filled icon update immediately on click (and stay in sync across
  // tile <-> lightbox).
  const handleVoteChange = useCallback(
    (photoId: string, next: { voteCount: number; votedByMe: boolean }) => {
      setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, ...next } : p)));
    },
    []
  );

  const anyFiltersActive = activeCountries.length > 0 || activeRegions.length > 0 || !!activePartnerTag || sortMode === 'random';

  return (
    <ThemeProvider theme="gpp">
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
        <div
          className="sticky top-0 z-30 -mx-4 px-4 py-3 mb-4 border-b border-theme-stroke flex flex-wrap items-center gap-2"
          style={{ background: 'rgba(255,255,255,0.95)' }}
        >
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
          {/* sicilian-58195: shuffle toggle. Same pill shape as the filter
              buttons; click reshuffles (new seed). The adjacent X clears
              shuffle and returns to newest-first ordering. */}
          <button
            onClick={handleShuffle}
            title={sortMode === 'random' ? 'Reshuffle' : 'Shuffle photos'}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors ${
              sortMode === 'random'
                ? 'bg-red-500/10 border-red-500/40 text-red-600 hover:bg-red-500/20'
                : 'border-black/10 text-gray-900 hover:bg-white'
            }`}
            style={sortMode === 'random' ? undefined : { background: 'rgba(255,255,255,0.85)' }}
          >
            <Shuffle size={14} />
            <span>{sortMode === 'random' ? 'Shuffled' : 'Shuffle'}</span>
            {sortMode === 'random' && (
              <span
                role="button"
                aria-label="Clear shuffle"
                onClick={(e) => { e.stopPropagation(); clearShuffle(); }}
                className="inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-red-500/20"
              >
                <X size={12} />
              </span>
            )}
          </button>
          {/* salame-58291: download all matching photos as a ZIP. Only visible
              when a partnerTag is active. Auth header is required, so we use
              fetch+blob instead of a plain <a download>. */}
          {activePartnerTag && (
            <button
              onClick={handleDownloadZip}
              disabled={downloading}
              title={`Download all photos tagged "${activePartnerTag}" as a ZIP`}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors border-black/10 text-gray-900 hover:bg-white ${
                downloading ? 'opacity-60 cursor-wait' : ''
              }`}
              style={{ background: 'rgba(255,255,255,0.85)' }}
            >
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span>{downloading ? 'Preparing ZIP...' : 'Download ZIP'}</span>
            </button>
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
        {downloadError && (
          <div className="mb-3 text-sm text-amber-600">{downloadError}</div>
        )}

        {loading && photos.length === 0 ? (
          <SkeletonGrid />
        ) : photos.length === 0 ? (
          <EmptyState anyFiltersActive={anyFiltersActive} onClear={clearAllFilters} />
        ) : (
          <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-3">
            {photos.map((p, idx) => (
              <FeedTile
                key={p.id}
                photo={p}
                onOpen={() => setSelectedIdx(idx)}
                onVoteChange={handleVoteChange}
              />
            ))}
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
            <p className="text-amber-600">{error}</p>
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
          onVoteChange={handleVoteChange}
        />
      )}
    </Layout>
    </ThemeProvider>
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
            ? 'bg-red-500/10 border-red-500/40 text-red-600 hover:bg-red-500/20'
            : 'border-black/10 text-gray-900 hover:bg-white'
        }`}
        style={count > 0 ? undefined : { background: 'rgba(255,255,255,0.85)' }}
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
          <div
            className={`absolute top-full left-0 mt-2 z-50 rounded-xl py-2 min-w-[260px] max-h-[60vh] overflow-y-auto border ${panelClassName}`}
            style={{ background: '#ffffff', borderColor: 'rgba(0,0,0,0.1)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}
          >
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
      <div className="px-3 pb-2 sticky top-0 border-b border-black/10" style={{ background: '#ffffff' }}>
        <div className="relative">
          <Search size={16} className="absolute top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" style={{ left: '12px' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search countries..."
            className="w-full pr-2 py-1.5 text-sm bg-white border border-black/10 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:border-red-500/40"
            style={{ paddingLeft: '36px' }}
          />
        </div>
      </div>
      {selected.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-100 transition-colors"
        >
          Clear ({selected.length})
        </button>
      )}
      {filtered.length === 0 ? (
        <div className="px-4 py-3 text-sm text-gray-600">No matches</div>
      ) : (
        filtered.map((opt) => {
          const isSel = selected.includes(opt.code);
          return (
            <button
              key={opt.code}
              onClick={() => toggle(opt.code)}
              className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2 ${
                isSel
                  ? 'text-red-600 font-medium'
                  : 'text-gray-900 hover:bg-gray-100'
              }`}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                isSel ? 'bg-red-500 border-red-500' : 'border-black/20'
              }`}>
                {isSel && <Check size={12} className="text-white" />}
              </div>
              {opt.code.startsWith('__unmapped__')
                ? <MapPin size={14} className="text-gray-500" />
                : <CircleFlag code={opt.code.toLowerCase()} size={16} />}
              <span className="flex-1 truncate">{opt.name}</span>
              <span className="text-xs text-gray-600">{opt.count}</span>
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
            ? 'text-red-600 font-medium'
            : 'text-gray-900 hover:bg-gray-100'
        }`}
      >
        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
          allSelected ? 'bg-red-500 border-red-500' : 'border-black/20'
        }`}>
          {allSelected && <Check size={12} className="text-white" />}
        </div>
        {allSelected ? 'Clear all' : 'Select all'}
      </button>
      <div className="border-b border-black/10 my-1" />
      {GPP_REGIONS.map((r) => {
        const isSel = selected.includes(r.id);
        return (
          <button
            key={r.id}
            onClick={() => toggle(r.id)}
            className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
              isSel
                ? 'text-red-600 font-medium'
                : 'text-gray-900 hover:bg-gray-100'
            }`}
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
              isSel ? 'bg-red-500 border-red-500' : 'border-black/20'
            }`}>
              {isSel && <Check size={12} className="text-white" />}
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
          className="w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-100 transition-colors"
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
                ? 'text-red-600 font-medium'
                : 'text-gray-900 hover:bg-gray-100'
            }`}
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
              isSel ? 'bg-red-500 border-red-500' : 'border-black/20'
            }`}>
              {isSel && <Check size={12} className="text-white" />}
            </div>
            <span className="flex-1 truncate">{tag}</span>
          </button>
        );
      })}
    </FilterDropdownShell>
  );
}

// --- Tiles + lightbox (unchanged from pre-sicilian-58129) --------------------

function FeedTile({
  photo,
  onOpen,
  onVoteChange,
}: {
  photo: FeedPhoto;
  onOpen: () => void;
  onVoteChange: (photoId: string, next: { voteCount: number; votedByMe: boolean }) => void;
}) {
  const isVideo = photo.mimeType?.startsWith('video/');
  const src = cdnUrl(photo.url);
  const aspectRatio = photo.width && photo.height
    ? `${photo.width} / ${photo.height}`
    : undefined;

  // Prefer GPP city manifest entry; fall back to address-derived city/country.
  const gpp = gppCityBySlug(photo.party.slug);
  const displayCity = gpp?.name ?? photo.party.city ?? photo.party.name;
  const displayCountry = gpp?.country ?? photo.party.country;

  // salame-58195
  const { user } = useAuth();
  const [voting, setVoting] = useState(false);
  const handleVote = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!user) {
      // Anon: defer login prompt — fall through to lightbox.
      onOpen();
      return;
    }
    if (voting) return;
    setVoting(true);
    // napoletana-58210: route to the source-specific vote endpoint.
    const res = photo.source === 'payout' && photo.payoutId
      ? await togglePayoutPhotoVote(photo.payoutId, photo.id)
      : await togglePhotoVote(photo.party.id, photo.id);
    setVoting(false);
    if (res) {
      onVoteChange(photo.id, { voteCount: res.voteCount, votedByMe: res.voted });
    }
  };

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
        {/* salame-58195: thumbs-up overlay (napoletana-58197: icon-only, white, drop-shadow) */}
        <span
          onClick={handleVote}
          role="button"
          aria-label={photo.votedByMe ? 'Remove vote' : 'Vote'}
          className={`absolute bottom-2 right-2 cursor-pointer text-white hover:scale-110 transition-transform ${voting ? 'opacity-70' : ''}`}
          style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}
        >
          <ThumbsUp size={22} fill={photo.votedByMe ? 'white' : 'none'} stroke="white" strokeWidth={2.25} />
        </span>
      </div>
      {(displayCity || photo.party.name) && (
        <div className="px-2 py-1.5 text-xs text-theme-text-muted flex items-center gap-1.5">
          {countryNameToAlpha2(displayCountry)
            ? <CircleFlag country={displayCountry} size={14} />
            : <MapPin size={11} />}
          <span className="truncate">
            {displayCity && displayCountry ? `${displayCity}, ${displayCountry}` : (displayCity || displayCountry || photo.party.name)}
          </span>
        </div>
      )}
    </button>
  );
}

function FeedLightbox({
  photo, onClose, onPrev, onNext, hasPrev, hasNext, onVoteChange,
}: {
  photo: FeedPhoto;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  onVoteChange: (photoId: string, next: { voteCount: number; votedByMe: boolean }) => void;
}) {
  const isVideo = photo.mimeType?.startsWith('video/');

  // Prefer GPP city manifest entry; fall back to address-derived city/country.
  const gpp = gppCityBySlug(photo.party.slug);
  const displayCity = gpp?.name ?? photo.party.city;
  const displayCountry = gpp?.country ?? photo.party.country;

  // salame-58195
  const { user } = useAuth();
  const [voting, setVoting] = useState(false);
  const handleVote = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user || voting) return;
    setVoting(true);
    // napoletana-58210: route to the source-specific vote endpoint.
    const res = photo.source === 'payout' && photo.payoutId
      ? await togglePayoutPhotoVote(photo.payoutId, photo.id)
      : await togglePhotoVote(photo.party.id, photo.id);
    setVoting(false);
    if (res) {
      onVoteChange(photo.id, { voteCount: res.voteCount, votedByMe: res.voted });
    }
  };

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
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-theme-text-muted text-sm flex items-center gap-2">
              {countryNameToAlpha2(displayCountry)
                ? <CircleFlag country={displayCountry} size={18} />
                : <MapPin size={12} />}
              <Link to={`/${photo.party.slug}`} className="hover:underline text-theme-text">
                {photo.party.name}
              </Link>
              {displayCity && <span>· {displayCity}{displayCountry ? `, ${displayCountry}` : ''}</span>}
            </p>
            {/* salame-58195: vote button (logged-in users only; anon sees count) */}
            <button
              onClick={handleVote}
              disabled={!user || voting}
              aria-label={photo.votedByMe ? 'Remove vote' : 'Thumbs up'}
              title={user ? (photo.votedByMe ? 'Remove vote' : 'Thumbs up') : 'Log in to vote'}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                photo.votedByMe
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'bg-white/10 text-theme-text hover:bg-white/20'
              } ${!user || voting ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <ThumbsUp size={18} fill={photo.votedByMe ? 'currentColor' : 'none'} />
              <span>{photo.voteCount}</span>
            </button>
          </div>
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
