import React from 'react';
import { Monitor, Eye, Clock, ExternalLink, Copy, Edit2, Trash2, Power, PowerOff } from 'lucide-react';
import { Display, DisplayContentType } from '../../types';

interface DisplayCardProps {
  display: Display;
  partyId: string;
  onEdit: (display: Display) => void;
  onDelete: (display: Display) => void;
  onToggleActive: (display: Display) => void;
}

const contentTypeLabels: Record<DisplayContentType, string> = {
  slideshow: 'Slideshow',
  qr_code: 'QR Code',
  event_info: 'Event Info',
  photos: 'Photo Wall',
  upload: 'Upload',
  custom: 'Custom',
};

const contentTypeIcons: Record<DisplayContentType, string> = {
  slideshow: '📸',
  qr_code: '🔲',
  event_info: '📋',
  photos: '🖼️',
  upload: '📤',
  custom: '⚙️',
};

export function DisplayCard({ display, partyId, onEdit, onDelete, onToggleActive }: DisplayCardProps) {
  const displayUrl = `${window.location.origin}/display/${partyId}/${display.slug}`;

  const copyUrl = () => {
    navigator.clipboard.writeText(displayUrl);
  };

  const openPreview = () => {
    window.open(displayUrl, '_blank');
  };

  const formatLastViewed = (dateStr: string | null | undefined) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getContentDescription = () => {
    const config = display.contentConfig as any;
    switch (display.contentType) {
      case 'slideshow':
        return config?.googleSlidesUrl ? 'Google Slides' : 'No slides configured';
      case 'photos':
        const filter = config?.filter === 'starred' ? 'Starred only' : 'All photos';
        return filter;
      case 'qr_code':
        return config?.message || 'RSVP QR';
      case 'event_info':
        return 'Event details';
      case 'upload':
        return config?.mediaType === 'video' ? 'Video' : 'Image';
      case 'custom':
        return 'Custom content';
      default:
        return '';
    }
  };

  // Parse physical dimensions for mockup (stored in contentConfig as _physicalWidth/_physicalHeight/_resolution)
  const meta = display.contentConfig as any;
  const physW = meta?._physicalWidth ? parseFloat(meta._physicalWidth) : 0;
  const physH = meta?._physicalHeight ? parseFloat(meta._physicalHeight) : 0;
  const displayResolution = meta?._resolution || '';
  const hasPhysicalDimensions = physW > 0 && physH > 0;

  return (
    <div className={`card p-4 border ${display.isActive ? 'border-theme-stroke' : 'border-red-500/30 bg-red-950/10'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-theme-surface flex items-center justify-center text-xl">
            {contentTypeIcons[display.contentType]}
          </div>
          <div>
            <h3 className="font-medium text-theme-text flex items-center gap-2">
              {display.name}
              {!display.isActive && (
                <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">Inactive</span>
              )}
            </h3>
            <p className="text-sm text-theme-text-muted">
              {contentTypeLabels[display.contentType]} - {getContentDescription()}
            </p>
          </div>
        </div>
      </div>

      {/* Screen Size Mockup */}
      {hasPhysicalDimensions && (
        <ScreenMockup width={physW} height={physH} resolution={displayResolution} />
      )}

      {/* URL Display */}
      <div className="bg-theme-surface rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
        <Monitor size={14} className="text-theme-text-muted flex-shrink-0" />
        <span className="text-sm text-theme-text-secondary truncate flex-1 font-mono">
          /display/{partyId.substring(0, 8)}.../{display.slug}
        </span>
        <button
          onClick={copyUrl}
          className="text-theme-text-muted hover:text-theme-text transition-colors"
          title="Copy URL"
        >
          <Copy size={14} />
        </button>
        <button
          onClick={openPreview}
          className="text-theme-text-muted hover:text-theme-text transition-colors"
          title="Open Preview"
        >
          <ExternalLink size={14} />
        </button>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-sm text-theme-text-muted mb-4">
        <div className="flex items-center gap-1">
          <Eye size={14} />
          <span>{display.viewCount} views</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock size={14} />
          <span>{formatLastViewed(display.lastViewedAt)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onToggleActive(display)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            display.isActive
              ? 'bg-theme-surface hover:bg-theme-surface-hover text-theme-text-secondary'
              : 'bg-green-500/10 hover:bg-green-500/20 text-green-400'
          }`}
        >
          {display.isActive ? <PowerOff size={14} /> : <Power size={14} />}
          {display.isActive ? 'Deactivate' : 'Activate'}
        </button>
        <button
          onClick={() => onEdit(display)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-theme-surface hover:bg-theme-surface-hover text-theme-text-secondary transition-colors"
        >
          <Edit2 size={14} />
          Edit
        </button>
        <button
          onClick={() => onDelete(display)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
        >
          <Trash2 size={14} />
          Delete
        </button>
      </div>
    </div>
  );
}

function ScreenMockup({ width, height, resolution }: { width: number; height: number; resolution?: string }) {
  // Scale the physical dimensions to fit in a reasonable card-sized area
  const maxMockupWidth = 180;
  const maxMockupHeight = 80;
  const aspectRatio = width / height;

  let mockupWidth: number;
  let mockupHeight: number;

  if (aspectRatio > maxMockupWidth / maxMockupHeight) {
    // Width-constrained
    mockupWidth = maxMockupWidth;
    mockupHeight = maxMockupWidth / aspectRatio;
  } else {
    // Height-constrained
    mockupHeight = maxMockupHeight;
    mockupWidth = maxMockupHeight * aspectRatio;
  }

  return (
    <div className="flex items-center justify-center mb-3 py-2">
      <div className="flex flex-col items-center gap-1">
        <div className="relative flex items-center gap-1">
          {/* Width label on top */}
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] text-theme-text-muted whitespace-nowrap">
            {width}"
          </div>
          {/* Height label on the left */}
          <div className="text-[10px] text-theme-text-muted mr-1">
            {height}"
          </div>
          {/* Screen rectangle */}
          <div
            className="border-2 border-theme-stroke-hover rounded bg-theme-surface flex items-center justify-center"
            style={{ width: mockupWidth, height: mockupHeight }}
          >
            {resolution && (
              <span className="text-[9px] text-theme-text-faint">{resolution}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
