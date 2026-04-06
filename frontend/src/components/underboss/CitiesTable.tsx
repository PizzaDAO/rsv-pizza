import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, MapPin, Check, X, Clock, ExternalLink, ArrowUpDown, ChevronDown } from 'lucide-react';
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

// Map sheet region names to GPP region IDs they belong to
const SHEET_REGION_TO_GPP: Record<string, string[]> = {
  'north-america': ['usa', 'canada'],
  'africa': ['west-africa', 'east-africa', 'south-africa'],
};

interface CitiesTableProps {
  events: UnderbossEvent[];
  selectedRegions: string[];
  meData: UnderbossMeResponse | null;
  onTelegramBroadcast?: (cities: string[]) => void;
}

export function CitiesTable({ events, selectedRegions, meData, onTelegramBroadcast }: CitiesTableProps) {
  const [sheetCities, setSheetCities] = useState<SheetCity[]>([]);
  const [cityStatuses, setCityStatuses] = useState<CityStatusMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CityStatusValue>('all');
  const [sortField, setSortField] = useState<SortField>('city');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [showActionDropdown, setShowActionDropdown] = useState(false);

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
        matchedEventUrl: matchedEvent ? `/${matchedEvent}` : null,
      };
    });
  }, [sheetCities, cityStatuses, eventCityMap]);

  // Apply filters + sorting
  const filteredCities = useMemo(() => {
    let result = mergedCities;

    // Region-based filter (non-admins only see cities in their assigned regions)
    if (meData && !meData.isAdmin && meData.regions.length > 0) {
      const myRegions = meData.regions.map((r) => r.toLowerCase());
      result = result.filter((c) => {
        if (!c.region) return false;
        const sheetRegion = c.region.toLowerCase().replace(/\s+/g, '-');
        if (myRegions.includes(sheetRegion)) return true;
        const mappedGppIds = SHEET_REGION_TO_GPP[sheetRegion];
        if (mappedGppIds) return mappedGppIds.some((id) => myRegions.includes(id));
        return false;
      });
    }

    // Region filter (synced with selectedRegions)
    if (selectedRegions.length > 0) {
      const normalizedRegions = selectedRegions.map((r) => r.toLowerCase());
      result = result.filter((c) => {
        if (!c.region) return false;
        const sheetRegion = c.region.toLowerCase().replace(/\s+/g, '-');
        // Direct match (e.g. "western-europe" === "western-europe")
        if (normalizedRegions.includes(sheetRegion)) return true;
        // Sheet uses umbrella regions (e.g. "North America" covers usa + canada)
        const mappedGppIds = SHEET_REGION_TO_GPP[sheetRegion];
        if (mappedGppIds) {
          return mappedGppIds.some((id) => normalizedRegions.includes(id));
        }
        return false;
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

  const toggleSelect = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedKeys.size === filteredCities.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(filteredCities.map((c) => c.key)));
    }
  }, [selectedKeys.size, filteredCities]);

  const handleBulkStatus = useCallback(
    async (newStatus: CityStatusValue) => {
      const keys = Array.from(selectedKeys);
      // Optimistic updates
      for (const key of keys) {
        handleStatusChange(key, newStatus);
      }
      setSelectedKeys(new Set());
      setShowActionDropdown(false);
    },
    [selectedKeys, handleStatusChange]
  );

  const handleBulkTelegram = useCallback(() => {
    const cities = filteredCities
      .filter((c) => selectedKeys.has(c.key))
      .map((c) => c.city);
    onTelegramBroadcast?.(cities);
    setShowActionDropdown(false);
  }, [selectedKeys, filteredCities, onTelegramBroadcast]);

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
      {/* Summary badges (clickable to filter) */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          onClick={() => setStatusFilter(statusFilter === 'created' ? 'all' : 'created')}
          className={`px-2 py-1 rounded-full font-medium transition-all cursor-pointer ${
            statusFilter === 'created'
              ? 'bg-green-500/30 text-green-700 ring-1 ring-green-500/40'
              : 'bg-green-500/15 text-green-700 hover:bg-green-500/25'
          }`}
        >
          {statusCounts.created} Created
        </button>
        <button
          onClick={() => setStatusFilter(statusFilter === 'todo' ? 'all' : 'todo')}
          className={`px-2 py-1 rounded-full font-medium transition-all cursor-pointer ${
            statusFilter === 'todo'
              ? 'bg-orange-500/30 text-orange-700 ring-1 ring-orange-500/40'
              : 'bg-orange-500/15 text-orange-700 hover:bg-orange-500/25'
          }`}
        >
          {statusCounts.todo} To Do
        </button>
        <button
          onClick={() => setStatusFilter(statusFilter === 'skip' ? 'all' : 'skip')}
          className={`px-2 py-1 rounded-full font-medium transition-all cursor-pointer ${
            statusFilter === 'skip'
              ? 'bg-gray-400/30 text-gray-600 ring-1 ring-gray-400/40'
              : 'bg-gray-400/15 text-gray-600 hover:bg-gray-400/25'
          }`}
        >
          {statusCounts.skip} Skip
        </button>
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

      {/* Bulk action bar */}
      {selectedKeys.size > 0 && (
        <div className="flex items-center gap-3 py-2 px-3 bg-theme-surface border border-theme-stroke rounded-lg text-sm">
          <span className="text-theme-text-secondary font-medium">
            {selectedKeys.size} selected
          </span>
          <div className="relative">
            <button
              onClick={() => setShowActionDropdown(!showActionDropdown)}
              className="flex items-center gap-1 px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 transition-colors"
            >
              Actions <ChevronDown size={12} />
            </button>
            {showActionDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowActionDropdown(false)} />
                <div className="absolute top-full left-0 mt-1 z-50 bg-theme-card border border-theme-stroke rounded-xl shadow-2xl py-1 min-w-[180px]">
                  <button onClick={() => handleBulkStatus('created')} className="w-full text-left px-4 py-2 text-sm text-green-600 hover:bg-theme-surface transition-colors">
                    Set Created
                  </button>
                  <button onClick={() => handleBulkStatus('todo')} className="w-full text-left px-4 py-2 text-sm text-orange-600 hover:bg-theme-surface transition-colors">
                    Set To Do
                  </button>
                  <button onClick={() => handleBulkStatus('skip')} className="w-full text-left px-4 py-2 text-sm text-gray-500 hover:bg-theme-surface transition-colors">
                    Set Skip
                  </button>
                  {onTelegramBroadcast && (
                    <>
                      <div className="border-t border-theme-stroke my-1" />
                      <button onClick={handleBulkTelegram} className="w-full text-left px-4 py-2 text-sm text-blue-500 hover:bg-theme-surface transition-colors">
                        Send Telegram Message
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => { setSelectedKeys(new Set()); setShowActionDropdown(false); }}
            className="text-theme-text-faint hover:text-theme-text-secondary text-xs"
          >
            Clear
          </button>
        </div>
      )}

      {/* Table (desktop) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-theme-stroke">
              <th className="py-2 px-3 w-8">
                <input
                  type="checkbox"
                  checked={selectedKeys.size === filteredCities.length && filteredCities.length > 0}
                  ref={(el) => { if (el) el.indeterminate = selectedKeys.size > 0 && selectedKeys.size < filteredCities.length; }}
                  onChange={toggleSelectAll}
                  className="rounded border-theme-stroke-hover"
                />
              </th>
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
                isSelected={selectedKeys.has(city.key)}
                onToggleSelect={toggleSelect}
              />
            ))}
            {filteredCities.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-theme-text-faint text-sm">
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
          <CityCard key={city.key} city={city} onStatusChange={handleStatusChange} isSelected={selectedKeys.has(city.key)} onToggleSelect={toggleSelect} />
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

  const badge = (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {config.label}
      {matchedEventUrl && <ExternalLink size={10} className="opacity-60" />}
      {isAuto && !matchedEventUrl && (
        <span className="opacity-50 text-[10px]">(auto)</span>
      )}
    </span>
  );

  if (matchedEventUrl) {
    return (
      <a
        href={matchedEventUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:opacity-80 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {badge}
      </a>
    );
  }

  return badge;
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
  isSelected,
  onToggleSelect,
}: {
  city: MergedCity;
  onStatusChange: (cityKey: string, status: CityStatusValue) => void;
  isSelected: boolean;
  onToggleSelect: (key: string) => void;
}) {
  return (
    <tr className={`border-b border-theme-stroke/50 hover:bg-theme-surface/50 transition-colors ${isSelected ? 'bg-theme-surface/30' : ''}`}>
      <td className="py-2.5 px-3 w-8">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(city.key)}
          className="rounded border-theme-stroke-hover"
        />
      </td>
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
  isSelected,
  onToggleSelect,
}: {
  city: MergedCity;
  onStatusChange: (cityKey: string, status: CityStatusValue) => void;
  isSelected: boolean;
  onToggleSelect: (key: string) => void;
}) {
  return (
    <div className={`bg-theme-surface border border-theme-stroke rounded-xl p-3 space-y-2 ${isSelected ? 'ring-1 ring-red-500/30' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(city.key)}
            className="rounded border-theme-stroke-hover"
          />
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
