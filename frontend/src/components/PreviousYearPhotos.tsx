import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  X,
  Eye,
  EyeOff,
  Upload,
  Loader2,
  Trash2,
  Image as ImageIcon,
} from 'lucide-react';
import { usePizza } from '../contexts/PizzaContext';
import { updateParty, uploadEventPhoto } from '../lib/supabase';

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
      manifestPromise = null;
      return null;
    });

  return manifestPromise;
}

interface PhotoItem {
  src: string; // The raw src path from manifest (used as identifier)
  url: string; // Full URL for display
  year: number;
  index: number;
  isExtra?: boolean; // Host-uploaded photo
}

export function PreviousYearPhotos() {
  const { party, loadParty } = usePizza();
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [cityName, setCityName] = useState('');
  const [loading, setLoading] = useState(true);
  const [hiddenSrcs, setHiddenSrcs] = useState<Set<string>>(new Set());
  const [extraPhotos, setExtraPhotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showUploadArea, setShowUploadArea] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize from party data
  useEffect(() => {
    if (party) {
      setHiddenSrcs(new Set(party.hiddenGppPhotos || []));
      setExtraPhotos(party.extraGppPhotos || []);
    }
  }, [party?.hiddenGppPhotos, party?.extraGppPhotos]);

  // Fetch manifest photos
  useEffect(() => {
    if (!party?.customUrl) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      const manifest = await fetchManifest();
      if (cancelled || !manifest) {
        if (!cancelled) setLoading(false);
        return;
      }

      const normalizedCustomUrl = party.customUrl!.toLowerCase().replace(/\s+/g, '');
      const city = manifest.cities.find(
        (c) => c.name.toLowerCase().replace(/\s+/g, '') === normalizedCustomUrl
      );

      if (!city || city.years.length === 0) {
        if (!cancelled) setLoading(false);
        return;
      }

      // Collect all years' photos, sorted by year (most recent first)
      const sortedYears = [...city.years].sort((a, b) => b.year - a.year);
      const allPhotos: PhotoItem[] = [];
      for (const yearData of sortedYears) {
        for (let i = 0; i < yearData.photos.length; i++) {
          allPhotos.push({
            src: yearData.photos[i].src,
            url: `${GPP_BASE_URL}${yearData.photos[i].src}`,
            year: yearData.year,
            index: i + 1,
          });
        }
      }

      if (!cancelled) {
        setCityName(city.name);
        setPhotos(allPhotos);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [party?.customUrl]);

  // Build the combined list of all photos (manifest + extra)
  const allPhotos: PhotoItem[] = [
    ...photos,
    ...extraPhotos.map((url, i) => ({
      src: url, // Use URL as identifier for extras
      url,
      year: 0,
      index: i + 1,
      isExtra: true,
    })),
  ];

  const visibleCount = allPhotos.filter((p) => !hiddenSrcs.has(p.src)).length;
  const hiddenCount = allPhotos.filter((p) => hiddenSrcs.has(p.src)).length;

  // Toggle visibility
  const togglePhoto = useCallback(
    async (src: string) => {
      if (!party) return;

      const newHidden = new Set(hiddenSrcs);
      if (newHidden.has(src)) {
        newHidden.delete(src);
      } else {
        newHidden.add(src);
      }

      // Optimistic update
      setHiddenSrcs(newHidden);

      setSaving(true);
      const success = await updateParty(party.id, {
        hidden_gpp_photos: Array.from(newHidden),
      });
      setSaving(false);

      if (!success) {
        // Revert on failure
        setHiddenSrcs(hiddenSrcs);
        if (party.inviteCode) {
          loadParty(party.inviteCode);
        }
      }
    },
    [party, hiddenSrcs, loadParty]
  );

  // Remove an extra photo
  const removeExtraPhoto = useCallback(
    async (url: string) => {
      if (!party) return;

      const newExtras = extraPhotos.filter((u) => u !== url);

      // Also remove from hidden if it was hidden
      const newHidden = new Set(hiddenSrcs);
      newHidden.delete(url);

      // Optimistic update
      setExtraPhotos(newExtras);
      setHiddenSrcs(newHidden);

      setSaving(true);
      const success = await updateParty(party.id, {
        extra_gpp_photos: newExtras,
        hidden_gpp_photos: Array.from(newHidden),
      });
      setSaving(false);

      if (!success) {
        // Revert
        setExtraPhotos(extraPhotos);
        setHiddenSrcs(hiddenSrcs);
        if (party.inviteCode) {
          loadParty(party.inviteCode);
        }
      }
    },
    [party, extraPhotos, hiddenSrcs, loadParty]
  );

  // Upload handler
  const handleUploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!party) return;

      setUploading(true);
      const newUrls: string[] = [];

      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > 10 * 1024 * 1024) continue;

        const result = await uploadEventPhoto(file, party.id);
        if (result) {
          newUrls.push(result.url);
        }
      }

      if (newUrls.length > 0) {
        const updatedExtras = [...extraPhotos, ...newUrls];
        setExtraPhotos(updatedExtras);

        const success = await updateParty(party.id, {
          extra_gpp_photos: updatedExtras,
        });

        if (!success) {
          setExtraPhotos(extraPhotos);
          if (party.inviteCode) {
            loadParty(party.inviteCode);
          }
        }
      }

      setUploading(false);
      setShowUploadArea(false);
    },
    [party, extraPhotos, loadParty]
  );

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
        return current < allPhotos.length - 1 ? current + 1 : current;
      });
    },
    [allPhotos.length]
  );

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') navigateLightbox('prev');
      else if (e.key === 'ArrowRight') navigateLightbox('next');
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

  // Only show for GPP events with a customUrl
  if (!party || party.eventType !== 'gpp' || !party.customUrl) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 text-[#ff393a] animate-spin" />
      </div>
    );
  }

  // Show even if no manifest photos — host might want to upload extras
  if (allPhotos.length === 0 && !showUploadArea) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-theme-text">
            Photos from Previous Years
          </h2>
          <button
            onClick={() => setShowUploadArea(true)}
            className="flex items-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm"
          >
            <Upload size={16} />
            Upload
          </button>
        </div>

        <div className="text-center py-8 bg-theme-surface rounded-xl">
          <ImageIcon className="w-10 h-10 text-theme-text-faint mx-auto mb-3" />
          <p className="text-theme-text-secondary text-sm">
            {photos.length === 0
              ? 'No previous year photos found for this city. Upload your own!'
              : 'No photos to display.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-theme-text">
          Photos from Previous Years{cityName ? ` in ${cityName}` : ''}
          <span className="text-theme-text-muted font-normal text-sm ml-2">
            ({visibleCount} visible{hiddenCount > 0 ? `, ${hiddenCount} hidden` : ''})
          </span>
        </h2>

        <div className="flex items-center gap-2">
          {saving && (
            <span className="text-theme-text-muted text-xs flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              Saving...
            </span>
          )}
          <button
            onClick={() => setShowUploadArea(true)}
            className="flex items-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm"
          >
            <Upload size={16} />
            <span className="hidden sm:inline">Upload</span>
          </button>
        </div>
      </div>

      <p className="text-theme-text-muted text-xs">
        Click the eye icon to show/hide photos on your public event page. Hidden photos will not be visible to guests.
      </p>

      {/* Photo Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {allPhotos.map((photo, index) => {
          const isHidden = hiddenSrcs.has(photo.src);
          return (
            <div
              key={photo.src}
              className={`group relative aspect-square rounded-xl overflow-hidden bg-theme-surface ${
                isHidden ? 'opacity-40' : ''
              }`}
            >
              {/* Image */}
              <img
                src={photo.url}
                alt={
                  photo.isExtra
                    ? `Uploaded photo ${photo.index}`
                    : `${cityName} ${photo.year} - photo ${photo.index}`
                }
                loading="lazy"
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => openLightbox(index)}
              />

              {/* Overlay gradient */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />

              {/* Year badge */}
              {photo.year > 0 && (
                <span className="absolute top-2 left-2 text-[10px] font-medium bg-black/60 text-white/80 px-2 py-0.5 rounded-full">
                  {photo.year}
                </span>
              )}
              {photo.isExtra && (
                <span className="absolute top-2 left-2 text-[10px] font-medium bg-[#ff393a]/80 text-white px-2 py-0.5 rounded-full">
                  Uploaded
                </span>
              )}

              {/* Action buttons */}
              <div className="absolute bottom-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePhoto(photo.src);
                  }}
                  className={`p-1.5 rounded-full transition-colors ${
                    isHidden
                      ? 'bg-red-500/80 text-white hover:bg-red-500'
                      : 'bg-white/20 text-white hover:bg-white/30'
                  }`}
                  title={isHidden ? 'Show on event page' : 'Hide from event page'}
                >
                  {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>

                {photo.isExtra && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeExtraPhoto(photo.url);
                    }}
                    className="p-1.5 rounded-full bg-white/20 text-white hover:bg-red-500/80 transition-colors"
                    title="Remove uploaded photo"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Upload Modal */}
      {showUploadArea &&
        createPortal(
          <UploadModal
            uploading={uploading}
            dragging={dragging}
            setDragging={setDragging}
            fileInputRef={fileInputRef}
            onFiles={handleUploadFiles}
            onClose={() => setShowUploadArea(false)}
          />,
          document.body
        )}

      {/* Lightbox Modal */}
      {lightboxIndex !== null &&
        allPhotos[lightboxIndex] &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
            onClick={closeLightbox}
          >
            <button
              onClick={closeLightbox}
              className="absolute top-4 right-4 text-white/60 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
              aria-label="Close"
            >
              <X size={24} />
            </button>

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

            {lightboxIndex < allPhotos.length - 1 && (
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

            <div
              className="max-w-[90vw] max-h-[90vh] flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={allPhotos[lightboxIndex].url}
                alt={`Photo ${lightboxIndex + 1} of ${allPhotos.length}`}
                className="max-w-full max-h-[85vh] object-contain rounded-lg"
              />
            </div>

            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4">
              <p className="text-white/60 text-sm">
                {lightboxIndex + 1} of {allPhotos.length}
                {allPhotos[lightboxIndex].year > 0 && ` - ${allPhotos[lightboxIndex].year}`}
                {allPhotos[lightboxIndex].isExtra && ' - Uploaded'}
              </p>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  togglePhoto(allPhotos[lightboxIndex!].src);
                }}
                className={`p-2 rounded-full transition-colors ${
                  hiddenSrcs.has(allPhotos[lightboxIndex].src)
                    ? 'bg-red-500/80 text-white hover:bg-red-500'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
                title={
                  hiddenSrcs.has(allPhotos[lightboxIndex].src)
                    ? 'Show on event page'
                    : 'Hide from event page'
                }
              >
                {hiddenSrcs.has(allPhotos[lightboxIndex].src) ? (
                  <EyeOff size={18} />
                ) : (
                  <Eye size={18} />
                )}
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

// Upload modal sub-component
function UploadModal({
  uploading,
  dragging,
  setDragging,
  fileInputRef,
  onFiles,
  onClose,
}: {
  uploading: boolean;
  dragging: boolean;
  setDragging: (v: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | File[]) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-20 p-4 z-50 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="max-w-lg w-full bg-theme-header border border-theme-stroke rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-theme-text">
            Upload Previous Year Photos
          </h3>
          <button
            onClick={onClose}
            className="text-theme-text-secondary hover:text-theme-text transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-theme-text-muted text-xs mb-4">
          Upload your own photos from previous years. These will appear alongside the
          app.gpp.day photos on your public event page.
        </p>

        <div
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFiles(e.dataTransfer.files);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragging(false);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
            dragging
              ? 'border-[#ff393a] bg-[#ff393a]/10'
              : 'border-theme-stroke-hover hover:border-[#ff393a]/50 hover:bg-theme-surface'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            onChange={(e) => e.target.files && onFiles(e.target.files)}
            className="hidden"
          />

          {uploading ? (
            <>
              <Loader2 className="w-10 h-10 text-[#ff393a] mx-auto mb-3 animate-spin" />
              <p className="text-theme-text-secondary">Uploading...</p>
            </>
          ) : (
            <>
              <Upload className="w-10 h-10 text-theme-text-muted mx-auto mb-3" />
              <p className="text-theme-text-secondary mb-1">
                Drag and drop photos here
              </p>
              <p className="text-theme-text-muted text-sm">or click to select files</p>
              <p className="text-theme-text-faint text-xs mt-2">
                Max 10MB per photo. JPEG, PNG, WebP, GIF
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
