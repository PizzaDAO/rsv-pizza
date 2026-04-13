import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ChevronLeft, ChevronRight, X } from 'lucide-react';

const GPP_PHOTOS_URL = 'https://app.gpp.day/api/photos.json';
const GPP_BASE_URL = 'https://app.gpp.day';

interface GppCity {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  countryCode: string;
  years: {
    year: number;
    photos: { src: string }[];
  }[];
}

interface GppManifest {
  cities: GppCity[];
}

// Module-level cache so we only fetch once across all instances
let manifestCache: GppManifest | null = null;
let manifestPromise: Promise<GppManifest | null> | null = null;

async function fetchManifest(): Promise<GppManifest | null> {
  if (manifestCache) return manifestCache;
  if (manifestPromise) return manifestPromise;

  manifestPromise = fetch(GPP_PHOTOS_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch photos manifest: ${res.status}`);
      return res.json() as Promise<GppManifest>;
    })
    .then((data) => {
      manifestCache = data;
      return data;
    })
    .catch((err) => {
      console.error('Error fetching GPP photos manifest:', err);
      manifestPromise = null; // allow retry on failure
      return null;
    });

  return manifestPromise;
}

interface PhotoItem {
  url: string;
  year: number;
  index: number;
}

interface LastYearPhotosProps {
  customUrl: string;
}

export function LastYearPhotos({ customUrl }: LastYearPhotosProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [cityName, setCityName] = useState('');
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const manifest = await fetchManifest();
      if (cancelled || !manifest) {
        if (!cancelled) setLoading(false);
        return;
      }

      // Match city: normalize DOW name to lowercase-no-spaces, compare with customUrl
      const normalizedCustomUrl = customUrl.toLowerCase().replace(/\s+/g, '');
      const city = manifest.cities.find(
        (c) => c.name.toLowerCase().replace(/\s+/g, '') === normalizedCustomUrl
      );

      if (!city || city.years.length === 0) {
        if (!cancelled) setLoading(false);
        return;
      }

      // Use the most recent year's photos
      const sortedYears = [...city.years].sort((a, b) => b.year - a.year);
      const latestYear = sortedYears[0];

      const photoItems: PhotoItem[] = latestYear.photos.map((p, i) => ({
        url: `${GPP_BASE_URL}${p.src}`,
        year: latestYear.year,
        index: i + 1,
      }));

      if (!cancelled) {
        setCityName(city.name);
        setPhotos(photoItems);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customUrl]);

  // Carousel scroll helpers
  const scroll = useCallback((direction: 'left' | 'right') => {
    const container = scrollRef.current;
    if (!container) return;
    const scrollAmount = container.clientWidth * 0.8;
    container.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  }, []);

  // Lightbox navigation
  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  const navigateLightbox = useCallback(
    (direction: 'prev' | 'next') => {
      setLightboxIndex((current) => {
        if (current === null) return null;
        if (direction === 'prev') return current > 0 ? current - 1 : current;
        return current < photos.length - 1 ? current + 1 : current;
      });
    },
    [photos.length]
  );

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeLightbox();
      } else if (e.key === 'ArrowLeft') {
        navigateLightbox('prev');
      } else if (e.key === 'ArrowRight') {
        navigateLightbox('next');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxIndex, closeLightbox, navigateLightbox]);

  // Lock body scroll when lightbox is open
  useEffect(() => {
    if (lightboxIndex !== null) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [lightboxIndex]);

  // Don't render anything while loading or if no photos
  if (loading || photos.length === 0) return null;

  return (
    <div className="border-t border-theme-stroke pt-6 mt-6">
      <div className="card p-4 sm:p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <Camera className="w-5 h-5 text-[#ff393a]" />
          <h2 className="text-lg font-semibold text-theme-text">
            Last Year's Party{cityName ? ` in ${cityName}` : ''}
          </h2>
        </div>

        {/* Carousel */}
        <div className="relative group">
          {/* Left arrow — hidden on mobile */}
          <button
            onClick={() => scroll('left')}
            className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100"
            aria-label="Scroll left"
          >
            <ChevronLeft size={24} />
          </button>

          {/* Right arrow — hidden on mobile */}
          <button
            onClick={() => scroll('right')}
            className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100"
            aria-label="Scroll right"
          >
            <ChevronRight size={24} />
          </button>

          {/* Scrollable container */}
          <div
            ref={scrollRef}
            className="dow-carousel flex gap-3 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-2"
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <style>{`
              .dow-carousel::-webkit-scrollbar { display: none; }
            `}</style>
            {photos.map((photo, index) => (
              <button
                key={`${photo.year}-${photo.index}`}
                onClick={() => openLightbox(index)}
                className="flex-shrink-0 snap-start rounded-xl overflow-hidden cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-[#ff393a] focus:ring-offset-2 focus:ring-offset-transparent"
                style={{ width: 'min(280px, 75vw)', height: '200px' }}
              >
                <img
                  src={photo.url}
                  alt={`${cityName} pizza party ${photo.year} — photo ${photo.index}`}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>

          {/* Photo count */}
          <p className="text-theme-text-muted text-xs mt-2 text-center">
            {photos.length} photo{photos.length !== 1 ? 's' : ''} from {photos[0]?.year}
          </p>
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxIndex !== null &&
        photos[lightboxIndex] &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
            onClick={closeLightbox}
          >
            {/* Close button */}
            <button
              onClick={closeLightbox}
              className="absolute top-4 right-4 text-white/60 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
              aria-label="Close"
            >
              <X size={24} />
            </button>

            {/* Previous arrow */}
            {lightboxIndex > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateLightbox('prev');
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
                aria-label="Previous photo"
              >
                <ChevronLeft size={32} />
              </button>
            )}

            {/* Next arrow */}
            {lightboxIndex < photos.length - 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateLightbox('next');
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
                aria-label="Next photo"
              >
                <ChevronRight size={32} />
              </button>
            )}

            {/* Image */}
            <div
              className="max-w-[90vw] max-h-[90vh] flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={photos[lightboxIndex].url}
                alt={`${cityName} pizza party ${photos[lightboxIndex].year} — photo ${photos[lightboxIndex].index}`}
                className="max-w-full max-h-[85vh] object-contain rounded-lg"
              />
            </div>

            {/* Counter */}
            <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/60 text-sm">
              {lightboxIndex + 1} of {photos.length}
            </p>
          </div>,
          document.body
        )}
    </div>
  );
}
