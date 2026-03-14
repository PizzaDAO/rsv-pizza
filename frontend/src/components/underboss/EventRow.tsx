import React, { useState } from 'react';
import { Users, Camera, MapPin, Calendar, ExternalLink, Check, Plus, X } from 'lucide-react';
import { ProgressIndicator } from './ProgressIndicator';
import { GPP_REGIONS } from '../../types';
import { updateHostStatus, updateHostTags } from '../../lib/api';
import type { UnderbossEvent, HostStatus } from '../../types';

interface EventRowProps {
  event: UnderbossEvent;
  showRegion?: boolean;
  onEventUpdate?: (eventId: string, updates: Partial<UnderbossEvent>) => void;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}

// Relative time formatting
function formatRelativeTime(dateStr: string | null): { text: string; isPast: boolean } {
  if (!dateStr) return { text: 'TBD', isPast: false };
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    const absDays = Math.abs(diffDays);
    const isPast = diffMs < 0;

    if (absDays === 0) return { text: 'Today', isPast: false };
    if (diffDays === 1) return { text: 'Tomorrow', isPast: false };
    if (diffDays === -1) return { text: 'Yesterday', isPast: true };

    if (absDays < 7) {
      return { text: isPast ? `${absDays}d ago` : `in ${absDays}d`, isPast };
    }
    if (absDays < 30) {
      const weeks = Math.round(absDays / 7);
      return { text: isPast ? `${weeks}w ago` : `in ${weeks}w`, isPast };
    }
    if (absDays < 365) {
      const months = Math.round(absDays / 30);
      return { text: isPast ? `${months}mo ago` : `in ${months}mo`, isPast };
    }
    const years = Math.round(absDays / 365);
    return { text: isPast ? `${years}y ago` : `in ${years}y`, isPast };
  } catch {
    return { text: 'TBD', isPast: false };
  }
}

function formatFullDate(dateStr: string | null): string {
  if (!dateStr) return 'No date set';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return 'Invalid date';
  }
}

// Host status badge/dropdown
const HOST_STATUS_OPTIONS: { value: HostStatus | ''; label: string; color: string }[] = [
  { value: '', label: '--', color: '' },
  { value: 'new', label: 'new', color: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30' },
  { value: 'alum', label: 'alum', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { value: 'pro', label: 'pro', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
];

function HostStatusBadge({
  status,
  eventId,
  onUpdate,
}: {
  status: HostStatus | null;
  eventId: string;
  onUpdate: (status: HostStatus | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const current = HOST_STATUS_OPTIONS.find((o) => o.value === (status || ''));
  const displayColor = current?.color || 'text-theme-text-faint';

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`text-[10px] px-1.5 py-0.5 rounded-md border transition-colors ${
          status ? displayColor : 'border-theme-stroke text-theme-text-faint hover:text-theme-text-muted'
        }`}
      >
        {status || 'status'}
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 bg-theme-card border border-theme-stroke rounded-lg shadow-xl py-1 min-w-[80px]">
            {HOST_STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={async () => {
                  const newStatus = opt.value === '' ? null : opt.value as HostStatus;
                  onUpdate(newStatus);
                  setIsOpen(false);
                  try {
                    await updateHostStatus(eventId, newStatus);
                  } catch {
                    // Revert on error
                    onUpdate(status);
                  }
                }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-theme-surface ${
                  (status || '') === opt.value ? 'font-medium text-theme-text' : 'text-theme-text-muted'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Host tags pills with inline editor
function HostTagsPills({
  tags,
  eventId,
  onUpdate,
}: {
  tags: string[];
  eventId: string;
  onUpdate: (tags: string[]) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTag, setNewTag] = useState('');

  const presetTags = ['swc'];

  async function addTag(tag: string) {
    const cleaned = tag.trim().toLowerCase();
    if (!cleaned || tags.includes(cleaned)) return;
    const newTags = [...tags, cleaned];
    onUpdate(newTags);
    setNewTag('');
    setIsAdding(false);
    try {
      await updateHostTags(eventId, newTags);
    } catch {
      onUpdate(tags);
    }
  }

  async function removeTag(tag: string) {
    const newTags = tags.filter((t) => t !== tag);
    onUpdate(newTags);
    try {
      await updateHostTags(eventId, newTags);
    } catch {
      onUpdate(tags);
    }
  }

  const tagColors: Record<string, string> = {
    swc: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  };

  return (
    <div className="flex flex-wrap items-center gap-1 mt-0.5">
      {tags.map((tag) => (
        <button
          key={tag}
          onClick={() => removeTag(tag)}
          className={`text-[10px] px-1.5 py-0.5 rounded-md border transition-colors hover:opacity-70 ${
            tagColors[tag] || 'bg-theme-surface text-theme-text-muted border-theme-stroke'
          }`}
          title={`Click to remove "${tag}"`}
        >
          {tag}
        </button>
      ))}
      {isAdding ? (
        <div className="flex items-center gap-1">
          {/* Preset tags */}
          {presetTags.filter((t) => !tags.includes(t)).map((preset) => (
            <button
              key={preset}
              onClick={() => addTag(preset)}
              className="text-[10px] px-1.5 py-0.5 rounded-md border border-dashed border-theme-stroke text-theme-text-faint hover:text-theme-text-muted transition-colors"
            >
              {preset}
            </button>
          ))}
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTag(newTag);
              if (e.key === 'Escape') { setIsAdding(false); setNewTag(''); }
            }}
            onBlur={() => {
              if (newTag.trim()) addTag(newTag);
              else { setIsAdding(false); setNewTag(''); }
            }}
            autoFocus
            placeholder="tag..."
            className="w-16 bg-transparent border-b border-theme-stroke text-[10px] text-theme-text focus:outline-none"
          />
          <button
            onClick={() => { setIsAdding(false); setNewTag(''); }}
            className="text-theme-text-faint hover:text-theme-text-muted"
          >
            <X size={10} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setIsAdding(true)}
          className="text-theme-text-faint hover:text-theme-text-muted transition-colors"
          title="Add tag"
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}

export function EventRow({ event, showRegion, onEventUpdate, isSelected, onToggleSelect }: EventRowProps) {
  // Local state for optimistic updates
  const [hostStatus, setHostStatus] = useState<HostStatus | null>(event.hostStatus);
  const [hostTags, setHostTags] = useState<string[]>(event.hostTags || []);

  const eventUrl = event.customUrl
    ? `https://rsv.pizza/${event.customUrl}`
    : null;

  const relTime = formatRelativeTime(event.date);
  const fullDate = formatFullDate(event.date);

  return (
    <tr className="border-b border-theme-stroke hover:bg-theme-surface transition-colors">
      {/* Selection checkbox */}
      <td className="py-3 px-3 text-center">
        <button
          onClick={() => onToggleSelect?.(event.id)}
          className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
            isSelected
              ? 'bg-[#ff393a]/20 border-[#ff393a]/40 text-[#ff393a]'
              : 'border-theme-stroke text-transparent hover:border-theme-stroke-hover'
          }`}
          title="Select event"
        >
          <Check size={12} />
        </button>
      </td>

      {/* Event name + relative time + approval indicator */}
      <td className="py-3 px-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {event.underbossApproved && (
                <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" title="Approved" />
              )}
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
            <div className="flex items-center gap-1.5 mt-0.5" title={fullDate}>
              <Calendar size={10} className="text-theme-text-faint" />
              <span className={`text-xs ${relTime.isPast ? 'text-red-400' : 'text-theme-text-muted'}`}>
                {relTime.text}
              </span>
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

      {/* Host + status badge + tags */}
      <td className="py-3 px-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-theme-text-secondary">{event.host.name || 'Unknown'}</span>
          <HostStatusBadge
            status={hostStatus}
            eventId={event.id}
            onUpdate={(s) => {
              setHostStatus(s);
              onEventUpdate?.(event.id, { hostStatus: s });
            }}
          />
        </div>
        {event.host.email && (
          <div className="text-xs text-theme-text-faint truncate max-w-[150px]">{event.host.email}</div>
        )}
        <HostTagsPills
          tags={hostTags}
          eventId={event.id}
          onUpdate={(tags) => {
            setHostTags(tags);
            onEventUpdate?.(event.id, { hostTags: tags });
          }}
        />
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

      {/* Progress (8 items) */}
      <td className="py-3 px-3">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <ProgressIndicator done={event.progress.hasCreatedEvent} label="Event" />
          <ProgressIndicator done={event.progress.hasCoHosts} label="Team" />
          <ProgressIndicator done={event.progress.hasVenue} label="Venue" />
          <ProgressIndicator done={event.progress.hasBudget} label="Budget" />
          <ProgressIndicator done={event.progress.hasSponsors} label="Partners" />
          <ProgressIndicator done={event.progress.hasPrepared} label="Prep" />
          <ProgressIndicator done={event.progress.hasSocialPosts} label="Social" />
          <ProgressIndicator done={event.progress.hasThrown} label="Thrown" />
        </div>
      </td>
    </tr>
  );
}
