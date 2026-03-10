import React, { useState, useMemo } from 'react';
import { Search, ArrowUpDown } from 'lucide-react';
import { EventRow } from './EventRow';
import { GPP_REGIONS } from '../../types';
import type { UnderbossEvent } from '../../types';

interface EventTableProps {
  events: UnderbossEvent[];
  showRegion?: boolean;
}

type SortField = 'name' | 'date' | 'guestCount' | 'progress';
type SortDir = 'asc' | 'desc';

function countProgress(event: UnderbossEvent): number {
  const p = event.progress;
  return [p.hasVenue, p.hasBudget, p.hasPartyKit, p.hasEventImage, p.hasDate, p.hasAddress]
    .filter(Boolean).length;
}

export function EventTable({ events, showRegion }: EventTableProps) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [kitFilter, setKitFilter] = useState<string>('all');
  const [progressFilters, setProgressFilters] = useState<string[]>([]);
  const [regionFilter, setRegionFilter] = useState<string>('all');

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

    // Kit status filter
    if (kitFilter !== 'all') {
      if (kitFilter === 'none') {
        result = result.filter((e) => !e.kitStatus);
      } else {
        result = result.filter((e) => e.kitStatus === kitFilter);
      }
    }

    // Progress filters (AND logic — event must have ALL selected progress items)
    if (progressFilters.length > 0) {
      result = result.filter((e) =>
        progressFilters.every((key) => e.progress[key as keyof typeof e.progress])
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
  }, [events, search, sortField, sortDir, kitFilter, progressFilters, regionFilter, showRegion]);

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
        className="py-2 px-3 text-left cursor-pointer hover:bg-white/5 transition-colors select-none"
        onClick={() => toggleSort(field)}
      >
        <div className="flex items-center gap-1">
          <span className={`text-xs uppercase tracking-wider ${isActive ? 'text-white/70' : 'text-white/30'}`}>
            {children}
          </span>
          <ArrowUpDown size={10} className={isActive ? 'text-white/50' : 'text-white/15'} />
        </div>
      </th>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events, hosts, venues..."
          className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Kit Status dropdown */}
        <select
          value={kitFilter}
          onChange={(e) => setKitFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/70 focus:outline-none focus:border-white/20"
        >
          <option value="all">Kit: All</option>
          <option value="pending">Kit: Pending</option>
          <option value="approved">Kit: Approved</option>
          <option value="shipped">Kit: Shipped</option>
          <option value="delivered">Kit: Delivered</option>
          <option value="declined">Kit: Declined</option>
          <option value="none">Kit: No Kit</option>
        </select>

        {/* Progress filter checkboxes */}
        {(['hasVenue', 'hasBudget', 'hasPartyKit', 'hasEventImage', 'hasDate'] as const).map((key) => {
          const labels: Record<string, string> = {
            hasVenue: 'Venue',
            hasBudget: 'Budget',
            hasPartyKit: 'Kit',
            hasEventImage: 'Image',
            hasDate: 'Date',
          };
          const isActive = progressFilters.includes(key);
          return (
            <button
              key={key}
              onClick={() => {
                setProgressFilters((prev) =>
                  prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]
                );
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-red-500/20 text-red-500 border border-red-500/30'
                  : 'bg-white/5 text-white/40 border border-white/10 hover:text-white/60'
              }`}
            >
              {labels[key]}
            </button>
          );
        })}

        {/* Region filter — only when showRegion */}
        {showRegion && (
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/70 focus:outline-none focus:border-white/20"
          >
            <option value="all">Region: All</option>
            {GPP_REGIONS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        )}

        {/* Clear filters link */}
        {(kitFilter !== 'all' || progressFilters.length > 0 || regionFilter !== 'all') && (
          <button
            onClick={() => {
              setKitFilter('all');
              setProgressFilters([]);
              setRegionFilter('all');
            }}
            className="text-xs text-red-500/70 hover:text-red-500 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.02]">
              <SortHeader field="name">Event</SortHeader>
              {showRegion && (
                <th className="py-2 px-3 text-left">
                  <span className="text-xs text-white/30 uppercase tracking-wider">Region</span>
                </th>
              )}
              <th className="py-2 px-3 text-left">
                <span className="text-xs text-white/30 uppercase tracking-wider">Host</span>
              </th>
              <th className="py-2 px-3 text-left">
                <span className="text-xs text-white/30 uppercase tracking-wider">Location</span>
              </th>
              <SortHeader field="guestCount">RSVPs</SortHeader>
              <th className="py-2 px-3 text-center">
                <span className="text-xs text-white/30 uppercase tracking-wider">Photos</span>
              </th>
              <th className="py-2 px-3 text-center">
                <span className="text-xs text-white/30 uppercase tracking-wider">Kit</span>
              </th>
              <SortHeader field="progress">Progress</SortHeader>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.length === 0 ? (
              <tr>
                <td colSpan={showRegion ? 8 : 7} className="py-12 text-center text-white/30 text-sm">
                  {search ? 'No events match your search' : 'No events in this region yet'}
                </td>
              </tr>
            ) : (
              filteredEvents.map((event) => (
                <EventRow key={event.id} event={event} showRegion={showRegion} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Count */}
      <div className="text-xs text-white/30 text-right">
        {filteredEvents.length} of {events.length} events
      </div>
    </div>
  );
}
