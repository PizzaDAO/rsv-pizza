import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ArrowUpDown, ExternalLink, Loader2, Search } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { fetchFakeDetection } from '../../lib/api';
import type { FakeDetectionResponse, FakeDetectionRow, FakeDetectionTier } from '../../types';

type SortField = 'score' | 'name' | 'rsvps' | 'country';
type SortDir = 'asc' | 'desc';

const TIER_TINT: Record<FakeDetectionTier, string> = {
  high: 'bg-red-500/10 hover:bg-red-500/20',
  medium: 'bg-amber-500/10 hover:bg-amber-500/20',
  low: 'bg-yellow-500/5 hover:bg-yellow-500/10',
  clean: 'hover:bg-theme-surface',
};

const TIER_SCORE_COLOR: Record<FakeDetectionTier, string> = {
  high: 'text-red-500',
  medium: 'text-amber-500',
  low: 'text-yellow-500',
  clean: 'text-theme-text-muted',
};

const TIER_LABEL: Record<FakeDetectionTier, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  clean: 'Clean',
};

function FlagPill({ flag }: { flag: FakeDetectionRow['flags'][number] }) {
  if (!flag.fired) return null;
  return (
    <span
      title={`${flag.name} (+${flag.weight}) — ${flag.detail}`}
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-500/20 text-red-300 border border-red-500/30"
    >
      {flag.name}
    </span>
  );
}

export function FakeDetectionTable() {
  const { t } = useTranslation('admin');
  const [data, setData] = useState<FakeDetectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [tierFilters, setTierFilters] = useState<Record<FakeDetectionTier, boolean>>({
    high: true,
    medium: true,
    low: true,
    clean: false,
  });
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFakeDetection()
      .then((resp) => {
        if (cancelled) return;
        setData(resp);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const countries = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.rows.map((r) => r.country).filter((c): c is string => !!c))).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.rows;

    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.customUrl?.toLowerCase().includes(q) ||
          r.country?.toLowerCase().includes(q) ||
          r.region?.toLowerCase().includes(q) ||
          r.hostName?.toLowerCase().includes(q) ||
          r.hostEmail?.toLowerCase().includes(q),
      );
    }

    rows = rows.filter((r) => tierFilters[r.tier]);

    if (countryFilter !== 'all') {
      rows = rows.filter((r) => r.country === countryFilter);
    }

    if (onlyFlagged) {
      rows = rows.filter((r) => r.flags.some((f) => f.fired));
    }

    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'score':
          cmp = a.score - b.score;
          break;
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'rsvps':
          cmp = a.rsvpCount - b.rsvpCount;
          break;
        case 'country':
          cmp = (a.country ?? '').localeCompare(b.country ?? '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return rows;
  }, [data, search, sortField, sortDir, tierFilters, countryFilter, onlyFlagged]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'score' ? 'desc' : 'asc');
    }
  }

  function SortHeader({ field, children }: { field: SortField; children: React.ReactNode }) {
    return (
      <th
        className="py-2 px-3 text-left cursor-pointer hover:bg-theme-surface transition-colors select-none"
        onClick={() => toggleSort(field)}
      >
        <div className="flex items-center gap-1">
          {children}
          <ArrowUpDown
            size={12}
            className={sortField === field ? 'text-theme-text' : 'text-theme-text-faint'}
          />
        </div>
      </th>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-theme-text-muted">
        <Loader2 size={20} className="animate-spin mr-2" />
        {t('fakeDetection.loading', 'Computing risk scores…')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-16 text-red-500">
        <AlertCircle size={20} className="mr-2" />
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Search + counts */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="max-w-sm flex-1 min-w-[240px]">
          <IconInput
            icon={Search}
            iconSize={14}
            type="text"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            placeholder={t('fakeDetection.searchPlaceholder', 'Search event, city, host…')}
            className="bg-theme-surface border border-theme-stroke rounded-lg pr-3 py-2 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
          />
        </div>
        <div className="text-xs text-theme-text-faint whitespace-nowrap">
          {t('fakeDetection.showingOf', {
            filtered: filtered.length,
            total: data.rows.length,
            defaultValue: '{{filtered}} of {{total}} events',
          })}
          {' · '}
          {t('fakeDetection.sybilWallets', {
            count: data.meta.sybilWalletCount,
            defaultValue: '{{count}} sybil wallets',
          })}
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-theme-text-faint uppercase tracking-wide">
          {t('fakeDetection.tier', 'Tier')}:
        </span>
        {(['high', 'medium', 'low', 'clean'] as FakeDetectionTier[]).map((tier) => (
          <Checkbox
            key={tier}
            checked={tierFilters[tier]}
            onChange={() => setTierFilters((prev) => ({ ...prev, [tier]: !prev[tier] }))}
            label={`${TIER_LABEL[tier]} (${data.rows.filter((r) => r.tier === tier).length})`}
            size={14}
            labelClassName={`text-xs ${TIER_SCORE_COLOR[tier]}`}
          />
        ))}
        <span className="text-xs text-theme-text-faint uppercase tracking-wide ml-2">
          {t('fakeDetection.country', 'Country')}:
        </span>
        <select
          value={countryFilter}
          onChange={(e) => setCountryFilter(e.target.value)}
          className="bg-theme-surface border border-theme-stroke rounded-lg px-2 py-1 text-xs text-theme-text focus:outline-none focus:border-theme-stroke-hover"
        >
          <option value="all">{t('fakeDetection.allCountries', 'All')}</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <Checkbox
          checked={onlyFlagged}
          onChange={() => setOnlyFlagged((v) => !v)}
          label={t('fakeDetection.onlyFlagged', 'Only flagged')}
          size={14}
          labelClassName="text-xs text-theme-text"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-theme-stroke rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-theme-surface text-theme-text-muted text-xs uppercase tracking-wide">
            <tr>
              <SortHeader field="name">{t('fakeDetection.columns.event', 'Event')}</SortHeader>
              <th className="py-2 px-3 text-left">{t('fakeDetection.columns.slug', 'Slug')}</th>
              <SortHeader field="rsvps">{t('fakeDetection.columns.rsvps', 'RSVPs')}</SortHeader>
              <SortHeader field="score">{t('fakeDetection.columns.score', 'Score')}</SortHeader>
              <th className="py-2 px-3 text-left">{t('fakeDetection.columns.flags', 'Fired flags')}</th>
              <th className="py-2 px-3 text-left">{t('fakeDetection.columns.status', 'Status')}</th>
              <th className="py-2 px-3 text-left">{t('fakeDetection.columns.details', 'Details')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 px-3 text-center text-theme-text-muted">
                  {t('fakeDetection.noResults', 'No events match the current filters.')}
                </td>
              </tr>
            )}
            {filtered.map((row) => (
              <tr
                key={row.id}
                className={`border-t border-theme-stroke transition-colors ${TIER_TINT[row.tier]}`}
              >
                <td className="py-2 px-3 align-top">
                  <div className="font-medium text-theme-text">{row.name}</div>
                  <div className="text-xs text-theme-text-faint">
                    {[row.region, row.country].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className="py-2 px-3 align-top">
                  {row.customUrl ? (
                    <a
                      href={`https://rsv.pizza/${row.customUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-theme-text-muted hover:text-theme-text underline-offset-2 hover:underline"
                    >
                      {row.customUrl}
                    </a>
                  ) : (
                    <span className="text-theme-text-faint text-xs">—</span>
                  )}
                </td>
                <td className="py-2 px-3 align-top text-theme-text-muted">
                  {row.rsvpCount}
                  {row.maxGuests ? <span className="text-theme-text-faint">/{row.maxGuests}</span> : null}
                </td>
                <td className="py-2 px-3 align-top">
                  <span className={`text-2xl font-semibold ${TIER_SCORE_COLOR[row.tier]}`}>
                    {row.score}
                  </span>
                </td>
                <td className="py-2 px-3 align-top max-w-md">
                  <div className="flex flex-wrap gap-1">
                    {row.flags.filter((f) => f.fired).map((f) => (
                      <FlagPill key={f.id} flag={f} />
                    ))}
                  </div>
                </td>
                <td className="py-2 px-3 align-top text-xs text-theme-text-muted">
                  {row.underbossStatus ?? 'pending'}
                </td>
                <td className="py-2 px-3 align-top">
                  {row.customUrl ? (
                    <a
                      href={`https://rsv.pizza/${row.customUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text"
                      title={t('fakeDetection.openEvent', 'Open event page')}
                    >
                      <ExternalLink size={14} />
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
