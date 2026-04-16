import React, { useEffect, useState, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { LoginModal } from '../components/LoginModal';
import { IconInput } from '../components/IconInput';
import { useAuth } from '../contexts/AuthContext';
import { fetchSponsorMe, fetchSponsorEvents, toggleSponsorChecklistItem, updateSponsorExpectedGuests } from '../lib/api';
import {
  Loader2, Shield, Tag, ExternalLink, Users,
  Search, ThumbsUp, ThumbsDown, BarChart3, Calendar, MapPin,
  Wallet, TrendingUp,
} from 'lucide-react';
import type { SponsorDashboardEvent, SponsorMeResponse, SponsorDashboardData, CoHost } from '../types';
import { GPP_REGIONS } from '../types';

const themeClass = 'gpp-theme';
const backgroundStyle = { background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)' } as React.CSSProperties;

// ============================================
// Progress filter constants & FilterPill
// ============================================

const PROGRESS_FILTER_KEYS: { key: string; label: string }[] = [
  { key: 'hasPartyKit', label: 'Kit' },
  { key: 'hasCoHosts', label: 'Team' },
  { key: 'hasVenue', label: 'Venue' },
  { key: 'hasBudget', label: 'Budget' },
  { key: 'hasSponsors', label: 'Partners' },
  { key: 'hasSocialPosts', label: 'Social' },
  { key: 'hasThrown', label: 'Thrown' },
];

function FilterPill({
  label,
  state,
  onToggle,
}: {
  label: string;
  state: 'neutral' | 'include' | 'exclude';
  onToggle: (newState: 'neutral' | 'include' | 'exclude') => void;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${
        state === 'include'
          ? 'bg-[#39d98a]/20 border-[#39d98a]/30'
          : state === 'exclude'
            ? 'bg-[#E52828]/20 border-[#E52828]/30'
            : 'bg-theme-surface border-theme-stroke'
      }`}
    >
      <button
        onClick={() => onToggle(state === 'include' ? 'neutral' : 'include')}
        className="flex items-center gap-1.5 flex-1 py-0.5 hover:opacity-70 transition-opacity"
        title={`Must have ${label}`}
      >
        <ThumbsUp
          size={12}
          className={`transition-all ${state === 'include' ? 'text-[#39d98a]' : 'text-theme-text-faint'}`}
        />
        <span className="text-theme-text text-xs">{label}</span>
      </button>
      <button
        onClick={() => onToggle(state === 'exclude' ? 'neutral' : 'exclude')}
        className="p-0.5 hover:opacity-70 transition-opacity"
        title={`Must NOT have ${label}`}
      >
        <ThumbsDown
          size={12}
          className={`transition-all ${state === 'exclude' ? 'text-[#E52828]' : 'text-theme-text-faint'}`}
        />
      </button>
    </div>
  );
}

export function PartnerDashboardPage() {
  const { user, loading: authLoading } = useAuth();

  // Set body class for elements outside React tree (modals, portals)
  useEffect(() => {
    document.body.classList.add('gpp-theme-active');
    return () => { document.body.classList.remove('gpp-theme-active'); };
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meData, setMeData] = useState<SponsorMeResponse | null>(null);
  const [dashboardData, setDashboardData] = useState<SponsorDashboardData | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | undefined>(undefined);
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');

  // Three-state progress filters
  const [progressIncludes, setProgressIncludes] = useState<string[]>([]);
  const [progressExcludes, setProgressExcludes] = useState<string[]>([]);

  // Region filter (simple dropdown like underboss)
  const [regionFilter, setRegionFilter] = useState<string>('all');

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setLoading(false);
      return;
    }

    async function loadDashboard() {
      try {
        const me = await fetchSponsorMe();
        setMeData(me);

        if (!me.isSponsor) {
          setLoading(false);
          return;
        }

        // If admin, load all events first to get available tags
        const tag = me.isAdmin ? selectedTag : me.sponsor?.tag;
        const data = await fetchSponsorEvents(tag);
        setDashboardData(data);

        // For admins, extract unique tags from events to build a tag picker
        if (me.isAdmin && !selectedTag) {
          const tags = new Set<string>();
          data.events.forEach(e => {
            // eventTags are on the event but not in the response — use the dashboard tag
            if (data.tag) tags.add(data.tag);
          });
          // Also fetch all sponsor users to get all tags
          try {
            const { fetchSponsorUsers } = await import('../lib/api');
            const result = await fetchSponsorUsers();
            result.sponsorUsers.forEach(su => tags.add(su.tag));
          } catch { /* admin-only, ok to fail */ }
          setAvailableTags(Array.from(tags).sort());
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load partner dashboard');
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, [user, authLoading, selectedTag]);

  async function handleToggleChecklist(eventId: string, itemId: string) {
    if (!dashboardData) return;

    // Optimistic update
    setDashboardData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        events: prev.events.map(event => {
          if (event.id !== eventId) return event;
          return {
            ...event,
            checklist: event.checklist.map(item => {
              if (item.id !== itemId) return item;
              return {
                ...item,
                completed: !item.completed,
                completedAt: !item.completed ? new Date().toISOString() : null,
              };
            }),
          };
        }),
      };
    });

    try {
      await toggleSponsorChecklistItem(itemId);
    } catch {
      // Revert on failure
      const data = await fetchSponsorEvents();
      setDashboardData(data);
    }
  }

  // Derived data (must be above early returns to preserve hook order)
  const sponsor = dashboardData?.sponsor;
  const allEvents = dashboardData?.events || [];

  function getFilterState(key: string): 'neutral' | 'include' | 'exclude' {
    if (progressIncludes.includes(key)) return 'include';
    if (progressExcludes.includes(key)) return 'exclude';
    return 'neutral';
  }

  function setFilterState(key: string, newState: 'neutral' | 'include' | 'exclude') {
    setProgressIncludes((prev) => prev.filter((k) => k !== key));
    setProgressExcludes((prev) => prev.filter((k) => k !== key));
    if (newState === 'include') {
      setProgressIncludes((prev) => [...prev, key]);
    } else if (newState === 'exclude') {
      setProgressExcludes((prev) => [...prev, key]);
    }
  }

  const events = useMemo(() => {
    let filtered = allEvents;

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(e =>
        e.name.toLowerCase().includes(q) ||
        (e.hostName && e.hostName.toLowerCase().includes(q)) ||
        (e.venueName && e.venueName.toLowerCase().includes(q)) ||
        (e.address && e.address.toLowerCase().includes(q))
      );
    }

    // Progress includes (AND: event must have ALL included progress items)
    if (progressIncludes.length > 0) {
      filtered = filtered.filter(e => {
        if (!e.progress) return false;
        return progressIncludes.every(key => e.progress![key as keyof typeof e.progress]);
      });
    }

    // Progress excludes (AND: event must NOT have ANY excluded progress items)
    if (progressExcludes.length > 0) {
      filtered = filtered.filter(e => {
        if (!e.progress) return true; // if no progress data, don't exclude
        return progressExcludes.every(key => !e.progress![key as keyof typeof e.progress]);
      });
    }

    // Region filter
    if (regionFilter !== 'all') {
      filtered = filtered.filter(e => e.region === regionFilter);
    }

    // Sort by date descending (default, no user-selectable sort)
    const sorted = [...filtered].sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    return sorted;
  }, [allEvents, searchQuery, progressIncludes, progressExcludes, regionFilter]);

  const uniqueRegions = useMemo(() => {
    const regions = new Set(allEvents.map(e => e.region).filter(Boolean));
    return regions;
  }, [allEvents]);

  const hasActiveFilters = searchQuery.trim() !== '' || progressIncludes.length > 0 || progressExcludes.length > 0 || (uniqueRegions.size > 1 && regionFilter !== 'all');

  function clearAllFilters() {
    setSearchQuery('');
    setProgressIncludes([]);
    setProgressExcludes([]);
    setRegionFilter('all');
  }

  // Loading state
  if (authLoading || loading) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-theme-text-muted" />
        </div>
        <Footer />
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-theme-text-faint mb-4" />
          <h1 className="text-2xl font-bold text-theme-text mb-2">Partner Dashboard</h1>
          <p className="text-theme-text-muted text-center max-w-md mb-6">
            Log in to access your partner dashboard.
          </p>
          <button
            onClick={() => setShowLoginModal(true)}
            className="px-6 py-2 bg-[#E52828] text-white rounded-xl text-sm font-medium hover:bg-[#CC2020] transition-colors"
          >
            Log In
          </button>
        </div>
        <Footer />
        <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-red-400/60 mb-4" />
          <h1 className="text-2xl font-bold text-theme-text mb-2">Error</h1>
          <p className="text-theme-text-muted text-center max-w-md">{error}</p>
        </div>
        <Footer />
      </div>
    );
  }

  // Not a partner
  if (!meData?.isSponsor) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-theme-text-faint mb-4" />
          <h1 className="text-2xl font-bold text-theme-text mb-2">Access Denied</h1>
          <p className="text-theme-text-muted text-center max-w-md">
            You do not have partner access. Contact an admin to get set up.
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${themeClass} relative overflow-hidden`} style={backgroundStyle}>
      <Helmet>
        <title>Partner Dashboard | RSV.Pizza</title>
      </Helmet>

      <Header />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        <div className="rounded-2xl p-6 sm:p-8" style={{ background: 'rgba(240, 240, 240, 0.95)' }}>
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-[#E52828]/20 flex items-center justify-center">
              <Tag size={20} className="text-[#E52828]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-theme-text">
                {dashboardData?.isAdmin ? 'Partner Dashboard' : `${sponsor?.name || 'Partner'} Dashboard`}
              </h1>
              <p className="text-sm text-theme-text-muted">
                Showing {events.length}{events.length !== allEvents.length ? ` of ${allEvents.length}` : ''} event{events.length !== 1 ? 's' : ''}{dashboardData?.tag ? ` tagged "${dashboardData.tag}"` : ''}
              </p>
            </div>
          </div>

          {/* Admin tag filter */}
          {dashboardData?.isAdmin && availableTags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedTag(undefined)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  !selectedTag
                    ? 'border-[#E52828] text-theme-text bg-[#E52828]/20'
                    : 'border-theme-stroke text-theme-text-muted hover:text-theme-text-secondary'
                }`}
              >
                All tags
              </button>
              {availableTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(tag)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    selectedTag === tag
                      ? 'border-[#E52828] text-theme-text bg-[#E52828]/20'
                      : 'border-theme-stroke text-theme-text-muted hover:text-theme-text-secondary'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Stats */}
        {allEvents.length > 0 && (() => {
          const totalRsvps = allEvents.reduce((sum, e) => sum + (e.rsvpCount || 0), 0);
          const avgRsvps = allEvents.length > 0 ? Math.round(totalRsvps / allEvents.length) : 0;
          const withVenue = allEvents.filter(e => e.progress?.hasVenue).length;
          const withBudget = allEvents.filter(e => e.progress?.hasBudget).length;
          const venueRate = allEvents.length > 0 ? Math.round((withVenue / allEvents.length) * 100) : 0;
          const budgetRate = allEvents.length > 0 ? Math.round((withBudget / allEvents.length) * 100) : 0;
          return (
            <div className="mb-6 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className="bg-theme-card border border-theme-stroke rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/20 text-blue-400"><BarChart3 size={16} /></div>
                    <span className="text-xs text-theme-text-muted uppercase tracking-wider">Events</span>
                  </div>
                  <div className="text-2xl font-bold text-theme-text">{allEvents.length}</div>
                </div>
                <div className="bg-theme-card border border-theme-stroke rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-500/20 text-purple-400"><Users size={16} /></div>
                    <span className="text-xs text-theme-text-muted uppercase tracking-wider">Total RSVPs</span>
                  </div>
                  <div className="text-2xl font-bold text-theme-text">{totalRsvps}</div>
                  <div className="text-xs text-theme-text-muted mt-1">~{avgRsvps} per event</div>
                </div>
                <div className="bg-theme-card border border-theme-stroke rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-orange-500/20 text-orange-400"><MapPin size={16} /></div>
                    <span className="text-xs text-theme-text-muted uppercase tracking-wider">With Venue</span>
                  </div>
                  <div className="text-2xl font-bold text-theme-text">{withVenue}</div>
                </div>
                <div className="bg-theme-card border border-theme-stroke rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-yellow-500/20 text-yellow-400"><Wallet size={16} /></div>
                    <span className="text-xs text-theme-text-muted uppercase tracking-wider">With Budget</span>
                  </div>
                  <div className="text-2xl font-bold text-theme-text">{withBudget}</div>
                </div>
                <div className="bg-theme-card border border-theme-stroke rounded-xl p-4 col-span-2 md:col-span-3 lg:col-span-1">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp size={14} className="text-theme-text-muted" />
                    <span className="text-xs text-theme-text-muted uppercase tracking-wider">Completion</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-theme-text-muted w-14 shrink-0">Venue</span>
                      <div className="flex-1 h-2 bg-theme-surface rounded-full overflow-hidden"><div className="h-full bg-green-500/60 rounded-full transition-all duration-500" style={{ width: `${venueRate}%` }} /></div>
                      <span className="text-xs text-theme-text-secondary w-10 text-right">{venueRate}%</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-theme-text-muted w-14 shrink-0">Budget</span>
                      <div className="flex-1 h-2 bg-theme-surface rounded-full overflow-hidden"><div className="h-full bg-green-500/60 rounded-full transition-all duration-500" style={{ width: `${budgetRate}%` }} /></div>
                      <span className="text-xs text-theme-text-secondary w-10 text-right">{budgetRate}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Filters */}
        {allEvents.length > 0 && (
          <div className="mb-6 space-y-3">
            {/* Search */}
            <div className="max-w-sm">
              <IconInput
                icon={Search}
                type="search"
                placeholder="Search events, hosts, venues..."
                value={searchQuery}
                onChange={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
              />
            </div>

            {/* Progress filter pills + Region dropdown */}
            <div className="flex flex-wrap items-center gap-2">
              {PROGRESS_FILTER_KEYS.map(({ key, label }) => (
                <FilterPill
                  key={key}
                  label={label}
                  state={getFilterState(key)}
                  onToggle={(newState) => setFilterState(key, newState)}
                />
              ))}

              {/* Region filter dropdown — hidden when all events share one region */}
              {uniqueRegions.size > 1 && (
                <select
                  value={regionFilter}
                  onChange={(e) => setRegionFilter(e.target.value)}
                  className="bg-theme-input border border-theme-stroke rounded-lg px-3 py-1.5 text-sm text-theme-text focus:outline-none focus:border-theme-stroke-hover"
                >
                  <option value="all">Region: All</option>
                  {GPP_REGIONS.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              )}

              {/* Clear filters */}
              {hasActiveFilters && (
                <button
                  onClick={clearAllFilters}
                  className="text-xs text-red-500/70 hover:text-red-500 transition-colors"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}

        {/* Events grid */}
        {events.length === 0 ? (
          <div className="text-center py-16">
            <Tag size={48} className="text-theme-text-faint mx-auto mb-4" />
            {hasActiveFilters ? (
              <>
                <p className="text-theme-text-muted mb-3">No events match your filters.</p>
                <button
                  onClick={clearAllFilters}
                  className="px-4 py-2 text-sm text-theme-text-secondary hover:text-theme-text border border-theme-stroke hover:border-theme-stroke-hover rounded-xl transition-colors"
                >
                  Clear all filters
                </button>
              </>
            ) : (
              <p className="text-theme-text-muted">No events found with your partner tag.</p>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:gap-6">
            {events.map(event => (
              <EventCard
                key={event.id}
                event={event}
                onToggleChecklist={(itemId) => handleToggleChecklist(event.id, itemId)}
              />
            ))}
          </div>
        )}
        </div>{/* closes inner panel */}
      </main>

      <Footer />
    </div>
  );
}

// ============================================
// Event Card component
// ============================================

interface EventCardProps {
  event: SponsorDashboardEvent;
  onToggleChecklist: (itemId: string) => void;
}

function EventCard({ event, onToggleChecklist }: EventCardProps) {
  // Filter co-hosts to show only visible ones
  const visibleCoHosts = event.coHosts.filter((h: CoHost) => h.showOnEvent !== false);

  // Per-partner expected guest count (local optimistic state)
  const [localExpected, setLocalExpected] = useState<number | null>(event.expectedGuests ?? null);

  // Keep local state in sync if the parent re-renders with a fresh value
  useEffect(() => {
    setLocalExpected(event.expectedGuests ?? null);
  }, [event.expectedGuests]);

  async function saveExpectedGuests() {
    const current = event.expectedGuests ?? null;
    if (localExpected === current) return; // no change
    try {
      await updateSponsorExpectedGuests(event.id, localExpected);
      // Optimistic — don't refetch
    } catch (err) {
      console.error('Failed to save expected guests:', err);
      setLocalExpected(current); // revert
    }
  }

  return (
    <div className="bg-theme-card border border-theme-stroke rounded-2xl overflow-hidden flex flex-col md:flex-row hover:border-theme-stroke-hover transition-colors">
      {/* Flyer image — banner on mobile, left column on desktop */}
      {event.eventImageUrl && (
        <div className="md:w-44 flex-shrink-0 self-stretch bg-black/40 flex items-center justify-center">
          <img
            src={event.eventImageUrl}
            alt=""
            className="w-full h-32 md:h-full object-contain"
          />
        </div>
      )}

      {/* Right side: compact content to fit within image height */}
      <div className="flex-1 min-w-0 px-4 py-3 flex flex-col justify-between">
        {/* Top: title + links */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-theme-text truncate">{event.name}</h2>
            {event.hostName && (
              <p className="text-xs text-theme-text-muted">Hosted by {event.hostName}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {event.reportPublicSlug ? (
              <a
                href={`/report/${event.reportPublicSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-theme-text-muted hover:text-theme-text-secondary border border-theme-stroke hover:border-theme-stroke-hover rounded-md transition-colors"
                title="View event report"
              >
                <BarChart3 size={12} />
                Report
              </a>
            ) : (
              <span
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-theme-text-faint border border-theme-surface rounded-md cursor-default"
                title="Report not published yet"
              >
                <BarChart3 size={12} />
                Report
              </span>
            )}
            <a
              href={`/${event.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-theme-text-faint hover:text-theme-text-secondary transition-colors"
              title="View event page"
            >
              <ExternalLink size={14} />
            </a>
          </div>
        </div>

        {/* Middle: date/time/venue + RSVP inline */}
        <div className="flex items-center gap-4 mt-2">
          <div className="flex-1 min-w-0 space-y-0.5 text-xs text-theme-text-secondary">
            {event.date && (
              <div className="flex items-center gap-1.5">
                <Calendar size={12} className="text-theme-text-muted flex-shrink-0" />
                <span>{new Date(event.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(event.timezone ? { timeZone: event.timezone } : {}) })}</span>
                <span className="text-theme-text-muted mx-0.5">·</span>
                <span>{new Date(event.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(event.timezone ? { timeZone: event.timezone } : {}) })}</span>
              </div>
            )}
            {(event.venueName || event.address) && (
              <div className="flex items-center gap-1.5">
                <MapPin size={12} className="text-theme-text-muted flex-shrink-0" />
                <span className="truncate">
                  {event.venueName}{event.venueName && event.address ? ' - ' : ''}{event.address}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Users size={14} className="text-theme-text-muted" />
            <span className="text-lg font-bold text-theme-text">{event.rsvpCount}</span>
            <span className="text-xs text-theme-text-muted">RSVPs</span>
            <span className="text-theme-text-muted mx-1">·</span>
            <input
              type="number"
              min={0}
              max={10000}
              value={localExpected ?? ''}
              onChange={(e) => setLocalExpected(e.target.value === '' ? null : parseInt(e.target.value, 10))}
              onBlur={saveExpectedGuests}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              placeholder="—"
              className="w-14 bg-theme-surface border border-theme-stroke rounded text-sm text-theme-text px-1.5 py-0.5 text-right focus:outline-none focus:border-theme-stroke-hover"
              title="Your expected guests for this event"
              aria-label="Your expected guests for this event"
            />
            <span className="text-xs text-theme-text-muted">expected</span>
          </div>
        </div>

        {/* Bottom: co-hosts */}
        {visibleCoHosts.length > 0 && (
          <div className="flex items-center gap-2 mt-2 overflow-hidden">
            <Users size={12} className="text-theme-text-muted flex-shrink-0" />
            <div className="flex flex-wrap gap-1.5 overflow-hidden max-h-6">
              {visibleCoHosts.map((host: CoHost, i: number) => (
                <span
                  key={host.id || i}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-theme-surface text-xs text-theme-text-secondary"
                >
                  {host.avatar_url && (
                    <img src={host.avatar_url} alt="" className="w-3.5 h-3.5 rounded-full" />
                  )}
                  {host.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>{/* closes flex-1 wrapper */}
    </div>
  );
}
