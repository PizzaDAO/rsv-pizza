import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Star, Download, Trash2, User, Calendar, Tag, CheckCircle2, XCircle, Clock, MessageSquare, ThumbsUp } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Photo } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { togglePhotoVote, togglePayoutPhotoVote } from '../../lib/api';
import { MediaThumb } from './MediaThumb';

interface PhotoModalProps {
  photo: Photo;
  photos: Photo[];
  isHost?: boolean;
  availableTags?: string[];
  onClose: () => void;
  onNavigate?: (photo: Photo) => void;
  onStar?: (photoId: string, starred: boolean) => void;
  onDelete?: (photoId: string) => void;
  onUpdateCaption?: (photoId: string, caption: string) => void;
  onUpdateTags?: (photoId: string, tags: string[]) => void;
  onUpdateYear?: (photoId: string, year: number | null) => void;
  onApprove?: (photoId: string) => void;
  onReject?: (photoId: string) => void;
  // salame-58195: thumbs-up vote toggled — parent updates local list.
  onVoteChange?: (photoId: string, next: { voteCount: number; votedByMe: boolean }) => void;
}

export const PhotoModal: React.FC<PhotoModalProps> = ({
  photo,
  photos,
  isHost = false,
  availableTags = [],
  onClose,
  onNavigate,
  onStar,
  onDelete,
  onUpdateCaption,
  onUpdateTags,
  onUpdateYear,
  onApprove,
  onReject,
  onVoteChange,
}) => {
  // napoletana-58210: payout-sourced rows hide star/delete/tag-edit
  // affordances and route vote toggles to a different endpoint.
  const isPayoutSource = photo.source === 'payout';

  // salame-58195: thumbs-up voting
  const { user } = useAuth();
  const [voting, setVoting] = useState(false);
  const handleVote = async () => {
    if (!user || voting) return;
    setVoting(true);
    // napoletana-58210: route to the source-specific vote endpoint.
    const res = isPayoutSource && photo.payoutId
      ? await togglePayoutPhotoVote(photo.payoutId, photo.id)
      : await togglePhotoVote(photo.partyId, photo.id);
    setVoting(false);
    if (res && onVoteChange) {
      onVoteChange(photo.id, { voteCount: res.voteCount, votedByMe: res.voted });
    }
  };

  const [editingCaption, setEditingCaption] = useState(false);
  const [captionValue, setCaptionValue] = useState(photo.caption || '');
  const [editingTags, setEditingTags] = useState(false);
  const [tagValues, setTagValues] = useState<string[]>(photo.tags || []);
  const [editingYear, setEditingYear] = useState(false);
  const [yearValue, setYearValue] = useState<number | null>(photo.photoYear);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: currentYear - 2010 + 1 }, (_, i) => currentYear - i);

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

  // nduja-58297: swipe-to-navigate on the photo container (mobile).
  // Threshold: 50px horizontal AND horizontal dominant over vertical so
  // info-panel vertical scrolling doesn't get hijacked.
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) { touchStartXRef.current = null; return; }
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    const dy = e.changedTouches[0].clientY - touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0 && hasPrev) navigatePrev();
    else if (dx < 0 && hasNext) navigateNext();
  };

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

  // Update caption, tags, and year state when photo changes
  useEffect(() => {
    setCaptionValue(photo.caption || '');
    setEditingCaption(false);
    setTagValues(photo.tags || []);
    setEditingTags(false);
    setYearValue(photo.photoYear);
    setEditingYear(false);
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

  const handleSaveYear = () => {
    onUpdateYear?.(photo.id, yearValue);
    setEditingYear(false);
  };

  const handleToggleTag = (tag: string) => {
    setTagValues(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleSaveTags = () => {
    onUpdateTags?.(photo.id, tagValues);
    setEditingTags(false);
  };

  const handleDelete = () => {
    onDelete?.(photo.id);
    setShowDeleteConfirm(false);
    onClose();
  };

  const uploaderDisplayName = photo.guest?.name || photo.uploaderName || 'Anonymous';
  const isVideo = photo.mimeType?.startsWith('video/');

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close Button */}
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-3 right-3 sm:top-4 sm:right-4 p-2 sm:p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors z-20"
        style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}
      >
        <X size={28} strokeWidth={2.5} />
      </button>

      {/* Navigation Arrows */}
      {hasPrev && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigatePrev();
          }}
          aria-label="Previous photo"
          className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 p-2 sm:p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors z-20"
          style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}
        >
          <ChevronLeft size={32} strokeWidth={2.5} />
        </button>
      )}

      {hasNext && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigateNext();
          }}
          aria-label="Next photo"
          className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 p-2 sm:p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors z-20"
          style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}
        >
          <ChevronRight size={32} strokeWidth={2.5} />
        </button>
      )}

      {/* Main Content */}
      <div
        className="flex flex-col md:flex-row max-w-6xl w-full max-h-[90vh] mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Photo/Video */}
        <div
          className="flex-1 flex items-center justify-center min-h-0"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <MediaThumb
            key={photo.id}
            src={photo.url}
            mimeType={photo.mimeType}
            alt={photo.caption || 'Event photo'}
            mode="full"
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
                {photo.photoYear
                  ? `${photo.photoYear} (uploaded ${formatDate(photo.createdAt)})`
                  : formatDate(photo.createdAt)
                }
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
                <IconInput
                  icon={MessageSquare}
                  multiline
                  rows={3}
                  value={captionValue}
                  onChange={(e) => setCaptionValue(e.target.value)}
                  placeholder="Add a caption..."
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
                ) : isHost && !isPayoutSource ? (
                  <button
                    onClick={() => setEditingCaption(true)}
                    className="text-theme-text-muted hover:text-theme-text-secondary text-sm"
                  >
                    Add a caption...
                  </button>
                ) : null}
                {isHost && !isPayoutSource && photo.caption && (
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
          {editingTags ? (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 text-theme-text-secondary text-sm mb-2">
                <Tag size={14} />
                <span>Tags</span>
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {availableTags.map((tag) => {
                  const isSelected = tagValues.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => handleToggleTag(tag)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        isSelected
                          ? 'bg-[#ff393a] border-[#ff393a] text-white'
                          : 'bg-transparent border-theme-stroke text-theme-text-secondary hover:border-[#ff393a]/50 hover:text-theme-text'
                      }`}
                    >
                      #{tag}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveTags}
                  className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] text-white text-sm font-medium py-1.5 rounded-lg transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setTagValues(photo.tags || []);
                    setEditingTags(false);
                  }}
                  className="flex-1 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text text-sm font-medium py-1.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-4">
              {photo.tags.length > 0 ? (
                <>
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
                  {isHost && !isPayoutSource && onUpdateTags && availableTags.length > 0 && (
                    <button
                      onClick={() => setEditingTags(true)}
                      className="text-theme-text-muted hover:text-theme-text-secondary text-xs mt-1"
                    >
                      Edit tags
                    </button>
                  )}
                </>
              ) : isHost && !isPayoutSource && onUpdateTags && availableTags.length > 0 ? (
                <button
                  onClick={() => setEditingTags(true)}
                  className="text-theme-text-muted hover:text-theme-text-secondary text-sm flex items-center gap-1"
                >
                  <Tag size={14} />
                  Add tags...
                </button>
              ) : null}
            </div>
          )}

          {/* Year */}
          {editingYear ? (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 text-theme-text-secondary text-sm mb-2">
                <Calendar size={14} />
                <span>Year Taken</span>
              </div>
              <select
                value={yearValue || ''}
                onChange={(e) => setYearValue(e.target.value ? parseInt(e.target.value, 10) : null)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] appearance-none cursor-pointer mb-2"
              >
                <option value="" className="bg-[#1a1a2e] text-white">No year (use upload date)</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year} className="bg-[#1a1a2e] text-white">
                    {year}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveYear}
                  className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] text-white text-sm font-medium py-1.5 rounded-lg transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setYearValue(photo.photoYear);
                    setEditingYear(false);
                  }}
                  className="flex-1 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text text-sm font-medium py-1.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : isHost && !isPayoutSource && onUpdateYear ? (
            <div className="mb-4">
              {photo.photoYear ? (
                <div>
                  <div className="flex items-center gap-1.5 text-theme-text-secondary text-sm mb-1">
                    <Calendar size={14} />
                    <span>Year Taken: {photo.photoYear}</span>
                  </div>
                  <button
                    onClick={() => setEditingYear(true)}
                    className="text-theme-text-muted hover:text-theme-text-secondary text-xs"
                  >
                    Edit year
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditingYear(true)}
                  className="text-theme-text-muted hover:text-theme-text-secondary text-sm flex items-center gap-1"
                >
                  <Calendar size={14} />
                  Set year taken...
                </button>
              )}
            </div>
          ) : photo.photoYear ? (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 text-theme-text-secondary text-sm">
                <Calendar size={14} />
                <span>Year Taken: {photo.photoYear}</span>
              </div>
            </div>
          ) : null}

          {/* Actions */}
          <div className="space-y-2 border-t border-theme-stroke pt-4">
            {/* salame-58195: thumbs-up vote (approved photos only) */}
            {photo.status === 'approved' && (
              <button
                onClick={handleVote}
                disabled={!user || voting}
                title={user ? (photo.votedByMe ? 'Remove vote' : 'Thumbs up') : 'Log in to vote'}
                className={`w-full flex items-center justify-center gap-2 font-medium py-2.5 rounded-lg transition-colors ${
                  photo.votedByMe
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-theme-surface-hover text-theme-text hover:bg-white/15'
                } ${!user || voting ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <ThumbsUp size={18} fill={photo.votedByMe ? 'currentColor' : 'none'} />
                {photo.voteCount > 0 ? `${photo.voteCount}` : ''} {photo.votedByMe ? 'Voted' : 'Thumbs up'}
              </button>
            )}

            <button
              onClick={handleDownload}
              className="w-full flex items-center justify-center gap-2 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text font-medium py-2.5 rounded-lg transition-colors"
            >
              <Download size={18} />
              Download
            </button>

            {/* napoletana-58210: host star/delete affordances don't apply to
                payout-sourced rows — hide them to avoid 404s + confusion. */}
            {isHost && !isPayoutSource && (
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
                  {photo.starred ? 'Starred' : isVideo ? 'Star Video' : 'Star Photo'}
                </button>

                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium py-2.5 rounded-lg transition-colors"
                >
                  <Trash2 size={18} />
                  {isVideo ? 'Delete Video' : 'Delete Photo'}
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
            <h3 className="text-lg font-semibold text-theme-text mb-3">{isVideo ? 'Delete Video?' : 'Delete Photo?'}</h3>
            <p className="text-theme-text-secondary mb-6">
              This action cannot be undone. The {isVideo ? 'video' : 'photo'} will be permanently removed.
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
    </div>,
    document.body
  );
};
