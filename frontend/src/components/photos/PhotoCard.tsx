import React from 'react';
import { Star, Trash2, User, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Photo } from '../../types';

interface PhotoCardProps {
  photo: Photo;
  isHost?: boolean;
  onClick?: () => void;
  onStar?: (photoId: string, starred: boolean) => void;
  onDelete?: (photoId: string) => void;
  onApprove?: (photoId: string) => void;
  onReject?: (photoId: string) => void;
}

export const PhotoCard: React.FC<PhotoCardProps> = ({
  photo,
  isHost = false,
  onClick,
  onStar,
  onDelete,
  onApprove,
  onReject,
}) => {
  const uploaderDisplayName = photo.guest?.name || photo.uploaderName || 'Anonymous';
  const isPending = photo.status === 'pending';
  const isRejected = photo.status === 'rejected';

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div
      className={`group relative aspect-square rounded-xl overflow-hidden bg-theme-surface cursor-pointer ${
        isPending ? 'ring-2 ring-amber-500/50' : isRejected ? 'ring-2 ring-red-500/30 opacity-60' : ''
      }`}
      onClick={onClick}
    >
      {/* Photo Image */}
      <img
        src={photo.thumbnailUrl || photo.url}
        alt={photo.caption || 'Event photo'}
        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        loading="lazy"
      />

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
            <span className="text-theme-text-secondary text-xs">{formatDate(photo.createdAt)}</span>
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
    </div>
  );
};
