import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Users, Camera, MapPin, Calendar, ExternalLink, Check, Plus, X, Handshake, StickyNote, ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react';
import { ProgressIndicator } from './ProgressIndicator';
import { IconInput } from '../IconInput';
import { CopyEmailButton } from '../CopyEmailButton';
import { updateHostStatus, bulkUpdateEventTags, updateUnderbossNotes, updateExpectedGuests, getPartyPhotos } from '../../lib/api';
import { triggerFlyerRegenForEvents } from '../flyer/autoRegenFlyer';
import { getGppPhotosForCity, getGppPhotoCounts } from '../../lib/gppPhotos';
import { calculateEventPrice } from '../../utils/sponsorshipPricing';
import type { UnderbossEvent, HostStatus } from '../../types';

interface DisplayPhoto {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
  source: 'uploaded' | 'gpp';
  year?: number;
}

interface EventRowProps {
  event: UnderbossEvent;
  showRegion?: boolean;
  onEventUpdate?: (eventId: string, updates: Partial<UnderbossEvent>) => void;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  partnerTags?: string[];
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

// Event tags pills with inline editor.
// Writes to `parties.event_tags` via `bulkUpdateEventTags` so partner co-host /
// sponsor sync runs (matches the bulk action menu's behavior).
function HostTagsPills({
  tags,
  eventId,
  event,
  onUpdate,
  partnerTags = [],
}: {
  tags: string[];
  eventId: string;
  event: UnderbossEvent;
  onUpdate: (tags: string[]) => void;
  partnerTags?: string[];
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTag, setNewTag] = useState('');

  const presetTags = ['review', 'swc'];

  async function addTag(tag: string) {
    const cleaned = tag.trim().toLowerCase();
    if (!cleaned || tags.includes(cleaned)) return;
    const newTags = [...tags, cleaned];
    onUpdate(newTags);
    setNewTag('');
    setIsAdding(false);
    try {
      await bulkUpdateEventTags([eventId], [cleaned], 'add');
      triggerFlyerRegenForEvents([event]);
    } catch {
      onUpdate(tags);
    }
  }

  async function removeTag(tag: string) {
    const newTags = tags.filter((t) => t !== tag);
    onUpdate(newTags);
    try {
      await bulkUpdateEventTags([eventId], [tag], 'remove');
      triggerFlyerRegenForEvents([event]);
    } catch {
      onUpdate(tags);
    }
  }

  function colorForTag(tag: string): string {
    if (tag === 'review') return 'bg-red-500/20 text-red-400 border-red-500/30';
    if (tag === 'swc') return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    if (tag === 'global pizza party') return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
  }

  return (
    <div className="flex flex-wrap items-center gap-1 mt-0.5">
      {tags.map((tag) => (
        <button
          key={tag}
          onClick={() => removeTag(tag)}
          className={`text-[10px] px-1.5 py-0.5 rounded-md border transition-colors hover:opacity-70 inline-flex items-center gap-0.5 ${colorForTag(tag)}`}
          title={`Click to remove "${tag}"`}
        >
          {partnerTags.includes(tag) && (
            <Handshake size={9} className="shrink-0" />
          )}
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

function PhotoLightbox({
  photos,
  currentIndex,
  onClose,
  onNavigate,
}: {
  photos: DisplayPhoto[];
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

export function EventRow({ event, showRegion, onEventUpdate, isSelected, onToggleSelect, partnerTags = [] }: EventRowProps) {
  // Local state for optimistic updates
  const [hostStatus, setHostStatus] = useState<HostStatus | null>(event.hostStatus);
  const [eventTags, setEventTags] = useState<string[]>(event.eventTags || []);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesValue, setNotesValue] = useState(event.underbossNotes || '');
  const [notesSaving, setNotesSaving] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [photosExpanded, setPhotosExpanded] = useState(false);
  const [displayPhotos, setDisplayPhotos] = useState<DisplayPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [showAllPhotos, setShowAllPhotos] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // GPP photo count for the badge (fetched once, cached at module level)
  const [gppCount, setGppCount] = useState(0);

  useEffect(() => {
    const cityName = event.name.replace(/^Global Pizza Party\s*/i, '').trim();
    if (!cityName) return;
    getGppPhotoCounts().then(counts => {
      const key = cityName.toLowerCase().replace(/\s+/g, '');
      setGppCount(counts[key] || 0);
    });
  }, [event.name]);

  const loadPhotos = useCallback(async () => {
    if (displayPhotos.length > 0 || !event.id) return;
    setPhotosLoading(true);
    try {
      // Extract city name from event name (strip "Global Pizza Party " prefix)
      const cityName = event.name.replace(/^Global Pizza Party\s*/i, '').trim();

      // Fetch both sources in parallel
      const [uploadedResult, gppPhotos] = await Promise.all([
        getPartyPhotos(event.id),
        cityName ? getGppPhotosForCity(cityName) : Promise.resolve([]),
      ]);

      // Convert uploaded photos to DisplayPhoto
      const uploaded: DisplayPhoto[] = (uploadedResult?.photos || []).map((p) => ({
        id: p.id,
        url: p.url,
        thumbnailUrl: p.thumbnailUrl,
        caption: p.caption,
        source: 'uploaded' as const,
      }));

      // Convert GPP photos to DisplayPhoto
      const gpp: DisplayPhoto[] = gppPhotos.map((p, i) => ({
        id: `gpp-${i}`,
        url: p.url,
        thumbnailUrl: null,
        caption: `GPP ${p.year}`,
        source: 'gpp' as const,
        year: p.year,
      }));

      // Uploaded first, then GPP
      setDisplayPhotos([...uploaded, ...gpp]);
    } catch (err) {
      console.error('Failed to load photos:', err);
    } finally {
      setPhotosLoading(false);
    }
  }, [event.id, event.name, displayPhotos.length]);

  const togglePhotos = useCallback(() => {
    const next = !photosExpanded;
    setPhotosExpanded(next);
    if (next) loadPhotos();
  }, [photosExpanded, loadPhotos]);

  // Expected guests state
  const [expectedGuestsValue, setExpectedGuestsValue] = useState(
    event.expectedGuests != null ? String(event.expectedGuests) : ''
  );
  const expectedGuestsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveExpectedGuests = useCallback(async (value: string) => {
    const trimmed = value.trim();
    const numValue = trimmed === '' ? null : parseInt(trimmed, 10);
    if (trimmed !== '' && (isNaN(numValue!) || numValue! < 0)) return;
    onEventUpdate?.(event.id, { expectedGuests: numValue });
    try {
      await updateExpectedGuests(event.id, numValue);
    } catch {
      setExpectedGuestsValue(event.expectedGuests != null ? String(event.expectedGuests) : '');
      onEventUpdate?.(event.id, { expectedGuests: event.expectedGuests });
    }
  }, [event.id, event.expectedGuests, onEventUpdate]);

  const handleExpectedGuestsChange = useCallback((value: string) => {
    // Only allow digits
    if (value !== '' && !/^\d+$/.test(value)) return;
    setExpectedGuestsValue(value);
    if (expectedGuestsTimeoutRef.current) clearTimeout(expectedGuestsTimeoutRef.current);
    expectedGuestsTimeoutRef.current = setTimeout(() => saveExpectedGuests(value), 1000);
  }, [saveExpectedGuests]);

  const handleExpectedGuestsBlur = useCallback(() => {
    if (expectedGuestsTimeoutRef.current) clearTimeout(expectedGuestsTimeoutRef.current);
    saveExpectedGuests(expectedGuestsValue);
  }, [expectedGuestsValue, saveExpectedGuests]);

  const saveNotes = useCallback(async (value: string) => {
    const trimmed = value.trim();
    const newValue = trimmed || null;
    setNotesSaving(true);
    onEventUpdate?.(event.id, { underbossNotes: newValue });
    try {
      await updateUnderbossNotes(event.id, newValue);
    } catch {
      // Revert on error
      setNotesValue(event.underbossNotes || '');
      onEventUpdate?.(event.id, { underbossNotes: event.underbossNotes });
    } finally {
      setNotesSaving(false);
    }
  }, [event.id, event.underbossNotes, onEventUpdate]);

  const handleNotesChange = useCallback((value: string) => {
    setNotesValue(value);
    // Debounce auto-save
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveNotes(value), 1000);
  }, [saveNotes]);

  const handleNotesBlur = useCallback(() => {
    // Save immediately on blur
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveNotes(notesValue);
  }, [notesValue, saveNotes]);

  const eventUrl = `https://rsv.pizza/${event.customUrl || event.inviteCode}`;

  const relTime = formatRelativeTime(event.date);
  const fullDate = formatFullDate(event.date);

  const cityName = event.name.replace(/^Global Pizza Party\s*/i, '').trim();
  const priceGuests = event.expectedGuests ?? event.guestCount ?? 30;
  const price = calculateEventPrice(priceGuests, cityName);

  const hasNotes = !!(event.underbossNotes || notesValue.trim());

  const displayedPhotos = showAllPhotos ? displayPhotos : displayPhotos.slice(0, 12);

  return (
    <>
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
        <td className="py-3 px-3 max-w-[200px]">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {event.underbossStatus === 'approved' && (
                  <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" title="Approved" />
                )}
                {event.underbossStatus === 'rejected' && (
                  <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" title="Rejected" />
                )}
                {event.underbossStatus === 'hidden' && (
                  <span className="w-2 h-2 rounded-full bg-gray-400 shrink-0" title="Hidden" />
                )}
                {event.underbossStatus === 'listed' && (
                  <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" title="Community Listed" />
                )}
                <span className="text-sm font-medium text-theme-text truncate">{event.name.replace(/^Global Pizza Party\s*/i, '')}</span>
                <a
                  href={eventUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-theme-text-faint hover:text-theme-text-secondary transition-colors shrink-0"
                >
                  <ExternalLink size={12} />
                </a>
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
                {event.telegramGroup && (
                  <a
                    href={event.telegramGroup}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#29B6F6] hover:text-[#4FC3F7] transition-colors shrink-0"
                    title="Telegram group"
                  >
                    <MessageCircle size={12} />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5" title={fullDate}>
                <Calendar size={10} className="text-theme-text-faint" />
                <span className={`text-xs ${relTime.isPast ? 'text-red-400' : 'text-theme-text-muted'}`}>
                  {relTime.text}
                </span>
                <span className="text-xs font-medium text-green-400 ml-1">&middot; ${price.toLocaleString()}</span>
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
                  className="text-[11px] text-amber-400/70 truncate max-w-[180px] mt-0.5 text-left hover:text-amber-400 transition-colors block"
                  title={notesValue}
                >
                  {notesValue}
                </button>
              )}
            </div>
          </div>
        </td>

        {/* Country (optional) */}
        {showRegion && (
          <td className="py-3 px-3">
            <span className="text-xs text-theme-text-muted">
              {event.country || '\u2014'}
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
            <div className="flex items-center gap-1">
              <div className="text-xs text-theme-text-faint truncate max-w-[150px]">{event.host.email}</div>
              <CopyEmailButton email={event.host.email} />
            </div>
          )}
          <HostTagsPills
            tags={eventTags}
            eventId={event.id}
            event={event}
            partnerTags={partnerTags}
            onUpdate={(tags) => {
              setEventTags(tags);
              onEventUpdate?.(event.id, { eventTags: tags });
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
          {event.invitedCount > 0 && (
            <div className="text-xs text-blue-400/60">{event.invitedCount} invited</div>
          )}
          {event.checkedInCount > 0 && (
            <div className="text-xs text-green-400/60">{event.checkedInCount} checked in</div>
          )}
          <div className="mt-1">
            <input
              type="text"
              inputMode="numeric"
              value={expectedGuestsValue}
              onChange={(e) => handleExpectedGuestsChange(e.target.value)}
              onBlur={handleExpectedGuestsBlur}
              placeholder="exp."
              className="w-12 bg-transparent border-b border-theme-stroke text-[10px] text-center text-theme-text-muted focus:outline-none focus:border-theme-stroke-hover placeholder:text-theme-text-faint [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              title="Expected guests"
            />
          </div>
        </td>

        {/* Photos */}
        <td className="py-3 px-3 text-center">
          <button
            onClick={togglePhotos}
            className="inline-flex items-center justify-center gap-1 text-theme-text-muted hover:text-theme-text-secondary cursor-pointer transition-colors"
          >
            <Camera size={12} />
            <span className="text-xs">{event.photoCount + gppCount}</span>
          </button>
        </td>

        {/* Progress (8 items) */}
        <td className="py-3 px-3">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
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
        </td>
      </tr>
      {photosExpanded && (
        <tr>
          <td colSpan={showRegion ? 9 : 8} className="py-3 px-6 bg-theme-surface/30 border-b border-theme-stroke">
            {photosLoading ? (
              <div className="flex items-center gap-2 py-4">
                <div className="animate-spin w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full" />
                <span className="text-xs text-theme-text-muted">Loading photos...</span>
              </div>
            ) : displayPhotos.length === 0 ? (
              <p className="text-xs text-theme-text-faint py-2">No photos found</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
                  {displayedPhotos.map((photo, idx) => (
                    <button
                      key={photo.id}
                      onClick={() => setLightboxIndex(idx)}
                      className="aspect-square rounded-lg overflow-hidden hover:ring-2 hover:ring-red-500/50 transition-all relative group"
                    >
                      <img
                        src={photo.thumbnailUrl || photo.url}
                        alt={photo.caption || ''}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      {photo.source === 'gpp' && photo.year && (
                        <span className="absolute bottom-0.5 right-0.5 text-[9px] bg-black/60 text-white/80 px-1 rounded">
                          {photo.year}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {!showAllPhotos && displayPhotos.length > 12 && (
                  <button
                    onClick={() => setShowAllPhotos(true)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Show all {displayPhotos.length} photos
                  </button>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
      {lightboxIndex !== null && displayedPhotos[lightboxIndex] && createPortal(
        <PhotoLightbox
          photos={displayedPhotos}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />,
        document.body
      )}
    </>
  );
}
