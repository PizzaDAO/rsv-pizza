import React, { useState, useMemo } from 'react';
import { Search, ArrowUpDown, ThumbsUp, ThumbsDown } from 'lucide-react';
import { IconInput } from '../IconInput';
import { EventRow } from './EventRow';
import { EventCard } from './EventCard';
import { GPP_REGIONS } from '../../types';
import type { UnderbossEvent, UnderbossEventProgress } from '../../types';

interface EventTableProps {
  events: UnderbossEvent[];
  showRegion?: boolean;
  onEventUpdate?: (eventId: string, updates: Partial<UnderbossEvent>) => void;
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

export function EventTable({ events, showRegion, onEventUpdate }: EventTableProps) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [regionFilter, setRegionFilter] = useState<string>('all');

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
          e.venueName?.toLowerCase().includes(q)
      );
    }

    // Progress includes (AND logic — event must have ALL included progress items)
    if (progressIncludes.length > 0) {
      result = result.filter((e) =>
        progressIncludes.every((key) => e.progress[key as keyof typeof e.progress])
      );
    }

    // Progress excludes (AND logic — event must NOT have ANY excluded progress items)
    if (progressExcludes.length > 0) {
      result = result.filter((e) =>
        progressExcludes.every((key) => !e.progress[key as keyof typeof e.progress])
      );
    }

    // Region filter (only when showRegion is active)
    if (showRegion && regionFilter !== 'all') {
      result = result.filter((e) => e.region === regionFilter);
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
  }, [events, search, sortField, sortDir, progressIncludes, progressExcludes, regionFilter, showRegion]);

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

  const hasActiveFilters = progressIncludes.length > 0 || progressExcludes.length > 0 || regionFilter !== 'all';

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="max-w-sm">
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

        {/* Region filter -- only when showRegion */}
        {showRegion && (
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-1.5 text-sm text-theme-text-secondary focus:outline-none focus:border-theme-stroke-hover"
          >
            <option value="all">Region: All</option>
            {GPP_REGIONS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
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
            }}
            className="text-xs text-red-500/70 hover:text-red-500 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Mobile: card list */}
      <div className="md:hidden space-y-3">
        {filteredEvents.length === 0 ? (
          <div className="py-12 text-center text-theme-text-faint text-sm">
            {search ? 'No events match your search' : 'No events in this region yet'}
          </div>
        ) : (
          filteredEvents.map((event) => (
            <EventCard key={event.id} event={event} showRegion={showRegion} onEventUpdate={onEventUpdate} />
          ))
        )}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-theme-stroke">
        <table className="w-full">
          <thead>
            <tr className="border-b border-theme-stroke bg-theme-surface">
              <th className="py-2 px-3 text-center w-8">
                <span className="text-xs text-theme-text-faint uppercase tracking-wider" title="Approved">OK</span>
              </th>
              <SortHeader field="name">Event</SortHeader>
              {showRegion && (
                <th className="py-2 px-3 text-left">
                  <span className="text-xs text-theme-text-faint uppercase tracking-wider">Region</span>
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
              <th className="py-2 px-3 text-center">
                <span className="text-xs text-theme-text-faint uppercase tracking-wider">Kit</span>
              </th>
              <SortHeader field="progress">Progress</SortHeader>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.length === 0 ? (
              <tr>
                <td colSpan={showRegion ? 9 : 8} className="py-12 text-center text-theme-text-faint text-sm">
                  {search ? 'No events match your search' : 'No events in this region yet'}
                </td>
              </tr>
            ) : (
              filteredEvents.map((event) => (
                <EventRow key={event.id} event={event} showRegion={showRegion} onEventUpdate={onEventUpdate} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Count */}
      <div className="text-xs text-theme-text-faint text-right">
        {filteredEvents.length} of {events.length} events
      </div>
    </div>
  );
}
