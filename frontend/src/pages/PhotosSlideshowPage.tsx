import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, X, Pause, Play, MapPin, ThumbsUp, SkipBack, SkipForward } from 'lucide-react';
import { cdnUrl } from '../lib/supabase';
import { getPhotosFeed, togglePhotoVote, togglePayoutPhotoVote, FeedPhoto } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { countryNameToAlpha2, alpha2ToCountryNames } from '../utils/countryFlag';
import { gppCityBySlug } from '../utils/gppCity';
import { CircleFlag } from '../components/CircleFlag';
import { BRAND } from '../config/brand';

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
// funghi-91314: controls fade out after this long without pointer/touch/key
// activity (the page is used fullscreen on a livestream).
const CONTROLS_HIDE_MS = 3000;
// Max photos remembered for the Back button.
const HISTORY_MAX = 500;
// Touch: horizontal travel (px) that counts as a swipe rather than a tap.
const SWIPE_MIN_PX = 50;

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
  // sfoglia-58543: honor the /photos type (payout_role) filter in the slideshow.
  const types = parseCsvParam(searchParams.get('type'));
  const yearParam = searchParams.get('year');
  const year = yearParam && Number.isFinite(parseInt(yearParam, 10)) ? parseInt(yearParam, 10) : undefined;
  const backendCountries = Array.from(
    new Set(countryCodes.flatMap((code) => alpha2ToCountryNames(code)))
  );

  const [photos, setPhotos] = useState<FeedPhoto[]>([]);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  // funghi-91314: every photo shown, in order (across reshuffles), so Back can
  // walk through them. `histPos` is null while viewing the live deck photo;
  // otherwise it indexes the history entry being re-viewed.
  const [history, setHistory] = useState<FeedPhoto[]>([]);
  const [histPos, setHistPos] = useState<number | null>(null);
  // Bumped on manual navigation so the auto-advance timer restarts.
  const [timerKey, setTimerKey] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // sfoglia-58543: thumbs-up (vote) support, mirroring the /photos feed
  // lightbox. Anon users can't vote (button disabled); logged-in users toggle
  // via the source-appropriate endpoint.
  const { user } = useAuth();
  const [voting, setVoting] = useState(false);

  // Refs mirror the state that the interval / prefetch logic reads, so the
  // timer callback never goes stale.
  const photosRef = useRef<FeedPhoto[]>([]);
  const idxRef = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const seedRef = useRef<string>(searchParams.get('seed') || genSeed());
  const historyRef = useRef<FeedPhoto[]>([]);
  const histPosRef = useRef<number | null>(null);
  photosRef.current = photos;
  historyRef.current = history;
  histPosRef.current = histPos;
  idxRef.current = idx;

  // Filters are stable for the life of the page; capture them in a ref so
  // loadPage stays a stable callback.
  const filtersRef = useRef({ countries: backendCountries, regions, partnerTag, year, type: types });
  filtersRef.current = { countries: backendCountries, regions, partnerTag, year, type: types };

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
        type: filtersRef.current.type, // sfoglia-58543
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

  // Step forward one photo: through re-viewed history first, then the live
  // deck (reshuffling when it runs out). Only reads refs, so it is safe to
  // call from the timer, keys and touch handlers.
  const goNext = useCallback(() => {
    const hp = histPosRef.current;
    const hist = historyRef.current;
    if (hp !== null) {
      const np = hp + 1;
      setHistPos(np >= hist.length - 1 ? null : np);
      return;
    }
    const deck = photosRef.current;
    if (deck.length === 0) return;
    const next = idxRef.current + 1;
    if (next < deck.length) {
      setIdx(next);
    } else if (!hasMoreRef.current) {
      reshuffle();
    }
    // else: next page not in hand yet — hold; the prefetch effect is loading it.
  }, [reshuffle]);

  // Step back one photo through the history.
  const goBack = useCallback(() => {
    const hist = historyRef.current;
    const from = histPosRef.current ?? hist.length - 1;
    if (from > 0) setHistPos(from - 1);
  }, []);

  const manualNav = useCallback((dir: 'back' | 'next') => {
    if (dir === 'back') goBack(); else goNext();
    setTimerKey((k) => k + 1); // restart the 3s timer; paused stays paused
  }, [goBack, goNext]);

  // Auto-advance.
  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(goNext, ADVANCE_MS);
    return () => window.clearInterval(t);
  }, [paused, goNext, timerKey]);

  // Record each live photo in the history as it appears.
  const liveId = photos[idx]?.id;
  useEffect(() => {
    const live = photosRef.current[idxRef.current];
    if (!live) return;
    setHistory((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].id === live.id) return prev;
      const next = [...prev, live];
      // Only trim while following the live photo, so histPos stays valid.
      return next.length > HISTORY_MAX && histPosRef.current === null
        ? next.slice(next.length - HISTORY_MAX)
        : next;
    });
  }, [liveId]);

  // Show controls, then hide them again after a quiet spell.
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => {
    // Controls start visible; schedule their first auto-hide.
    hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
    return () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

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

  // Keyboard: Esc exits (handled by the Link), Space toggles pause,
  // Left/Right arrows go back/next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        manualNav('back');
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        manualNav('next');
      } else {
        return;
      }
      revealControls();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manualNav, revealControls]);

  // Touch: swipe left/right = next/back; tap left/right third = back/next;
  // tap the middle third just reveals the controls.
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = t ? { x: t.clientX, y: t.clientY } : null;
    revealControls();
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    if ((e.target as HTMLElement).closest('button, a')) return; // controls handle themselves
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      manualNav(dx < 0 ? 'next' : 'back');
    } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const third = window.innerWidth / 3;
      if (t.clientX < third) manualNav('back');
      else if (t.clientX > third * 2) manualNav('next');
    }
  };

  const live = photos[idx];
  // The photo on screen: a re-viewed history entry, or the live deck photo.
  const current = histPos !== null ? history[histPos] ?? live : live;
  const isVideo = current?.mimeType?.startsWith('video/');

  // sfoglia-58543: toggle a vote on the current photo. Source-aware dispatch
  // (same as the /photos FeedLightbox). On success, patch the loaded deck so
  // the count/fill persist as the slideshow advances or loops.
  const handleVote = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!current || voting || !user) return;
    setVoting(true);
    const res = current.source === 'payout' && current.payoutId
      ? await togglePayoutPhotoVote(current.payoutId, current.id)
      : await togglePhotoVote(current.party.id, current.id);
    setVoting(false);
    if (res) {
      const patch = (p: FeedPhoto) =>
        p.id === current.id ? { ...p, voteCount: res.voteCount, votedByMe: res.voted } : p;
      setHistory((prev) => prev.map(patch));
      setPhotos((prev) => prev.map(patch));
    }
  };

  const hideCls = controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none';

  const gpp = current ? gppCityBySlug(current.party.slug) : undefined;
  const displayCity = gpp?.name ?? current?.party.city;
  const displayCountry = gpp?.country ?? current?.party.country;

  return (
    <div
      className={`fixed inset-0 z-50 bg-black flex items-center justify-center overflow-hidden ${
        controlsVisible ? '' : 'cursor-none'
      }`}
      onMouseMove={revealControls}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <Helmet>
        <title>{`Photo Slideshow · ${BRAND.name}`}</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      {/* Exit */}
      <Link
        to="/photos"
        aria-label="Exit slideshow"
        className={`absolute top-4 right-4 z-20 p-2 rounded-full bg-black/40 hover:bg-black/70 text-white transition-all duration-300 ${hideCls}`}
      >
        <X size={24} />
      </Link>

      {/* sfoglia-58543: thumbs-up (vote) — bottom-right, left of Pause/Play.
          Styled like the other overlay controls. Anon users see the count but
          can't vote (disabled). */}
      {photos.length > 0 && current && (
        <button
          onClick={handleVote}
          disabled={!user || voting}
          aria-label={current.votedByMe ? 'Remove vote' : 'Thumbs up'}
          title={user ? (current.votedByMe ? 'Remove vote' : 'Thumbs up') : 'Log in to vote'}
          className={`absolute bottom-4 right-[10.5rem] z-20 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/40 hover:bg-black/70 text-white transition-all duration-300 ${
            !user || voting ? 'opacity-60 cursor-not-allowed' : ''
          } ${hideCls}`}
        >
          <ThumbsUp size={20} fill={current.votedByMe ? 'white' : 'none'} />
          <span className="text-sm font-medium">{current.voteCount}</span>
        </button>
      )}

      {/* funghi-91314: Back / Pause-Play / Next, bottom-right. Fade out after a
          few seconds idle; reappear on mouse move, tap or key press. */}
      {photos.length > 0 && (
        <div className={`absolute bottom-4 right-4 z-20 flex items-center gap-2 transition-all duration-300 ${hideCls}`}>
          <button
            onClick={() => manualNav('back')}
            disabled={(histPos ?? history.length - 1) <= 0}
            aria-label="Previous photo"
            title="Previous (Left arrow)"
            className="p-2 rounded-full bg-black/40 hover:bg-black/70 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <SkipBack size={22} className="fill-white" />
          </button>
          <button
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Resume slideshow' : 'Pause slideshow'}
            title={paused ? 'Play (Space)' : 'Pause (Space)'}
            className="p-2 rounded-full bg-black/40 hover:bg-black/70 text-white transition-colors"
          >
            {paused ? <Play size={22} className="fill-white" /> : <Pause size={22} className="fill-white" />}
          </button>
          <button
            onClick={() => manualNav('next')}
            aria-label="Next photo"
            title="Next (Right arrow)"
            className="p-2 rounded-full bg-black/40 hover:bg-black/70 text-white transition-colors"
          >
            <SkipForward size={22} className="fill-white" />
          </button>
        </div>
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
