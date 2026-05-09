import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, ArrowUpDown, ThumbsUp, ThumbsDown, ChevronDown, Check, X, DollarSign } from 'lucide-react';
import { IconInput } from '../IconInput';
import { EventRow } from './EventRow';
import { EventCard } from './EventCard';
import { bulkUpdateUnderbossStatus, bulkDeleteEvents, bulkUpdateEventTags } from '../../lib/api';
import { triggerFlyerRegenForEvents } from '../flyer/autoRegenFlyer';
import type { UnderbossEvent, UnderbossEventProgress } from '../../types';
import { calculateTagSponsorshipTotal } from '../../utils/sponsorshipPricing';

interface EventTableProps {
  events: UnderbossEvent[];
  showRegion?: boolean;
  onEventUpdate?: (eventId: string, updates: Partial<UnderbossEvent>) => void;
  onBulkAction?: () => void;
  onTelegramBroadcast?: (cities: string[]) => void;
  partnerTags?: string[];
}

type SortField = 'name' | 'date' | 'guestCount' | 'progress';
type SortDir = 'asc' | 'desc';

// Filterable progress keys (skip "Event" always-true and "Prep" always-false)
const PROGRESS_FILTER_KEYS: { key: keyof UnderbossEventProgress; label: string }[] = [
  { key: 'hasPartyKit', label: 'Kit' },
  { key: 'hasCoHosts', label: 'Team' },
  { key: 'hasVenue', label: 'Venue' },
  { key: 'hasBudget', label: 'Budget' },
  { key: 'hasSponsors', label: 'Partners' },
  { key: 'hasSocialPosts', label: 'Social' },
  { key: 'hasThrown', label: 'Thrown' },
];

function countProgress(event: UnderbossEvent): number {
  const p = event.progress;
  return [
    p.hasCreatedEvent, p.hasPartyKit, p.hasCoHosts, p.hasVenue,
    p.hasBudget, p.hasSponsors, p.hasPrepared, p.hasSocialPosts, p.hasThrown,
  ].filter(Boolean).length;
}

// Three-state topping-style filter pill
function FilterPill({
  label,
  state,
  onToggle,
}: {
  label: string;
  state: 'neutral' | 'include' | 'exclude';
  onToggle: (newState: 'neutral' | 'include' | 'exclude') => void;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${
        state === 'include'
          ? 'bg-[#39d98a]/20 border-[#39d98a]/30'
          : state === 'exclude'
            ? 'bg-[#ff393a]/20 border-[#ff393a]/30'
            : 'bg-theme-surface border-theme-stroke'
      }`}
    >
      <button
        onClick={() => onToggle(state === 'include' ? 'neutral' : 'include')}
        className="flex items-center gap-1.5 flex-1 py-0.5 hover:opacity-70 transition-opacity"
        title={`Must have ${label}`}
      >
        <ThumbsUp
          size={12}
          className={`transition-all ${state === 'include' ? 'text-[#39d98a]' : 'text-theme-text-faint'}`}
        />
        <span className="text-theme-text text-xs">{label}</span>
      </button>
      <button
        onClick={() => onToggle(state === 'exclude' ? 'neutral' : 'exclude')}
        className="p-0.5 hover:opacity-70 transition-opacity"
        title={`Must NOT have ${label}`}
      >
        <ThumbsDown
          size={12}
          className={`transition-all ${state === 'exclude' ? 'text-[#ff393a]' : 'text-theme-text-faint'}`}
        />
      </button>
    </div>
  );
}

export function EventTable({ events, showRegion, onEventUpdate, onBulkAction, onTelegramBroadcast, partnerTags = [] }: EventTableProps) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');

  // Selection state for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showActionDropdown, setShowActionDropdown] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showTagSubmenu, setShowTagSubmenu] = useState<'add' | 'remove' | null>(null);
  const [customTag, setCustomTag] = useState('');
  const [showCopyCitiesModal, setShowCopyCitiesModal] = useState(false);
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  const [discount, setDiscount] = useState(0);

  // Alphabetized city names from the currently-selected events.
  // Reuses the same extraction logic as the Send Telegram action: strip
  // the "Global Pizza Party " prefix from event names, fall back to the
  // customUrl slug, then the raw name.
  const selectedCitiesSorted = useMemo(() => {
    const prefix = 'Global Pizza Party ';
    return events
      .filter(e => selectedIds.has(e.id))
      .map(e => e.name.startsWith(prefix) ? e.name.slice(prefix.length) : (e.customUrl || e.name))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [events, selectedIds]);

  // Three-state progress filters: includes (must have) and excludes (must NOT have)
  const [progressIncludes, setProgressIncludes] = useState<string[]>([]);
  const [progressExcludes, setProgressExcludes] = useState<string[]>([]);

  function getFilterState(key: string): 'neutral' | 'include' | 'exclude' {
    if (progressIncludes.includes(key)) return 'include';
    if (progressExcludes.includes(key)) return 'exclude';
    return 'neutral';
  }

  function setFilterState(key: string, newState: 'neutral' | 'include' | 'exclude') {
    setProgressIncludes((prev) => prev.filter((k) => k !== key));
    setProgressExcludes((prev) => prev.filter((k) => k !== key));
    if (newState === 'include') {
      setProgressIncludes((prev) => [...prev, key]);
    } else if (newState === 'exclude') {
      setProgressExcludes((prev) => [...prev, key]);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filteredEvents = useMemo(() => {
    let result = events;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.host.name?.toLowerCase().includes(q) ||
          e.host.email?.toLowerCase().includes(q) ||
          e.address?.toLowerCase().includes(q) ||
          e.venueName?.toLowerCase().includes(q) ||
          e.country?.toLowerCase().includes(q) ||
          e.region?.toLowerCase().includes(q)
      );
    }

    // Progress + approved includes (AND logic — event must have ALL included items)
    if (progressIncludes.length > 0) {
      result = result.filter((e) =>
        progressIncludes.every((key) => {
          if (key === 'approved') return e.underbossStatus === 'approved';
          if (key === 'rejected') return e.underbossStatus === 'rejected';
          if (key === 'hidden') return e.underbossStatus === 'hidden';
          if (key === 'listed') return e.underbossStatus === 'listed';
          return e.progress[key as keyof typeof e.progress];
        })
      );
    }

    // Progress + approved excludes (AND logic — event must NOT have ANY excluded items)
    if (progressExcludes.length > 0) {
      result = result.filter((e) =>
        progressExcludes.every((key) => {
          if (key === 'approved') return e.underbossStatus !== 'approved';
          if (key === 'rejected') return e.underbossStatus !== 'rejected';
          if (key === 'hidden') return e.underbossStatus !== 'hidden';
          if (key === 'listed') return e.underbossStatus !== 'listed';
          return !e.progress[key as keyof typeof e.progress];
        })
      );
    }

    // Country filter (only when showRegion is active)
    if (showRegion && regionFilter !== 'all') {
      result = result.filter((e) => {
        const country = e.country || '';
        return country === regionFilter;
      });
    }

    // Tag filter
    if (tagFilter !== 'all') {
      result = result.filter((e) => e.eventTags?.includes(tagFilter));
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'date':
          if (!a.date && !b.date) cmp = 0;
          else if (!a.date) cmp = 1;
          else if (!b.date) cmp = -1;
          else cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'guestCount':
          cmp = a.guestCount - b.guestCount;
          break;
        case 'progress':
          cmp = countProgress(a) - countProgress(b);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [events, search, sortField, sortDir, progressIncludes, progressExcludes, regionFilter, showRegion, tagFilter]);

  const availableTags = useMemo(
    () => Array.from(new Set(events.flatMap((e) => e.eventTags ?? []))).sort(),
    [events]
  );

  const sponsorshipSuggestion = useMemo(() => {
    if (tagFilter === 'all' || filteredEvents.length === 0) return null;
    return calculateTagSponsorshipTotal(filteredEvents);
  }, [tagFilter, filteredEvents]);

  function toggleSelectAll() {
    if (selectedIds.size === filteredEvents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEvents.map(e => e.id)));
    }
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function SortHeader({ field, children }: { field: SortField; children: React.ReactNode }) {
    const isActive = sortField === field;
    return (
      <th
        className="py-2 px-3 text-left cursor-pointer hover:bg-theme-surface transition-colors select-none"
        onClick={() => toggleSort(field)}
      >
        <div className="flex items-center gap-1">
          <span className={`text-xs uppercase tracking-wider ${isActive ? 'text-theme-text-secondary' : 'text-theme-text-faint'}`}>
            {children}
          </span>
          <ArrowUpDown size={10} className={isActive ? 'text-theme-text-muted' : 'text-theme-text-faint'} />
        </div>
      </th>
    );
  }

  const hasActiveFilters = progressIncludes.length > 0 || progressExcludes.length > 0 || regionFilter !== 'all' || tagFilter !== 'all';

  return (
    <div className="space-y-3">
      {/* Search + count */}
      <div className="flex items-center justify-between gap-4">
        <div className="max-w-sm flex-1">
          <IconInput
          icon={Search}
          iconSize={14}
          type="text"
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          placeholder="Search events, hosts, venues..."
          className="bg-theme-surface border border-theme-stroke rounded-lg pr-3 py-2 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
        />
        </div>
        <div className="text-xs text-theme-text-faint whitespace-nowrap">
          {filteredEvents.length} of {events.length} events
        </div>
      </div>

      {/* Filters — topping-style pills */}
      <div className="flex flex-wrap items-center gap-2">
        {PROGRESS_FILTER_KEYS.map(({ key, label }) => (
          <FilterPill
            key={key}
            label={label}
            state={getFilterState(key)}
            onToggle={(newState) => setFilterState(key, newState)}
          />
        ))}

        {/* Approved filter */}
        <FilterPill
          label="Approved"
          state={getFilterState('approved')}
          onToggle={(newState) => setFilterState('approved', newState)}
        />

        {/* Rejected filter */}
        <FilterPill
          label="Rejected"
          state={getFilterState('rejected')}
          onToggle={(newState) => setFilterState('rejected', newState)}
        />

        {/* Hidden filter */}
        <FilterPill
          label="Hidden"
          state={getFilterState('hidden')}
          onToggle={(newState) => setFilterState('hidden', newState)}
        />

        {/* Listed filter */}
        <FilterPill
          label="Listed"
          state={getFilterState('listed')}
          onToggle={(newState) => setFilterState('listed', newState)}
        />

        {/* Country filter -- only when showRegion */}
        {showRegion && (
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-1.5 text-sm text-theme-text-secondary focus:outline-none focus:border-theme-stroke-hover"
          >
            <option value="all">Country: All</option>
            {[...new Set(events.map(e => e.country).filter(Boolean))].sort().map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}

        {/* Tag filter */}
        {availableTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-1.5 text-sm text-theme-text-secondary focus:outline-none focus:border-theme-stroke-hover"
          >
            <option value="all">Tag: All</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>Tag: {tag}</option>
            ))}
          </select>
        )}

        {/* Clear filters link */}
        {hasActiveFilters && (
          <button
            onClick={() => {
              setProgressIncludes([]);
              setProgressExcludes([]);
              setRegionFilter('all');
              setTagFilter('all');
            }}
            className="text-xs text-red-500/70 hover:text-red-500 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Sponsorship pricing suggestion banner */}
      {sponsorshipSuggestion && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-theme-surface border border-theme-stroke">
          <DollarSign size={14} className="text-theme-text-secondary" />
          <span className="text-sm text-theme-text">
            Suggested sponsorship for "<span className="font-medium">{tagFilter}</span>"
            ({sponsorshipSuggestion.eventCount} events):
            {discount > 0 ? (
              <>
                <span className="line-through text-theme-text-muted ml-1">${sponsorshipSuggestion.total.toLocaleString()}</span>
                <span className="font-bold text-white ml-1">${Math.round(sponsorshipSuggestion.total * (1 - discount / 100)).toLocaleString()}</span>
              </>
            ) : (
              <span className="font-bold text-white ml-1">${sponsorshipSuggestion.total.toLocaleString()}</span>
            )}
          </span>
          <div className="flex items-center gap-1 ml-2">
            <input
              type="number"
              min={0}
              max={100}
              value={discount || ''}
              onChange={(e) => setDiscount(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              placeholder="0"
              className="w-12 px-1.5 py-0.5 text-xs text-center rounded bg-black/30 border border-theme-stroke text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
            />
            <span className="text-xs text-theme-text-muted">% off</span>
          </div>
          {sponsorshipSuggestion.missingExpectedGuests > 0 && (
            <span className="text-xs text-amber-400 ml-2">
              ({sponsorshipSuggestion.missingExpectedGuests} without expected guests)
            </span>
          )}
        </div>
      )}

      {/* Bulk action bar — always visible */}
      <div className="sticky top-0 z-30 flex items-center gap-3 px-4 py-2 rounded-lg bg-theme-surface border border-theme-stroke">
        {selectedIds.size > 0 ? (
          <>
          <span className="text-sm text-theme-text-secondary font-medium">
            {selectedIds.size} selected
          </span>

          {/* Action dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowActionDropdown(!showActionDropdown)}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-theme-card border border-theme-stroke text-sm text-theme-text hover:bg-theme-surface-hover transition-colors disabled:opacity-50"
            >
              Actions <ChevronDown size={14} />
            </button>
            {showActionDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => { setShowActionDropdown(false); setShowTagSubmenu(null); setCustomTag(''); }} />
                <div className="absolute top-full left-0 mt-1 z-50 bg-theme-card border border-theme-stroke rounded-lg shadow-xl py-1 min-w-[180px]">
                  {(() => {
                    const selectedEvents = events.filter(e => selectedIds.has(e.id));
                    const allApproved = selectedEvents.length > 0 && selectedEvents.every(e => e.underbossStatus === 'approved');
                    return (
                      <button
                        onClick={async () => {
                          setShowActionDropdown(false);
                          setBulkLoading(true);
                          const newStatus = allApproved ? 'pending' : 'approved';
                          try {
                            await bulkUpdateUnderbossStatus(Array.from(selectedIds), newStatus);
                            for (const id of selectedIds) {
                              onEventUpdate?.(id, { underbossStatus: newStatus });
                            }
                            setSelectedIds(new Set());
                          } catch (err) { console.error(`Bulk ${newStatus} failed`, err); }
                          setBulkLoading(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-theme-text hover:bg-theme-surface transition-colors"
                      >
                        {allApproved ? 'Unapprove' : 'Approve'}
                      </button>
                    );
                  })()}
                  <button
                    onClick={async () => {
                      setShowActionDropdown(false);
                      setBulkLoading(true);
                      try {
                        await bulkUpdateUnderbossStatus(Array.from(selectedIds), 'rejected');
                        setSelectedIds(new Set());
                        onBulkAction?.();
                      } catch (err) { console.error('Bulk reject failed', err); }
                      setBulkLoading(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-theme-surface transition-colors"
                  >
                    Reject
                  </button>
                  <button
                    onClick={async () => {
                      setShowActionDropdown(false);
                      setBulkLoading(true);
                      try {
                        await bulkUpdateUnderbossStatus(Array.from(selectedIds), 'hidden');
                        setSelectedIds(new Set());
                        onBulkAction?.();
                      } catch (err) { console.error('Bulk hide failed', err); }
                      setBulkLoading(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-theme-text hover:bg-theme-surface transition-colors"
                  >
                    Hide
                  </button>
                  <button
                    onClick={() => {
                      setShowActionDropdown(false);
                      setShowDeleteConfirm(true);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-theme-surface transition-colors"
                  >
                    Cancel Event
                  </button>
                  <button
                    onClick={() => {
                      setShowActionDropdown(false);
                      // Extract city names from selected events (strip "Global Pizza Party " prefix)
                      const cities = events
                        .filter(e => selectedIds.has(e.id))
                        .map(e => {
                          // customUrl is the city name lowercase no spaces (e.g., "tokyo")
                          // name is "Global Pizza Party CityName"
                          const prefix = 'Global Pizza Party ';
                          return e.name.startsWith(prefix)
                            ? e.name.slice(prefix.length)
                            : e.customUrl || e.name;
                        });
                      onTelegramBroadcast?.(cities);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-theme-text hover:bg-theme-surface transition-colors"
                  >
                    Send Telegram
                  </button>
                  <button
                    onClick={() => {
                      setShowActionDropdown(false);
                      setShowCopyCitiesModal(true);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-theme-text hover:bg-theme-surface transition-colors"
                  >
                    Copy Cities
                  </button>

                  {/* Divider */}
                  <div className="border-t border-theme-stroke my-1" />

                  {/* Add Tag */}
                  <div className="relative">
                    <button
                      onClick={() => setShowTagSubmenu(showTagSubmenu === 'add' ? null : 'add')}
                      className="w-full text-left px-4 py-2 text-sm text-theme-text hover:bg-theme-surface transition-colors"
                    >
                      Add Tag &rarr;
                    </button>
                    {showTagSubmenu === 'add' && (
                      <div className="absolute left-full top-0 ml-1 bg-theme-card border border-theme-stroke rounded-lg shadow-xl py-1 min-w-[160px]">
                        {['review', 'swc', 'Global Pizza Party'].map((tag) => (
                          <button
                            key={tag}
                            onClick={async () => {
                              setShowActionDropdown(false);
                              setShowTagSubmenu(null);
                              setBulkLoading(true);
                              try {
                                await bulkUpdateEventTags(Array.from(selectedIds), [tag], 'add');
                                // Optimistic update
                                for (const id of selectedIds) {
                                  const evt = events.find(e => e.id === id);
                                  if (evt) {
                                    const existing = evt.eventTags || [];
                                    if (!existing.includes(tag.toLowerCase())) {
                                      onEventUpdate?.(id, { eventTags: [...existing, tag.toLowerCase()] });
                                    }
                                  }
                                }
                                // Trigger flyer regen for affected events
                                const affected = events.filter(e => selectedIds.has(e.id));
                                triggerFlyerRegenForEvents(affected);
                              } catch (err) { console.error('Add tag failed', err); }
                              setBulkLoading(false);
                            }}
                            className="w-full text-left px-4 py-2 text-sm text-theme-text hover:bg-theme-surface transition-colors"
                          >
                            {tag}
                          </button>
                        ))}
                        {/* Custom tag input */}
                        <div className="px-3 py-2 border-t border-theme-stroke">
                          <input
                            type="text"
                            value={customTag}
                            onChange={(e) => setCustomTag(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter' && customTag.trim()) {
                                setShowActionDropdown(false);
                                setShowTagSubmenu(null);
                                setBulkLoading(true);
                                try {
                                  await bulkUpdateEventTags(Array.from(selectedIds), [customTag.trim()], 'add');
                                  for (const id of selectedIds) {
                                    const evt = events.find(ev => ev.id === id);
                                    if (evt) {
                                      const existing = evt.eventTags || [];
                                      const cleaned = customTag.trim().toLowerCase();
                                      if (!existing.includes(cleaned)) {
                                        onEventUpdate?.(id, { eventTags: [...existing, cleaned] });
                                      }
                                    }
                                  }
                                  // Trigger flyer regen for affected events
                                  const affected = events.filter(e2 => selectedIds.has(e2.id));
                                  triggerFlyerRegenForEvents(affected);
                                } catch (err) { console.error('Add custom tag failed', err); }
                                setBulkLoading(false);
                                setCustomTag('');
                              }
                            }}
                            placeholder="Custom tag..."
                            className="w-full bg-transparent border-b border-theme-stroke text-xs text-theme-text focus:outline-none placeholder:text-theme-text-faint"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Remove Tag */}
                  <div className="relative">
                    <button
                      onClick={() => setShowTagSubmenu(showTagSubmenu === 'remove' ? null : 'remove')}
                      className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-theme-surface transition-colors"
                    >
                      Remove Tag &rarr;
                    </button>
                    {showTagSubmenu === 'remove' && (
                      <div className="absolute left-full top-0 ml-1 bg-theme-card border border-theme-stroke rounded-lg shadow-xl py-1 min-w-[160px]">
                        {/* Show tags that exist on selected events */}
                        {(() => {
                          const selectedEvents = events.filter(e => selectedIds.has(e.id));
                          const allTags = [...new Set(selectedEvents.flatMap(e => e.eventTags || []))];
                          if (allTags.length === 0) {
                            return <div className="px-4 py-2 text-xs text-theme-text-faint">No tags to remove</div>;
                          }
                          return allTags.map((tag) => (
                            <button
                              key={tag}
                              onClick={async () => {
                                setShowActionDropdown(false);
                                setShowTagSubmenu(null);
                                setBulkLoading(true);
                                try {
                                  await bulkUpdateEventTags(Array.from(selectedIds), [tag], 'remove');
                                  // Optimistic update
                                  for (const id of selectedIds) {
                                    const evt = events.find(e => e.id === id);
                                    if (evt) {
                                      onEventUpdate?.(id, { eventTags: (evt.eventTags || []).filter(t => t !== tag) });
                                    }
                                  }
                                  // Trigger flyer regen for affected events (partner logo may have been removed)
                                  const affected = events.filter(e => selectedIds.has(e.id));
                                  triggerFlyerRegenForEvents(affected);
                                } catch (err) { console.error('Remove tag failed', err); }
                                setBulkLoading(false);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-theme-surface transition-colors"
                            >
                              {tag}
                            </button>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-theme-text-faint hover:text-theme-text-muted transition-colors"
          >
            Deselect all
          </button>
          </>
        ) : (
          <span className="text-theme-text-faint text-sm">No events selected</span>
        )}
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-theme-card border border-theme-stroke rounded-xl p-6 max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-theme-text mb-2">Cancel Events?</h3>
            <p className="text-sm text-theme-text-muted mb-4">
              This will permanently delete {selectedIds.size} event{selectedIds.size > 1 ? 's' : ''}. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text transition-colors">
                Keep Events
              </button>
              <button
                onClick={async () => {
                  setShowDeleteConfirm(false);
                  setBulkLoading(true);
                  try {
                    await bulkDeleteEvents(Array.from(selectedIds));
                    setSelectedIds(new Set());
                    onBulkAction?.();
                  } catch (err) { console.error('Bulk delete failed', err); }
                  setBulkLoading(false);
                }}
                className="px-4 py-2 text-sm bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors"
              >
                Delete {selectedIds.size} Event{selectedIds.size > 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Copy Cities modal */}
      {showCopyCitiesModal && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowCopyCitiesModal(false)}
        >
          <div
            className="bg-theme-header border border-theme-stroke rounded-2xl p-5 max-w-md w-full"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-theme-text">
                Copy Cities ({selectedCitiesSorted.length} selected)
              </h3>
              <button
                onClick={() => setShowCopyCitiesModal(false)}
                className="text-theme-text-faint hover:text-theme-text transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <textarea
              readOnly
              value={selectedCitiesSorted.join('\n')}
              onFocus={e => e.currentTarget.select()}
              className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text font-mono resize-none focus:outline-none focus:border-theme-stroke-hover"
              style={{ maxHeight: '40vh', minHeight: '8rem', height: `${Math.min(Math.max(selectedCitiesSorted.length, 4), 16) * 1.5}rem`, overflowY: 'auto' }}
            />

            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setShowCopyCitiesModal(false)}
                className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text transition-colors"
              >
                Close
              </button>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(selectedCitiesSorted.join('\n'));
                    setCopiedToClipboard(true);
                    setTimeout(() => setCopiedToClipboard(false), 2000);
                  } catch (err) {
                    console.error('Copy to clipboard failed', err);
                  }
                }}
                disabled={selectedCitiesSorted.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: copiedToClipboard ? '#39d98a' : '#ff393a',
                }}
                onMouseEnter={e => {
                  if (!copiedToClipboard && selectedCitiesSorted.length > 0) {
                    e.currentTarget.style.backgroundColor = '#ff5a5b';
                  }
                }}
                onMouseLeave={e => {
                  if (!copiedToClipboard) {
                    e.currentTarget.style.backgroundColor = '#ff393a';
                  }
                }}
              >
                {copiedToClipboard ? (
                  <>
                    <Check size={14} /> Copied!
                  </>
                ) : (
                  'Copy to Clipboard'
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Mobile: card list */}
      <div className="md:hidden space-y-3">
        {filteredEvents.length === 0 ? (
          <div className="py-12 text-center text-theme-text-faint text-sm">
            {search ? 'No events match your search' : 'No events in this region yet'}
          </div>
        ) : (
          filteredEvents.map((event) => (
            <EventCard key={event.id} event={event} showRegion={showRegion} onEventUpdate={onEventUpdate} isSelected={selectedIds.has(event.id)} onToggleSelect={toggleSelect} />
          ))
        )}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-theme-stroke">
        <table className="w-full">
          <thead>
            <tr className="border-b border-theme-stroke bg-theme-surface">
              <th className="py-2 px-3 text-center w-8">
                <button
                  onClick={toggleSelectAll}
                  className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                    selectedIds.size === filteredEvents.length && filteredEvents.length > 0
                      ? 'bg-[#ff393a]/20 border-[#ff393a]/40 text-[#ff393a]'
                      : selectedIds.size > 0
                        ? 'bg-[#ff393a]/10 border-[#ff393a]/30 text-[#ff393a]'
                        : 'border-theme-stroke text-transparent hover:border-theme-stroke-hover'
                  }`}
                  title="Select all"
                >
                  {selectedIds.size > 0 && <Check size={12} />}
                </button>
              </th>
              <SortHeader field="name">Event</SortHeader>
              {showRegion && (
                <th className="py-2 px-3 text-left">
                  <span className="text-xs text-theme-text-faint uppercase tracking-wider">Country</span>
                </th>
              )}
              <th className="py-2 px-3 text-left">
                <span className="text-xs text-theme-text-faint uppercase tracking-wider">Host</span>
              </th>
              <th className="py-2 px-3 text-left">
                <span className="text-xs text-theme-text-faint uppercase tracking-wider">Location</span>
              </th>
              <SortHeader field="guestCount">RSVPs</SortHeader>
              <th className="py-2 px-3 text-center">
                <span className="text-xs text-theme-text-faint uppercase tracking-wider">Photos</span>
              </th>
              <SortHeader field="progress">Progress</SortHeader>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.length === 0 ? (
              <tr>
                <td colSpan={showRegion ? 8 : 7} className="py-12 text-center text-theme-text-faint text-sm">
                  {search ? 'No events match your search' : 'No events in this region yet'}
                </td>
              </tr>
            ) : (
              filteredEvents.map((event) => (
                <EventRow key={event.id} event={event} showRegion={showRegion} onEventUpdate={onEventUpdate} isSelected={selectedIds.has(event.id)} onToggleSelect={toggleSelect} partnerTags={partnerTags} />
              ))
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
