import React from 'react';
import { Users, Camera, MapPin, Calendar, ExternalLink } from 'lucide-react';
import { ProgressIndicator } from './ProgressIndicator';
import { GPP_REGIONS } from '../../types';
import type { UnderbossEvent } from '../../types';

interface EventRowProps {
  event: UnderbossEvent;
  showRegion?: boolean;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'TBD';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return 'TBD';
  }
}

function KitBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-theme-text-faint">--</span>;

  const colors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    approved: 'bg-blue-500/20 text-blue-400',
    shipped: 'bg-purple-500/20 text-purple-400',
    delivered: 'bg-green-500/20 text-green-400',
    declined: 'bg-red-500/20 text-red-400',
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] || 'bg-theme-surface-hover text-theme-text-muted'}`}>
      {status}
    </span>
  );
}

export function EventRow({ event, showRegion }: EventRowProps) {
  const eventUrl = event.customUrl
    ? `https://rsv.pizza/${event.customUrl}`
    : null;

  return (
    <tr className="border-b border-theme-stroke hover:bg-theme-surface transition-colors">
      {/* Event name + date */}
      <td className="py-3 px-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-theme-text truncate">{event.name}</span>
              {eventUrl && (
                <a
                  href={eventUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-theme-text-faint hover:text-theme-text-secondary transition-colors shrink-0"
                >
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Calendar size={10} className="text-theme-text-faint" />
              <span className="text-xs text-theme-text-muted">{formatDate(event.date)}</span>
            </div>
          </div>
        </div>
      </td>

      {/* Region (optional) */}
      {showRegion && (
        <td className="py-3 px-3">
          <span className="text-xs text-theme-text-muted">
            {GPP_REGIONS.find((r) => r.id === event.region)?.label || event.region || '\u2014'}
          </span>
        </td>
      )}

      {/* Host */}
      <td className="py-3 px-3">
        <span className="text-xs text-theme-text-secondary">{event.host.name || 'Unknown'}</span>
        {event.host.email && (
          <div className="text-xs text-theme-text-faint truncate max-w-[150px]">{event.host.email}</div>
        )}
      </td>

      {/* Location */}
      <td className="py-3 px-3">
        <div className="flex items-center gap-1.5">
          {event.venueName || event.address ? (
            <>
              <MapPin size={10} className="text-theme-text-faint shrink-0" />
              <span className="text-xs text-theme-text-muted truncate max-w-[180px]">
                {event.venueName || event.address}
              </span>
            </>
          ) : (
            <span className="text-xs text-theme-text-faint">No venue</span>
          )}
        </div>
      </td>

      {/* RSVPs */}
      <td className="py-3 px-3 text-center">
        <div className="flex items-center justify-center gap-1">
          <Users size={12} className="text-theme-text-faint" />
          <span className="text-sm text-theme-text-secondary">{event.guestCount}</span>
        </div>
        {event.checkedInCount > 0 && (
          <div className="text-xs text-green-400/60">{event.checkedInCount} checked in</div>
        )}
      </td>

      {/* Photos */}
      <td className="py-3 px-3 text-center">
        <div className="flex items-center justify-center gap-1">
          <Camera size={12} className="text-theme-text-faint" />
          <span className="text-xs text-theme-text-muted">{event.photoCount}</span>
        </div>
      </td>

      {/* Party Kit */}
      <td className="py-3 px-3 text-center">
        <KitBadge status={event.kitStatus} />
      </td>

      {/* Progress */}
      <td className="py-3 px-3">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <ProgressIndicator done={event.progress.hasVenue} label="Venue" />
          <ProgressIndicator done={event.progress.hasBudget} label="Budget" />
          <ProgressIndicator done={event.progress.hasPartyKit} label="Kit" />
          <ProgressIndicator done={event.progress.hasEventImage} label="Image" />
          <ProgressIndicator done={event.progress.hasDate} label="Date" />
        </div>
      </td>
    </tr>
  );
}
