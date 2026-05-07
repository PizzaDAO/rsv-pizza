import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Helmet } from 'react-helmet-async';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { LoginModal } from '../components/LoginModal';
import { IconInput } from '../components/IconInput';
import { useAuth } from '../contexts/AuthContext';
import { fetchSponsorMe, fetchSponsorEvents, toggleSponsorChecklistItem, updatePartnerEventNote, getPartyPhotos } from '../lib/api';
import {
  Loader2, Shield, Tag, Users,
  Search, ThumbsUp, ThumbsDown, BarChart3, Calendar, MapPin,
  Wallet, TrendingUp, StickyNote, MessageCircle, MousePointerClick, Eye,
  Instagram, Youtube, Linkedin, Globe, Facebook,
  Camera, ChevronLeft, ChevronRight, X, Link2,
} from 'lucide-react';
import { cdnUrl } from '../lib/supabase';
import { getGppPhotosForCity, getGppPhotoCounts } from '../lib/gppPhotos';
import { fetchSheetCities } from '../lib/cities';
import type { SheetCity } from '../lib/cities';
import type { SponsorDashboardEvent, SponsorMeResponse, SponsorDashboardData, CoHost } from '../types';
import { GPP_REGIONS } from '../types';

interface DisplayPhoto {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
  source: 'uploaded' | 'gpp';
  year?: number;
}

function PhotoLightbox({
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

const themeClass = 'gpp-theme';
const backgroundStyle = { background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)' } as React.CSSProperties;

// Detect platform from URL domain
function detectPlatform(url: string): string {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    if (host.includes('instagram.com')) return 'Instagram';
    if (host.includes('twitter.com') || host.includes('x.com')) return 'X';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'YouTube';
    if (host.includes('tiktok.com')) return 'TikTok';
    if (host.includes('linkedin.com')) return 'LinkedIn';
    if (host.includes('facebook.com') || host.includes('fb.com')) return 'Facebook';
    if (host.includes('farcaster') || host.includes('warpcast.com')) return 'Farcaster';
    return 'Website';
  } catch {
    return 'Website';
  }
}

// X (Twitter) icon
const XIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

// TikTok icon
const TikTokIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
  </svg>
);

// Farcaster icon
const FarcasterIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M5.315 3.401h13.37v17.198h-1.689V7.68H6.998v12.919H5.315V3.401zm3.371 7.674h6.628v1.414h-6.628v-1.414z" />
  </svg>
);

function PlatformIcon({ platform, size = 12 }: { platform: string; size?: number }) {
  switch (platform) {
    case 'Instagram': return <Instagram size={size} />;
    case 'X': return <XIcon size={size} />;
    case 'YouTube': return <Youtube size={size} />;
    case 'TikTok': return <TikTokIcon size={size} />;
    case 'LinkedIn': return <Linkedin size={size} />;
    case 'Facebook': return <Facebook size={size} />;
    case 'Farcaster': return <FarcasterIcon size={size} />;
    default: return <Globe size={size} />;
  }
}

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

function resolveCityChat(eventName: string, chats: Map<string, string>): string | undefined {
  // Event names are like "Global Pizza Party City Name" — strip the prefix
  const city = eventName.replace(/^Global Pizza Party\s*/i, '').trim().toLowerCase();
  return chats.get(city);
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

  // City chat Telegram links from the master Google Sheet
  const [cityChats, setCityChats] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    fetchSheetCities().then(cities => {
      const map = new Map<string, string>();
      for (const c of cities) {
        if (c.chatUrl) map.set(c.city.toLowerCase().trim(), c.chatUrl);
      }
      setCityChats(map);
    }).catch(() => {/* silent — Telegram buttons just won't show */});
  }, []);

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
          const totalImpressions = allEvents.reduce((sum, e) => sum + (e.impressions?.totalViews || 0), 0);
          const totalUniqueVisitors = allEvents.reduce((sum, e) => sum + (e.impressions?.uniqueVisitors || 0), 0);
          const totalClicks = allEvents.reduce((sum, e) => sum + (e.clickStats?.totalClicks || 0), 0);
          const totalUniqueClickers = allEvents.reduce((sum, e) => sum + (e.clickStats?.uniqueClickers || 0), 0);
          // Aggregate click breakdown by platform across all events
          const clicksByPlatformAgg: Record<string, { clicks: number; uniqueClickers: number }> = {};
          for (const e of allEvents) {
            for (const link of e.clickStats?.byLink || []) {
              const platform = detectPlatform(link.url);
              if (!clicksByPlatformAgg[platform]) clicksByPlatformAgg[platform] = { clicks: 0, uniqueClickers: 0 };
              clicksByPlatformAgg[platform].clicks += link.clicks;
              clicksByPlatformAgg[platform].uniqueClickers += link.uniqueClickers;
            }
          }
          const isSwc = dashboardData?.tag === 'swc';
          const withVenue = allEvents.filter(e => e.progress?.hasVenue).length;
          const withBudget = allEvents.filter(e => e.progress?.hasBudget).length;
          const venueRate = allEvents.length > 0 ? Math.round((withVenue / allEvents.length) * 100) : 0;
          const budgetRate = allEvents.length > 0 ? Math.round((withBudget / allEvents.length) * 100) : 0;
          return (
            <div className="mb-6 space-y-3">
              <div className={`grid grid-cols-2 gap-3 ${isSwc ? 'md:grid-cols-3 lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
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
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/20 text-cyan-400"><Eye size={16} /></div>
                    <span className="text-xs text-theme-text-muted uppercase tracking-wider">Impressions</span>
                  </div>
                  <div className="text-2xl font-bold text-theme-text">{totalImpressions.toLocaleString()}</div>
                  <div className="text-xs text-theme-text-muted mt-1">{totalUniqueVisitors.toLocaleString()} unique</div>
                </div>
                <div className="bg-theme-card border border-theme-stroke rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-500/20 text-green-400"><MousePointerClick size={16} /></div>
                    <span className="text-xs text-theme-text-muted uppercase tracking-wider">Partner Link Clicks</span>
                  </div>
                  <div className="text-2xl font-bold text-theme-text">{totalClicks.toLocaleString()}</div>
                  <div className="text-xs text-theme-text-muted mt-1">{totalUniqueClickers.toLocaleString()} unique</div>
                  {Object.keys(clicksByPlatformAgg).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {Object.entries(clicksByPlatformAgg)
                        .sort((a, b) => b[1].clicks - a[1].clicks)
                        .map(([platform, data]) => (
                        <span
                          key={platform}
                          className="inline-flex items-center gap-1 text-xs text-theme-text-muted"
                          title={`${platform}: ${data.clicks} clicks (${data.uniqueClickers} unique)`}
                        >
                          <PlatformIcon platform={platform} size={14} />
                          <span className="font-semibold text-theme-text">{data.clicks}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {isSwc && (
                  <>
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
                  </>
                )}
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
                cityChats={cityChats}
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
  cityChats: Map<string, string>;
}

function EventCard({ event, onToggleChecklist, cityChats }: EventCardProps) {
  // Filter co-hosts to show only visible ones
  const visibleCoHosts = event.coHosts.filter((h: CoHost) => h.showOnEvent !== false);

  // One Sheet copy state
  const [oneSheetCopied, setOneSheetCopied] = useState(false);

  // Photo state
  const [photosExpanded, setPhotosExpanded] = useState(false);
  const [displayPhotos, setDisplayPhotos] = useState<DisplayPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [showAllPhotos, setShowAllPhotos] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [gppCount, setGppCount] = useState(0);

  useEffect(() => {
    const cityName = event.name.replace(/^Global Pizza Party\s*/i, '').trim();
    if (!cityName) return;
    getGppPhotoCounts().then(counts => {
      const key = cityName.toLowerCase().replace(/\s+/g, '');
      setGppCount(counts[key] || 0);
    });
  }, [event.name]);

  const loadPhotos = useCallback(async () => {
    if (displayPhotos.length > 0 || !event.id) return;
    setPhotosLoading(true);
    try {
      const cityName = event.name.replace(/^Global Pizza Party\s*/i, '').trim();

      const [uploadedResult, gppPhotos] = await Promise.all([
        getPartyPhotos(event.id),
        cityName ? getGppPhotosForCity(cityName) : Promise.resolve([]),
      ]);

      const uploaded: DisplayPhoto[] = (uploadedResult?.photos || []).map((p: any) => ({
        id: p.id,
        url: p.url,
        thumbnailUrl: p.thumbnailUrl,
        caption: p.caption,
        source: 'uploaded' as const,
      }));

      const gpp: DisplayPhoto[] = gppPhotos.map((p: any, i: number) => ({
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
  }, [event.id, event.name, displayPhotos.length]);

  const togglePhotos = useCallback(() => {
    const next = !photosExpanded;
    setPhotosExpanded(next);
    if (next) loadPhotos();
  }, [photosExpanded, loadPhotos]);

  // Notes state with debounced auto-save
  const [notes, setNotes] = useState(event.partnerNotes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef(event.partnerNotes || '');

  const saveNotes = useCallback(async (value: string) => {
    if (value === lastSavedRef.current) return;
    setSavingNotes(true);
    try {
      await updatePartnerEventNote(event.id, value);
      lastSavedRef.current = value;
    } catch {
      // Revert on failure
      setNotes(lastSavedRef.current);
    }
    setSavingNotes(false);
  }, [event.id]);

  const handleNotesChange = useCallback((value: string) => {
    setNotes(value);
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveNotes(value);
    }, 800);
  }, [saveNotes]);

  const handleModalClose = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    saveNotes(notes);
    setNotesModalOpen(false);
  }, [notes, saveNotes]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="bg-theme-card border border-theme-stroke rounded-2xl overflow-hidden flex flex-col md:flex-row hover:border-theme-stroke-hover transition-colors">
      {/* Flyer image — banner on mobile, left column on desktop */}
      {event.eventImageUrl && (
        <div className="md:w-44 flex-shrink-0 self-stretch bg-black/40 flex items-center justify-center">
          <img
            src={cdnUrl(event.eventImageUrl)}
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
            <h2 className="text-base font-semibold truncate">
              <a
                href={`/${event.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-theme-text hover:text-theme-text-secondary transition-colors"
                title="View event page"
              >
                {event.name}
              </a>
            </h2>
            {event.hostName && (
              <p className="text-xs text-theme-text-muted">Hosted by {event.hostName}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {(() => {
              const telegramLink = event.telegramGroup || resolveCityChat(event.name, cityChats);
              return telegramLink ? (
                <a
                  href={telegramLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#29B6F6] hover:text-[#4FC3F7] border border-[#29B6F6]/30 hover:border-[#29B6F6]/50 rounded-md transition-colors"
                  title="Join city Telegram group"
                >
                  <MessageCircle size={12} />
                  Telegram
                </a>
              ) : null;
            })()}
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
            <button
              onClick={() => {
                navigator.clipboard.writeText(`https://rsv.pizza/onesheet/${event.slug}`);
                setOneSheetCopied(true);
                setTimeout(() => setOneSheetCopied(false), 2000);
              }}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-theme-text-muted hover:text-theme-text-secondary border border-theme-stroke hover:border-theme-stroke-hover rounded-md transition-colors"
              title="Copy One Sheet link"
            >
              <Link2 size={12} />
              {oneSheetCopied ? 'Copied!' : 'One Sheet'}
            </button>
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
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <Users size={14} className="text-theme-text-muted" />
              <span className="text-lg font-bold text-theme-text">{event.rsvpCount}</span>
              <span className="text-xs text-theme-text-muted">RSVPs</span>
            </div>
            {(event.photoCount + gppCount > 0) && (
              <button
                onClick={togglePhotos}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-theme-stroke hover:border-theme-stroke-hover text-theme-text-muted hover:text-theme-text-secondary cursor-pointer transition-colors"
              >
                <Camera size={14} />
                <span className="text-sm font-medium">{event.photoCount + gppCount}</span>
                <span className="text-xs">Photos</span>
              </button>
            )}
            {event.expectedGuests != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-theme-text-faint">/</span>
                <span className="text-lg font-bold text-theme-text">{event.expectedGuests}</span>
                <span className="text-xs text-theme-text-muted">expected</span>
              </div>
            )}
            {event.impressions && event.impressions.totalViews > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-theme-text-muted">
                <Eye size={12} />
                <span>{event.impressions.totalViews.toLocaleString()} views</span>
                <span className="text-theme-text-muted/50">({event.impressions.uniqueVisitors.toLocaleString()} unique)</span>
              </div>
            )}
            {event.clickStats && event.clickStats.totalClicks > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-theme-text-muted flex-wrap">
                <MousePointerClick size={12} />
                <span>{event.clickStats.totalClicks} clicks</span>
                {event.clickStats.uniqueClickers > 0 && (
                  <span className="text-theme-text-muted/50">({event.clickStats.uniqueClickers} unique)</span>
                )}
                {event.clickStats.byLink && event.clickStats.byLink.length > 0 && (
                  <span className="flex items-center gap-1.5 flex-wrap">
                    {(() => {
                      const platformCounts: Record<string, number> = {};
                      for (const link of event.clickStats.byLink!) {
                        const p = detectPlatform(link.url);
                        platformCounts[p] = (platformCounts[p] || 0) + link.clicks;
                      }
                      return Object.entries(platformCounts)
                        .sort((a, b) => b[1] - a[1])
                        .map(([platform, clicks]) => (
                          <span
                            key={platform}
                            className="inline-flex items-center gap-0.5 text-theme-text-muted"
                            title={`${platform}: ${clicks}`}
                          >
                            <PlatformIcon platform={platform} size={11} />
                            <span className="font-semibold text-[10px]">{clicks}</span>
                          </span>
                        ));
                    })()}
                  </span>
                )}
              </div>
            )}
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
                    <img src={cdnUrl(host.avatar_url)} alt="" className="w-3.5 h-3.5 rounded-full" />
                  )}
                  {host.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Private notes — clickable pill that opens modal */}
        <button
          onClick={() => setNotesModalOpen(true)}
          className="mt-2 flex items-center gap-1.5 text-xs text-theme-text-muted hover:text-theme-text-secondary transition-colors truncate max-w-full text-left"
          title={notes || 'Add private notes'}
        >
          <StickyNote size={12} className="flex-shrink-0" />
          {savingNotes ? (
            <Loader2 size={12} className="animate-spin flex-shrink-0" />
          ) : (
            <span className="truncate">{notes || 'Private notes for this event...'}</span>
          )}
        </button>

        {/* Expandable photo grid */}
        {photosExpanded && (
          <div className="mt-3 pt-3 border-t border-theme-stroke/50">
            {photosLoading ? (
              <div className="flex items-center gap-2 py-3">
                <div className="animate-spin w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full" />
                <span className="text-xs text-theme-text-muted">Loading photos...</span>
              </div>
            ) : displayPhotos.length === 0 ? (
              <p className="text-xs text-theme-text-faint py-2">No photos found</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-1.5">
                  {(showAllPhotos ? displayPhotos : displayPhotos.slice(0, 12)).map((photo, idx) => (
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
                {!showAllPhotos && displayPhotos.length > 12 && (
                  <button
                    onClick={() => setShowAllPhotos(true)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Show all {displayPhotos.length} photos
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Photo lightbox */}
        {lightboxIndex !== null && (showAllPhotos ? displayPhotos : displayPhotos.slice(0, 12))[lightboxIndex] && createPortal(
          <PhotoLightbox
            photos={showAllPhotos ? displayPhotos : displayPhotos.slice(0, 12)}
            currentIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onNavigate={setLightboxIndex}
          />,
          document.body
        )}
      </div>{/* closes flex-1 wrapper */}

      {/* Notes modal */}
      {notesModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={handleModalClose}
        >
          <div
            className="bg-theme-card border border-theme-stroke rounded-2xl p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-theme-text flex items-center gap-2">
                <StickyNote size={16} />
                Notes — {event.name}
              </h3>
              {savingNotes && <Loader2 size={14} className="animate-spin text-theme-text-muted" />}
            </div>
            <IconInput
              icon={StickyNote}
              multiline
              rows={5}
              placeholder="Private notes for this event..."
              value={notes}
              onChange={(e) => handleNotesChange((e.target as HTMLTextAreaElement).value)}
              autoFocus
            />
            <div className="flex justify-end mt-4">
              <button
                onClick={handleModalClose}
                className="px-4 py-1.5 text-sm font-medium text-white bg-[#E52828] rounded-lg hover:bg-[#CC2020] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
