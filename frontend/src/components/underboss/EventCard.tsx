import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Users, Camera, MapPin, Calendar, ExternalLink, Check, Plus, X, StickyNote, ChevronLeft, ChevronRight } from 'lucide-react';
import { ProgressIndicator } from './ProgressIndicator';
import { IconInput } from '../IconInput';
import { updateHostStatus, bulkUpdateEventTags, updateUnderbossNotes, getPartyPhotos } from '../../lib/api';
import type { UnderbossEvent, HostStatus, Photo } from '../../types';

interface EventCardProps {
  event: UnderbossEvent;
  showRegion?: boolean;
  onEventUpdate?: (eventId: string, updates: Partial<UnderbossEvent>) => void;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
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
    try { await bulkUpdateEventTags([eventId], [cleaned], 'add'); } catch { onUpdate(tags); }
  }

  async function removeTag(tag: string) {
    const newTags = tags.filter((t) => t !== tag);
    onUpdate(newTags);
    try { await bulkUpdateEventTags([eventId], [tag], 'remove'); } catch { onUpdate(tags); }
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

function PhotoLightbox({
  photos,
  currentIndex,
  onClose,
  onNavigate,
}: {
  photos: Photo[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const photo = photos[currentIndex];

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentIndex > 0) onNavigate(currentIndex - 1);
      if (e.key === 'ArrowRight' && currentIndex < photos.length - 1) onNavigate(currentIndex + 1);
    };
    window.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [currentIndex, photos.length, onClose, onNavigate]);

  if (!photo) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/60 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
      >
        <X size={24} />
      </button>

      {currentIndex > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(currentIndex - 1); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
        >
          <ChevronLeft size={32} />
        </button>
      )}

      {currentIndex < photos.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(currentIndex + 1); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
        >
          <ChevronRight size={32} />
        </button>
      )}

      <div className="max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <img
          src={photo.url}
          alt={photo.caption || ''}
          className="max-w-full max-h-[85vh] object-contain rounded-lg"
        />
        {photo.caption && (
          <p className="text-white/70 text-sm text-center max-w-lg">{photo.caption}</p>
        )}
      </div>

      <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/60 text-sm">
        {currentIndex + 1} of {photos.length}
      </p>
    </div>
  );
}

export function EventCard({ event, showRegion, onEventUpdate, isSelected, onToggleSelect }: EventCardProps) {
  const [hostStatus, setHostStatus] = useState<HostStatus | null>(event.hostStatus);
  const [hostTags, setHostTags] = useState<string[]>(event.hostTags || []);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesValue, setNotesValue] = useState(event.underbossNotes || '');
  const [notesSaving, setNotesSaving] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [photosExpanded, setPhotosExpanded] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [showAllPhotos, setShowAllPhotos] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const loadPhotos = useCallback(async () => {
    if (photos.length > 0 || !event.id) return;
    setPhotosLoading(true);
    try {
      const result = await getPartyPhotos(event.id);
      setPhotos(result?.photos || []);
    } catch (err) {
      console.error('Failed to load photos:', err);
    } finally {
      setPhotosLoading(false);
    }
  }, [event.id, photos.length]);

  const togglePhotos = useCallback(() => {
    if (event.photoCount === 0) return;
    const next = !photosExpanded;
    setPhotosExpanded(next);
    if (next) loadPhotos();
  }, [photosExpanded, event.photoCount, loadPhotos]);

  const saveNotes = useCallback(async (value: string) => {
    const trimmed = value.trim();
    const newValue = trimmed || null;
    setNotesSaving(true);
    onEventUpdate?.(event.id, { underbossNotes: newValue });
    try {
      await updateUnderbossNotes(event.id, newValue);
    } catch {
      setNotesValue(event.underbossNotes || '');
      onEventUpdate?.(event.id, { underbossNotes: event.underbossNotes });
    } finally {
      setNotesSaving(false);
    }
  }, [event.id, event.underbossNotes, onEventUpdate]);

  const handleNotesChange = useCallback((value: string) => {
    setNotesValue(value);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveNotes(value), 1000);
  }, [saveNotes]);

  const handleNotesBlur = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveNotes(notesValue);
  }, [notesValue, saveNotes]);

  const hasNotes = !!(event.underbossNotes || notesValue.trim());

  const eventUrl = event.customUrl ? `https://rsv.pizza/${event.customUrl}` : null;
  const relTime = formatRelativeTime(event.date);
  const fullDate = formatFullDate(event.date);

  return (
    <div className="rounded-lg p-4 bg-theme-surface border border-theme-stroke transition-colors">
      {/* Top row: selection checkbox + event name + link */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => onToggleSelect?.(event.id)}
          className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors shrink-0 mt-0.5 ${
            isSelected
              ? 'bg-[#ff393a]/20 border-[#ff393a]/40 text-[#ff393a]'
              : 'border-theme-stroke text-transparent hover:border-theme-stroke-hover'
          }`}
          title="Select event"
        >
          <Check size={12} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {event.underbossApproved && (
              <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" title="Approved" />
            )}
            <span className="text-sm font-medium text-theme-text truncate">{event.name.replace(/^Global Pizza Party\s*/i, '')}</span>
            {eventUrl && (
              <a href={eventUrl} target="_blank" rel="noopener noreferrer" className="text-theme-text-faint hover:text-theme-text-secondary transition-colors shrink-0">
                <ExternalLink size={12} />
              </a>
            )}
            <button
              onClick={() => setNotesOpen(!notesOpen)}
              className={`transition-colors shrink-0 ${
                hasNotes
                  ? 'text-amber-400 hover:text-amber-300'
                  : 'text-theme-text-faint hover:text-theme-text-secondary'
              }`}
              title={hasNotes ? 'Edit notes' : 'Add notes'}
            >
              <StickyNote size={12} />
            </button>
          </div>

          {/* Date */}
          <div className="flex items-center gap-1.5 mt-0.5" title={fullDate}>
            <Calendar size={10} className="text-theme-text-faint" />
            <span className={`text-xs ${relTime.isPast ? 'text-red-400' : 'text-theme-text-muted'}`}>
              {relTime.text}
            </span>
            {showRegion && event.country && (
              <>
                <span className="text-theme-text-faint">·</span>
                <span className="text-xs text-theme-text-muted">
                  {event.country || ''}
                </span>
              </>
            )}
          </div>

          {/* Inline notes editor */}
          {notesOpen && (
            <div className="mt-1.5">
              <IconInput
                icon={StickyNote}
                iconSize={12}
                placeholder="Underboss notes..."
                value={notesValue}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleNotesChange(e.target.value)}
                onBlur={handleNotesBlur}
                multiline
                rows={2}
                className="bg-theme-surface border border-theme-stroke rounded-lg text-xs text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover !pl-8 py-1.5 pr-2"
              />
              {notesSaving && (
                <span className="text-[10px] text-theme-text-faint mt-0.5 block">Saving...</span>
              )}
            </div>
          )}
          {/* Show notes preview when collapsed */}
          {!notesOpen && hasNotes && (
            <button
              onClick={() => setNotesOpen(true)}
              className="text-[11px] text-amber-400/70 truncate max-w-full mt-0.5 text-left hover:text-amber-400 transition-colors block"
              title={notesValue}
            >
              {notesValue}
            </button>
          )}
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
        <button
          onClick={togglePhotos}
          disabled={event.photoCount === 0}
          className={`flex items-center gap-1 transition-colors ${
            event.photoCount > 0
              ? 'text-theme-text-muted hover:text-theme-text-secondary cursor-pointer'
              : 'text-theme-text-faint/40 cursor-default'
          }`}
        >
          <Camera size={12} />
          <span className="text-xs">{event.photoCount}</span>
        </button>
      </div>

      {/* Expandable photo grid */}
      {photosExpanded && (
        <div className="mt-3 pt-3 border-t border-theme-stroke/50">
          {photosLoading ? (
            <div className="flex items-center gap-2 py-3">
              <div className="animate-spin w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full" />
              <span className="text-xs text-theme-text-muted">Loading photos...</span>
            </div>
          ) : photos.length === 0 ? (
            <p className="text-xs text-theme-text-faint py-2">No photos found</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-1.5">
                {(showAllPhotos ? photos : photos.slice(0, 12)).map((photo, idx) => (
                  <button
                    key={photo.id}
                    onClick={() => setLightboxIndex(idx)}
                    className="aspect-square rounded-lg overflow-hidden hover:ring-2 hover:ring-red-500/50 transition-all"
                  >
                    <img
                      src={photo.thumbnailUrl || photo.url}
                      alt={photo.caption || ''}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
              {!showAllPhotos && photos.length > 12 && (
                <button
                  onClick={() => setShowAllPhotos(true)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Show all {photos.length} photos
                </button>
              )}
            </div>
          )}
        </div>
      )}

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

      {lightboxIndex !== null && (showAllPhotos ? photos : photos.slice(0, 12))[lightboxIndex] && createPortal(
        <PhotoLightbox
          photos={showAllPhotos ? photos : photos.slice(0, 12)}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />,
        document.body
      )}
    </div>
  );
}
