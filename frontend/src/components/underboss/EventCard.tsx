import React, { useState } from 'react';
import { Users, Camera, MapPin, Calendar, ExternalLink, Check, Plus, X } from 'lucide-react';
import { ProgressIndicator } from './ProgressIndicator';
import { GPP_REGIONS } from '../../types';
import { updateHostStatus, updateUnderbossApproval, updateHostTags } from '../../lib/api';
import type { UnderbossEvent, HostStatus } from '../../types';

interface EventCardProps {
  event: UnderbossEvent;
  showRegion?: boolean;
  onEventUpdate?: (eventId: string, updates: Partial<UnderbossEvent>) => void;
}

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

    if (absDays < 7) return { text: isPast ? `${absDays}d ago` : `in ${absDays}d`, isPast };
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
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return 'Invalid date';
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
    try { await updateHostTags(eventId, newTags); } catch { onUpdate(tags); }
  }

  async function removeTag(tag: string) {
    const newTags = tags.filter((t) => t !== tag);
    onUpdate(newTags);
    try { await updateHostTags(eventId, newTags); } catch { onUpdate(tags); }
  }

  const tagColors: Record<string, string> = {
    swc: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <button
          key={tag}
          onClick={() => removeTag(tag)}
          className={`text-[10px] px-1.5 py-0.5 rounded-md border transition-colors hover:opacity-70 ${
            tagColors[tag] || 'bg-theme-surface text-theme-text-muted border-theme-stroke'
          }`}
          title={`Remove "${tag}"`}
        >
          {tag}
        </button>
      ))}
      {isAdding ? (
        <div className="flex items-center gap-1">
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
          <button onClick={() => { setIsAdding(false); setNewTag(''); }} className="text-theme-text-faint hover:text-theme-text-muted">
            <X size={10} />
          </button>
        </div>
      ) : (
        <button onClick={() => setIsAdding(true)} className="text-theme-text-faint hover:text-theme-text-muted transition-colors" title="Add tag">
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}

export function EventCard({ event, showRegion, onEventUpdate }: EventCardProps) {
  const [hostStatus, setHostStatus] = useState<HostStatus | null>(event.hostStatus);
  const [approved, setApproved] = useState(event.underbossApproved);
  const [hostTags, setHostTags] = useState<string[]>(event.hostTags || []);

  const eventUrl = event.customUrl ? `https://rsv.pizza/${event.customUrl}` : null;
  const relTime = formatRelativeTime(event.date);
  const fullDate = formatFullDate(event.date);

  async function toggleApproval() {
    const newVal = !approved;
    setApproved(newVal);
    onEventUpdate?.(event.id, { underbossApproved: newVal });
    try {
      await updateUnderbossApproval(event.id, newVal);
    } catch {
      setApproved(!newVal);
      onEventUpdate?.(event.id, { underbossApproved: !newVal });
    }
  }

  return (
    <div className="rounded-lg p-4 bg-theme-surface border border-theme-stroke transition-colors">
      {/* Top row: approval + event name + link */}
      <div className="flex items-start gap-3">
        <button
          onClick={toggleApproval}
          className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors shrink-0 mt-0.5 ${
            approved
              ? 'bg-green-500/20 border-green-500/40 text-green-400'
              : 'border-theme-stroke text-transparent hover:border-theme-stroke-hover'
          }`}
          title={approved ? 'Approved' : 'Not approved'}
        >
          <Check size={12} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-theme-text truncate">{event.name}</span>
            {eventUrl && (
              <a href={eventUrl} target="_blank" rel="noopener noreferrer" className="text-theme-text-faint hover:text-theme-text-secondary transition-colors shrink-0">
                <ExternalLink size={12} />
              </a>
            )}
          </div>

          {/* Date */}
          <div className="flex items-center gap-1.5 mt-0.5" title={fullDate}>
            <Calendar size={10} className="text-theme-text-faint" />
            <span className={`text-xs ${relTime.isPast ? 'text-red-400' : 'text-theme-text-muted'}`}>
              {relTime.text}
            </span>
            {showRegion && event.region && (
              <>
                <span className="text-theme-text-faint">·</span>
                <span className="text-xs text-theme-text-muted">
                  {GPP_REGIONS.find((r) => r.id === event.region)?.label || event.region}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Host info */}
      <div className="mt-3 flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-theme-text-secondary">{event.host.name || 'Unknown'}</span>
        <HostStatusBadge
          status={hostStatus}
          eventId={event.id}
          onUpdate={(s) => {
            setHostStatus(s);
            onEventUpdate?.(event.id, { hostStatus: s });
          }}
        />
        <HostTagsPills
          tags={hostTags}
          eventId={event.id}
          onUpdate={(tags) => {
            setHostTags(tags);
            onEventUpdate?.(event.id, { hostTags: tags });
          }}
        />
      </div>

      {/* Location */}
      {(event.venueName || event.address) && (
        <div className="flex items-center gap-1.5 mt-2">
          <MapPin size={10} className="text-theme-text-faint shrink-0" />
          <span className="text-xs text-theme-text-muted truncate">{event.venueName || event.address}</span>
        </div>
      )}

      {/* Stats row: RSVPs, Photos, Kit */}
      <div className="flex items-center gap-4 mt-3">
        <div className="flex items-center gap-1">
          <Users size={12} className="text-theme-text-faint" />
          <span className="text-xs text-theme-text-secondary">{event.guestCount}</span>
          {event.checkedInCount > 0 && (
            <span className="text-xs text-green-400/60">({event.checkedInCount})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Camera size={12} className="text-theme-text-faint" />
          <span className="text-xs text-theme-text-muted">{event.photoCount}</span>
        </div>
        <KitBadge status={event.kitStatus} />
      </div>

      {/* Progress */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 pt-3 border-t border-theme-stroke">
        <ProgressIndicator done={event.progress.hasCreatedEvent} label="Event" />
        <ProgressIndicator done={event.progress.hasPartyKit} label="Kit" />
        <ProgressIndicator done={event.progress.hasCoHosts} label="Team" />
        <ProgressIndicator done={event.progress.hasVenue} label="Venue" />
        <ProgressIndicator done={event.progress.hasBudget} label="Budget" />
        <ProgressIndicator done={event.progress.hasSponsors} label="Partners" />
        <ProgressIndicator done={event.progress.hasPrepared} label="Prep" />
        <ProgressIndicator done={event.progress.hasSocialPosts} label="Social" />
        <ProgressIndicator done={event.progress.hasThrown} label="Thrown" />
      </div>
    </div>
  );
}
