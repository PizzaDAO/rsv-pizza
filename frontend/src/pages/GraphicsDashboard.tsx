import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { LoginModal } from '../components/LoginModal';
import { IconInput } from '../components/IconInput';
import { useAuth } from '../contexts/AuthContext';
import { fetchUnderbossMe, fetchUnderbossDashboard } from '../lib/api';
import type { UnderbossMeResponse } from '../lib/api';
import {
  Loader2, Shield, Image, ExternalLink, Search, AlertTriangle,
} from 'lucide-react';
import type { UnderbossEvent } from '../types';
import { GPP_REGIONS } from '../types';
import { renderFlyer, uses12Hour, formatFlyerTime } from '../components/flyer/renderFlyer';
import { getDateTimeInTimezone } from '../utils/dateUtils';
import { uploadEventImage, updateParty } from '../lib/supabase';

export function GraphicsDashboard() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meData, setMeData] = useState<UnderbossMeResponse | null>(null);
  const [events, setEvents] = useState<UnderbossEvent[]>([]);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [staleFilter, setStaleFilter] = useState(false);

  // Mass generation state
  const [massGenerating, setMassGenerating] = useState(false);
  const [massProgress, setMassProgress] = useState({ current: 0, total: 0 });

  const loadDashboard = useCallback(async () => {
    try {
      const me = await fetchUnderbossMe();
      setMeData(me);
      if (!me.isUnderboss && !me.isAdmin && !me.isGraphicsAdmin) {
        setLoading(false);
        return;
      }
      const data = await fetchUnderbossDashboard('all');
      setEvents(data.events);
    } catch (err: any) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    loadDashboard();
  }, [user, authLoading, loadDashboard]);

  const filtered = useMemo(() => {
    let list = events;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(e =>
        e.name.toLowerCase().includes(q) ||
        (e.host.name && e.host.name.toLowerCase().includes(q)) ||
        (e.address && e.address.toLowerCase().includes(q))
      );
    }

    if (regionFilter !== 'all') {
      list = list.filter(e => e.region === regionFilter);
    }

    if (staleFilter) {
      list = list.filter(e => e.flyerStale);
    }

    return [...list].sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [events, searchQuery, regionFilter, staleFilter]);

  const missingFlyerCount = useMemo(() => {
    return filtered.filter(e => !e.eventImageUrl).length;
  }, [filtered]);

  const handleMassGenerate = async () => {
    const missing = filtered.filter(e => !e.eventImageUrl);
    if (missing.length === 0) return;

    setMassGenerating(true);
    setMassProgress({ current: 0, total: missing.length });

    // Load fonts first
    try {
      const display = new FontFace('Hub 191 Display', 'url(/fonts/Hub-191-Display.otf)');
      const regular = new FontFace('Hub 191', 'url(/fonts/Hub-191-Regular.otf)');
      const [disp, reg] = await Promise.all([display.load(), regular.load()]);
      document.fonts.add(disp);
      document.fonts.add(reg);
    } catch {
      // Continue with fallback fonts
    }

    for (let i = 0; i < missing.length; i++) {
      const event = missing[i];
      setMassProgress({ current: i + 1, total: missing.length });

      try {
        const city = event.name.replace(/^Global Pizza Party\s*/i, '').trim() || event.name;
        const venueName = event.venueName || 'LOCATION TBA';
        const streetAddress = event.address ? event.address.split(',')[0].trim() : '';

        // Parse date/time
        let dateDisplay = '';
        let timeDisplay = '';
        let is12h = false;
        if (event.date) {
          const tz = event.timezone || 'UTC';
          is12h = uses12Hour(tz);
          const start = getDateTimeInTimezone(event.date, tz);
          const startFormatted = formatFlyerTime(start.timeStr, is12h);
          timeDisplay = startFormatted;
          if (event.duration) {
            const endDate = new Date(new Date(event.date).getTime() + event.duration * 3600000);
            const end = getDateTimeInTimezone(endDate, tz);
            const endFormatted = formatFlyerTime(end.timeStr, is12h);
            timeDisplay = `${startFormatted} - ${endFormatted}`;
          }
          // Derive "MAY 22" style date
          const eventDate = new Date(event.date);
          const monthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short' });
          const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' });
          const monthStr = monthFormatter.format(eventDate).toUpperCase();
          const dayStr = dayFormatter.format(eventDate);
          dateDisplay = `${monthStr} ${dayStr}`;
        }

        const canvas = await renderFlyer({
          city,
          venueName,
          streetAddress,
          dateDisplay,
          timeDisplay,
          is12h,
          sponsors: [],
        });

        const blob = await new Promise<Blob | null>(resolve =>
          canvas.toBlob(b => resolve(b), 'image/png')
        );
        if (!blob) continue;

        const file = new File([blob], `gpp-flyer-${event.customUrl || event.id}.png`, { type: 'image/png' });
        const uploadedUrl = await uploadEventImage(file);
        if (!uploadedUrl) continue;

        await updateParty(event.id, {
          event_image_url: uploadedUrl,
          flyer_generated_at: new Date().toISOString(),
        });

        // Update local state to reflect the change
        setEvents(prev => prev.map(e =>
          e.id === event.id
            ? { ...e, eventImageUrl: uploadedUrl, flyerGeneratedAt: new Date().toISOString(), flyerStale: false }
            : e
        ));
      } catch (err) {
        console.error(`Failed to generate flyer for ${event.name}:`, err);
      }
    }

    setMassGenerating(false);
  };

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

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a]">
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-white/20 mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Graphics Dashboard</h1>
          <p className="text-white/50 text-center max-w-md mb-6">
            Log in to review event flyers.
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

  if (error || (!meData?.isUnderboss && !meData?.isAdmin)) {
    return (
      <div className="min-h-screen bg-[#0a0a0a]">
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-white/20 mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">
            {error ? 'Error' : 'Access Denied'}
          </h1>
          <p className="text-white/50 text-center max-w-md">
            {error || 'You need underboss or admin access to view this page.'}
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Helmet>
        <title>Graphics Dashboard | RSV.Pizza</title>
      </Helmet>

      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-[#ff393a]/20 flex items-center justify-center">
              <Image size={20} className="text-[#ff393a]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Graphics Dashboard</h1>
              <p className="text-sm text-white/50">
                {events.length} events
                {filtered.length !== events.length && ` \u2022 showing ${filtered.length}`}
              </p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="max-w-xs flex-1">
            <IconInput
              icon={Search}
              type="search"
              placeholder="Search events, hosts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
            />
          </div>

          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/70 focus:outline-none focus:border-white/20"
          >
            <option value="all">Region: All</option>
            {GPP_REGIONS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>

          <button
            onClick={() => setStaleFilter(prev => !prev)}
            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
              staleFilter ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-white/[0.03] text-white/50 border border-white/10'
            }`}
          >
            <AlertTriangle size={14} className="inline mr-1.5 -mt-0.5" />
            Stale flyers
          </button>

          <button
            onClick={handleMassGenerate}
            disabled={massGenerating || missingFlyerCount === 0}
            className="px-3 py-2 rounded-lg text-sm bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {massGenerating
              ? `Generating ${massProgress.current}/${massProgress.total}...`
              : `Generate Missing (${missingFlyerCount})`
            }
          </button>
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Image size={48} className="text-white/10 mx-auto mb-4" />
            <p className="text-white/40">No events match your filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filtered.map(event => (
              <div
                key={event.id}
                className="group bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden hover:border-white/15 transition-colors"
              >
                {/* Flyer image */}
                <div className="aspect-square relative overflow-hidden bg-black/40">
                  {event.eventImageUrl ? (
                    <img
                      src={event.eventImageUrl}
                      alt={event.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Image size={32} className="text-white/10" />
                    </div>
                  )}
                  {/* Stale flyer badge */}
                  {event.flyerStale && (
                    <div className="absolute top-2 right-2 bg-amber-500 text-black text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <AlertTriangle size={10} />
                      New partners
                    </div>
                  )}
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <a
                      href={`/${event.customUrl || event.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors"
                      title="View event"
                    >
                      <ExternalLink size={16} className="text-white" />
                    </a>
                  </div>
                </div>

                {/* Title */}
                <div className="px-3 py-2">
                  <p className="text-sm text-white font-medium truncate" title={event.name}>
                    {event.name}
                  </p>
                  {event.host.name && (
                    <p className="text-xs text-white/40 truncate">{event.host.name}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
