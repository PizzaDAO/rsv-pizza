import React from 'react';
import { Performer, PerformerType, PerformerStatus } from '../../types';
import { GripVertical, Edit2, Trash2, Instagram, ExternalLink, Check, DollarSign } from 'lucide-react';

interface PerformerCardProps {
  performer: Performer;
  onEdit: (performer: Performer) => void;
  onDelete: (performerId: string) => void;
  isDragging?: boolean;
  dragHandleProps?: {
    onDragStart: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
}

// Type icons with emoji
const typeIcons: Record<PerformerType, string> = {
  dj: '\uD83C\uDFA7', // Headphones
  live_band: '\uD83C\uDFB8', // Guitar
  solo: '\uD83C\uDFA4', // Microphone
  playlist: '\uD83C\uDFB5', // Musical note
};

// Type labels
const typeLabels: Record<PerformerType, string> = {
  dj: 'DJ',
  live_band: 'Live Band',
  solo: 'Solo Artist',
  playlist: 'Playlist',
};

// Status colors
const statusColors: Record<PerformerStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Pending' },
  confirmed: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Confirmed' },
  cancelled: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Cancelled' },
};

// Format time for display (e.g., "21:00" -> "9:00 PM")
function formatTime(time: string | null): string {
  if (!time) return '';
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

// Format duration (e.g., 120 -> "2 hrs")
function formatDuration(minutes: number | null): string {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours} hr${hours > 1 ? 's' : ''}`;
  return `${hours}h ${mins}m`;
}

// Format fee
function formatFee(fee: number | null): string {
  if (fee === null || fee === undefined) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(fee);
}

export const PerformerCard: React.FC<PerformerCardProps> = ({
  performer,
  onEdit,
  onDelete,
  isDragging = false,
  dragHandleProps,
}) => {
  const statusStyle = statusColors[performer.status];
  const typeIcon = typeIcons[performer.type];
  const typeLabel = typeLabels[performer.type];

  return (
    <div
      className={`bg-white/5 border border-white/10 rounded-xl p-4 transition-all ${
        isDragging ? 'opacity-50' : 'opacity-100'
      }`}
      draggable={!!dragHandleProps}
      onDragStart={dragHandleProps?.onDragStart}
      onDragOver={dragHandleProps?.onDragOver}
      onDragEnd={dragHandleProps?.onDragEnd}
    >
      <div className="flex items-start gap-3">
        {/* Drag Handle */}
        {dragHandleProps && (
          <div className="cursor-grab active:cursor-grabbing text-white/30 hover:text-white/60 pt-1">
            <GripVertical size={18} />
          </div>
        )}

        {/* Type Icon */}
        <div className="text-2xl flex-shrink-0 pt-0.5">{typeIcon}</div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Header Row */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-white font-medium truncate">{performer.name}</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
              {statusStyle.label}
            </span>
          </div>

          {/* Genre & Type */}
          <div className="flex items-center gap-2 text-sm text-white/60 mb-2">
            <span>{typeLabel}</span>
            {performer.genre && (
              <>
                <span className="text-white/30">|</span>
                <span>{performer.genre}</span>
              </>
            )}
          </div>

          {/* Time Slot */}
          {(performer.setTime || performer.setDuration) && (
            <div className="text-sm text-white/70 mb-2">
              {performer.setTime && <span>{formatTime(performer.setTime)}</span>}
              {performer.setTime && performer.setDuration && <span> - </span>}
              {performer.setDuration && <span>({formatDuration(performer.setDuration)})</span>}
            </div>
          )}

          {/* Fee & Payment Status */}
          {performer.fee !== null && performer.fee !== undefined && (
            <div className="flex items-center gap-2 text-sm mb-2">
              <DollarSign size={14} className="text-white/40" />
              <span className="text-white/70">{formatFee(performer.fee)}</span>
              {performer.feePaid && (
                <span className="flex items-center gap-1 text-green-400 text-xs">
                  <Check size={12} />
                  Paid
                </span>
              )}
            </div>
          )}

          {/* Social Links */}
          <div className="flex items-center gap-3 mt-2">
            {performer.instagram && (
              <a
                href={`https://instagram.com/${performer.instagram.replace('@', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/50 hover:text-white transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <Instagram size={16} />
              </a>
            )}
            {performer.soundcloud && (
              <a
                href={
                  performer.soundcloud.startsWith('http')
                    ? performer.soundcloud
                    : `https://soundcloud.com/${performer.soundcloud}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/50 hover:text-white transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={16} />
              </a>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onEdit(performer)}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title="Edit"
          >
            <Edit2 size={16} />
          </button>
          <button
            onClick={() => onDelete(performer.id)}
            className="p-2 text-white/50 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
