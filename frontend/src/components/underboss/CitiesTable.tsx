import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, MapPin, Check, X, Clock, ExternalLink, ArrowUpDown } from 'lucide-react';
import { IconInput } from '../IconInput';
import { fetchSheetCities, SheetCity } from '../../lib/cities';
import { fetchCityStatuses, updateCityStatus, CityStatusMap } from '../../lib/api';
import type { UnderbossMeResponse } from '../../lib/api';
import { GPP_REGIONS } from '../../types';
import type { UnderbossEvent } from '../../types';

type CityStatusValue = 'created' | 'skip' | 'todo';

interface MergedCity {
  key: string; // normalized lowercase city name
  city: string;
  country: string;
  underboss: string;
  region: string;
  chatUrl: string;
  status: CityStatusValue;
  isAuto: boolean; // true if status came from matching event (no DB override)
  matchedEventUrl: string | null; // link to the matching event if auto-detected
}

type SortField = 'city' | 'country' | 'underboss' | 'status';
type SortDir = 'asc' | 'desc';

const STATUS_ORDER: Record<CityStatusValue, number> = { created: 0, todo: 1, skip: 2 };

interface CitiesTableProps {
  events: UnderbossEvent[];
  selectedRegions: string[];
  meData: UnderbossMeResponse | null;
}

export function CitiesTable({ events, selectedRegions, meData }: CitiesTableProps) {
  const [sheetCities, setSheetCities] = useState<SheetCity[]>([]);
  const [cityStatuses, setCityStatuses] = useState<CityStatusMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CityStatusValue>('all');
  const [sortField, setSortField] = useState<SortField>('city');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Load sheet cities and DB statuses
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [cities, statuses] = await Promise.all([
          fetchSheetCities(),
          fetchCityStatuses(),
        ]);
        setSheetCities(cities);
        setCityStatuses(statuses);
      } catch (err: any) {
        setError(err.message || 'Failed to load cities');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Build a set of city names that have matching GPP events
  const eventCityMap = useMemo(() => {
    const map: Record<string, string> = {}; // normalized city -> customUrl
    for (const event of events) {
      // Match "Global Pizza Party {City}" pattern
      const match = event.name.match(/Global Pizza Party\s+(.+)/i);
      if (match) {
        const cityName = match[1].trim().toLowerCase();
        map[cityName] = event.customUrl || event.id;
      }
    }
    return map;
  }, [events]);

  // Merge sheet cities with statuses and event matching
  const mergedCities = useMemo<MergedCity[]>(() => {
    return sheetCities.map((sc) => {
      const key = sc.city.toLowerCase().trim();
      const dbStatus = cityStatuses[key];
      const matchedEvent = eventCityMap[key];

      let status: CityStatusValue;
      let isAuto = false;

      if (dbStatus) {
        // DB override takes priority
        status = dbStatus.status as CityStatusValue;
      } else if (matchedEvent) {
        // Auto-detected from event
        status = 'created';
        isAuto = true;
      } else {
        status = 'todo';
      }

      return {
        key,
        city: sc.city,
        country: sc.country,
        underboss: sc.underboss,
        region: sc.region,
        chatUrl: sc.chatUrl,
        status,
        isAuto,
        matchedEventUrl: matchedEvent ? `/e/${matchedEvent}` : null,
      };
    });
  }, [sheetCities, cityStatuses, eventCityMap]);

  // Apply filters + sorting
  const filteredCities = useMemo(() => {
    let result = mergedCities;

    // Underboss name filter (non-admins only see their own cities)
    if (meData && !meData.isAdmin && meData.name) {
      const myName = meData.name.toLowerCase();
      result = result.filter((c) => c.underboss.toLowerCase() === myName);
    }

    // Region filter (synced with selectedRegions)
    if (selectedRegions.length > 0) {
      const normalizedRegions = selectedRegions.map((r) => r.toLowerCase());
      result = result.filter((c) => {
        if (!c.region) return false;
        const regionLower = c.region.toLowerCase().replace(/\s+/g, '-');
        return normalizedRegions.includes(regionLower);
      });
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.city.toLowerCase().includes(q) ||
          c.country.toLowerCase().includes(q) ||
          c.underboss.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((c) => c.status === statusFilter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'city':
          cmp = a.city.localeCompare(b.city);
          break;
        case 'country':
          cmp = a.country.localeCompare(b.country);
          break;
        case 'underboss':
          cmp = a.underboss.localeCompare(b.underboss);
          break;
        case 'status':
          cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [mergedCities, meData, selectedRegions, search, statusFilter, sortField, sortDir]);

  // Optimistic status update
  const handleStatusChange = useCallback(
    async (cityKey: string, newStatus: CityStatusValue) => {
      // Optimistic: update local state immediately
      const previousStatuses = { ...cityStatuses };

      if (newStatus === 'todo') {
        // Remove from map (default)
        setCityStatuses((prev) => {
          const next = { ...prev };
          delete next[cityKey];
          return next;
        });
      } else {
        setCityStatuses((prev) => ({
          ...prev,
          [cityKey]: {
            status: newStatus,
            updatedBy: null,
            updatedAt: new Date().toISOString(),
          },
        }));
      }

      try {
        await updateCityStatus(cityKey, newStatus);
      } catch (err) {
        // Revert on error
        setCityStatuses(previousStatuses);
        console.error('Failed to update city status:', err);
      }
    },
    [cityStatuses]
  );

  // Counts for header
  const statusCounts = useMemo(() => {
    const counts = { created: 0, skip: 0, todo: 0, total: 0 };
    for (const c of mergedCities) {
      counts[c.status]++;
      counts.total++;
    }
    return counts;
  }, [mergedCities]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full" />
        <span className="ml-3 text-sm text-theme-text-muted">Loading cities...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary badges */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-1 rounded-full bg-green-500/15 text-green-700 font-medium">
          {statusCounts.created} Created
        </span>
        <span className="px-2 py-1 rounded-full bg-orange-500/15 text-orange-700 font-medium">
          {statusCounts.todo} To Do
        </span>
        <span className="px-2 py-1 rounded-full bg-gray-400/15 text-gray-600 font-medium">
          {statusCounts.skip} Skip
        </span>
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="max-w-sm flex-1">
          <IconInput
            icon={Search}
            iconSize={14}
            type="text"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            placeholder="Search cities, countries, underbosses..."
            className="bg-theme-surface border border-theme-stroke rounded-lg pr-3 py-2 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text-secondary focus:outline-none focus:border-theme-stroke-hover"
        >
          <option value="all">All Statuses</option>
          <option value="created">Created</option>
          <option value="todo">To Do</option>
          <option value="skip">Skip</option>
        </select>
      </div>

      {/* Table (desktop) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-theme-stroke">
              <SortHeader field="status">Status</SortHeader>
              <SortHeader field="city">City</SortHeader>
              <SortHeader field="country">Country</SortHeader>
              <SortHeader field="underboss">Underboss</SortHeader>
              <th className="py-2 px-3 text-left text-xs uppercase tracking-wider text-theme-text-faint">Region</th>
              <th className="py-2 px-3 text-left text-xs uppercase tracking-wider text-theme-text-faint">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCities.map((city) => (
              <CityRow
                key={city.key}
                city={city}
                onStatusChange={handleStatusChange}
              />
            ))}
            {filteredCities.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-theme-text-faint text-sm">
                  No cities match your filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Cards (mobile) */}
      <div className="md:hidden space-y-2">
        {filteredCities.map((city) => (
          <CityCard key={city.key} city={city} onStatusChange={handleStatusChange} />
        ))}
        {filteredCities.length === 0 && (
          <p className="py-8 text-center text-theme-text-faint text-sm">
            No cities match your filters
          </p>
        )}
      </div>

      <p className="text-xs text-theme-text-faint">
        Showing {filteredCities.length} of {mergedCities.length} cities
      </p>
    </div>
  );
}

// === Status Badge ===
function StatusBadge({ status, isAuto, matchedEventUrl }: { status: CityStatusValue; isAuto: boolean; matchedEventUrl: string | null }) {
  const config = {
    created: { bg: 'bg-green-500/15', text: 'text-green-700', label: 'Created' },
    skip: { bg: 'bg-gray-400/15', text: 'text-gray-600', label: 'Skip' },
    todo: { bg: 'bg-orange-500/15', text: 'text-orange-700', label: 'To Do' },
  }[status];

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {config.label}
      {isAuto && matchedEventUrl && (
        <a
          href={matchedEventUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-60 hover:opacity-100"
          title="Auto-detected from event"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={10} />
        </a>
      )}
      {isAuto && !matchedEventUrl && (
        <span className="opacity-50 text-[10px]">(auto)</span>
      )}
    </span>
  );
}

// === 3-Way Status Toggle ===
function StatusToggle({
  currentStatus,
  onStatusChange,
}: {
  currentStatus: CityStatusValue;
  onStatusChange: (status: CityStatusValue) => void;
}) {
  const statuses: { value: CityStatusValue; icon: React.ReactNode; label: string; activeClass: string }[] = [
    {
      value: 'created',
      icon: <Check size={12} />,
      label: 'Created',
      activeClass: 'bg-green-500 text-white',
    },
    {
      value: 'todo',
      icon: <Clock size={12} />,
      label: 'To Do',
      activeClass: 'bg-orange-500 text-white',
    },
    {
      value: 'skip',
      icon: <X size={12} />,
      label: 'Skip',
      activeClass: 'bg-gray-500 text-white',
    },
  ];

  return (
    <div className="inline-flex items-center rounded-lg border border-theme-stroke overflow-hidden">
      {statuses.map((s) => (
        <button
          key={s.value}
          onClick={() => onStatusChange(s.value)}
          title={s.label}
          className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
            currentStatus === s.value
              ? s.activeClass
              : 'bg-theme-surface text-theme-text-faint hover:text-theme-text-secondary'
          }`}
        >
          {s.icon}
          <span className="hidden lg:inline">{s.label}</span>
        </button>
      ))}
    </div>
  );
}

// === Desktop Row ===
function CityRow({
  city,
  onStatusChange,
}: {
  city: MergedCity;
  onStatusChange: (cityKey: string, status: CityStatusValue) => void;
}) {
  return (
    <tr className="border-b border-theme-stroke/50 hover:bg-theme-surface/50 transition-colors">
      <td className="py-2.5 px-3">
        <StatusBadge status={city.status} isAuto={city.isAuto} matchedEventUrl={city.matchedEventUrl} />
      </td>
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-1.5">
          <MapPin size={12} className="text-theme-text-faint flex-shrink-0" />
          <span className="text-theme-text font-medium">{city.city}</span>
          {city.chatUrl && (
            <a
              href={city.chatUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-theme-text-faint hover:text-blue-500 transition-colors"
              title="Telegram group"
            >
              <ExternalLink size={10} />
            </a>
          )}
        </div>
      </td>
      <td className="py-2.5 px-3 text-theme-text-secondary">{city.country}</td>
      <td className="py-2.5 px-3 text-theme-text-secondary">{city.underboss || '—'}</td>
      <td className="py-2.5 px-3 text-theme-text-faint text-xs">
        {GPP_REGIONS.find((r) => r.id === city.region.toLowerCase().replace(/\s+/g, '-'))?.label || city.region}
      </td>
      <td className="py-2.5 px-3">
        <StatusToggle
          currentStatus={city.status}
          onStatusChange={(status) => onStatusChange(city.key, status)}
        />
      </td>
    </tr>
  );
}

// === Mobile Card ===
function CityCard({
  city,
  onStatusChange,
}: {
  city: MergedCity;
  onStatusChange: (cityKey: string, status: CityStatusValue) => void;
}) {
  return (
    <div className="bg-theme-surface border border-theme-stroke rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin size={14} className="text-theme-text-faint" />
          <span className="text-theme-text font-medium text-sm">{city.city}</span>
          <StatusBadge status={city.status} isAuto={city.isAuto} matchedEventUrl={city.matchedEventUrl} />
        </div>
        {city.chatUrl && (
          <a
            href={city.chatUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-theme-text-faint hover:text-blue-500"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-theme-text-faint">
        <span>{city.country} &middot; {city.underboss || 'No underboss'}</span>
        <span>{GPP_REGIONS.find((r) => r.id === city.region.toLowerCase().replace(/\s+/g, '-'))?.label || city.region}</span>
      </div>
      <StatusToggle
        currentStatus={city.status}
        onStatusChange={(status) => onStatusChange(city.key, status)}
      />
    </div>
  );
}
