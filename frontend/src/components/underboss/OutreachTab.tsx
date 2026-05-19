import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, ExternalLink, Loader2, Mail, MapPin, MessageCircle, Search, Send, Twitter, Users } from 'lucide-react';
import { IconInput } from '../IconInput';
import {
  fetchOutreachCommunities,
  fetchUnderbossMe,
  updateOutreachAttempt,
  type OutreachChannel,
  type OutreachCommunityRow,
  type OutreachStatus,
} from '../../lib/api';
import { OUTREACH_CHANNEL_LABELS } from '../../lib/outreachTemplates';
import { OutreachTemplateModal } from './OutreachTemplateModal';
import { OutreachLinkPartyModal } from './OutreachLinkPartyModal';

interface OutreachTabProps {
  isAdmin: boolean;
}

type StatusFilter = '' | 'none' | OutreachStatus;
type SortField = 'city' | 'followers' | 'priority' | 'lastAttempt';
type SortDir = 'asc' | 'desc';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'none', label: 'Not contacted' },
  { value: 'sent', label: 'Sent' },
  { value: 'replied', label: 'Replied' },
  { value: 'declined', label: 'Declined' },
  { value: 'converted', label: 'Converted' },
  { value: 'bounced', label: 'Bounced' },
];

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-red-500/15 text-red-500 border-red-500/30',
  medium: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  low: 'bg-theme-surface text-theme-text-muted border-theme-stroke',
};

const STATUS_BADGE: Record<OutreachStatus, string> = {
  sent: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  replied: 'bg-cyan-500/15 text-cyan-500 border-cyan-500/30',
  declined: 'bg-theme-surface text-theme-text-muted border-theme-stroke',
  converted: 'bg-green-500/15 text-green-500 border-green-500/30',
  bounced: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
};

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(mo / 12);
  return `${yr}y ago`;
}

function channelEnabled(community: OutreachCommunityRow, channel: OutreachChannel): boolean {
  if (channel === 'twitter_dm') {
    return Boolean(community.twitterHandle || (community.source && community.source.toLowerCase().includes('twitter')));
  }
  if (channel === 'email') {
    return Boolean(community.email);
  }
  if (channel === 'telegram') {
    return Boolean(community.telegramHandle || (community.source && community.source.toLowerCase().includes('telegram')));
  }
  return false;
}

export function OutreachTab(_props: OutreachTabProps) {
  const [communities, setCommunities] = useState<OutreachCommunityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cityFilter, setCityFilter] = useState('');
  const [debouncedCity, setDebouncedCity] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [sourceFilter, setSourceFilter] = useState('');

  const [sortField, setSortField] = useState<SortField>('priority');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [templateModal, setTemplateModal] = useState<{ community: OutreachCommunityRow; channel: OutreachChannel } | null>(null);
  const [linkPartyModal, setLinkPartyModal] = useState<{ attemptId: string; communityName: string } | null>(null);

  const [senderName, setSenderName] = useState<string | null>(null);

  const cityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load sender display name for template interpolation
  useEffect(() => {
    let mounted = true;
    fetchUnderbossMe()
      .then((me) => {
        if (!mounted) return;
        const name = me?.name || me?.email || null;
        setSenderName(name);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Debounce city filter
  useEffect(() => {
    if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current);
    cityDebounceRef.current = setTimeout(() => setDebouncedCity(cityFilter.trim()), 300);
    return () => {
      if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current);
    };
  }, [cityFilter]);

  const loadCommunities = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchOutreachCommunities({
        city: debouncedCity,
        priority: priorityFilter,
        source: sourceFilter,
        status: statusFilter,
      });
      setCommunities(rows);
    } catch (e: any) {
      setError(e?.message || 'Failed to load communities');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCommunities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedCity, priorityFilter, sourceFilter, statusFilter]);

  const sources = useMemo(() => {
    const set = new Set<string>();
    communities.forEach((c) => {
      if (c.source) set.add(c.source);
    });
    return Array.from(set).sort();
  }, [communities]);

  const sorted = useMemo(() => {
    const list = [...communities];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (sortField === 'city') return a.city.localeCompare(b.city) * dir;
      if (sortField === 'followers') {
        const av = a.followerCount ?? -1;
        const bv = b.followerCount ?? -1;
        return (av - bv) * dir;
      }
      if (sortField === 'priority') {
        const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
        const av = order[a.priority || ''] ?? 99;
        const bv = order[b.priority || ''] ?? 99;
        return (av - bv) * dir;
      }
      if (sortField === 'lastAttempt') {
        const av = a.lastAttempt ? new Date(a.lastAttempt.sentAt).getTime() : 0;
        const bv = b.lastAttempt ? new Date(b.lastAttempt.sentAt).getTime() : 0;
        return (av - bv) * dir;
      }
      return 0;
    });
    return list;
  }, [communities, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'followers' || field === 'lastAttempt' ? 'desc' : 'asc');
    }
  };

  const clearFilters = () => {
    setCityFilter('');
    setPriorityFilter('');
    setStatusFilter('');
    setSourceFilter('');
  };

  const handleStatusChange = async (attemptId: string, status: OutreachStatus) => {
    // Optimistic update
    setCommunities((prev) =>
      prev.map((c) => {
        if (c.lastAttempt?.id !== attemptId) return c;
        return { ...c, lastAttempt: { ...c.lastAttempt, status } };
      })
    );
    try {
      await updateOutreachAttempt(attemptId, { status });
    } catch (e) {
      // Reload on failure to revert
      loadCommunities();
    }
  };

  const handleAttemptLogged = () => {
    loadCommunities();
  };

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-64">
          <IconInput
            icon={MapPin}
            placeholder="Search city..."
            value={cityFilter}
            onChange={(e: any) => setCityFilter(e.target.value)}
          />
        </div>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-theme-card border border-theme-stroke text-sm text-theme-text"
        >
          <option value="">All priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="px-3 py-2 rounded-lg bg-theme-card border border-theme-stroke text-sm text-theme-text"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-theme-card border border-theme-stroke text-sm text-theme-text"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {(cityFilter || priorityFilter || statusFilter || sourceFilter) && (
          <button
            type="button"
            onClick={clearFilters}
            className="px-3 py-2 rounded-lg text-sm text-theme-text-secondary hover:text-theme-text"
          >
            Clear filters
          </button>
        )}

        <div className="ml-auto text-sm text-theme-text-muted">
          {communities.length} communit{communities.length === 1 ? 'y' : 'ies'}
        </div>
      </div>

      {/* Table */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-theme-text-muted">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-500">
          {error}
        </div>
      )}

      {!loading && !error && sorted.length === 0 && (
        <div className="text-center py-12 text-theme-text-muted">
          <Search size={28} className="mx-auto mb-2 opacity-50" />
          <p>No communities match your filters. Try clearing them.</p>
        </div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-theme-stroke">
          <table className="w-full text-sm">
            <thead className="bg-theme-surface text-theme-text-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">
                  <button
                    type="button"
                    onClick={() => toggleSort('city')}
                    className="inline-flex items-center gap-1 hover:text-theme-text"
                  >
                    City <ArrowUpDown size={12} />
                  </button>
                </th>
                <th className="px-3 py-2 text-left">Community</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('followers')}
                    className="inline-flex items-center gap-1 hover:text-theme-text"
                  >
                    Followers <ArrowUpDown size={12} />
                  </button>
                </th>
                <th className="px-3 py-2 text-left">
                  <button
                    type="button"
                    onClick={() => toggleSort('priority')}
                    className="inline-flex items-center gap-1 hover:text-theme-text"
                  >
                    Priority <ArrowUpDown size={12} />
                  </button>
                </th>
                <th className="px-3 py-2 text-left">
                  <button
                    type="button"
                    onClick={() => toggleSort('lastAttempt')}
                    className="inline-flex items-center gap-1 hover:text-theme-text"
                  >
                    Last attempt <ArrowUpDown size={12} />
                  </button>
                </th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-stroke">
              {sorted.map((community) => {
                const last = community.lastAttempt;
                const priorityKey = (community.priority || '').toLowerCase();
                return (
                  <tr key={community.id} className="hover:bg-theme-surface/50">
                    <td className="px-3 py-2 text-theme-text whitespace-nowrap">{community.city}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-theme-text">{community.name}</span>
                        {community.contactUrl && (
                          <a
                            href={community.contactUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-theme-text-muted hover:text-theme-text"
                            title={community.contactUrl}
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-theme-text-muted whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded text-xs bg-theme-surface border border-theme-stroke">
                        {community.source}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-theme-text-muted tabular-nums">
                      {community.followerCount != null ? community.followerCount.toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {community.priority ? (
                        <span
                          className={`px-2 py-0.5 rounded text-xs border ${
                            PRIORITY_BADGE[priorityKey] || PRIORITY_BADGE.low
                          }`}
                        >
                          {community.priority}
                        </span>
                      ) : (
                        <span className="text-theme-text-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {last ? (
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-xs border ${STATUS_BADGE[last.status]}`}
                          >
                            {last.status}
                          </span>
                          <span className="text-xs text-theme-text-muted">
                            {formatRelative(last.sentAt)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-theme-text-faint text-xs">Not contacted</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Channel buttons */}
                        {(['twitter_dm', 'email', 'telegram'] as OutreachChannel[]).map((ch) => {
                          const enabled = channelEnabled(community, ch);
                          const Icon = ch === 'twitter_dm' ? Twitter : ch === 'email' ? Mail : MessageCircle;
                          return (
                            <button
                              key={ch}
                              type="button"
                              disabled={!enabled}
                              onClick={() => setTemplateModal({ community, channel: ch })}
                              title={enabled ? `Compose ${OUTREACH_CHANNEL_LABELS[ch]}` : `No ${OUTREACH_CHANNEL_LABELS[ch]} contact`}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs border ${
                                enabled
                                  ? 'border-theme-stroke text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface'
                                  : 'border-theme-stroke text-theme-text-faint opacity-50 cursor-not-allowed'
                              }`}
                            >
                              <Icon size={12} />
                              {OUTREACH_CHANNEL_LABELS[ch]}
                            </button>
                          );
                        })}

                        {/* Status change select (only if there's a last attempt) */}
                        {last && (
                          <select
                            value={last.status}
                            onChange={(e) => handleStatusChange(last.id, e.target.value as OutreachStatus)}
                            className="px-2 py-1 rounded text-xs bg-theme-card border border-theme-stroke text-theme-text"
                            title="Update status"
                          >
                            <option value="sent">Sent</option>
                            <option value="replied">Replied</option>
                            <option value="declined">Declined</option>
                            <option value="converted">Converted</option>
                            <option value="bounced">Bounced</option>
                          </select>
                        )}

                        {/* Link party (only if converted + not yet linked) */}
                        {last && last.status === 'converted' && !last.convertedPartyId && (
                          <button
                            type="button"
                            onClick={() =>
                              setLinkPartyModal({ attemptId: last.id, communityName: community.name })
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-green-500/30 bg-green-500/10 text-green-500 hover:bg-green-500/20"
                          >
                            <Users size={12} />
                            Link party
                          </button>
                        )}

                        {last && last.convertedPartyId && (
                          <span className="inline-flex items-center gap-1 text-xs text-green-500" title={last.convertedPartyId}>
                            <Send size={12} /> linked
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {templateModal && (
        <OutreachTemplateModal
          community={templateModal.community}
          channel={templateModal.channel}
          senderName={senderName}
          onClose={() => setTemplateModal(null)}
          onLogged={handleAttemptLogged}
        />
      )}

      {linkPartyModal && (
        <OutreachLinkPartyModal
          attemptId={linkPartyModal.attemptId}
          communityName={linkPartyModal.communityName}
          onClose={() => setLinkPartyModal(null)}
          onLinked={handleAttemptLogged}
        />
      )}
    </div>
  );
}
