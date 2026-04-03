import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { LoginModal } from '../components/LoginModal';
import { SponsorChecklist } from '../components/sponsor-dashboard/SponsorChecklist';
import { EventInfoCard } from '../components/sponsor-dashboard/EventInfoCard';
import { BudgetSummary } from '../components/sponsor-dashboard/BudgetSummary';
import { RsvpCounter } from '../components/sponsor-dashboard/RsvpCounter';
import { useAuth } from '../contexts/AuthContext';
import { fetchSponsorMe, fetchSponsorEvents, toggleSponsorChecklistItem } from '../lib/api';
import {
  Loader2, Shield, Tag, ExternalLink, ClipboardList, MapPin, DollarSign, Users,
} from 'lucide-react';
import type { SponsorDashboardEvent, SponsorMeResponse, SponsorDashboardData, CoHost } from '../types';

export function SponsorDashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meData, setMeData] = useState<SponsorMeResponse | null>(null);
  const [dashboardData, setDashboardData] = useState<SponsorDashboardData | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

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

        const data = await fetchSponsorEvents();
        setDashboardData(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load sponsor dashboard');
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, [user, authLoading]);

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

  // Loading state
  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a]">
        <Header />
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-white/40" />
        </div>
        <Footer />
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a]">
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-white/20 mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Sponsor Dashboard</h1>
          <p className="text-white/50 text-center max-w-md mb-6">
            Log in to access your sponsor dashboard.
          </p>
          <button
            onClick={() => setShowLoginModal(true)}
            className="px-6 py-2 bg-[#ff393a] text-white rounded-xl text-sm font-medium hover:bg-[#e62e2f] transition-colors"
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
      <div className="min-h-screen bg-[#0a0a0a]">
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-red-400/60 mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Error</h1>
          <p className="text-white/50 text-center max-w-md">{error}</p>
        </div>
        <Footer />
      </div>
    );
  }

  // Not a sponsor
  if (!meData?.isSponsor) {
    return (
      <div className="min-h-screen bg-[#0a0a0a]">
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-white/20 mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-white/50 text-center max-w-md">
            You do not have sponsor access. Contact an admin to get set up.
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  const sponsor = dashboardData?.sponsor;
  const events = dashboardData?.events || [];

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Helmet>
        <title>Sponsor Dashboard | RSV.Pizza</title>
      </Helmet>

      <Header />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-[#ff393a]/20 flex items-center justify-center">
              <Tag size={20} className="text-[#ff393a]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">
                {sponsor?.name || 'Sponsor'} Dashboard
              </h1>
              <p className="text-sm text-white/50">
                Showing {events.length} event{events.length !== 1 ? 's' : ''} tagged &quot;{sponsor?.tag}&quot;
              </p>
            </div>
          </div>
        </div>

        {/* Events grid */}
        {events.length === 0 ? (
          <div className="text-center py-16">
            <Tag size={48} className="text-white/10 mx-auto mb-4" />
            <p className="text-white/40">No events found with your sponsor tag.</p>
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

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
      {/* Event header */}
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {event.eventImageUrl && (
            <img
              src={event.eventImageUrl}
              alt=""
              className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
            />
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white truncate">{event.name}</h2>
            {event.hostName && (
              <p className="text-xs text-white/40">Hosted by {event.hostName}</p>
            )}
          </div>
        </div>
        <a
          href={`/${event.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 ml-2"
          title="View event page"
        >
          <ExternalLink size={16} />
        </a>
      </div>

      {/* Event body */}
      <div className="px-5 py-4 space-y-5">
        {/* Row 1: Event info + RSVP count */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <EventInfoCard
              date={event.date}
              timezone={event.timezone}
              address={event.address}
              venueName={event.venueName}
            />
          </div>
          <div className="flex items-center">
            <RsvpCounter
              rsvpCount={event.rsvpCount}
              maxGuests={event.maxGuests}
            />
          </div>
        </div>

        {/* Co-hosts */}
        {visibleCoHosts.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Users size={14} className="text-white/40" />
              <span className="text-xs text-white/40 uppercase tracking-wider">Co-hosts</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {visibleCoHosts.map((host: CoHost, i: number) => (
                <span
                  key={host.id || i}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 text-xs text-white/60"
                >
                  {host.avatar_url && (
                    <img src={host.avatar_url} alt="" className="w-4 h-4 rounded-full" />
                  )}
                  {host.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Budget */}
        {event.budget && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <DollarSign size={14} className="text-white/40" />
              <span className="text-xs text-white/40 uppercase tracking-wider">Budget</span>
            </div>
            <BudgetSummary budget={event.budget} />
          </div>
        )}

        {/* Checklist */}
        {event.checklist.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ClipboardList size={14} className="text-white/40" />
              <span className="text-xs text-white/40 uppercase tracking-wider">Checklist</span>
            </div>
            <SponsorChecklist
              items={event.checklist}
              onToggle={onToggleChecklist}
            />
          </div>
        )}
      </div>
    </div>
  );
}
