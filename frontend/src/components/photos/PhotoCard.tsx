import React, { useState } from 'react';
import { Star, Trash2, User, CheckCircle2, XCircle, Clock, Play, ThumbsUp } from 'lucide-react';
import { Photo } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { togglePhotoVote } from '../../lib/api';

interface PhotoCardProps {
  photo: Photo;
  isHost?: boolean;
  onClick?: () => void;
  onStar?: (photoId: string, starred: boolean) => void;
  onDelete?: (photoId: string) => void;
  onApprove?: (photoId: string) => void;
  onReject?: (photoId: string) => void;
  // salame-58195: thumbs-up vote toggled — parent updates local list.
  onVoteChange?: (photoId: string, next: { voteCount: number; votedByMe: boolean }) => void;
}

/** Format duration in seconds to "M:SS" display */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const PhotoCard: React.FC<PhotoCardProps> = ({
  photo,
  isHost = false,
  onClick,
  onStar,
  onDelete,
  onApprove,
  onReject,
  onVoteChange,
}) => {
  const uploaderDisplayName = photo.guest?.name || photo.uploaderName || 'Anonymous';
  const isPending = photo.status === 'pending';
  const isRejected = photo.status === 'rejected';
  const isVideo = photo.mimeType?.startsWith('video/');

  // salame-58195: thumbs-up voting
  const { user } = useAuth();
  const [voting, setVoting] = useState(false);
  const handleVote = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      // Anon: fall through to opening the modal (login prompt deferred).
      onClick?.();
      return;
    }
    if (voting) return;
    setVoting(true);
    const res = await togglePhotoVote(photo.partyId, photo.id);
    setVoting(false);
    if (res && onVoteChange) {
      onVoteChange(photo.id, { voteCount: res.voteCount, votedByMe: res.voted });
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const displayDate = photo.photoYear ? `${photo.photoYear}` : formatDate(photo.createdAt);

  return (
    <div
      className={`group relative aspect-square rounded-xl overflow-hidden bg-theme-surface cursor-pointer ${
        isPending ? 'ring-2 ring-amber-500/50' : isRejected ? 'ring-2 ring-red-500/30 opacity-60' : ''
      }`}
      onClick={onClick}
    >
      {/* Photo/Video Thumbnail */}
      {isVideo ? (
        <video
          src={photo.url}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          preload="metadata"
          muted
          playsInline
        />
      ) : (
        <img
          src={photo.thumbnailUrl || photo.url}
          alt={photo.caption || 'Event photo'}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
      )}

      {/* Play Icon Overlay for Videos */}
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 rounded-full p-2.5 group-hover:bg-black/70 transition-colors">
            <Play size={20} className="text-white fill-white" />
          </div>
        </div>
      )}

      {/* Duration Badge for Videos (bottom-right) */}
      {isVideo && photo.duration != null && (
        <div className="absolute bottom-2 right-2 z-10 pointer-events-none">
          <span className="bg-black/70 text-white text-xs font-medium px-1.5 py-0.5 rounded">
            {formatDuration(photo.duration)}
          </span>
        </div>
      )}

      {/* Gradient Overlay on Hover */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

      {/* Status Badge (pending/rejected) */}
      {isPending && (
        <div className="absolute top-2 left-2 z-10">
          <div className="flex items-center gap-1 bg-amber-500/90 text-theme-text text-xs font-medium px-2 py-1 rounded-full">
            <Clock size={12} />
            Pending
          </div>
        </div>
      )}

      {isRejected && (
        <div className="absolute top-2 left-2 z-10">
          <div className="flex items-center gap-1 bg-red-500/90 text-white text-xs font-medium px-2 py-1 rounded-full">
            <XCircle size={12} />
            Rejected
          </div>
        </div>
      )}

      {/* Star Badge (if starred and not pending/rejected) */}
      {photo.starred && !isPending && !isRejected && (
        <div className="absolute top-2 left-2">
          <Star className="w-5 h-5 text-yellow-400 fill-yellow-400 drop-shadow-lg" />
        </div>
      )}

      {/* Approve/Reject Buttons for pending photos */}
      {isPending && onApprove && onReject && (
        <div className="absolute bottom-2 left-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onApprove(photo.id);
            }}
            className="flex-1 flex items-center justify-center gap-1 bg-green-500/90 hover:bg-green-500 text-white text-xs font-medium py-2 rounded-lg transition-colors"
          >
            <CheckCircle2 size={14} />
            Approve
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReject(photo.id);
            }}
            className="flex-1 flex items-center justify-center gap-1 bg-red-500/90 hover:bg-red-500 text-white text-xs font-medium py-2 rounded-lg transition-colors"
          >
            <XCircle size={14} />
            Reject
          </button>
        </div>
      )}

      {/* Host Controls (for approved photos) */}
      {isHost && !isPending && (
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStar?.(photo.id, !photo.starred);
            }}
            className={`p-1.5 rounded-full transition-colors ${
              photo.starred
                ? 'bg-yellow-400/20 text-yellow-400'
                : 'bg-black/40 text-theme-text hover:bg-yellow-400/20 hover:text-yellow-400'
            }`}
            title={photo.starred ? 'Unstar photo' : 'Star photo'}
          >
            <Star size={16} className={photo.starred ? 'fill-current' : ''} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(photo.id);
            }}
            className="p-1.5 rounded-full bg-black/40 text-white hover:bg-red-500/60 hover:text-white transition-colors"
            title="Delete photo"
          >
            <Trash2 size={16} />
          </button>
        </div>
      )}

      {/* Bottom Info (on hover, only for non-pending or when no approve/reject) */}
      {(!isPending || !onApprove) && (
        <div className="absolute bottom-0 left-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex items-center justify-between text-theme-text text-sm">
            <div className="flex items-center gap-1.5">
              <User size={14} className="text-theme-text-secondary" />
              <span className="truncate max-w-[100px]">{uploaderDisplayName}</span>
            </div>
            <span className="text-theme-text-secondary text-xs">{displayDate}</span>
          </div>
          {photo.caption && (
            <p className="text-theme-text text-xs mt-1 truncate">{photo.caption}</p>
          )}
        </div>
      )}

      {/* Tags (if any and not pending) */}
      {photo.tags.length > 0 && !isPending && !isRejected && (
        <div className="absolute top-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {photo.tags.slice(0, 2).map((tag, index) => (
            <span
              key={index}
              className="bg-black/50 text-theme-text text-xs px-1.5 py-0.5 rounded"
            >
              #{tag}
            </span>
          ))}
          {photo.tags.length > 2 && (
            <span className="bg-black/50 text-theme-text-secondary text-xs px-1.5 py-0.5 rounded">
              +{photo.tags.length - 2}
            </span>
          )}
        </div>
      )}

      {/* salame-58195: thumbs-up vote (approved photos only) — napoletana-58197: icon-only, white, drop-shadow */}
      {!isPending && !isRejected && (
        <button
          type="button"
          onClick={handleVote}
          aria-label={photo.votedByMe ? 'Remove vote' : 'Vote'}
          title={user ? (photo.votedByMe ? 'Remove vote' : 'Vote') : 'Log in to vote'}
          className={`absolute bottom-2 left-2 z-10 cursor-pointer text-white hover:scale-110 transition-transform ${voting ? 'opacity-70' : ''}`}
          style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}
        >
          <ThumbsUp size={22} fill="none" stroke="white" strokeWidth={2.25} />
        </button>
      )}
    </div>
  );
};
