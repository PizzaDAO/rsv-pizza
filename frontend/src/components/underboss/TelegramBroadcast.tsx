import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Check, AlertCircle, Loader2, Send, ChevronDown } from 'lucide-react';
import { fetchTelegramGroups, TelegramGroup } from '../../lib/telegram';
import { sendTelegramBroadcast, sendTelegramTest, BroadcastResult } from '../../lib/api';

interface TelegramBroadcastProps {
  onClose: () => void;
  preSelectedCities?: string[];
}

type ViewState = 'compose' | 'sending' | 'results';

export function TelegramBroadcast({ onClose, preSelectedCities }: TelegramBroadcastProps) {
  // Data loading
  const [groups, setGroups] = useState<TelegramGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Selection & filtering
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);

  // Message
  const [message, setMessage] = useState('');
  const [parseMode, setParseMode] = useState<'HTML' | 'Markdown'>('HTML');

  // State flow
  const [viewState, setViewState] = useState<ViewState>('compose');
  const [results, setResults] = useState<BroadcastResult[]>([]);
  const [sendStats, setSendStats] = useState({ sent: 0, failed: 0 });

  // Test message
  const [testingChatId, setTestingChatId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ chatId: string; success: boolean; error?: string } | null>(null);

  // Load groups on mount
  useEffect(() => {
    async function load() {
      try {
        const data = await fetchTelegramGroups();
        setGroups(data);
        // Auto-select groups matching pre-selected cities
        if (preSelectedCities && preSelectedCities.length > 0) {
          const citySet = new Set(preSelectedCities.map(c => c.toLowerCase()));
          const matchingIds = new Set<string>();
          for (const g of data) {
            if (citySet.has(g.city.toLowerCase())) {
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

  // Filtered groups
  const filteredGroups = useMemo(() => {
    let filtered = groups;

    // When opened from actions dropdown, only show groups matching the selected cities
    if (preSelectedCities && preSelectedCities.length > 0) {
      const citySet = new Set(preSelectedCities.map(c => c.toLowerCase()));
      filtered = filtered.filter(g => citySet.has(g.city.toLowerCase()));
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

  // Build selected groups array for API
  const selectedGroups = useMemo(() => {
    return groups.filter(g => selectedIds.has(g.groupId)).map(g => ({
      chatId: g.groupId,
      city: g.city,
      country: g.country,
    }));
  }, [groups, selectedIds]);

  // Send broadcast
  const handleSend = async () => {
    if (selectedGroups.length === 0 || !message.trim()) return;

    const confirmed = window.confirm(
      `Send this message to ${selectedGroups.length} Telegram group${selectedGroups.length > 1 ? 's' : ''}?`
    );
    if (!confirmed) return;

    setViewState('sending');

    try {
      const response = await sendTelegramBroadcast(selectedGroups, message, parseMode);
      setResults(response.results);
      setSendStats({ sent: response.sent, failed: response.failed });
      setViewState('results');
    } catch (err: any) {
      setResults([]);
      setSendStats({ sent: 0, failed: selectedGroups.length });
      setViewState('results');
    }
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-theme-card border border-theme-stroke rounded-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-theme-stroke flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/20 flex items-center justify-center">
              <Send size={16} className="text-red-500" />
            </div>
            <h3 className="text-lg font-semibold text-theme-text">Broadcast Message</h3>
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
              <p className="text-sm text-theme-text-muted">Loading Telegram groups...</p>
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
              {/* Group Selector Section */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-theme-text">
                    Select Groups
                    <span className="ml-2 text-theme-text-faint font-normal">
                      {selectedIds.size} of {filteredGroups.length} selected
                    </span>
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={selectAll}
                      className="text-xs text-red-500/70 hover:text-red-500 transition-colors"
                    >
                      Select All
                    </button>
                    <span className="text-theme-text-faint text-xs">/</span>
                    <button
                      onClick={deselectAll}
                      className="text-xs text-red-500/70 hover:text-red-500 transition-colors"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>

                {/* Search and region filter */}
                <div className="flex gap-2 mb-3">
                  <div className="flex-1 relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-faint" />
                    <input
                      type="text"
                      placeholder="Search city, country, or underboss..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full bg-theme-surface border border-theme-stroke rounded-lg pl-9 pr-3 py-2 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
                    />
                  </div>
                  <div className="relative">
                    <button
                      onClick={() => setRegionDropdownOpen(!regionDropdownOpen)}
                      className="flex items-center gap-1.5 bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text hover:border-theme-stroke-hover transition-colors"
                    >
                      {regionFilter === 'all' ? 'All Regions' : regionFilter}
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
                            All Regions
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
                        No groups match your search
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
                          <div className="flex-1 grid grid-cols-3 gap-2">
                            <span>City</span>
                            <span>Country</span>
                            <span>Underboss</span>
                          </div>
                          <div className="w-14 text-right">Test</div>
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
                            <div className="flex-1 grid grid-cols-3 gap-2 text-sm">
                              <span className="text-theme-text truncate">{group.city}</span>
                              <span className="text-theme-text-secondary truncate">{group.country}</span>
                              <span className="text-theme-text-faint truncate">{group.underboss}</span>
                            </div>
                            <div className="w-14 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (message.trim()) handleTest(group);
                                }}
                                disabled={!message.trim() || testingChatId === group.groupId}
                                className="text-xs text-theme-text-faint hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                title={message.trim() ? 'Send test message to this group' : 'Write a message first'}
                              >
                                {testingChatId === group.groupId ? (
                                  <Loader2 size={12} className="animate-spin inline" />
                                ) : (
                                  'Test'
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
                        ? `Test sent successfully to ${testResult.chatId}`
                        : `Test failed: ${testResult.error}`}
                    </span>
                    <button onClick={() => setTestResult(null)} className="ml-2 hover:opacity-70">
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>

              {/* Message Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-theme-text">Message</h4>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-theme-text-faint">
                      {message.length} / 4096
                    </span>
                    <select
                      value={parseMode}
                      onChange={(e) => setParseMode(e.target.value as 'HTML' | 'Markdown')}
                      className="bg-theme-surface border border-theme-stroke rounded-lg px-2 py-1 text-xs text-theme-text focus:outline-none focus:border-theme-stroke-hover"
                    >
                      <option value="HTML">HTML</option>
                      <option value="Markdown">Markdown</option>
                    </select>
                  </div>
                </div>
                <textarea
                  placeholder="Type your message here..."
                  value={message}
                  onChange={(e) => {
                    if (e.target.value.length <= 4096) {
                      setMessage(e.target.value);
                    }
                  }}
                  rows={6}
                  className="w-full bg-theme-surface border border-theme-stroke rounded-xl p-3 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover resize-none"
                />
                <p className="text-xs text-theme-text-faint mt-1.5">
                  Use <code className="bg-theme-surface px-1 py-0.5 rounded text-red-500/80">{'{city}'}</code> and <code className="bg-theme-surface px-1 py-0.5 rounded text-red-500/80">{'{country}'}</code> for per-group personalization
                </p>
              </div>

              {/* Send button */}
              <div className="flex justify-end">
                <button
                  onClick={handleSend}
                  disabled={selectedIds.size === 0 || !message.trim()}
                  className="flex items-center gap-2 bg-[#E52828] hover:bg-[#cc2222] disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
                >
                  <Send size={14} />
                  Send to {selectedIds.size} group{selectedIds.size !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )}

          {/* Sending view */}
          {viewState === 'sending' && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 size={32} className="animate-spin text-red-500 mb-4" />
              <p className="text-theme-text font-medium mb-1">
                Sending to {selectedGroups.length} group{selectedGroups.length !== 1 ? 's' : ''}...
              </p>
              <p className="text-sm text-theme-text-faint">
                This may take a moment
              </p>
            </div>
          )}

          {/* Results view */}
          {viewState === 'results' && (
            <div className="space-y-5">
              {/* Summary */}
              <div className="flex items-center gap-4 justify-center py-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{sendStats.sent}</div>
                  <div className="text-xs text-theme-text-faint">Sent</div>
                </div>
                <div className="w-px h-10 bg-theme-stroke" />
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-500">{sendStats.failed}</div>
                  <div className="text-xs text-theme-text-faint">Failed</div>
                </div>
              </div>

              {/* Results list */}
              <div className="border border-theme-stroke rounded-xl overflow-hidden">
                <div className="max-h-[350px] overflow-y-auto">
                  {results.map((r, i) => (
                    <div
                      key={i}
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

              {/* Done button */}
              <div className="flex justify-center">
                <button
                  onClick={onClose}
                  className="bg-theme-surface hover:bg-theme-card border border-theme-stroke text-theme-text px-6 py-2.5 rounded-xl text-sm font-medium transition-colors"
                >
                  Done
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
