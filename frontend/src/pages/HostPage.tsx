import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, AlertCircle, Settings, Pizza, Users, MapPin, Star, Trophy } from 'lucide-react';
import { PizzaProvider, usePizza } from '../contexts/PizzaContext';
import { Layout } from '../components/Layout';
import { PartyHeader } from '../components/PartyHeader';
import { GuestList } from '../components/GuestList';
import { PizzaOrderSummary } from '../components/PizzaOrderSummary';
import { BeverageSettings } from '../components/BeverageSettings';
import { GuestPreferencesList } from '../components/GuestPreferencesList';
import { EventDetailsTab } from '../components/EventDetailsTab';
import { PizzeriaSearch } from '../components/PizzeriaSearch';
import { PizzaStyleAndToppings } from '../components/PizzaStyleAndToppings';
import { Pizzeria } from '../types';
import { searchPizzerias, geocodeAddress } from '../lib/ordering';

type TabType = 'details' | 'pizza' | 'guests';

function HostPageContent() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { loadParty, party, partyLoading, guests, generateRecommendations, orderExpectedGuests, setOrderExpectedGuests } = usePizza();
  const [error, setError] = useState<string | null>(null);
  const [loadedCode, setLoadedCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [nearbyPizzerias, setNearbyPizzerias] = useState<Pizzeria[]>([]);

  useEffect(() => {
    async function load() {
      if (inviteCode && inviteCode !== loadedCode) {
        setError(null);
        setLoadedCode(inviteCode);
        const success = await loadParty(inviteCode);
        if (!success) {
          setError('Party not found. The link may be invalid or expired.');
        }
      }
    }
    load();
  }, [inviteCode, loadParty, loadedCode]);

  // Fetch nearby pizzerias for ranking display
  useEffect(() => {
    async function fetchPizzerias() {
      if (!party?.address) return;
      try {
        const location = await geocodeAddress(party.address);
        if (location) {
          const results = await searchPizzerias(location.lat, location.lng);
          setNearbyPizzerias(results.slice(0, 3)); // Same as RSVP page shows
        }
      } catch (err) {
        console.error('Failed to fetch pizzerias:', err);
      }
    }
    fetchPizzerias();
  }, [party?.address]);

  // Compute pizzeria rankings from guest votes
  const pizzeriaRankings = React.useMemo(() => {
    const rankings: Record<string, { first: number; second: number; third: number }> = {};

    guests.forEach(guest => {
      if (guest.pizzeriaRankings && guest.pizzeriaRankings.length > 0) {
        guest.pizzeriaRankings.forEach((pizzeriaId, index) => {
          if (!rankings[pizzeriaId]) {
            rankings[pizzeriaId] = { first: 0, second: 0, third: 0 };
          }
          if (index === 0) rankings[pizzeriaId].first++;
          else if (index === 1) rankings[pizzeriaId].second++;
          else if (index === 2) rankings[pizzeriaId].third++;
        });
      }
    });

    // Convert to array and sort by total votes (weighted: 1st=3, 2nd=2, 3rd=1)
    return Object.entries(rankings)
      .map(([id, votes]) => ({
        id,
        ...votes,
        total: votes.first * 3 + votes.second * 2 + votes.third,
        pizzeria: nearbyPizzerias.find(p => p.id === id),
      }))
      .sort((a, b) => b.total - a.total);
  }, [guests, nearbyPizzerias]);

  const hasAnyRankings = pizzeriaRankings.length > 0;

  if (partyLoading || (inviteCode && inviteCode !== loadedCode)) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
        </div>
      </Layout>
    );
  }

  if (error || !party) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center p-4">
          <div className="card p-8 max-w-md text-center">
            <AlertCircle className="w-16 h-16 text-[#ff393a] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-2">Party Not Found</h1>
            <p className="text-white/60 mb-6">{error || 'Unable to load party.'}</p>
            <button onClick={() => navigate('/')} className="btn-primary">
              Go to Home
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  const tabs = [
    { id: 'details' as TabType, label: 'Settings', icon: Settings },
    { id: 'guests' as TabType, label: 'Guests', icon: Users },
    { id: 'pizza' as TabType, label: 'Pizza & Drinks', icon: Pizza },
  ];

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <PartyHeader />

        {/* Tab Navigation */}
        <div className="border-b border-white/10 mb-6 flex gap-8 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-1 pb-3 font-medium text-sm transition-all whitespace-nowrap relative ${activeTab === tab.id
                    ? 'text-white'
                    : 'text-white/40 hover:text-white/60'
                  }`}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 space-y-3">
            {activeTab === 'guests' && (
              <>
                <GuestList />
              </>
            )}

            {activeTab === 'pizza' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="card p-4 flex flex-col items-center justify-center text-center bg-[#1a1a2e] border-white/10">
                    <span className="text-3xl font-bold text-white">{guests.length}</span>
                    <span className="text-xs text-white/50 uppercase tracking-wider font-semibold mt-1">Total Guests RSVP'd</span>
                  </div>
                  <div className="card p-4 flex flex-col items-center justify-center text-center bg-[#1a1a2e] border-white/10">
                    <span className="text-3xl font-bold text-[#ff393a]">
                      {guests.filter(g =>
                        g.toppings.length > 0 ||
                        g.dislikedToppings.length > 0 ||
                        g.dietaryRestrictions.length > 0 ||
                        (g.likedBeverages && g.likedBeverages.length > 0) ||
                        (g.dislikedBeverages && g.dislikedBeverages.length > 0)
                      ).length}
                    </span>
                    <span className="text-xs text-white/50 uppercase tracking-wider font-semibold mt-1">Requests Submitted</span>
                  </div>
                </div>
                <GuestPreferencesList />
                <PizzaStyleAndToppings />
                <BeverageSettings />

                {/* Guest Pizzeria Rankings */}
                {hasAnyRankings && (
                  <div className="card p-6 bg-[#1a1a2e] border-white/10">
                    <div className="flex items-center gap-2 mb-4">
                      <Trophy size={20} className="text-yellow-400" />
                      <h2 className="text-lg font-bold text-white">Guest Pizzeria Rankings</h2>
                    </div>
                    <div className="space-y-3">
                      {pizzeriaRankings.map((ranking, index) => (
                        <div
                          key={ranking.id}
                          className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10"
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                            index === 0 ? 'bg-yellow-400 text-black' :
                            index === 1 ? 'bg-gray-300 text-black' :
                            index === 2 ? 'bg-amber-600 text-white' :
                            'bg-white/10 text-white/60'
                          }`}>
                            {index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-white truncate">
                              {ranking.pizzeria?.name || `Pizzeria ${ranking.id.slice(0, 8)}...`}
                            </h3>
                            {ranking.pizzeria?.rating && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <Star size={12} className="text-yellow-400 fill-yellow-400" />
                                <span className="text-xs text-white/60">{ranking.pizzeria.rating.toFixed(1)}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            {ranking.first > 0 && (
                              <span className="px-2 py-1 bg-yellow-400/20 text-yellow-400 rounded-full">
                                🥇 {ranking.first}
                              </span>
                            )}
                            {ranking.second > 0 && (
                              <span className="px-2 py-1 bg-gray-300/20 text-gray-300 rounded-full">
                                🥈 {ranking.second}
                              </span>
                            )}
                            {ranking.third > 0 && (
                              <span className="px-2 py-1 bg-amber-600/20 text-amber-500 rounded-full">
                                🥉 {ranking.third}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-white/40 mt-3">
                      Based on {guests.filter(g => g.pizzeriaRankings && g.pizzeriaRankings.length > 0).length} guest{guests.filter(g => g.pizzeriaRankings && g.pizzeriaRankings.length > 0).length !== 1 ? 's' : ''} who ranked pizzerias
                    </p>
                  </div>
                )}

                {/* Pizzeria Search Section */}
                {party?.address ? (
                  <PizzeriaSearch
                    partyAddress={party.address}
                    onSelectPizzeria={(pizzeria, option) => {
                      // Open the ordering link
                      if (option.deepLink) {
                        window.open(option.deepLink, '_blank');
                      }
                    }}
                    rankings={pizzeriaRankings}
                  />
                ) : (
                  <div className="card p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <MapPin size={24} className="text-[#ff393a]" />
                      <h2 className="text-xl font-bold text-white">Top Pizzerias Nearby</h2>
                    </div>
                    <div className="text-center py-8">
                      <MapPin size={48} className="mx-auto mb-4 text-white/20" />
                      <p className="text-white/60 mb-4">Set your event location to find nearby pizzerias</p>
                      <button
                        onClick={() => setActiveTab('details')}
                        className="btn-secondary inline-flex items-center gap-2"
                      >
                        <Settings size={16} />
                        Go to Settings
                      </button>
                    </div>
                  </div>
                )}

                {/* Expected Guests Input */}
                <div className="card p-4 bg-[#1a1a2e] border-white/10">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-white">Expected Guests</span>
                      <p className="text-xs text-white/50 mt-0.5">Adjust for non-respondents</p>
                    </div>
                    <input
                      type="number"
                      min="1"
                      value={orderExpectedGuests ?? party?.maxGuests ?? guests.length}
                      onChange={(e) => {
                        const value = e.target.value ? parseInt(e.target.value, 10) : null;
                        setOrderExpectedGuests(value);
                      }}
                      className="w-20 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-center focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                    />
                  </div>
                </div>

                <button
                  onClick={generateRecommendations}
                  disabled={guests.length === 0}
                  className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Order
                </button>
              </>
            )}

            {activeTab === 'details' && (
              <EventDetailsTab />
            )}
          </div>

          {/* Order Summary - Only on Pizza & Drinks Tab */}
          {activeTab === 'pizza' && (
            <div className="xl:col-span-1 space-y-3">
              <PizzaOrderSummary />
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

export function HostPage() {
  return (
    <PizzaProvider>
      <HostPageContent />
    </PizzaProvider>
  );
}
