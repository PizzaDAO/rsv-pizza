import React from 'react';
import { MapPin, Calendar, Clock } from 'lucide-react';

interface EventInfoCardProps {
  date: string | null;
  timezone: string | null;
  address: string | null;
  venueName: string | null;
}

function formatDate(dateStr: string, timezone?: string | null): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      ...(timezone ? { timeZone: timezone } : {}),
    });
  } catch {
    return dateStr;
  }
}

function formatTime(dateStr: string, timezone?: string | null): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      ...(timezone ? { timeZone: timezone } : {}),
    });
  } catch {
    return '';
  }
}

function getStaticMapUrl(address: string): string {
  const encoded = encodeURIComponent(address);
  const key = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '';
  if (!key) return '';
  return `https://maps.googleapis.com/maps/api/staticmap?center=${encoded}&zoom=15&size=300x200&scale=2&maptype=roadmap&markers=color:red%7C${encoded}&key=${key}`;
}

export const EventInfoCard: React.FC<EventInfoCardProps> = ({ date, timezone, address, venueName }) => {
  const mapUrl = address ? getStaticMapUrl(address) : '';

  return (
    <div className="flex gap-3">
      {/* Map thumbnail */}
      {mapUrl && (
        <a
          href={`https://maps.google.com/?q=${encodeURIComponent(address!)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 w-24 h-20 rounded-lg overflow-hidden bg-theme-surface"
        >
          <img
            src={mapUrl}
            alt="Map"
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </a>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1.5">
        {date && (
          <div className="flex items-center gap-2 text-sm text-theme-text-secondary">
            <Calendar size={14} className="text-theme-text-muted flex-shrink-0" />
            <span>{formatDate(date, timezone)}</span>
          </div>
        )}
        {date && (
          <div className="flex items-center gap-2 text-sm text-theme-text-secondary">
            <Clock size={14} className="text-theme-text-muted flex-shrink-0" />
            <span>{formatTime(date, timezone)}</span>
          </div>
        )}
        {(venueName || address) && (
          <div className="flex items-start gap-2 text-sm text-theme-text-secondary">
            <MapPin size={14} className="text-theme-text-muted flex-shrink-0 mt-0.5" />
            <span className="truncate">
              {venueName && <span className="font-medium">{venueName}</span>}
              {venueName && address && <span className="text-theme-text-muted"> - </span>}
              {address}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
