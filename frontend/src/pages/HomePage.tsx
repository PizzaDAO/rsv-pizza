import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Layout } from '../components/Layout';
import { EventForm } from '../components/EventForm';
import { useAuth } from '../contexts/AuthContext';
import { Calendar, Loader2, Users, Plus, MapPin, Crown } from 'lucide-react';
import { fetchMyEvents } from '../lib/api';

export function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useTranslation('account');

  const [eventFilter, setEventFilter] = useState<'upcoming' | 'past'>('upcoming');

  // Fetch all user events in a single API call with React Query caching
  const { data: userParties = [], isLoading: partiesLoading } = useQuery({
    queryKey: ['my-events'],
    queryFn: fetchMyEvents,
    enabled: !!user,
    staleTime: 30_000, // 30 seconds - instant back-navigation
  });

  // Format party date for display
  const formatPartyDate = (dateStr: string | null) => {
    if (!dateStr) return t('home.dateTbd');
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  // Show loading state while auth is loading
  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 size={32} className="animate-spin text-theme-text-secondary" />
        </div>
      </Layout>
    );
  }

  // If user is signed in and has parties, show parties list
  if (user && (userParties.length > 0 || partiesLoading)) {
    return (
      <Layout>
        <Link to="/gpp" className="block bg-gradient-to-r from-[#ff393a] to-[#ff5a5b] text-white text-center py-3 px-4 text-sm font-medium hover:opacity-90 transition-opacity">
          {t('home.gppBanner')}
        </Link>
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-theme-text mb-2">{t('home.yourEvents')}</h1>
            <p className="text-theme-text-secondary">{t('home.eventsSubtitle')}</p>
          </div>

          {/* Upcoming/Past Toggle + Create Party Button */}
          <div className="flex items-center justify-between mb-6">
            <div className="inline-flex bg-theme-surface border border-theme-stroke rounded-xl p-1">
              <button
                type="button"
                onClick={() => setEventFilter('upcoming')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  eventFilter === 'upcoming'
                    ? 'bg-white text-black'
                    : 'text-theme-text-secondary hover:text-theme-text'
                }`}
              >
                {t('home.upcoming')}
              </button>
              <button
                type="button"
                onClick={() => setEventFilter('past')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  eventFilter === 'past'
                    ? 'bg-white text-black'
                    : 'text-theme-text-secondary hover:text-theme-text'
                }`}
              >
                {t('home.past')}
              </button>
            </div>
            <Link
              to="/new"
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={18} />
              {t('home.createParty')}
            </Link>
          </div>

          {partiesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={32} className="animate-spin text-theme-text-secondary" />
            </div>
          ) : (
            <div className="space-y-3 mb-8">
              {(() => {
                const now = new Date();
                const filteredParties = userParties.filter(party => {
                  const partyDate = party.date ? new Date(party.date) : null;
                  if (eventFilter === 'upcoming') {
                    return !partyDate || partyDate >= now;
                  } else {
                    return partyDate && partyDate < now;
                  }
                });

                if (filteredParties.length === 0) {
                  return (
                    <div className="text-center py-8 text-theme-text-muted">
                      {t('home.noEvents', { filter: eventFilter === 'upcoming' ? t('home.upcoming').toLowerCase() : t('home.past').toLowerCase() })}
                    </div>
                  );
                }

                return filteredParties.map(party => (
                <Link
                  key={party.id}
                  to={party.role === 'host' ? `/host/${party.inviteCode}` : `/${party.inviteCode}`}
                  className="block card p-4 hover:bg-theme-surface-hover transition-colors"
                >
                  <div className="flex items-start gap-4">
                    {/* Event Image or Placeholder */}
                    {party.eventImageUrl ? (
                      <img
                        src={party.eventImageUrl}
                        alt={party.name}
                        className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#ff393a]/20 to-[#ff5a5b]/20 border border-theme-stroke flex items-center justify-center flex-shrink-0">
                        <Calendar size={24} className="text-theme-text-muted" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-theme-text truncate">{party.name}</h3>
                        {party.role === 'host' && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-[#ff393a]/20 border border-[#ff393a]/30 rounded-full text-xs text-[#ff393a] flex-shrink-0">
                            <Crown size={10} />
                            {t('home.host')}
                          </span>
                        )}
                        {/* porchetta-81402: cancelled pill — hosts see this on
                            their own cancelled events so they can recognize
                            them at a glance and reinstate from the dashboard
                            if it was an accident. */}
                        {party.cancelledAt && (
                          <span className="px-2 py-0.5 bg-[#ff393a]/15 border border-[#ff393a]/30 rounded-full text-xs text-[#ff393a] flex-shrink-0">
                            {t('home.cancelled')}
                          </span>
                        )}
                      </div>

                      <p className="text-sm text-theme-text-secondary mb-1">
                        {formatPartyDate(party.date)}
                      </p>

                      <div className="flex items-center gap-4 text-xs text-theme-text-muted">
                        {party.address && (
                          <span className="flex items-center gap-1 truncate">
                            <MapPin size={12} />
                            {party.address.split(',')[0]}
                          </span>
                        )}
                        {party.guestCount !== undefined && (
                          <span className="flex items-center gap-1">
                            <Users size={12} />
                            {t('home.guest', { count: party.guestCount })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ));
              })()}
            </div>
          )}
        </div>
      </Layout>
    );
  }

  // Default: Show event creation form (for non-signed-in users or users with no parties)
  return (
    <Layout>
      <Link to="/gpp" className="block bg-gradient-to-r from-[#ff393a] to-[#ff5a5b] text-white text-center py-3 px-4 text-sm font-medium hover:opacity-90 transition-opacity">
        Planning a Global Pizza Party? Create it at rsv.pizza/gpp
      </Link>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="card p-8">
          <EventForm />
        </div>

      </div>
    </Layout>
  );
}
