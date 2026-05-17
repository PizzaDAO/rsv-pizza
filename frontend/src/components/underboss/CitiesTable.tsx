import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Search, MapPin, Check, X, Clock, ExternalLink, ArrowUpDown, ChevronDown, Camera, ChevronLeft, ChevronRight, Send } from 'lucide-react';
import { IconInput } from '../IconInput';
import { fetchSheetCities, SheetCity } from '../../lib/cities';
import { fetchCityStatuses, updateCityStatus, CityStatusMap, getPartyPhotos } from '../../lib/api';
import { getGppPhotosForCity, getGppPhotoCounts } from '../../lib/gppPhotos';
import type { UnderbossMeResponse } from '../../lib/api';
import { GPP_REGIONS } from '../../types';
import type { UnderbossEvent } from '../../types';

interface DisplayPhoto {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
  source: 'uploaded' | 'gpp';
  year?: number;
}

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
  photoCount: number;
  matchedEventIds: string[];
  hostTelegram: string | null;
}

type SortField = 'city' | 'country' | 'underboss' | 'status';
type SortDir = 'asc' | 'desc';

const STATUS_ORDER: Record<CityStatusValue, number> = { created: 0, todo: 1, skip: 2 };

// Map sheet region names to GPP region IDs they belong to
const SHEET_REGION_TO_GPP: Record<string, string[]> = {
  'africa': ['west-africa', 'east-africa', 'south-africa'],
};

// For "North America" sheet region, determine GPP region from city's country field
function sheetCityToGppRegion(city: { region: string; country: string }): string[] {
  const sheetRegion = city.region.toLowerCase().replace(/\s+/g, '-');

  if (sheetRegion === 'north-america') {
    const c = city.country.toLowerCase().trim();
    if (c.startsWith('usa') || c === 'united states' || c === 'iowa') return ['usa'];
    if (c.startsWith('canada')) return ['canada'];
    if (c === 'mexico') return ['central-america'];
    if (c === 'bahamas') return ['central-america'];
    // Fallback: show in both usa and canada
    return ['usa', 'canada'];
  }

  // Check umbrella mappings
  const mapped = SHEET_REGION_TO_GPP[sheetRegion];
  if (mapped) return mapped;

  // Direct match (e.g., "western-europe" === "western-europe")
  return [sheetRegion];
}

interface CitiesTableProps {
  events: UnderbossEvent[];
  selectedRegions: string[];
  meData: UnderbossMeResponse | null;
  onTelegramBroadcast?: (cities: string[]) => void;
}

export function CitiesTable({ events, selectedRegions, meData, onTelegramBroadcast }: CitiesTableProps) {
  const { t } = useTranslation('partner');
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
  const [gppCounts, setGppCounts] = useState<Record<string, number>>({});

  // Load GPP photo counts (cached at module level)
  useEffect(() => {
    getGppPhotoCounts().then(setGppCounts);
  }, []);

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

  // Normalize: strip diacritics, lowercase, collapse whitespace
  const normalize = useCallback((s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' '), []);

  // Build list of GPP events with their extracted + normalized city names
  const gppEvents = useMemo(() => {
    const list: { event: UnderbossEvent; raw: string; norm: string }[] = [];
    for (const event of events) {
      const match = event.name.match(/Global Pizza Party\s+(.+)/i);
      if (match) {
        const raw = match[1].trim().toLowerCase();
        list.push({ event, raw, norm: normalize(raw) });
      }
    }
    return list;
  }, [events, normalize]);

  // Find matching events for a sheet city (exact then fuzzy)
  const findMatchingEvents = useCallback((sheetCity: string): UnderbossEvent[] => {
    const key = sheetCity.toLowerCase().trim();
    const norm = normalize(sheetCity);

    // 1. Exact match on raw lowercase
    const exact = gppEvents.filter(e => e.raw === key);
    if (exact.length > 0) return exact.map(e => e.event);

    // 2. Exact match on normalized (strips diacritics)
    const normExact = gppEvents.filter(e => e.norm === norm);
    if (normExact.length > 0) return normExact.map(e => e.event);

    // 3. Containment match (one contains the other, min 4 chars to avoid false positives)
    if (norm.length >= 4) {
      const contained = gppEvents.filter(e =>
        e.norm.length >= 4 && (e.norm.includes(norm) || norm.includes(e.norm))
      );
      if (contained.length > 0) return contained.map(e => e.event);
    }

    return [];
  }, [gppEvents, normalize]);

  // Merge sheet cities with statuses and event matching
  const mergedCities = useMemo<MergedCity[]>(() => {
    return sheetCities.map((sc) => {
      const key = sc.city.toLowerCase().trim();
      const dbStatus = cityStatuses[key];
      const matchedEvents = findMatchingEvents(sc.city);
      const matchedEvent = matchedEvents.length > 0 ? (matchedEvents[0].customUrl || matchedEvents[0].id) : null;

      let status: CityStatusValue;
      let isAuto = false;

      if (dbStatus) {
        // DB override takes priority
        status = dbStatus.status as CityStatusValue;
      } else if (matchedEvents.length > 0) {
        // Auto-detected from event
        status = 'created';
        isAuto = true;
      } else {
        status = 'todo';
      }

      const gppKey = sc.city.toLowerCase().replace(/\s+/g, '');

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
        photoCount: matchedEvents.reduce((sum, e) => sum + (e.photoCount || 0), 0) + (gppCounts[gppKey] || 0),
        matchedEventIds: matchedEvents.map(e => e.id),
        hostTelegram: matchedEvents[0]?.hostTelegram || null,
      };
    });
  }, [sheetCities, cityStatuses, findMatchingEvents, gppCounts]);

  // Apply filters + sorting
  const filteredCities = useMemo(() => {
    let result = mergedCities;

    // Region+city scope filter (mozzarella-25815): non-admin UBs see cities
    // that match either their assigned regions OR their explicit cities.
    // Cities-only UBs see ONLY their explicit cities (strict).
    if (meData && !meData.isAdmin) {
      const myRegions = meData.regions.map((r) => r.toLowerCase());
      const myCities = (meData.cities || []).map((c) => c.toLowerCase().trim());
      result = result.filter((c) => {
        if (myCities.includes(c.key)) return true;
        // Strict city-only path: no regions assigned → only explicit cities
        if (myCities.length > 0 && myRegions.length === 0) return false;
        if (myRegions.length === 0) return false;
        if (!c.region) return false;
        const cityGppRegions = sheetCityToGppRegion(c);
        return cityGppRegions.some((id) => myRegions.includes(id));
      });
    }

    // Region filter (synced with selectedRegions)
    if (selectedRegions.length > 0) {
      const normalizedRegions = selectedRegions.map((r) => r.toLowerCase());
      result = result.filter((c) => {
        if (!c.region) return false;
        const cityGppRegions = sheetCityToGppRegion(c);
        return cityGppRegions.some((id) => normalizedRegions.includes(id));
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
        <span className="ml-3 text-sm text-theme-text-muted">{t('cities.loading')}</span>
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
          {t('cities.statusCreatedCount', { count: statusCounts.created })}
        </button>
        <button
          onClick={() => setStatusFilter(statusFilter === 'todo' ? 'all' : 'todo')}
          className={`px-2 py-1 rounded-full font-medium transition-all cursor-pointer ${
            statusFilter === 'todo'
              ? 'bg-orange-500/30 text-orange-700 ring-1 ring-orange-500/40'
              : 'bg-orange-500/15 text-orange-700 hover:bg-orange-500/25'
          }`}
        >
          {t('cities.statusTodoCount', { count: statusCounts.todo })}
        </button>
        <button
          onClick={() => setStatusFilter(statusFilter === 'skip' ? 'all' : 'skip')}
          className={`px-2 py-1 rounded-full font-medium transition-all cursor-pointer ${
            statusFilter === 'skip'
              ? 'bg-gray-400/30 text-gray-600 ring-1 ring-gray-400/40'
              : 'bg-gray-400/15 text-gray-600 hover:bg-gray-400/25'
          }`}
        >
          {t('cities.statusSkipCount', { count: statusCounts.skip })}
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
            placeholder={t('cities.searchPlaceholder')}
            className="bg-theme-surface border border-theme-stroke rounded-lg pr-3 py-2 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text-secondary focus:outline-none focus:border-theme-stroke-hover"
        >
          <option value="all">{t('cities.statusAll')}</option>
          <option value="created">{t('cities.statusCreated')}</option>
          <option value="todo">{t('cities.statusTodo')}</option>
          <option value="skip">{t('cities.statusSkip')}</option>
        </select>
      </div>

      {/* Bulk action bar — always visible */}
      <div className="flex items-center gap-3 py-2 px-3 bg-theme-surface border border-theme-stroke rounded-lg text-sm">
        {selectedKeys.size > 0 ? (
          <>
            <span className="text-theme-text-secondary font-medium">
              {t('cities.selected', { count: selectedKeys.size })}
            </span>
            <div className="relative">
              <button
                onClick={() => setShowActionDropdown(!showActionDropdown)}
                className="flex items-center gap-1 px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 transition-colors"
              >
                {t('cities.actions')} <ChevronDown size={12} />
              </button>
              {showActionDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowActionDropdown(false)} />
                  <div className="absolute top-full left-0 mt-1 z-50 bg-theme-card border border-theme-stroke rounded-xl shadow-2xl py-1 min-w-[180px]">
                    <button onClick={() => handleBulkStatus('created')} className="w-full text-left px-4 py-2 text-sm text-green-600 hover:bg-theme-surface transition-colors">
                      {t('cities.setCreated')}
                    </button>
                    <button onClick={() => handleBulkStatus('todo')} className="w-full text-left px-4 py-2 text-sm text-orange-600 hover:bg-theme-surface transition-colors">
                      {t('cities.setTodo')}
                    </button>
                    <button onClick={() => handleBulkStatus('skip')} className="w-full text-left px-4 py-2 text-sm text-gray-500 hover:bg-theme-surface transition-colors">
                      {t('cities.setSkip')}
                    </button>
                    {onTelegramBroadcast && (
                      <>
                        <div className="border-t border-theme-stroke my-1" />
                        <button onClick={handleBulkTelegram} className="w-full text-left px-4 py-2 text-sm text-blue-500 hover:bg-theme-surface transition-colors">
                          {t('cities.sendTelegramMessage')}
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
              {t('cities.clear')}
            </button>
          </>
        ) : (
          <span className="text-theme-text-faint text-sm">{t('cities.noCitiesSelected')}</span>
        )}
      </div>

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
              <SortHeader field="status">{t('cities.tableHeaders.status')}</SortHeader>
              <SortHeader field="city">{t('cities.tableHeaders.city')}</SortHeader>
              <SortHeader field="country">{t('cities.tableHeaders.country')}</SortHeader>
              <SortHeader field="underboss">{t('cities.tableHeaders.underboss')}</SortHeader>
              <th className="py-2 px-3 text-left text-xs uppercase tracking-wider text-theme-text-faint">{t('cities.tableHeaders.region')}</th>
              <th className="py-2 px-3 text-center text-xs uppercase tracking-wider text-theme-text-faint">
                <div className="flex items-center justify-center gap-1">
                  <Camera size={10} />
                  {t('cities.tableHeaders.photos')}
                </div>
              </th>
              <th className="py-2 px-3 text-left text-xs uppercase tracking-wider text-theme-text-faint">{t('cities.tableHeaders.actions')}</th>
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
                <td colSpan={8} className="py-8 text-center text-theme-text-faint text-sm">
                  {t('cities.noCitiesMatch')}
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
            {t('cities.noCitiesMatch')}
          </p>
        )}
      </div>

      <p className="text-xs text-theme-text-faint">
        {t('cities.showingOf', { shown: filteredCities.length, total: mergedCities.length })}
      </p>
    </div>
  );
}

// === Status Badge ===
function StatusBadge({ status, isAuto, matchedEventUrl }: { status: CityStatusValue; isAuto: boolean; matchedEventUrl: string | null }) {
  const { t } = useTranslation('partner');
  const config = {
    created: { bg: 'bg-green-500/15', text: 'text-green-700', label: t('cities.statusLabels.created') },
    skip: { bg: 'bg-gray-400/15', text: 'text-gray-600', label: t('cities.statusLabels.skip') },
    todo: { bg: 'bg-orange-500/15', text: 'text-orange-700', label: t('cities.statusLabels.todo') },
  }[status];

  const badge = (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {config.label}
      {matchedEventUrl && <ExternalLink size={10} className="opacity-60" />}
      {isAuto && !matchedEventUrl && (
        <span className="opacity-50 text-[10px]">{t('cities.auto')}</span>
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
  const { t } = useTranslation('partner');
  const statuses: { value: CityStatusValue; icon: React.ReactNode; label: string; activeClass: string }[] = [
    {
      value: 'created',
      icon: <Check size={12} />,
      label: t('cities.statusLabels.created'),
      activeClass: 'bg-green-500 text-white',
    },
    {
      value: 'todo',
      icon: <Clock size={12} />,
      label: t('cities.statusLabels.todo'),
      activeClass: 'bg-orange-500 text-white',
    },
    {
      value: 'skip',
      icon: <X size={12} />,
      label: t('cities.statusLabels.skip'),
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

// === Photo Lightbox ===
function CityPhotoLightbox({
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
  const { t } = useTranslation('partner');
  const [expanded, setExpanded] = useState(false);
  const [displayPhotos, setDisplayPhotos] = useState<DisplayPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const loadPhotos = useCallback(async () => {
    if (displayPhotos.length > 0) return;
    setPhotosLoading(true);
    try {
      // Fetch uploaded photos from matched events + GPP manifest photos in parallel
      const [uploadedResults, gppPhotos] = await Promise.all([
        city.matchedEventIds.length > 0
          ? Promise.all(city.matchedEventIds.map(id => getPartyPhotos(id)))
          : Promise.resolve([]),
        city.city ? getGppPhotosForCity(city.city) : Promise.resolve([]),
      ]);

      const uploaded: DisplayPhoto[] = (uploadedResults as any[]).flatMap(r => r?.photos || []).map((p: any) => ({
        id: p.id,
        url: p.url,
        thumbnailUrl: p.thumbnailUrl,
        caption: p.caption,
        source: 'uploaded' as const,
      }));

      const gpp: DisplayPhoto[] = gppPhotos.map((p, i) => ({
        id: `gpp-${i}`,
        url: p.url,
        thumbnailUrl: null,
        caption: `GPP ${p.year}`,
        source: 'gpp' as const,
        year: p.year,
      }));

      setDisplayPhotos([...uploaded, ...gpp]);
    } catch (err) {
      console.error('Failed to load photos:', err);
    } finally {
      setPhotosLoading(false);
    }
  }, [city.matchedEventIds, city.city, displayPhotos.length]);

  const toggleExpand = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadPhotos();
  }, [expanded, loadPhotos]);

  const displayedPhotos = showAll ? displayPhotos : displayPhotos.slice(0, 12);

  return (
    <>
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
                title={t('cities.telegramGroup')}
              >
                <ExternalLink size={10} />
              </a>
            )}
            {city.hostTelegram && (
              <a
                href={`https://t.me/${city.hostTelegram.replace(/^@/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 transition-colors"
                title="DM host on Telegram"
              >
                <Send size={10} />
              </a>
            )}
          </div>
        </td>
        <td className="py-2.5 px-3 text-theme-text-secondary">{city.country}</td>
        <td className="py-2.5 px-3 text-theme-text-secondary">{city.underboss || '—'}</td>
        <td className="py-2.5 px-3 text-theme-text-faint text-xs">
          {GPP_REGIONS.find((r) => r.id === city.region.toLowerCase().replace(/\s+/g, '-'))?.label || city.region}
        </td>
        <td className="py-2.5 px-3 text-center">
          <button
            onClick={toggleExpand}
            className="inline-flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text-secondary cursor-pointer transition-colors"
          >
            <Camera size={12} />
            <span>{city.photoCount}</span>
          </button>
        </td>
        <td className="py-2.5 px-3">
          <StatusToggle
            currentStatus={city.status}
            onStatusChange={(status) => onStatusChange(city.key, status)}
          />
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="py-3 px-6 bg-theme-surface/30">
            {photosLoading ? (
              <div className="flex items-center gap-2 py-4">
                <div className="animate-spin w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full" />
                <span className="text-xs text-theme-text-muted">{t('cities.loadingPhotos')}</span>
              </div>
            ) : displayPhotos.length === 0 ? (
              <p className="text-xs text-theme-text-faint py-2">{t('cities.noPhotos')}</p>
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
                {!showAll && displayPhotos.length > 12 && (
                  <button
                    onClick={() => setShowAll(true)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    {t('cities.showAllPhotos', { count: displayPhotos.length })}
                  </button>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
      {lightboxIndex !== null && displayedPhotos[lightboxIndex] && createPortal(
        <CityPhotoLightbox
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
  const { t } = useTranslation('partner');
  const [expanded, setExpanded] = useState(false);
  const [displayPhotos, setDisplayPhotos] = useState<DisplayPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const loadPhotos = useCallback(async () => {
    if (displayPhotos.length > 0) return;
    setPhotosLoading(true);
    try {
      const [uploadedResults, gppPhotos] = await Promise.all([
        city.matchedEventIds.length > 0
          ? Promise.all(city.matchedEventIds.map(id => getPartyPhotos(id)))
          : Promise.resolve([]),
        city.city ? getGppPhotosForCity(city.city) : Promise.resolve([]),
      ]);

      const uploaded: DisplayPhoto[] = (uploadedResults as any[]).flatMap(r => r?.photos || []).map((p: any) => ({
        id: p.id,
        url: p.url,
        thumbnailUrl: p.thumbnailUrl,
        caption: p.caption,
        source: 'uploaded' as const,
      }));

      const gpp: DisplayPhoto[] = gppPhotos.map((p, i) => ({
        id: `gpp-${i}`,
        url: p.url,
        thumbnailUrl: null,
        caption: `GPP ${p.year}`,
        source: 'gpp' as const,
        year: p.year,
      }));

      setDisplayPhotos([...uploaded, ...gpp]);
    } catch (err) {
      console.error('Failed to load photos:', err);
    } finally {
      setPhotosLoading(false);
    }
  }, [city.matchedEventIds, city.city, displayPhotos.length]);

  const toggleExpand = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadPhotos();
  }, [expanded, loadPhotos]);

  const displayedPhotos = showAll ? displayPhotos : displayPhotos.slice(0, 12);

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
        <div className="flex items-center gap-2">
          <span>{city.country} &middot; {city.underboss || t('cities.noUnderboss')}</span>
          <button
            onClick={toggleExpand}
            className="inline-flex items-center gap-1 text-theme-text-muted hover:text-theme-text-secondary cursor-pointer transition-colors"
          >
            <Camera size={10} />
            <span>{city.photoCount}</span>
          </button>
        </div>
        <span>{GPP_REGIONS.find((r) => r.id === city.region.toLowerCase().replace(/\s+/g, '-'))?.label || city.region}</span>
      </div>
      <StatusToggle
        currentStatus={city.status}
        onStatusChange={(status) => onStatusChange(city.key, status)}
      />
      {expanded && (
        <div className="pt-2 border-t border-theme-stroke/50">
          {photosLoading ? (
            <div className="flex items-center gap-2 py-3">
              <div className="animate-spin w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full" />
              <span className="text-xs text-theme-text-muted">{t('cities.loadingPhotos')}</span>
            </div>
          ) : displayPhotos.length === 0 ? (
            <p className="text-xs text-theme-text-faint py-2">{t('cities.noPhotos')}</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-1.5">
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
              {!showAll && displayPhotos.length > 12 && (
                <button
                  onClick={() => setShowAll(true)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  {t('cities.showAllPhotos', { count: displayPhotos.length })}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {lightboxIndex !== null && displayedPhotos[lightboxIndex] && createPortal(
        <CityPhotoLightbox
          photos={displayedPhotos}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />,
        document.body
      )}
    </div>
  );
}
