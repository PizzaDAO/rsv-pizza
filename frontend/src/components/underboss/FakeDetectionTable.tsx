import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ArrowUpDown, ExternalLink, Loader2, Search, X } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { fetchFakeDetection, updateUnderbossStatus } from '../../lib/api';
import type { FakeDetectionResponse, FakeDetectionRow, FakeDetectionTier } from '../../types';

type ActionStatus = 'pending' | 'approved' | 'rejected';

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

const FLAG_LABELS: Record<string, string> = {
  cap_fill_no_waitlist: 'Cap fill, no waitlist',
  low_domain_entropy: 'Low email-domain entropy',
  sig_collapse: 'Field signature collapse',
  wallet_too_low: 'Too few wallets',
  wallet_too_high_reuse: 'Wallet reuse (high)',
  wallet_reuse: 'Wallet reuse',
  host_self_rsvp_mismatch: 'Host self-RSVP mismatch',
  pizzeria_fields_blank: 'Pizzeria fields blank',
  wallet_source_all_null: 'Wallet source all null',
  one_word_name: 'One-word event name',
  firstname_digits_email: 'Firstname+digits emails',
  day_gap_pattern: 'Day-gap pattern',
  low_hour_entropy: 'Low hour-of-day entropy',
  rapid_intersubmission: 'Rapid inter-submission',
  cross_event_wallet: 'Cross-event sybil wallet',
  high_per_visitor_rsvp_saturation: 'High per-visitor RSVP saturation',
  low_funnel_coverage: 'Low funnel coverage',
};

function flagLabel(name: string): string {
  return FLAG_LABELS[name] ?? name.replace(/_/g, ' ');
}

function FlagPill({ flag }: { flag: FakeDetectionRow['flags'][number] }) {
  if (!flag.fired) return null;
  return (
    <span
      title={`${flag.name} — ${flag.detail}`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-500/15 text-red-700 border border-red-500/30"
    >
      <span>{flagLabel(flag.name)}</span>
      <span className="text-red-700/60 tabular-nums">+{flag.weight}</span>
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
  const [hideRejected, setHideRejected] = useState(true);  // default ON — rejected events clutter the queue

  // Per-row action state (keyed by party id)
  const [actionPending, setActionPending] = useState<Record<string, boolean>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string | null>>({});
  const [statusOverride, setStatusOverride] = useState<Record<string, ActionStatus>>({});

  const effectiveStatus = (row: FakeDetectionRow): string =>
    statusOverride[row.id] ?? row.underbossStatus ?? 'pending';

  async function runAction(rowId: string, next: ActionStatus) {
    const prev = statusOverride[rowId];
    setActionPending((p) => ({ ...p, [rowId]: true }));
    setActionErrors((e) => ({ ...e, [rowId]: null }));
    setStatusOverride((s) => ({ ...s, [rowId]: next }));
    try {
      await updateUnderbossStatus(rowId, next);
    } catch (err: unknown) {
      setStatusOverride((s) => {
        const n = { ...s };
        if (prev) {
          n[rowId] = prev;
        } else {
          delete n[rowId];
        }
        return n;
      });
      const msg = err instanceof Error ? err.message : String(err);
      setActionErrors((er) => ({ ...er, [rowId]: msg }));
    } finally {
      setActionPending((p) => ({ ...p, [rowId]: false }));
    }
  }

  function StatusActions({ rowId, current }: { rowId: string; current: string }) {
    const inFlight = !!actionPending[rowId];
    const err = actionErrors[rowId];

    if (inFlight) {
      return (
        <div className="flex items-center">
          <Loader2 size={14} className="animate-spin text-theme-text-muted" />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          {current !== 'approved' && (
            <button
              onClick={() => runAction(rowId, 'approved')}
              className="px-2 py-1 text-xs rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
            >
              {t('fakeDetection.actions.approve', 'Approve')}
            </button>
          )}
          {current !== 'rejected' && (
            <button
              onClick={() => runAction(rowId, 'rejected')}
              className="px-2 py-1 text-xs rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              {t('fakeDetection.actions.reject', 'Reject')}
            </button>
          )}
          {current !== 'pending' && (
            <button
              onClick={() => runAction(rowId, 'pending')}
              className="px-2 py-1 text-xs rounded bg-theme-surface text-theme-text-muted hover:bg-theme-stroke transition-colors"
              title={t('fakeDetection.actions.resetTitle', 'Reset to pending')}
            >
              {t('fakeDetection.actions.reset', 'Reset')}
            </button>
          )}
        </div>
        {err && (
          <div className="flex items-center gap-1 text-[10px] text-red-400">
            <span className="truncate max-w-[180px]" title={err}>
              {t('fakeDetection.actions.errorPrefix', 'Failed')}: {err}
            </span>
            <button
              onClick={() => setActionErrors((e) => ({ ...e, [rowId]: null }))}
              title={t('fakeDetection.actions.dismiss', 'Dismiss')}
              className="text-red-400 hover:text-red-300"
            >
              <X size={10} />
            </button>
          </div>
        )}
      </div>
    );
  }

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

    if (hideRejected) {
      rows = rows.filter((r) => effectiveStatus(r) !== 'rejected');
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
  }, [data, search, sortField, sortDir, tierFilters, countryFilter, onlyFlagged, hideRejected, statusOverride]);

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
        <Checkbox
          checked={hideRejected}
          onChange={() => setHideRejected((v) => !v)}
          label={t('fakeDetection.hideRejected', 'Hide rejected')}
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
              <th className="py-2 px-3 text-left">{t('fakeDetection.columns.actions', 'Actions')}</th>
              <th className="py-2 px-3 text-left">{t('fakeDetection.columns.details', 'Details')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 px-3 text-center text-theme-text-muted">
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
                  {effectiveStatus(row)}
                </td>
                <td className="py-2 px-3 align-top">
                  <StatusActions rowId={row.id} current={effectiveStatus(row)} />
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
