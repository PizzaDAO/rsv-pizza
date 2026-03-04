import React, { useState, useMemo } from 'react';
import { Search, ArrowUpDown } from 'lucide-react';
import { EventRow } from './EventRow';
import type { UnderbossEvent } from '../../types';

interface EventTableProps {
  events: UnderbossEvent[];
}

type SortField = 'name' | 'date' | 'guestCount' | 'progress';
type SortDir = 'asc' | 'desc';

function countProgress(event: UnderbossEvent): number {
  const p = event.progress;
  return [p.hasVenue, p.hasBudget, p.hasPartyKit, p.hasEventImage, p.hasDate, p.hasAddress]
    .filter(Boolean).length;
}

export function EventTable({ events }: EventTableProps) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

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
  }, [events, search, sortField, sortDir]);

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

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.02]">
              <SortHeader field="name">Event</SortHeader>
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
                <td colSpan={7} className="py-12 text-center text-white/30 text-sm">
                  {search ? 'No events match your search' : 'No events in this region yet'}
                </td>
              </tr>
            ) : (
              filteredEvents.map((event) => (
                <EventRow key={event.id} event={event} />
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
