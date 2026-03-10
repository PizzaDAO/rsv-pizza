import React, { useState } from 'react';
import { X, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { VenuePhoto } from '../../types';
import { deleteVenuePhoto } from '../../lib/api';

interface VenuePhotoGalleryProps {
  photos: VenuePhoto[];
  partyId: string;
  venueId: string;
  onPhotoDeleted: () => void;
  readOnly?: boolean;
}

export const VenuePhotoGallery: React.FC<VenuePhotoGalleryProps> = ({
  photos,
  partyId,
  venueId,
  onPhotoDeleted,
  readOnly = false,
}) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent, photoId: string) => {
    e.stopPropagation();
    if (!confirm('Delete this photo?')) return;

    setDeleting(photoId);
    try {
      const success = await deleteVenuePhoto(partyId, venueId, photoId);
      if (success) {
        onPhotoDeleted();
      }
    } catch (error) {
      console.error('Error deleting venue photo:', error);
    } finally {
      setDeleting(null);
    }
  };

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
  };

  const closeLightbox = () => {
    setLightboxIndex(null);
  };

  const navigateLightbox = (direction: -1 | 1) => {
    if (lightboxIndex === null) return;
    const newIndex = lightboxIndex + direction;
    if (newIndex >= 0 && newIndex < photos.length) {
      setLightboxIndex(newIndex);
    }
  };

  if (photos.length === 0) return null;

  return (
    <>
      {/* Photo Grid */}
      <div className="grid grid-cols-3 gap-2">
        {photos.map((photo, index) => (
          <div
            key={photo.id}
            className="relative group cursor-pointer aspect-square rounded-lg overflow-hidden bg-theme-surface"
            onClick={() => openLightbox(index)}
          >
            <img
              src={photo.url}
              alt={photo.caption || photo.fileName}
              className="w-full h-full object-cover"
              loading="lazy"
            />

            {/* Category badge */}
            {photo.category && (
              <span className="absolute top-1 left-1 text-[10px] bg-black/60 text-theme-text px-1.5 py-0.5 rounded">
                {photo.category}
              </span>
            )}

            {/* Delete button (visible on hover, host only) */}
            {!readOnly && (
              <button
                type="button"
                onClick={(e) => handleDelete(e, photo.id)}
                disabled={deleting === photo.id}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-red-500/80 hover:bg-red-500 text-white p-1 rounded transition-all"
              >
                <Trash2 size={12} />
              </button>
            )}

            {/* Caption overlay */}
            {photo.caption && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                <p className="text-[10px] text-theme-text truncate">{photo.caption}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && photos[lightboxIndex] && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[60]"
          onClick={closeLightbox}
        >
          <button
            type="button"
            onClick={closeLightbox}
            className="absolute top-4 right-4 text-theme-text-secondary hover:text-theme-text z-10"
          >
            <X size={24} />
          </button>

          {/* Navigation */}
          {lightboxIndex > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigateLightbox(-1);
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text bg-black/30 hover:bg-black/50 p-2 rounded-full z-10"
            >
              <ChevronLeft size={24} />
            </button>
          )}

          {lightboxIndex < photos.length - 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigateLightbox(1);
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text bg-black/30 hover:bg-black/50 p-2 rounded-full z-10"
            >
              <ChevronRight size={24} />
            </button>
          )}

          <div
            className="max-w-4xl max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={photos[lightboxIndex].url}
              alt={photos[lightboxIndex].caption || photos[lightboxIndex].fileName}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            {photos[lightboxIndex].caption && (
              <p className="text-theme-text text-sm mt-3 text-center">{photos[lightboxIndex].caption}</p>
            )}
            <p className="text-theme-text-muted text-xs mt-1">
              {lightboxIndex + 1} of {photos.length}
            </p>
          </div>
        </div>
      )}
    </>
  );
};
