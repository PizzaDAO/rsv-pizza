import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, X, Pause, Play, MapPin } from 'lucide-react';
import { cdnUrl } from '../lib/supabase';
import { getPhotosFeed, FeedPhoto } from '../lib/api';
import { countryNameToAlpha2, alpha2ToCountryNames } from '../utils/countryFlag';
import { gppCityBySlug } from '../utils/gppCity';
import { CircleFlag } from '../components/CircleFlag';

// crespelle-58543: /photos/play — a fullscreen slideshow that shows a fresh
// random photo every few seconds. It walks a randomly-shuffled feed (the same
// `sort=random`+seed mechanism the /photos grid uses), so every advance is a
// new photo until the deck is exhausted — then it reshuffles with a new seed
// and plays on forever. Filters (?countries/regions/partnerTag/year) carried
// in the URL are honored so a filtered grid can launch a filtered slideshow.

const ADVANCE_MS = 3000;
const PAGE_SIZE = 30;
// Prefetch the next page once we get this close to the end of the loaded deck.
const PREFETCH_WHEN_REMAINING = 6;

function parseCsvParam(v: string | null): string[] {
  if (!v) return [];
  return Array.from(new Set(v.split(',').map((s) => s.trim()).filter(Boolean)));
}

function genSeed(): string {
  return String(Math.floor(Math.random() * 1e9));
}

export function PhotosSlideshowPage() {
  const [searchParams] = useSearchParams();

  // Filters are read once from the URL — the slideshow itself never mutates
  // them. Countries arrive as alpha-2 codes (matching the /photos grid); expand
  // each to all known locale variants so the backend can match them. (The grid
  // intersects with facets to trim the payload; sending all variants is the
  // grid's own fallback and works fine.)
  const countryCodes = parseCsvParam(searchParams.get('countries'));
  const regions = parseCsvParam(searchParams.get('regions'));
  const partnerTag = searchParams.get('partnerTag') || null;
  const yearParam = searchParams.get('year');
  const year = yearParam && Number.isFinite(parseInt(yearParam, 10)) ? parseInt(yearParam, 10) : undefined;
  const backendCountries = Array.from(
    new Set(countryCodes.flatMap((code) => alpha2ToCountryNames(code)))
  );

  const [photos, setPhotos] = useState<FeedPhoto[]>([]);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refs mirror the state that the interval / prefetch logic reads, so the
  // timer callback never goes stale.
  const photosRef = useRef<FeedPhoto[]>([]);
  const idxRef = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const seedRef = useRef<string>(searchParams.get('seed') || genSeed());
  photosRef.current = photos;
  idxRef.current = idx;

  // Filters are stable for the life of the page; capture them in a ref so
  // loadPage stays a stable callback.
  const filtersRef = useRef({ countries: backendCountries, regions, partnerTag, year });
  filtersRef.current = { countries: backendCountries, regions, partnerTag, year };

  const loadPage = useCallback(async (isInitial: boolean) => {
    if (loadingRef.current) return;
    if (!isInitial && !hasMoreRef.current) return;
    loadingRef.current = true;
    if (isInitial) setLoading(true);
    try {
      const res = await getPhotosFeed(cursorRef.current, PAGE_SIZE, {
        sort: 'random',
        seed: seedRef.current,
        countries: filtersRef.current.countries,
        regions: filtersRef.current.regions,
        partnerTag: filtersRef.current.partnerTag,
        year: filtersRef.current.year,
      });
      if (!res) {
        if (isInitial) setError('Could not load photos right now.');
        hasMoreRef.current = false;
      } else {
        cursorRef.current = res.nextCursor;
        hasMoreRef.current = !!res.nextCursor;
        setPhotos((prev) => (isInitial ? res.photos : [...prev, ...res.photos]));
      }
    } catch {
      if (isInitial) setError('Could not load photos right now.');
      hasMoreRef.current = false;
    } finally {
      loadingRef.current = false;
      if (isInitial) setLoading(false);
    }
  }, []);

  // Reshuffle: a fresh seed + a clean deck. Used when we run out of photos so
  // the slideshow loops endlessly with a new random order each pass.
  const reshuffle = useCallback(() => {
    seedRef.current = genSeed();
    cursorRef.current = null;
    hasMoreRef.current = true;
    idxRef.current = 0;
    setIdx(0);
    setPhotos([]);
    loadPage(true);
  }, [loadPage]);

  // Initial load.
  useEffect(() => {
    loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-advance.
  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => {
      const deck = photosRef.current;
      if (deck.length === 0) return;
      const next = idxRef.current + 1;
      if (next < deck.length) {
        setIdx(next);
      } else if (hasMoreRef.current) {
        // Next page not in hand yet — hold on the current photo for one tick;
        // the prefetch effect is already loading it.
      } else {
        reshuffle();
      }
    }, ADVANCE_MS);
    return () => window.clearInterval(t);
  }, [paused, reshuffle]);

  // Prefetch the next page as we near the end of the loaded deck.
  useEffect(() => {
    if (hasMoreRef.current && photos.length - idx <= PREFETCH_WHEN_REMAINING) {
      loadPage(false);
    }
  }, [idx, photos.length, loadPage]);

  // Preload the next image so the crossfade lands on a decoded frame.
  useEffect(() => {
    const nextPhoto = photos[idx + 1];
    if (nextPhoto && !nextPhoto.mimeType?.startsWith('video/')) {
      const img = new Image();
      img.src = cdnUrl(nextPhoto.url);
    }
  }, [idx, photos]);

  // Keyboard: Esc exits (handled by the Link), Space toggles pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const current = photos[idx];
  const isVideo = current?.mimeType?.startsWith('video/');

  const gpp = current ? gppCityBySlug(current.party.slug) : undefined;
  const displayCity = gpp?.name ?? current?.party.city;
  const displayCountry = gpp?.country ?? current?.party.country;

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center overflow-hidden">
      <Helmet>
        <title>Photo Slideshow · RSV.Pizza</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      {/* Exit */}
      <Link
        to="/photos"
        aria-label="Exit slideshow"
        className="absolute top-4 right-4 z-20 p-2 rounded-full bg-black/40 hover:bg-black/70 text-white transition-colors"
      >
        <X size={24} />
      </Link>

      {/* Pause / play */}
      {photos.length > 0 && (
        <button
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? 'Resume slideshow' : 'Pause slideshow'}
          className="absolute bottom-4 right-4 z-20 p-2 rounded-full bg-black/40 hover:bg-black/70 text-white transition-colors"
        >
          {paused ? <Play size={22} className="fill-white" /> : <Pause size={22} className="fill-white" />}
        </button>
      )}

      {loading ? (
        <Loader2 size={40} className="animate-spin text-white/70" />
      ) : error ? (
        <div className="text-center text-white/80 px-6">
          <p className="mb-4">{error}</p>
          <Link to="/photos" className="underline">Back to photos</Link>
        </div>
      ) : !current ? (
        <div className="text-center text-white/80 px-6">
          <p className="mb-4">No photos to show.</p>
          <Link to="/photos" className="underline">Back to photos</Link>
        </div>
      ) : (
        <>
          {/* The media. `key` forces a remount per photo so the fade-in plays
              and videos restart from the top. */}
          <div
            key={current.id}
            className="absolute inset-0 flex items-center justify-center animate-[fadeIn_700ms_ease-out]"
          >
            {isVideo ? (
              <video
                src={cdnUrl(current.url)}
                autoPlay
                muted
                playsInline
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <img
                src={cdnUrl(current.url)}
                alt={current.caption || ''}
                className="max-w-full max-h-full object-contain"
              />
            )}
          </div>

          {/* Caption — city / country / event, bottom-left over a soft gradient. */}
          <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent pt-16 pb-5 px-6 pointer-events-none">
            <div className="flex items-center gap-2 text-white">
              {countryNameToAlpha2(displayCountry || '')
                ? <CircleFlag country={displayCountry || ''} size={20} />
                : <MapPin size={16} className="opacity-80" />}
              <span className="text-base sm:text-lg font-medium drop-shadow">
                {displayCity && displayCountry
                  ? `${displayCity}, ${displayCountry}`
                  : (displayCity || displayCountry || current.party.name)}
              </span>
            </div>
            {current.caption && (
              <p className="mt-1 text-sm text-white/80 max-w-2xl truncate drop-shadow">{current.caption}</p>
            )}
          </div>
        </>
      )}

      {/* Local keyframes for the per-photo fade-in. */}
      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  );
}
