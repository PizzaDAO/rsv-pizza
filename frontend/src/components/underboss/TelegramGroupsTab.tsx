import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Send, AlertTriangle, XCircle, ExternalLink, RefreshCw } from 'lucide-react';
import {
  fetchTelegramGroupsStatus,
  assignTelegramGroup,
  testCityTelegramGroup,
  refreshCityTelegramGroup,
  type TelegramGroupCityStatus,
  type TelegramPendingCapture,
  type TelegramGroupTestResult,
  type TelegramGroupRefreshResult,
} from '../../lib/api';

/**
 * tonda-58293 Phase 2: Telegram Groups gap report.
 *
 * Shows every GPP city LEFT JOINed against `city_telegram_groups` (status:
 * has-id / supergroup / missing), with a region filter, missing-first sort,
 * and a per-city Test button. Below, a Pending Captures section lets an
 * underboss assign an orphan capture (a group the bot was added to but whose
 * city we couldn't auto-match) to one of the gap cities.
 */
export function TelegramGroupsTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cities, setCities] = useState<TelegramGroupCityStatus[]>([]);
  const [pending, setPending] = useState<TelegramPendingCapture[]>([]);
  const [regionFilter, setRegionFilter] = useState('');

  // Per-city test state (cityKey -> result/loading)
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, TelegramGroupTestResult>>({});

  // Per-city refresh state (cityKey -> result/loading)
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [refreshResults, setRefreshResults] = useState<Record<string, TelegramGroupRefreshResult>>({});

  // Per-capture assign state (chatId -> selected cityKey / loading)
  const [assignSel, setAssignSel] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState<Record<string, boolean>>({});
  const [assignError, setAssignError] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTelegramGroupsStatus();
      setCities(data.cities);
      setPending(data.pendingCaptures);
    } catch (err: any) {
      setError(err?.message || 'Failed to load Telegram groups');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const c of cities) if (c.region) set.add(c.region);
    return Array.from(set).sort();
  }, [cities]);

  // Region filter + missing-first sort (missing → supergroup → has-id, then by city).
  const sortedCities = useMemo(() => {
    const filtered = regionFilter
      ? cities.filter((c) => (c.region || '') === regionFilter)
      : cities;
    const rank = (c: TelegramGroupCityStatus) => {
      if (!c.hasChatId) return 0; // missing first
      if (c.isSupergroup) return 1;
      return 2;
    };
    return [...filtered].sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return a.cityKey.localeCompare(b.cityKey);
    });
  }, [cities, regionFilter]);

  // Gap cities (missing an id) for the assign dropdown.
  const gapCities = useMemo(
    () => cities.filter((c) => !c.hasChatId).map((c) => c.cityKey).sort(),
    [cities],
  );

  async function handleTest(cityKey: string) {
    setTesting((t) => ({ ...t, [cityKey]: true }));
    setTestResults((r) => {
      const next = { ...r };
      delete next[cityKey];
      return next;
    });
    try {
      const result = await testCityTelegramGroup(cityKey);
      setTestResults((r) => ({ ...r, [cityKey]: result }));
    } catch (err: any) {
      setTestResults((r) => ({
        ...r,
        [cityKey]: { cityKey, ok: false, reason: err?.message || 'Request failed' },
      }));
    } finally {
      setTesting((t) => ({ ...t, [cityKey]: false }));
    }
  }

  async function handleRefresh(cityKey: string) {
    setRefreshing((t) => ({ ...t, [cityKey]: true }));
    setRefreshResults((r) => {
      const next = { ...r };
      delete next[cityKey];
      return next;
    });
    try {
      const result = await refreshCityTelegramGroup(cityKey);
      setRefreshResults((r) => ({ ...r, [cityKey]: result }));
      // On success, reload so title / supergroup / last-verified reflect the
      // re-fetched values (and any migration-persisted new id).
      if (result.ok) await load();
    } catch (err: any) {
      setRefreshResults((r) => ({
        ...r,
        [cityKey]: { cityKey, ok: false, reason: err?.message || 'Refresh failed' },
      }));
    } finally {
      setRefreshing((t) => ({ ...t, [cityKey]: false }));
    }
  }

  async function handleAssign(chatId: string) {
    const cityKey = (assignSel[chatId] || '').trim();
    if (!cityKey) {
      setAssignError((e) => ({ ...e, [chatId]: 'Pick a city first' }));
      return;
    }
    setAssigning((a) => ({ ...a, [chatId]: true }));
    setAssignError((e) => {
      const next = { ...e };
      delete next[chatId];
      return next;
    });
    try {
      await assignTelegramGroup(chatId, cityKey);
      // Reload so the city flips to has-id and the capture drops off pending.
      await load();
    } catch (err: any) {
      setAssignError((e) => ({ ...e, [chatId]: err?.message || 'Assign failed' }));
    } finally {
      setAssigning((a) => ({ ...a, [chatId]: false }));
    }
  }

  function statusBadge(c: TelegramGroupCityStatus) {
    if (!c.hasChatId) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 text-xs font-medium">
          <XCircle size={12} /> Missing
        </span>
      );
    }
    if (c.isSupergroup) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 text-xs font-medium">
          <AlertTriangle size={12} /> Supergroup
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-medium">
        <CheckCircle2 size={12} /> Connected
      </span>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-theme-text-muted">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading Telegram groups…
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center">
        <p className="text-red-400 mb-3">{error}</p>
        <button
          onClick={load}
          className="px-4 py-2 rounded-lg bg-theme-card border border-theme-stroke text-sm text-theme-text hover:bg-theme-surface"
        >
          Retry
        </button>
      </div>
    );
  }

  const missingCount = cities.filter((c) => !c.hasChatId).length;

  return (
    <div className="space-y-8">
      {/* Gap report */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h3 className="text-lg font-semibold text-theme-text">
            City groups ({cities.length - missingCount} of {cities.length} connected)
          </h3>
          {regions.length > 0 && (
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-theme-card border border-theme-stroke text-sm text-theme-text"
            >
              <option value="">All regions</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="text-xs text-theme-text-muted mb-4">
          To add a missing city: add @MoltoBeneBot to its Telegram group, or post /register in the group — the ID is captured automatically.
        </p>

        <div className="overflow-x-auto border border-theme-stroke rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-theme-text-muted border-b border-theme-stroke">
                <th className="px-3 py-2 font-medium">City</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Last verified</th>
                <th className="px-3 py-2 font-medium">Chat</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedCities.map((c) => {
                const result = testResults[c.cityKey];
                const refreshResult = refreshResults[c.cityKey];
                return (
                  <tr key={c.cityKey} className="border-b border-theme-stroke/60 last:border-0">
                    <td className="px-3 py-2 text-theme-text capitalize">{c.cityKey}</td>
                    <td className="px-3 py-2">{statusBadge(c)}</td>
                    <td className="px-3 py-2 text-theme-text-muted">{c.source || '—'}</td>
                    <td className="px-3 py-2 text-theme-text-muted">
                      {c.lastVerifiedAt ? new Date(c.lastVerifiedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {c.chatUrl ? (
                        <a
                          href={c.chatUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-theme-accent hover:underline"
                        >
                          Open <ExternalLink size={12} />
                        </a>
                      ) : (
                        <span className="text-theme-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {c.hasChatId ? (
                        <div className="inline-flex items-center gap-2 justify-end">
                          {result && (
                            <span
                              className={`text-xs ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}
                            >
                              {result.ok
                                ? result.migratedTo
                                  ? 'Sent (migrated)'
                                  : 'Sent ✓'
                                : result.reason || 'Failed'}
                            </span>
                          )}
                          {refreshResult && (
                            <span
                              className={`text-xs ${refreshResult.ok ? 'text-emerald-400' : 'text-red-400'}`}
                            >
                              {refreshResult.ok
                                ? refreshResult.migrated
                                  ? 'Refreshed (migrated)'
                                  : 'Refreshed ✓'
                                : refreshResult.reason || 'Failed'}
                            </span>
                          )}
                          <button
                            onClick={() => handleRefresh(c.cityKey)}
                            disabled={refreshing[c.cityKey]}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-theme-card border border-theme-stroke text-xs text-theme-text hover:bg-theme-surface disabled:opacity-50"
                          >
                            {refreshing[c.cityKey] ? (
                              <Loader2 className="animate-spin" size={12} />
                            ) : (
                              <RefreshCw size={12} />
                            )}
                            Refresh
                          </button>
                          <button
                            onClick={() => handleTest(c.cityKey)}
                            disabled={testing[c.cityKey]}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-theme-card border border-theme-stroke text-xs text-theme-text hover:bg-theme-surface disabled:opacity-50"
                          >
                            {testing[c.cityKey] ? (
                              <Loader2 className="animate-spin" size={12} />
                            ) : (
                              <Send size={12} />
                            )}
                            Test
                          </button>
                        </div>
                      ) : (
                        <span className="text-theme-text-muted text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {sortedCities.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-theme-text-muted">
                    No cities in scope.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending captures */}
      <div>
        <h3 className="text-lg font-semibold text-theme-text mb-2">
          Pending captures ({pending.length})
        </h3>
        <p className="text-xs text-theme-text-muted mb-4">
          Groups the bot was added to but couldn't auto-match to a city. Assign each to a gap city to connect it.
        </p>

        {pending.length === 0 ? (
          <p className="text-sm text-theme-text-muted">No unassigned captures.</p>
        ) : (
          <div className="overflow-x-auto border border-theme-stroke rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-theme-text-muted border-b border-theme-stroke">
                  <th className="px-3 py-2 font-medium">Group title</th>
                  <th className="px-3 py-2 font-medium">Chat ID</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Assign to city</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.chatId} className="border-b border-theme-stroke/60 last:border-0">
                    <td className="px-3 py-2 text-theme-text">{p.title || '(untitled)'}</td>
                    <td className="px-3 py-2 text-theme-text-muted font-mono text-xs">{p.chatId}</td>
                    <td className="px-3 py-2 text-theme-text-muted">{p.chatType || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={assignSel[p.chatId] || ''}
                          onChange={(e) =>
                            setAssignSel((s) => ({ ...s, [p.chatId]: e.target.value }))
                          }
                          className="px-3 py-2 rounded-lg bg-theme-card border border-theme-stroke text-sm text-theme-text"
                        >
                          <option value="">Select a city…</option>
                          {gapCities.map((ck) => (
                            <option key={ck} value={ck}>
                              {ck}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleAssign(p.chatId)}
                          disabled={assigning[p.chatId]}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-theme-accent/15 border border-theme-accent/30 text-sm text-theme-accent hover:bg-theme-accent/25 disabled:opacity-50"
                        >
                          {assigning[p.chatId] && <Loader2 className="animate-spin" size={12} />}
                          Assign
                        </button>
                        {assignError[p.chatId] && (
                          <span className="text-xs text-red-400">{assignError[p.chatId]}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
