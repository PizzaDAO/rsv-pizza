import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

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
    <div className="space-y-4">
      {/* Header */}
      <h2 className="text-lg font-semibold text-theme-text">
        Last Year's Party{cityName ? ` in ${cityName}` : ''}
        <span className="text-theme-text-muted font-normal text-sm ml-2">
          ({photos.length})
        </span>
      </h2>

      {/* Photo Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {photos.map((photo, index) => (
          <div
            key={`${photo.year}-${photo.index}`}
            className="group relative aspect-square rounded-xl overflow-hidden bg-theme-surface cursor-pointer"
            onClick={() => openLightbox(index)}
          >
            <img
              src={photo.url}
              alt={`${cityName} pizza party ${photo.year} — photo ${photo.index}`}
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
          </div>
        ))}
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
