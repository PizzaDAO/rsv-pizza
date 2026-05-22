import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, Play, MapPin } from 'lucide-react';
import { Layout } from '../components/Layout';
import { cdnUrl } from '../lib/supabase';
import { getPhotosFeed, FeedPhoto } from '../lib/api';
import { countryNameToFlag } from '../utils/countryFlag';

// Sentinel returned by countryNameToFlag when the country name doesn't map
// to an ISO-3166 alpha-2 code. When we see this, we fall back to the MapPin
// icon so we don't show the world-map emoji here.
const MAP_EMOJI_FALLBACK = '\u{1F5FA}\u{FE0F}';

export function PhotosFeedPage() {
  const [photos, setPhotos] = useState<FeedPhoto[]>([]);
  const [, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedPhoto | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);

  const loadPage = useCallback(async (isInitial: boolean) => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    if (isInitial) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      const res = await getPhotosFeed(cursorRef.current);
      if (!res) {
        setError('Could not load photos right now.');
        hasMoreRef.current = false;
        setHasMore(false);
      } else {
        setPhotos(prev => isInitial ? res.photos : [...prev, ...res.photos]);
        cursorRef.current = res.nextCursor;
        setCursor(res.nextCursor);
        hasMoreRef.current = !!res.nextCursor;
        setHasMore(!!res.nextCursor);
      }
    } catch {
      setError('Could not load photos right now.');
    } finally {
      loadingRef.current = false;
      if (isInitial) setLoading(false); else setLoadingMore(false);
    }
  }, []);

  useEffect(() => { loadPage(true); }, [loadPage]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) loadPage(false);
    }, { rootMargin: '600px 0px' });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [loadPage]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <Layout>
      <Helmet>
        <title>Photos from Pizza Parties Around the World | RSV.Pizza</title>
        <meta name="description" content="A live feed of starred photos from approved pizza parties hosted around the world." />
        <meta property="og:title" content="Pizza Party Photos" />
        <meta property="og:description" content="A live feed of starred photos from approved pizza parties hosted around the world." />
      </Helmet>

      <div className="max-w-[1400px] mx-auto px-4 py-8">
        <header className="mb-6">
          <h1 className="text-3xl font-bold text-theme-text">Photos</h1>
          <p className="text-theme-text-secondary mt-1">Highlights from pizza parties around the world.</p>
        </header>

        {loading && photos.length === 0 ? (
          <SkeletonGrid />
        ) : photos.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-3 [column-fill:_balance]">
            {photos.map(p => <FeedTile key={p.id} photo={p} onOpen={() => setSelected(p)} />)}
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
        {!hasMore && photos.length > 0 && !error && (
          <p className="text-center text-theme-text-muted py-6 text-sm">You've reached the end.</p>
        )}
      </div>

      {selected && <FeedLightbox photo={selected} onClose={() => setSelected(null)} />}
    </Layout>
  );
}

function FeedTile({ photo, onOpen }: { photo: FeedPhoto; onOpen: () => void }) {
  const isVideo = photo.mimeType?.startsWith('video/');
  const src = cdnUrl(photo.url);
  return (
    <button onClick={onOpen} className="mb-3 block w-full break-inside-avoid rounded-lg overflow-hidden bg-theme-surface hover:opacity-90 transition-opacity">
      <div className="relative">
        {isVideo ? (
          <>
            <video src={src} preload="metadata" muted className="w-full h-auto block" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-black/50 rounded-full p-3">
                <Play size={24} className="text-white fill-white" />
              </div>
            </div>
          </>
        ) : (
          <img src={src} alt={photo.caption || ''} loading="lazy" className="w-full h-auto block" />
        )}
      </div>
      {(photo.party.city || photo.party.name) && (
        <div className="px-2 py-1.5 text-xs text-theme-text-muted flex items-center gap-1">
          {(() => {
            const flag = countryNameToFlag(photo.party.country);
            return flag && flag !== MAP_EMOJI_FALLBACK
              ? <span className="text-sm leading-none" aria-label={photo.party.country || ''}>{flag}</span>
              : <MapPin size={11} />;
          })()}
          <span className="truncate">{photo.party.city || photo.party.name}</span>
        </div>
      )}
    </button>
  );
}

function FeedLightbox({ photo, onClose }: { photo: FeedPhoto; onClose: () => void }) {
  const isVideo = photo.mimeType?.startsWith('video/');
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
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
            {(() => {
              const flag = countryNameToFlag(photo.party.country);
              return flag && flag !== MAP_EMOJI_FALLBACK
                ? <span className="text-base leading-none" aria-label={photo.party.country || ''}>{flag}</span>
                : <MapPin size={12} />;
            })()}
            <Link to={`/${photo.party.slug}`} className="hover:underline text-theme-text">{photo.party.name}</Link>
            {photo.party.city && <span>· {photo.party.city}{photo.party.country ? `, ${photo.party.country}` : ''}</span>}
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

function EmptyState() {
  return (
    <div className="text-center py-20">
      <p className="text-theme-text text-lg">No starred photos yet.</p>
      <p className="text-theme-text-muted mt-2">Check back after the next pizza party.</p>
    </div>
  );
}
