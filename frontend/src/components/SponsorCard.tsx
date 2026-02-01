import React from 'react';
import { ExternalLink, GripVertical, Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { Sponsor, SponsorTier } from '../types';

interface SponsorCardProps {
  sponsor: Sponsor;
  isEditable?: boolean;
  isDragging?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleVisibility?: () => void;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}

const tierColors: Record<SponsorTier, { bg: string; border: string; text: string; badge: string }> = {
  gold: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    badge: 'bg-amber-500/20 text-amber-400',
  },
  silver: {
    bg: 'bg-slate-300/10',
    border: 'border-slate-300/30',
    text: 'text-slate-300',
    badge: 'bg-slate-300/20 text-slate-300',
  },
  bronze: {
    bg: 'bg-orange-700/10',
    border: 'border-orange-700/30',
    text: 'text-orange-400',
    badge: 'bg-orange-700/20 text-orange-400',
  },
  partner: {
    bg: 'bg-white/5',
    border: 'border-white/10',
    text: 'text-white/60',
    badge: 'bg-white/10 text-white/60',
  },
};

const tierLabels: Record<SponsorTier, string> = {
  gold: 'Gold',
  silver: 'Silver',
  bronze: 'Bronze',
  partner: 'Partner',
};

export const SponsorCard: React.FC<SponsorCardProps> = ({
  sponsor,
  isEditable = false,
  isDragging = false,
  onEdit,
  onDelete,
  onToggleVisibility,
  onDragStart,
  onDragOver,
  onDragEnd,
}) => {
  const colors = tierColors[sponsor.tier];

  const CardContent = (
    <>
      {/* Logo */}
      {sponsor.logoUrl ? (
        <div className="w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-white/10 flex items-center justify-center">
          <img
            src={sponsor.logoUrl}
            alt={`${sponsor.name} logo`}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      ) : (
        <div className={`w-16 h-16 flex-shrink-0 rounded-lg ${colors.bg} ${colors.border} border flex items-center justify-center`}>
          <span className={`text-2xl font-bold ${colors.text}`}>
            {sponsor.name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-medium text-white truncate">{sponsor.name}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${colors.badge}`}>
            {tierLabels[sponsor.tier]}
          </span>
        </div>
        {sponsor.description && (
          <p className="text-sm text-white/60 line-clamp-2">{sponsor.description}</p>
        )}
        {sponsor.websiteUrl && (
          <a
            href={sponsor.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[#ff393a] hover:text-[#ff5a5b] mt-1"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={12} />
            Visit website
          </a>
        )}
      </div>
    </>
  );

  if (isEditable) {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
          isDragging ? 'opacity-50' : 'opacity-100'
        } ${!sponsor.visible ? 'bg-white/5 border-white/10' : `${colors.bg} ${colors.border}`}`}
      >
        {/* Drag Handle */}
        <div className="cursor-grab active:cursor-grabbing text-white/30 hover:text-white/60">
          <GripVertical size={18} />
        </div>

        {CardContent}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onToggleVisibility}
            className={`p-2 rounded-lg transition-colors ${
              sponsor.visible
                ? 'text-white/40 hover:text-white hover:bg-white/10'
                : 'text-white/30 hover:text-white/60 hover:bg-white/10'
            }`}
            title={sponsor.visible ? 'Hide from guests' : 'Show to guests'}
          >
            {sponsor.visible ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title="Edit sponsor"
          >
            <Pencil size={18} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-2 text-[#ff393a]/60 hover:text-[#ff393a] hover:bg-[#ff393a]/10 rounded-lg transition-colors"
            title="Delete sponsor"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>
    );
  }

  // Guest-facing card (non-editable)
  return (
    <div className={`flex items-center gap-4 p-4 rounded-xl border ${colors.bg} ${colors.border}`}>
      {CardContent}
    </div>
  );
};
