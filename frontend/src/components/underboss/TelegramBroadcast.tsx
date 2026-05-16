import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation, Trans } from 'react-i18next';
import { X, Search, Check, AlertCircle, Loader2, Send, ChevronDown, MessageSquare } from 'lucide-react';
import { IconInput } from '../IconInput';
import { fetchTelegramGroups, TelegramGroup } from '../../lib/telegram';
import {
  sendTelegramBroadcast,
  sendTelegramTest,
  sendHostTelegramBroadcast,
  sendHostTelegramTest,
  BroadcastResult,
} from '../../lib/api';
import type { UnderbossEvent } from '../../types';

/** Extract a city name from a GPP event's name ("Global Pizza Party <city>"). */
function extractCityFromEvent(ev: UnderbossEvent): string {
  const match = ev.name.match(/Global Pizza Party\s+(.+)/i);
  return match ? match[1].trim() : ev.name;
}

type RecipientMode = 'groups' | 'hosts' | 'both';

interface HostRow {
  partyId: string;
  city: string;
  hostName: string;
  hostTelegram: string | null;
  connected: boolean;
}

interface SendStats {
  sent: number;
  failed: number;
  blockedHosts: number;
}

// Tag results with their bucket so the "Both" mode can render two sections.
type TaggedResult = BroadcastResult & { kind: 'group' | 'host' };

/** Normalize a city name for fuzzy matching (strip accents, suffixes, etc.) */
function normalizeCity(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents/diacritics
    .replace(/[İ]/g, 'I')           // Turkish İ
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, '')   // remove parentheticals like "(Queensland)"
    .replace(/^[-–—]\s*/, '')        // strip leading dashes "- La Paz, Bolivia"
    .replace(/\s*[-–—]\s+.*$/, '')   // strip trailing " - Pizza Touk" but NOT hyphens within words
    .replace(/\s*,\s+.*$/, '')       // strip ", Bolivia"
    .replace(/\s+\d{4}$/, '')        // strip trailing year "2026"
    .replace(/\s+city$/i, '')        // strip trailing "City"
    .replace(/\s+at\s+.*$/i, '')     // strip "at Papa Toms"
    .replace(/\s+in\s+.*$/i, '')     // strip "in Hangzhou"
    .trim();
}

// Aliases for cities known by different names in different languages/romanizations
const CITY_ALIASES: Record<string, string[]> = {
  'bangalore': ['bengaluru'],
  'johannesberg': ['johannesburg'],
  'koh phangan': ['ko phangan'],
  'mysore': ['mysuru'],
  'vienna': ['wien'],
  'warsaw': ['warszawa'],
  'rome': ['roma'],
  'naples': ['napoli'],
  'portland me': ['portland maine'],
  'san pedro de sula': ['san pedro sula'],
  'tirana': ['tirane'],
  'goteborg': ['gothenburg'],
  'new york city': ['new york', 'nyc', 'newyork'],
  'sao paulo': ['sao paulo/ brazil'],
  'denver': ['ethdenver'],
  'tokyo': ['ethtokyo'],
  'prague': ['pizzadayprague'],
  // CJK / Cyrillic city names
  'ningbo': ['ning bo shi', '\u5b81\u6ce2\u5e02'],
  'hangzhou': ['hang zhou shi', '\u676d\u5dde\u5e02'],
  'gotemba': ['yu dian chang shi', '\u5fa1\u6bbf\u5834\u5e02'],
  // Additional language variants
  'luxembourg': ['lussemburgo'],
  'goa': ['madgaon'],
  'durham': ['raleigh'],
};

// Build reverse alias lookup: alternate name -> canonical names
const ALIAS_LOOKUP: Record<string, string[]> = {};
for (const [canonical, alts] of Object.entries(CITY_ALIASES)) {
  for (const alt of alts) {
    if (!ALIAS_LOOKUP[alt]) ALIAS_LOOKUP[alt] = [];
    ALIAS_LOOKUP[alt].push(canonical);
  }
  // Also map canonical to itself for bidirectional lookup
  if (!ALIAS_LOOKUP[canonical]) ALIAS_LOOKUP[canonical] = [];
  for (const alt of alts) {
    ALIAS_LOOKUP[canonical].push(alt);
  }
}

/** Check whether two city names refer to the same city after normalization */
function citiesMatch(eventCity: string, sheetCity: string): boolean {
  const a = normalizeCity(eventCity);
  const b = normalizeCity(sheetCity);
  if (!a || !b) return false;
  // Exact match after normalization
  if (a === b) return true;
  // Substring containment (handles "New Delhi" matching "Delhi", etc.)
  if (a.length >= 3 && b.length >= 3) {
    if (a.includes(b) || b.includes(a)) return true;
  }
  // Check aliases
  const aAliases = ALIAS_LOOKUP[a] || [];
  const bAliases = ALIAS_LOOKUP[b] || [];
  for (const alias of aAliases) {
    if (alias === b) return true;
    if (alias.length >= 3 && b.length >= 3 && (alias.includes(b) || b.includes(alias))) return true;
  }
  for (const alias of bAliases) {
    if (alias === a) return true;
    if (alias.length >= 3 && a.length >= 3 && (alias.includes(a) || a.includes(alias))) return true;
  }
  return false;
}

interface TelegramBroadcastProps {
  onClose: () => void;
  preSelectedCities?: string[];
  events?: UnderbossEvent[];
}

type ViewState = 'compose' | 'sending' | 'results';

export function TelegramBroadcast({ onClose, preSelectedCities, events }: TelegramBroadcastProps) {
  const { t } = useTranslation('partner');
  // Data loading
  const [groups, setGroups] = useState<TelegramGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Recipient mode (groups, hosts, or both)
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('groups');

  // Selection & filtering
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedHostPartyIds, setSelectedHostPartyIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);

  // Message
  const [message, setMessage] = useState('');
  const [parseMode, setParseMode] = useState<'HTML' | 'Markdown' | 'None'>('None');

  // State flow
  const [viewState, setViewState] = useState<ViewState>('compose');
  const [results, setResults] = useState<TaggedResult[]>([]);
  const [sendStats, setSendStats] = useState<SendStats>({ sent: 0, failed: 0, blockedHosts: 0 });

  // Test message (groups + hosts share these states; the active chat/party is keyed by id)
  const [testingChatId, setTestingChatId] = useState<string | null>(null);
  const [testingHostPartyId, setTestingHostPartyId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ chatId: string; success: boolean; error?: string } | null>(null);

  // Load groups on mount
  useEffect(() => {
    async function load() {
      try {
        const data = await fetchTelegramGroups();
        setGroups(data);
        // Auto-select groups matching pre-selected cities (fuzzy match)
        if (preSelectedCities && preSelectedCities.length > 0) {
          const matchingIds = new Set<string>();
          for (const g of data) {
            if (preSelectedCities.some(pc => citiesMatch(pc, g.city))) {
              matchingIds.add(g.groupId);
            }
          }
          if (matchingIds.size > 0) setSelectedIds(matchingIds);
        }
      } catch (err: any) {
        setLoadError(err.message || 'Failed to load Telegram groups');
      } finally {
        setLoadingGroups(false);
      }
    }
    load();
  }, []);

  // Get unique regions for filter
  const regions = useMemo(() => {
    const regionSet = new Set(groups.map(g => g.region).filter(Boolean));
    return Array.from(regionSet).sort();
  }, [groups]);

  // Build a lookup of group.city -> host telegram handle by fuzzy-matching event city names.
  const hostTelegramByGroupId = useMemo(() => {
    const map: Record<string, string> = {};
    if (!events || events.length === 0) return map;
    const eventCities: { city: string; handle: string }[] = [];
    for (const ev of events) {
      if (!ev.hostTelegram) continue;
      eventCities.push({ city: extractCityFromEvent(ev), handle: ev.hostTelegram });
    }
    for (const g of groups) {
      const found = eventCities.find(ec => citiesMatch(ec.city, g.city));
      if (found) map[g.groupId] = found.handle;
    }
    return map;
  }, [events, groups]);

  // Filtered groups
  const filteredGroups = useMemo(() => {
    let filtered = groups;

    // When opened from actions dropdown, only show groups matching the selected cities (fuzzy match)
    if (preSelectedCities && preSelectedCities.length > 0) {
      filtered = filtered.filter(g => preSelectedCities.some(pc => citiesMatch(pc, g.city)));
    }

    if (regionFilter !== 'all') {
      filtered = filtered.filter(g => g.region === regionFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      filtered = filtered.filter(
        g =>
          g.city.toLowerCase().includes(q) ||
          g.country.toLowerCase().includes(q) ||
          g.underboss.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [groups, regionFilter, search, preSelectedCities]);

  // Selection helpers
  const toggleGroup = (groupId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const selectAll = () => {
    const ids = new Set(selectedIds);
    filteredGroups.forEach(g => ids.add(g.groupId));
    setSelectedIds(ids);
  };

  const deselectAll = () => {
    const ids = new Set(selectedIds);
    filteredGroups.forEach(g => ids.delete(g.groupId));
    setSelectedIds(ids);
  };

  const allFilteredSelected = filteredGroups.length > 0 && filteredGroups.every(g => selectedIds.has(g.groupId));

  // ===== Host rows (sausage-24183) =====

  // Build the list of selectable hosts from the events prop. Only events whose
  // host has either a Telegram handle or a connected bot chat_id are included
  // (others have no way for an underboss to reach them via this tool).
  const hostRows = useMemo<HostRow[]>(() => {
    if (!events || events.length === 0) return [];
    let rows: HostRow[] = events
      .filter(e => e.host && (e.hostTelegram || e.hostTelegramConnected))
      .map(e => ({
        partyId: e.id,
        city: extractCityFromEvent(e),
        hostName: e.host?.name || (t('telegram.unknownHost') as string),
        hostTelegram: e.hostTelegram || null,
        connected: !!e.hostTelegramConnected,
      }));

    // Mirror the groups list: filter by pre-selected cities when present.
    if (preSelectedCities && preSelectedCities.length > 0) {
      rows = rows.filter(r => preSelectedCities.some(pc => citiesMatch(pc, r.city)));
    }

    // Search filter (city or host name). Host events don't carry a region, so
    // skip the region filter in this mode (per plan).
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      rows = rows.filter(
        r => r.city.toLowerCase().includes(q) || r.hostName.toLowerCase().includes(q)
      );
    }

    return rows;
  }, [events, preSelectedCities, search, t]);

  // Auto-select hosts whose event city matches one of the pre-selected cities,
  // but only those that are actually connected (disabled checkboxes can't be
  // selected by the user, so we shouldn't auto-select them either).
  useEffect(() => {
    if (!preSelectedCities || preSelectedCities.length === 0) return;
    if (hostRows.length === 0) return;
    const matchingIds = new Set<string>();
    for (const r of hostRows) {
      if (r.connected && preSelectedCities.some(pc => citiesMatch(pc, r.city))) {
        matchingIds.add(r.partyId);
      }
    }
    if (matchingIds.size > 0) {
      setSelectedHostPartyIds(prev => {
        const next = new Set(prev);
        matchingIds.forEach(id => next.add(id));
        return next;
      });
    }
    // We intentionally only run when hostRows or preSelectedCities change.
  }, [hostRows, preSelectedCities]);

  const connectedHostRows = useMemo(() => hostRows.filter(r => r.connected), [hostRows]);
  const allFilteredHostsSelected =
    connectedHostRows.length > 0 &&
    connectedHostRows.every(r => selectedHostPartyIds.has(r.partyId));

  const toggleHost = (partyId: string, connected: boolean) => {
    if (!connected) return;
    setSelectedHostPartyIds(prev => {
      const next = new Set(prev);
      if (next.has(partyId)) {
        next.delete(partyId);
      } else {
        next.add(partyId);
      }
      return next;
    });
  };

  const selectAllHosts = () => {
    setSelectedHostPartyIds(prev => {
      const next = new Set(prev);
      connectedHostRows.forEach(r => next.add(r.partyId));
      return next;
    });
  };

  const deselectAllHosts = () => {
    setSelectedHostPartyIds(prev => {
      const next = new Set(prev);
      connectedHostRows.forEach(r => next.delete(r.partyId));
      return next;
    });
  };

  // Build selected groups array for API (dedup by groupId to prevent spam)
  const selectedGroups = useMemo(() => {
    const seen = new Set<string>();
    return groups
      .filter(g => selectedIds.has(g.groupId))
      .filter(g => {
        if (seen.has(g.groupId)) return false;
        seen.add(g.groupId);
        return true;
      })
      .map(g => ({
        chatId: g.groupId,
        city: g.city,
        country: g.country,
      }));
  }, [groups, selectedIds]);

  // Detect duplicate groupIds in loaded data
  const duplicateGroupWarnings = useMemo(() => {
    const groupIdToCities = new Map<string, string[]>();
    for (const g of groups) {
      if (!g.groupId || g.groupId === 'tbd' || g.groupId === 'x') continue;
      const cities = groupIdToCities.get(g.groupId) || [];
      cities.push(g.city);
      groupIdToCities.set(g.groupId, cities);
    }
    const dupes: { groupId: string; cities: string[] }[] = [];
    for (const [groupId, cities] of groupIdToCities) {
      if (cities.length > 1) dupes.push({ groupId, cities });
    }
    return dupes;
  }, [groups]);

  // Build host-broadcast payload from selected, connected host rows.
  const selectedHostsPayload = useMemo(() => {
    return hostRows
      .filter(r => selectedHostPartyIds.has(r.partyId) && r.connected)
      .map(r => ({ partyId: r.partyId, city: r.city, hostName: r.hostName }));
  }, [hostRows, selectedHostPartyIds]);

  // The "send" CTA is enabled only when the active mode has at least one
  // recipient AND there is a message to send.
  const sendDisabled =
    !message.trim() ||
    (recipientMode === 'groups' && selectedIds.size === 0) ||
    (recipientMode === 'hosts' && selectedHostPartyIds.size === 0) ||
    (recipientMode === 'both' && selectedIds.size === 0 && selectedHostPartyIds.size === 0);

  // Send broadcast — dispatches to one or both backends depending on mode.
  const handleSend = async () => {
    if (sendDisabled) return;

    const groupCount = selectedGroups.length;
    const hostCount = selectedHostsPayload.length;

    let confirmMsg: string;
    if (recipientMode === 'groups') {
      confirmMsg = t('telegram.confirmSend', { count: groupCount }) as string;
    } else if (recipientMode === 'hosts') {
      confirmMsg = t('telegram.confirmSendHosts', { count: hostCount }) as string;
    } else {
      // Both — show both counts.
      confirmMsg = `${t('telegram.confirmSend', { count: groupCount })} ${t('telegram.confirmSendHosts', { count: hostCount })}`;
    }

    const confirmed = window.confirm(confirmMsg);
    if (!confirmed) return;

    setViewState('sending');

    const allResults: TaggedResult[] = [];
    let totalSent = 0;
    let totalFailed = 0;
    let blockedHostCount = 0;

    if (recipientMode === 'groups' || recipientMode === 'both') {
      if (selectedGroups.length > 0) {
        try {
          const r = await sendTelegramBroadcast(selectedGroups, message, parseMode);
          allResults.push(...r.results.map(res => ({ ...res, kind: 'group' as const })));
          totalSent += r.sent;
          totalFailed += r.failed;
        } catch (err: any) {
          totalFailed += selectedGroups.length;
        }
      }
    }

    if (recipientMode === 'hosts' || recipientMode === 'both') {
      if (selectedHostsPayload.length > 0) {
        try {
          const r = await sendHostTelegramBroadcast(selectedHostsPayload, message, parseMode);
          allResults.push(...r.results.map(res => ({ ...res, kind: 'host' as const })));
          totalSent += r.sent;
          totalFailed += r.failed;
          blockedHostCount = r.results.filter(
            x => x.error === 'Host blocked the bot — disconnected'
          ).length;
        } catch (err: any) {
          totalFailed += selectedHostsPayload.length;
        }
      }
    }

    setResults(allResults);
    setSendStats({ sent: totalSent, failed: totalFailed, blockedHosts: blockedHostCount });
    setViewState('results');
  };

  // Send test to a single group
  const handleTest = async (group: TelegramGroup) => {
    setTestingChatId(group.groupId);
    setTestResult(null);

    // Replace template vars for preview
    let testMsg = message;
    testMsg = testMsg.replace(/\{city\}/g, group.city);
    testMsg = testMsg.replace(/\{country\}/g, group.country);

    try {
      const result = await sendTelegramTest(group.groupId, testMsg, parseMode);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ chatId: group.groupId, success: false, error: err.message });
    } finally {
      setTestingChatId(null);
    }
  };

  // Send a per-row test DM to a single host (sausage-24183).
  const handleHostTest = async (row: HostRow) => {
    setTestingHostPartyId(row.partyId);
    setTestResult(null);

    let testMsg = message;
    testMsg = testMsg.replace(/\{city\}/g, row.city);
    testMsg = testMsg.replace(/\{hostName\}/g, row.hostName);

    try {
      const result = await sendHostTelegramTest(row.partyId, testMsg, parseMode);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ chatId: row.partyId, success: false, error: err.message });
    } finally {
      setTestingHostPartyId(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="border border-theme-stroke rounded-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col"
        style={{ background: 'var(--bg-main)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-theme-stroke flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/20 flex items-center justify-center">
              <Send size={16} className="text-red-500" />
            </div>
            <h3 className="text-lg font-semibold text-theme-text">{t('telegram.broadcastMessage')}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-theme-text-faint hover:text-theme-text-secondary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6">
          {/* Loading state */}
          {loadingGroups && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 size={28} className="animate-spin text-theme-text-muted mb-3" />
              <p className="text-sm text-theme-text-muted">{t('telegram.loading')}</p>
            </div>
          )}

          {/* Load error */}
          {loadError && (
            <div className="flex flex-col items-center justify-center py-16">
              <AlertCircle size={28} className="text-red-400 mb-3" />
              <p className="text-sm text-red-400">{loadError}</p>
            </div>
          )}

          {/* Compose view */}
          {!loadingGroups && !loadError && viewState === 'compose' && (
            <div className="space-y-6">
              {/* Recipients toggle (sausage-24183) */}
              <div className="flex items-center gap-1 bg-theme-surface border border-theme-stroke rounded-xl p-1 w-fit">
                {(['groups', 'hosts', 'both'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setRecipientMode(mode)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      recipientMode === mode
                        ? 'bg-[#E52828] text-white'
                        : 'text-theme-text-faint hover:text-theme-text'
                    }`}
                  >
                    {t(`telegram.recipients.${mode}`)}
                  </button>
                ))}
              </div>

              {/* Duplicate groupId warning — only relevant for group mode */}
              {(recipientMode === 'groups' || recipientMode === 'both') && duplicateGroupWarnings.length > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={16} className="text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-yellow-600">{t('telegram.duplicatesDetected')}</p>
                      <p className="text-xs text-yellow-600/80 mt-1">
                        {t('telegram.duplicatesDesc')}
                      </p>
                      <ul className="text-xs text-yellow-600/80 mt-1 space-y-0.5">
                        {duplicateGroupWarnings.map(d => (
                          <li key={d.groupId}>
                            {d.cities.join(', ')}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Group Selector Section */}
              {(recipientMode === 'groups' || recipientMode === 'both') && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-theme-text">
                    {t('telegram.selectGroups')}
                    <span className="ml-2 text-theme-text-faint font-normal">
                      {t('telegram.selectedOf', { selected: selectedIds.size, total: filteredGroups.length })}
                    </span>
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={selectAll}
                      className="text-xs text-red-500/70 hover:text-red-500 transition-colors"
                    >
                      {t('telegram.selectAll')}
                    </button>
                    <span className="text-theme-text-faint text-xs">/</span>
                    <button
                      onClick={deselectAll}
                      className="text-xs text-red-500/70 hover:text-red-500 transition-colors"
                    >
                      {t('telegram.deselectAll')}
                    </button>
                  </div>
                </div>

                {/* Search and region filter */}
                <div className="flex gap-2 mb-3">
                  <div className="flex-1">
                    <IconInput
                      icon={Search}
                      iconSize={14}
                      type="text"
                      placeholder={t('telegram.searchPlaceholder')}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="relative">
                    <button
                      onClick={() => setRegionDropdownOpen(!regionDropdownOpen)}
                      className="flex items-center gap-1.5 bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text hover:border-theme-stroke-hover transition-colors"
                    >
                      {regionFilter === 'all' ? t('telegram.regionAll') : regionFilter}
                      <ChevronDown size={14} className={`transition-transform ${regionDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {regionDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setRegionDropdownOpen(false)} />
                        <div className="absolute top-full right-0 mt-1 z-50 bg-theme-card border border-theme-stroke rounded-xl shadow-2xl py-1 min-w-[160px]">
                          <button
                            onClick={() => { setRegionFilter('all'); setRegionDropdownOpen(false); }}
                            className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                              regionFilter === 'all'
                                ? 'text-red-500 font-medium'
                                : 'text-theme-text-secondary hover:bg-theme-surface'
                            }`}
                          >
                            {t('telegram.regionAll')}
                          </button>
                          {regions.map(r => (
                            <button
                              key={r}
                              onClick={() => { setRegionFilter(r); setRegionDropdownOpen(false); }}
                              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                                regionFilter === r
                                  ? 'text-red-500 font-medium'
                                  : 'text-theme-text-secondary hover:bg-theme-surface'
                              }`}
                            >
                              {r}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Group list */}
                <div className="border border-theme-stroke rounded-xl overflow-hidden">
                  <div className="max-h-[280px] overflow-y-auto">
                    {filteredGroups.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-theme-text-faint">
                        {t('telegram.noGroupsMatch')}
                      </div>
                    ) : (
                      <>
                        {/* Header row */}
                        <div className="flex items-center gap-3 px-4 py-2 bg-theme-surface border-b border-theme-stroke text-xs text-theme-text-faint font-medium sticky top-0">
                          <div className="w-5 flex-shrink-0">
                            <button
                              onClick={allFilteredSelected ? deselectAll : selectAll}
                              className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                                allFilteredSelected
                                  ? 'bg-red-500 border-red-500'
                                  : 'border-theme-stroke-hover hover:border-theme-text-faint'
                              }`}
                            >
                              {allFilteredSelected && <Check size={10} className="text-white" />}
                            </button>
                          </div>
                          <div className="flex-1 grid grid-cols-4 gap-2">
                            <span>{t('telegram.tableHeaders.city')}</span>
                            <span>{t('telegram.tableHeaders.country')}</span>
                            <span>{t('telegram.tableHeaders.underboss')}</span>
                            <span>{t('telegram.tableHeaders.hostTg')}</span>
                          </div>
                          <div className="w-14 text-right">{t('telegram.tableHeaders.test')}</div>
                        </div>
                        {filteredGroups.map(group => (
                          <div
                            key={group.groupId}
                            className={`flex items-center gap-3 px-4 py-2.5 border-b border-theme-stroke last:border-b-0 cursor-pointer transition-colors ${
                              selectedIds.has(group.groupId)
                                ? 'bg-red-500/5'
                                : 'hover:bg-theme-surface'
                            }`}
                            onClick={() => toggleGroup(group.groupId)}
                          >
                            <div className="w-5 flex-shrink-0">
                              <div
                                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                                  selectedIds.has(group.groupId)
                                    ? 'bg-red-500 border-red-500'
                                    : 'border-theme-stroke-hover'
                                }`}
                              >
                                {selectedIds.has(group.groupId) && <Check size={10} className="text-white" />}
                              </div>
                            </div>
                            <div className="flex-1 grid grid-cols-4 gap-2 text-sm">
                              <span className="text-theme-text truncate">{group.city}</span>
                              <span className="text-theme-text-secondary truncate">{group.country}</span>
                              <span className="text-theme-text-faint truncate">{group.underboss}</span>
                              <span className="text-theme-text-faint truncate">
                                {hostTelegramByGroupId[group.groupId] ? (
                                  <a
                                    href={`https://t.me/${hostTelegramByGroupId[group.groupId].replace(/^@/, '')}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-purple-400 hover:text-purple-300 transition-colors"
                                    title="DM host on Telegram"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    @{hostTelegramByGroupId[group.groupId].replace(/^@/, '')}
                                  </a>
                                ) : (
                                  '—'
                                )}
                              </span>
                            </div>
                            <div className="w-14 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (message.trim()) handleTest(group);
                                }}
                                disabled={!message.trim() || testingChatId === group.groupId}
                                className="text-xs text-theme-text-faint hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                title={message.trim() ? t('telegram.testTitle') : t('telegram.writeMessageFirst')}
                              >
                                {testingChatId === group.groupId ? (
                                  <Loader2 size={12} className="animate-spin inline" />
                                ) : (
                                  t('telegram.test')
                                )}
                              </button>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>

                {/* Test result toast */}
                {testResult && (
                  <div className={`mt-2 px-3 py-2 rounded-lg text-xs flex items-center justify-between ${
                    testResult.success
                      ? 'bg-green-500/10 text-green-700'
                      : 'bg-red-500/10 text-red-600'
                  }`}>
                    <span>
                      {testResult.success
                        ? t('telegram.testSentTo', { chatId: testResult.chatId })
                        : t('telegram.testFailed', { error: testResult.error })}
                    </span>
                    <button onClick={() => setTestResult(null)} className="ml-2 hover:opacity-70">
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>
              )}

              {/* Hosts Selector Section (sausage-24183) */}
              {(recipientMode === 'hosts' || recipientMode === 'both') && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-theme-text">
                      {t('telegram.hostsList.title')}
                      <span className="ml-2 text-theme-text-faint font-normal">
                        {t('telegram.selectedOf', {
                          selected: selectedHostPartyIds.size,
                          total: connectedHostRows.length,
                        })}
                      </span>
                    </h4>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={selectAllHosts}
                        className="text-xs text-red-500/70 hover:text-red-500 transition-colors"
                      >
                        {t('telegram.selectAll')}
                      </button>
                      <span className="text-theme-text-faint text-xs">/</span>
                      <button
                        onClick={deselectAllHosts}
                        className="text-xs text-red-500/70 hover:text-red-500 transition-colors"
                      >
                        {t('telegram.deselectAll')}
                      </button>
                    </div>
                  </div>

                  {/* Search input (region filter skipped — host events don't carry region) */}
                  {recipientMode === 'hosts' && (
                    <div className="flex gap-2 mb-3">
                      <div className="flex-1">
                        <IconInput
                          icon={Search}
                          iconSize={14}
                          type="text"
                          placeholder={t('telegram.searchPlaceholder')}
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {/* Hosts list */}
                  <div className="border border-theme-stroke rounded-xl overflow-hidden">
                    <div className="max-h-[280px] overflow-y-auto">
                      {hostRows.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-theme-text-faint">
                          {t('telegram.hostsList.noConnectedHosts')}
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-3 px-4 py-2 bg-theme-surface border-b border-theme-stroke text-xs text-theme-text-faint font-medium sticky top-0">
                            <div className="w-5 flex-shrink-0">
                              <button
                                onClick={allFilteredHostsSelected ? deselectAllHosts : selectAllHosts}
                                disabled={connectedHostRows.length === 0}
                                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                                  allFilteredHostsSelected
                                    ? 'bg-red-500 border-red-500'
                                    : 'border-theme-stroke-hover hover:border-theme-text-faint'
                                } disabled:opacity-30 disabled:cursor-not-allowed`}
                              >
                                {allFilteredHostsSelected && <Check size={10} className="text-white" />}
                              </button>
                            </div>
                            <div className="flex-1 grid grid-cols-4 gap-2">
                              <span>{t('telegram.tableHeaders.city')}</span>
                              <span>{t('telegram.tableHeaders.host')}</span>
                              <span>{t('telegram.tableHeaders.hostTg')}</span>
                              <span>{t('telegram.tableHeaders.status')}</span>
                            </div>
                            <div className="w-14 text-right">{t('telegram.tableHeaders.test')}</div>
                          </div>
                          {hostRows.map(row => {
                            const isSelected = selectedHostPartyIds.has(row.partyId);
                            const checkboxAriaLabel = row.connected
                              ? `${row.city} ${row.hostName}`
                              : `${row.city} ${row.hostName} — ${t('telegram.hostsList.notConnected')}`;
                            return (
                              <div
                                key={row.partyId}
                                className={`flex items-center gap-3 px-4 py-2.5 border-b border-theme-stroke last:border-b-0 transition-colors ${
                                  row.connected ? 'cursor-pointer' : 'cursor-default opacity-70'
                                } ${isSelected ? 'bg-red-500/5' : 'hover:bg-theme-surface'}`}
                                onClick={() => toggleHost(row.partyId, row.connected)}
                              >
                                <div className="w-5 flex-shrink-0">
                                  <div
                                    role="checkbox"
                                    aria-checked={isSelected}
                                    aria-label={checkboxAriaLabel}
                                    aria-disabled={!row.connected}
                                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                                      isSelected
                                        ? 'bg-red-500 border-red-500'
                                        : 'border-theme-stroke-hover'
                                    } ${!row.connected ? 'opacity-30' : ''}`}
                                  >
                                    {isSelected && <Check size={10} className="text-white" />}
                                  </div>
                                </div>
                                <div className="flex-1 grid grid-cols-4 gap-2 text-sm">
                                  <span className="text-theme-text truncate">{row.city}</span>
                                  <span className="text-theme-text-secondary truncate">{row.hostName}</span>
                                  <span className="text-theme-text-faint truncate">
                                    {row.hostTelegram ? (
                                      <a
                                        href={`https://t.me/${row.hostTelegram.replace(/^@/, '')}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-purple-400 hover:text-purple-300 transition-colors"
                                        title="DM host on Telegram"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        @{row.hostTelegram.replace(/^@/, '')}
                                      </a>
                                    ) : (
                                      '—'
                                    )}
                                  </span>
                                  <span>
                                    {row.connected ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/15 text-green-600">
                                        <Check size={10} />
                                        {t('telegram.hostsList.connected')}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-yellow-500/15 text-yellow-600">
                                        {t('telegram.hostsList.notConnected')}
                                      </span>
                                    )}
                                  </span>
                                </div>
                                <div className="w-14 text-right">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (message.trim() && row.connected) handleHostTest(row);
                                    }}
                                    disabled={!message.trim() || !row.connected || testingHostPartyId === row.partyId}
                                    className="text-xs text-theme-text-faint hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    title={row.connected ? (message.trim() ? t('telegram.testTitle') as string : t('telegram.writeMessageFirst') as string) : t('telegram.hostsList.notConnected') as string}
                                  >
                                    {testingHostPartyId === row.partyId ? (
                                      <Loader2 size={12} className="animate-spin inline" />
                                    ) : (
                                      t('telegram.test')
                                    )}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Message Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-theme-text">{t('telegram.messageLabel')}</h4>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-theme-text-faint">
                      {message.length} / 4096
                    </span>
                    <select
                      value={parseMode}
                      onChange={(e) => setParseMode(e.target.value as 'HTML' | 'Markdown' | 'None')}
                      className="bg-theme-surface border border-theme-stroke rounded-lg px-2 py-1 text-xs text-theme-text focus:outline-none focus:border-theme-stroke-hover"
                    >
                      <option value="None">{t('telegram.formatPlain')}</option>
                      <option value="HTML">{t('telegram.formatHtml')}</option>
                      <option value="Markdown">{t('telegram.formatMarkdown')}</option>
                    </select>
                  </div>
                </div>
                <IconInput
                  icon={MessageSquare}
                  multiline
                  rows={6}
                  placeholder={t('telegram.messagePlaceholder')}
                  value={message}
                  onChange={(e) => {
                    if (e.target.value.length <= 4096) {
                      setMessage(e.target.value);
                    }
                  }}
                />
                <p className="text-xs text-theme-text-faint mt-1.5">
                  <Trans
                    i18nKey="telegram.templateHint"
                    ns="partner"
                    components={{
                      1: <code className="bg-theme-surface px-1 py-0.5 rounded text-red-500/80" />,
                      3: <code className="bg-theme-surface px-1 py-0.5 rounded text-red-500/80" />,
                    }}
                  />
                </p>
              </div>

              {/* Send button */}
              <div className="flex justify-end">
                <button
                  onClick={handleSend}
                  disabled={sendDisabled}
                  className="flex items-center gap-2 bg-[#E52828] hover:bg-[#cc2222] disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
                >
                  <Send size={14} />
                  {recipientMode === 'groups' && t('telegram.sendToGroups', { count: selectedIds.size })}
                  {recipientMode === 'hosts' && t('telegram.sendToHosts', { count: selectedHostPartyIds.size })}
                  {recipientMode === 'both' && t('telegram.sendToBoth', { groups: selectedIds.size, hosts: selectedHostPartyIds.size })}
                </button>
              </div>
            </div>
          )}

          {/* Sending view */}
          {viewState === 'sending' && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 size={32} className="animate-spin text-red-500 mb-4" />
              <p className="text-theme-text font-medium mb-1">
                {recipientMode === 'hosts'
                  ? t('telegram.sendingToGroups', { count: selectedHostsPayload.length })
                  : t('telegram.sendingToGroups', { count: selectedGroups.length + (recipientMode === 'both' ? selectedHostsPayload.length : 0) })}
              </p>
              <p className="text-sm text-theme-text-faint">
                {t('telegram.sendingSubtext')}
              </p>
            </div>
          )}

          {/* Results view */}
          {viewState === 'results' && (
            <div className="space-y-5">
              {/* Blocked-host warning banner (sausage-24183 — locked-in decision) */}
              {sendStats.blockedHosts > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={16} className="text-yellow-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-yellow-600">
                      {t('telegram.results.blockedWarning', { count: sendStats.blockedHosts })}
                    </p>
                  </div>
                </div>
              )}

              {/* Summary */}
              <div className="flex items-center gap-4 justify-center py-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{sendStats.sent}</div>
                  <div className="text-xs text-theme-text-faint">{t('telegram.sent')}</div>
                </div>
                <div className="w-px h-10 bg-theme-stroke" />
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-500">{sendStats.failed}</div>
                  <div className="text-xs text-theme-text-faint">{t('telegram.failed')}</div>
                </div>
              </div>

              {/* Results list — split into Groups / Hosts sections when mode is "both" */}
              {recipientMode === 'both' ? (
                <>
                  {results.some(r => r.kind === 'group') && (
                    <div>
                      <h4 className="text-xs font-medium text-theme-text-faint mb-2 uppercase tracking-wide">
                        {t('telegram.results.groupsSection')}
                      </h4>
                      <div className="border border-theme-stroke rounded-xl overflow-hidden">
                        <div className="max-h-[200px] overflow-y-auto">
                          {results.filter(r => r.kind === 'group').map((r, i) => (
                            <div
                              key={`group-${i}`}
                              className="flex items-center gap-3 px-4 py-2.5 border-b border-theme-stroke last:border-b-0"
                            >
                              <div className="flex-shrink-0">
                                {r.success ? (
                                  <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                                    <Check size={12} className="text-green-600" />
                                  </div>
                                ) : (
                                  <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                                    <X size={12} className="text-red-500" />
                                  </div>
                                )}
                              </div>
                              <span className="text-sm text-theme-text flex-1">{r.city || r.chatId}</span>
                              {r.error && (
                                <span className="text-xs text-red-400 max-w-[200px] truncate" title={r.error}>
                                  {r.error}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {results.some(r => r.kind === 'host') && (
                    <div>
                      <h4 className="text-xs font-medium text-theme-text-faint mb-2 uppercase tracking-wide">
                        {t('telegram.results.hostsSection')}
                      </h4>
                      <div className="border border-theme-stroke rounded-xl overflow-hidden">
                        <div className="max-h-[200px] overflow-y-auto">
                          {results.filter(r => r.kind === 'host').map((r, i) => {
                            const isBlocked = r.error === 'Host blocked the bot — disconnected';
                            return (
                              <div
                                key={`host-${i}`}
                                className={`flex items-center gap-3 px-4 py-2.5 border-b border-theme-stroke last:border-b-0 ${
                                  isBlocked ? 'bg-yellow-500/5' : ''
                                }`}
                              >
                                <div className="flex-shrink-0">
                                  {r.success ? (
                                    <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                                      <Check size={12} className="text-green-600" />
                                    </div>
                                  ) : isBlocked ? (
                                    <div className="w-5 h-5 rounded-full bg-yellow-500/20 flex items-center justify-center">
                                      <AlertCircle size={12} className="text-yellow-600" />
                                    </div>
                                  ) : (
                                    <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                                      <X size={12} className="text-red-500" />
                                    </div>
                                  )}
                                </div>
                                <span className="text-sm text-theme-text flex-1">{r.city || r.chatId}</span>
                                {r.error && (
                                  <span className={`text-xs max-w-[200px] truncate ${isBlocked ? 'text-yellow-600' : 'text-red-400'}`} title={r.error}>
                                    {r.error}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="border border-theme-stroke rounded-xl overflow-hidden">
                  <div className="max-h-[350px] overflow-y-auto">
                    {results.map((r, i) => {
                      const isBlocked = r.kind === 'host' && r.error === 'Host blocked the bot — disconnected';
                      return (
                        <div
                          key={i}
                          className={`flex items-center gap-3 px-4 py-2.5 border-b border-theme-stroke last:border-b-0 ${
                            isBlocked ? 'bg-yellow-500/5' : ''
                          }`}
                        >
                          <div className="flex-shrink-0">
                            {r.success ? (
                              <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                                <Check size={12} className="text-green-600" />
                              </div>
                            ) : isBlocked ? (
                              <div className="w-5 h-5 rounded-full bg-yellow-500/20 flex items-center justify-center">
                                <AlertCircle size={12} className="text-yellow-600" />
                              </div>
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                                <X size={12} className="text-red-500" />
                              </div>
                            )}
                          </div>
                          <span className="text-sm text-theme-text flex-1">{r.city || r.chatId}</span>
                          {r.error && (
                            <span className={`text-xs max-w-[200px] truncate ${isBlocked ? 'text-yellow-600' : 'text-red-400'}`} title={r.error}>
                              {r.error}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Done button */}
              <div className="flex justify-center">
                <button
                  onClick={onClose}
                  className="bg-theme-surface hover:bg-theme-card border border-theme-stroke text-theme-text px-6 py-2.5 rounded-xl text-sm font-medium transition-colors"
                >
                  {t('telegram.done')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
