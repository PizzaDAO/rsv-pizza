import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Star, Download, Trash2, User, Calendar, Tag, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Photo } from '../../types';

interface PhotoModalProps {
  photo: Photo;
  photos: Photo[];
  isHost?: boolean;
  onClose: () => void;
  onNavigate?: (photo: Photo) => void;
  onStar?: (photoId: string, starred: boolean) => void;
  onDelete?: (photoId: string) => void;
  onUpdateCaption?: (photoId: string, caption: string) => void;
  onUpdateTags?: (photoId: string, tags: string[]) => void;
  onApprove?: (photoId: string) => void;
  onReject?: (photoId: string) => void;
}

export const PhotoModal: React.FC<PhotoModalProps> = ({
  photo,
  photos,
  isHost = false,
  onClose,
  onNavigate,
  onStar,
  onDelete,
  onUpdateCaption,
  onUpdateTags,
  onApprove,
  onReject,
}) => {
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionValue, setCaptionValue] = useState(photo.caption || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const currentIndex = photos.findIndex(p => p.id === photo.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < photos.length - 1;

  const navigatePrev = useCallback(() => {
    if (hasPrev) {
      onNavigate?.(photos[currentIndex - 1]);
    }
  }, [hasPrev, currentIndex, photos, onNavigate]);

  const navigateNext = useCallback(() => {
    if (hasNext) {
      onNavigate?.(photos[currentIndex + 1]);
    }
  }, [hasNext, currentIndex, photos, onNavigate]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        navigatePrev();
      } else if (e.key === 'ArrowRight') {
        navigateNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, navigatePrev, navigateNext]);

  // Update caption state when photo changes
  useEffect(() => {
    setCaptionValue(photo.caption || '');
    setEditingCaption(false);
  }, [photo]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = photo.url;
    link.download = photo.fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSaveCaption = () => {
    onUpdateCaption?.(photo.id, captionValue);
    setEditingCaption(false);
  };

  const handleDelete = () => {
    onDelete?.(photo.id);
    setShowDeleteConfirm(false);
    onClose();
  };

  const uploaderDisplayName = photo.guest?.name || photo.uploaderName || 'Anonymous';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close Button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-theme-text-secondary hover:text-theme-text p-2 rounded-full bg-theme-surface-hover hover:bg-theme-surface-hover transition-colors z-10"
      >
        <X size={24} />
      </button>

      {/* Navigation Arrows */}
      {hasPrev && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigatePrev();
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-theme-text-secondary hover:text-theme-text p-2 rounded-full bg-theme-surface-hover hover:bg-theme-surface-hover transition-colors z-10"
        >
          <ChevronLeft size={32} />
        </button>
      )}

      {hasNext && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigateNext();
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-theme-text-secondary hover:text-theme-text p-2 rounded-full bg-theme-surface-hover hover:bg-theme-surface-hover transition-colors z-10"
        >
          <ChevronRight size={32} />
        </button>
      )}

      {/* Main Content */}
      <div
        className="flex flex-col md:flex-row max-w-6xl w-full max-h-[90vh] mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Photo */}
        <div className="flex-1 flex items-center justify-center min-h-0">
          <img
            src={photo.url}
            alt={photo.caption || 'Event photo'}
            className="max-w-full max-h-[70vh] md:max-h-[85vh] object-contain rounded-lg"
          />
        </div>

        {/* Info Panel */}
        <div className="w-full md:w-80 bg-theme-header p-4 md:p-6 md:ml-4 rounded-lg md:rounded-l-none overflow-y-auto">
          {/* Uploader Info */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-[#ff393a]/20 flex items-center justify-center">
              <User size={20} className="text-[#ff393a]" />
            </div>
            <div>
              <p className="text-theme-text font-medium">{uploaderDisplayName}</p>
              <p className="text-theme-text-muted text-sm flex items-center gap-1">
                <Calendar size={12} />
                {formatDate(photo.createdAt)}
              </p>
            </div>
          </div>

          {/* Status Badge + Approve/Reject */}
          {photo.status === 'pending' && (
            <div className="mb-4">
              <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-2">
                <Clock size={16} className="text-amber-400" />
                <span className="text-amber-400 text-sm font-medium">Pending Review</span>
              </div>
              {isHost && onApprove && onReject && (
                <div className="flex gap-2">
                  <button
                    onClick={() => onApprove(photo.id)}
                    className="flex-1 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-medium py-2.5 rounded-lg transition-colors"
                  >
                    <CheckCircle2 size={18} />
                    Approve
                  </button>
                  <button
                    onClick={() => onReject(photo.id)}
                    className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white font-medium py-2.5 rounded-lg transition-colors"
                  >
                    <XCircle size={18} />
                    Reject
                  </button>
                </div>
              )}
            </div>
          )}

          {photo.status === 'rejected' && (
            <div className="mb-4">
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <XCircle size={16} className="text-red-400" />
                <span className="text-red-400 text-sm font-medium">Rejected</span>
              </div>
              {isHost && onApprove && (
                <button
                  onClick={() => onApprove(photo.id)}
                  className="w-full mt-2 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-medium py-2.5 rounded-lg transition-colors"
                >
                  <CheckCircle2 size={18} />
                  Approve
                </button>
              )}
            </div>
          )}

          {/* Caption */}
          <div className="mb-4">
            {editingCaption ? (
              <div className="space-y-2">
                <textarea
                  value={captionValue}
                  onChange={(e) => setCaptionValue(e.target.value)}
                  placeholder="Add a caption..."
                  className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] resize-none"
                  rows={3}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveCaption}
                    className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] text-white text-sm font-medium py-1.5 rounded-lg transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setCaptionValue(photo.caption || '');
                      setEditingCaption(false);
                    }}
                    className="flex-1 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text text-sm font-medium py-1.5 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {photo.caption ? (
                  <p className="text-theme-text">{photo.caption}</p>
                ) : isHost ? (
                  <button
                    onClick={() => setEditingCaption(true)}
                    className="text-theme-text-muted hover:text-theme-text-secondary text-sm"
                  >
                    Add a caption...
                  </button>
                ) : null}
                {isHost && photo.caption && (
                  <button
                    onClick={() => setEditingCaption(true)}
                    className="text-theme-text-muted hover:text-theme-text-secondary text-xs mt-1"
                  >
                    Edit caption
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Tags */}
          {photo.tags.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 text-theme-text-secondary text-sm mb-2">
                <Tag size={14} />
                <span>Tags</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {photo.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="bg-theme-surface-hover text-theme-text text-xs px-2 py-1 rounded-full"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2 border-t border-theme-stroke pt-4">
            <button
              onClick={handleDownload}
              className="w-full flex items-center justify-center gap-2 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text font-medium py-2.5 rounded-lg transition-colors"
            >
              <Download size={18} />
              Download
            </button>

            {isHost && (
              <>
                <button
                  onClick={() => onStar?.(photo.id, !photo.starred)}
                  className={`w-full flex items-center justify-center gap-2 font-medium py-2.5 rounded-lg transition-colors ${
                    photo.starred
                      ? 'bg-yellow-400/20 text-yellow-400 hover:bg-yellow-400/30'
                      : 'bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text'
                  }`}
                >
                  <Star size={18} className={photo.starred ? 'fill-current' : ''} />
                  {photo.starred ? 'Starred' : 'Star Photo'}
                </button>

                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium py-2.5 rounded-lg transition-colors"
                >
                  <Trash2 size={18} />
                  Delete Photo
                </button>
              </>
            )}
          </div>

          {/* Photo Counter */}
          <p className="text-center text-theme-text-muted text-sm mt-4">
            {currentIndex + 1} of {photos.length}
          </p>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 p-4">
          <div
            className="bg-theme-header border border-theme-stroke rounded-2xl p-6 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-theme-text mb-3">Delete Photo?</h3>
            <p className="text-theme-text-secondary mb-6">
              This action cannot be undone. The photo will be permanently removed.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text font-medium py-2.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white font-medium py-2.5 rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
