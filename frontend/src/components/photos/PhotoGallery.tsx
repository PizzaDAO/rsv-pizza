import React, { useState, useEffect, useCallback } from 'react';
import { Camera, Star, Loader2, Upload, Filter } from 'lucide-react';
import { Photo, PhotoStats } from '../../types';
import { getPartyPhotos, getPhotoStats, updatePhoto, deletePhoto } from '../../lib/api';
import { PhotoCard } from './PhotoCard';
import { PhotoModal } from './PhotoModal';
import { PhotoUpload } from './PhotoUpload';

interface PhotoGalleryProps {
  partyId: string;
  isHost?: boolean;
  uploaderName?: string;
  uploaderEmail?: string;
  guestId?: string;
}

type FilterOption = 'all' | 'starred';

export const PhotoGallery: React.FC<PhotoGalleryProps> = ({
  partyId,
  isHost = false,
  uploaderName,
  uploaderEmail,
  guestId,
}) => {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [stats, setStats] = useState<PhotoStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPhotos = useCallback(async (reset = false) => {
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const offset = reset ? 0 : photos.length;
      const result = await getPartyPhotos(partyId, {
        starred: filter === 'starred' ? true : undefined,
        limit: 20,
        offset,
      });

      if (result) {
        if (reset) {
          setPhotos(result.photos);
        } else {
          setPhotos(prev => [...prev, ...result.photos]);
        }
        setHasMore(result.photos.length + offset < result.total);
      } else {
        setError('Failed to load photos');
      }
    } catch (err) {
      setError('Failed to load photos');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [partyId, filter, photos.length]);

  const loadStats = useCallback(async () => {
    const result = await getPhotoStats(partyId);
    if (result) {
      setStats(result);
    }
  }, [partyId]);

  // Initial load
  useEffect(() => {
    loadPhotos(true);
    loadStats();
  }, [partyId, filter]);

  const handleUploadComplete = (photo: Photo) => {
    setPhotos(prev => [photo, ...prev]);
    loadStats(); // Refresh stats
  };

  const handleStar = async (photoId: string, starred: boolean) => {
    const result = await updatePhoto(partyId, photoId, { starred });
    if (result) {
      setPhotos(prev =>
        prev.map(p => (p.id === photoId ? result.photo : p))
      );
      if (selectedPhoto?.id === photoId) {
        setSelectedPhoto(result.photo);
      }
      loadStats();
    }
  };

  const handleDelete = async (photoId: string) => {
    const success = await deletePhoto(partyId, photoId, uploaderEmail);
    if (success) {
      setPhotos(prev => prev.filter(p => p.id !== photoId));
      loadStats();
    }
  };

  const handleUpdateCaption = async (photoId: string, caption: string) => {
    const result = await updatePhoto(partyId, photoId, { caption });
    if (result) {
      setPhotos(prev =>
        prev.map(p => (p.id === photoId ? result.photo : p))
      );
      if (selectedPhoto?.id === photoId) {
        setSelectedPhoto(result.photo);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-[#ff393a] animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400">{error}</p>
        <button
          onClick={() => loadPhotos(true)}
          className="mt-4 text-[#ff393a] hover:text-[#ff5a5b] font-medium"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Stats and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Camera size={20} className="text-[#ff393a]" />
            Photos
            {stats && stats.totalPhotos > 0 && (
              <span className="text-white/50 font-normal text-sm">
                ({stats.totalPhotos})
              </span>
            )}
          </h2>

          {stats && stats.starredPhotos > 0 && (
            <div className="flex items-center gap-1 text-yellow-400 text-sm">
              <Star size={14} className="fill-current" />
              <span>{stats.starredPhotos} starred</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Filter */}
          {stats && stats.starredPhotos > 0 && (
            <div className="flex items-center bg-white/5 rounded-lg p-1">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-[#ff393a] text-white'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('starred')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${
                  filter === 'starred'
                    ? 'bg-[#ff393a] text-white'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                <Star size={14} />
                Starred
              </button>
            </div>
          )}

          {/* Upload Button */}
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Upload size={16} />
            <span className="hidden sm:inline">Upload</span>
          </button>
        </div>
      </div>

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/70 flex items-start justify-center pt-20 p-4 z-50">
          <div className="max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <PhotoUpload
              partyId={partyId}
              uploaderName={uploaderName}
              uploaderEmail={uploaderEmail}
              guestId={guestId}
              onUploadComplete={handleUploadComplete}
              onClose={() => setShowUpload(false)}
            />
          </div>
        </div>
      )}

      {/* Photo Grid */}
      {photos.length === 0 ? (
        <div className="text-center py-12 bg-white/5 rounded-xl">
          <Camera className="w-12 h-12 text-white/20 mx-auto mb-3" />
          <p className="text-white/60 mb-4">
            {filter === 'starred' ? 'No starred photos yet' : 'No photos yet'}
          </p>
          {filter === 'all' && (
            <button
              onClick={() => setShowUpload(true)}
              className="inline-flex items-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Upload size={16} />
              Upload First Photo
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                isHost={isHost}
                onClick={() => setSelectedPhoto(photo)}
                onStar={handleStar}
                onDelete={handleDelete}
              />
            ))}
          </div>

          {/* Load More */}
          {hasMore && (
            <div className="text-center pt-4">
              <button
                onClick={() => loadPhotos(false)}
                disabled={loadingMore}
                className="text-[#ff393a] hover:text-[#ff5a5b] font-medium flex items-center gap-2 mx-auto"
              >
                {loadingMore ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Loading...
                  </>
                ) : (
                  'Load More Photos'
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* Photo Modal */}
      {selectedPhoto && (
        <PhotoModal
          photo={selectedPhoto}
          photos={photos}
          isHost={isHost}
          onClose={() => setSelectedPhoto(null)}
          onNavigate={setSelectedPhoto}
          onStar={handleStar}
          onDelete={handleDelete}
          onUpdateCaption={handleUpdateCaption}
        />
      )}
    </div>
  );
};
