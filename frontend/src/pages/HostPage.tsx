import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, AlertCircle, Settings, Pizza, Users } from 'lucide-react';
import { PizzaProvider, usePizza } from '../contexts/PizzaContext';
import { Layout } from '../components/Layout';
import { PartyHeader } from '../components/PartyHeader';
import { GuestList } from '../components/GuestList';
import { PizzaOrderSummary } from '../components/PizzaOrderSummary';
import { BeverageSettings } from '../components/BeverageSettings';
import { GuestPreferencesList } from '../components/GuestPreferencesList';
import { EventDetailsTab } from '../components/EventDetailsTab';
import { PizzaStyleAndToppings } from '../components/PizzaStyleAndToppings';

type TabType = 'details' | 'pizza' | 'guests';

function HostPageContent() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { loadParty, party, partyLoading, guests, generateRecommendations, orderExpectedGuests, setOrderExpectedGuests } = usePizza();
  const [error, setError] = useState<string | null>(null);
  const [loadedCode, setLoadedCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('details');

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

  // Count guests with requests for slider marks
  const guestsWithRequests = useMemo(() => {
    return guests.filter(g =>
      g.toppings.length > 0 ||
      g.dislikedToppings.length > 0 ||
      g.dietaryRestrictions.length > 0 ||
      (g.likedBeverages && g.likedBeverages.length > 0) ||
      (g.dislikedBeverages && g.dislikedBeverages.length > 0)
    ).length;
  }, [guests]);

  // Track previous values for auto-regeneration
  const prevExpectedGuests = useRef<number | null>(null);
  const prevGuestsWithRequests = useRef<number>(0);
  const hasInitialized = useRef(false);

  // Auto-generate recommendations when expected guests or requests change
  useEffect(() => {
    // Skip if party hasn't loaded yet or no guests
    if (!party || guests.length === 0) return;

    const currentExpected = orderExpectedGuests ?? party?.maxGuests ?? guests.length;

    // On first load, generate recommendations
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      prevExpectedGuests.current = currentExpected;
      prevGuestsWithRequests.current = guestsWithRequests;
      generateRecommendations();
      return;
    }

    // Regenerate if expected guests changed
    if (prevExpectedGuests.current !== currentExpected) {
      prevExpectedGuests.current = currentExpected;
      generateRecommendations();
      return;
    }

    // Regenerate if new requests came in
    if (prevGuestsWithRequests.current !== guestsWithRequests) {
      prevGuestsWithRequests.current = guestsWithRequests;
      generateRecommendations();
    }
  }, [party, guests.length, orderExpectedGuests, guestsWithRequests, generateRecommendations]);

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
                {/* Expected Guests Slider - at top */}
                <div className="card p-4 bg-[#1a1a2e] border-white/10">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="text-sm font-medium text-white">Expected Guests</span>
                      <p className="text-xs text-white/50 mt-0.5">Adjust for non-respondents</p>
                    </div>
                    <input
                      type="number"
                      min="0"
                      value={orderExpectedGuests ?? party?.maxGuests ?? guests.length}
                      onChange={(e) => {
                        const value = e.target.value ? parseInt(e.target.value, 10) : null;
                        setOrderExpectedGuests(value);
                      }}
                      className="w-20 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-center focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                    />
                  </div>

                  {/* Slider with marks */}
                  {(() => {
                    const currentValue = orderExpectedGuests ?? party?.maxGuests ?? guests.length;
                    const minValue = 0;
                    // Scale max dynamically based on data - use smaller max for low guest counts
                    const baseMax = Math.max(guestsWithRequests, guests.length, currentValue);
                    const maxValue = Math.max(baseMax + 10, Math.ceil(baseMax * 1.5));
                    const requestsPercent = ((guestsWithRequests - minValue) / (maxValue - minValue)) * 100;
                    const rsvpsPercent = ((guests.length - minValue) / (maxValue - minValue)) * 100;

                    return (
                      <div className="relative pt-6 pb-2">
                        {/* Marks */}
                        {guestsWithRequests > 0 && (
                          <div
                            className="absolute top-0 flex flex-col items-center"
                            style={{ left: `${requestsPercent}%`, transform: 'translateX(-50%)' }}
                          >
                            <span className="text-[10px] text-[#ff393a] font-medium whitespace-nowrap">
                              {guestsWithRequests} requests
                            </span>
                            <div className="w-0.5 h-2 bg-[#ff393a]/50 mt-0.5" />
                          </div>
                        )}
                        {guests.length > 0 && guests.length !== guestsWithRequests && (
                          <div
                            className="absolute top-0 flex flex-col items-center"
                            style={{ left: `${rsvpsPercent}%`, transform: 'translateX(-50%)' }}
                          >
                            <span className="text-[10px] text-white/60 font-medium whitespace-nowrap">
                              {guests.length} RSVPs
                            </span>
                            <div className="w-0.5 h-2 bg-white/30 mt-0.5" />
                          </div>
                        )}

                        {/* Slider track */}
                        <input
                          type="range"
                          min={minValue}
                          max={maxValue}
                          value={currentValue}
                          onChange={(e) => setOrderExpectedGuests(parseInt(e.target.value, 10))}
                          className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#ff393a]"
                          style={{
                            background: `linear-gradient(to right, #ff393a 0%, #ff393a ${((currentValue - minValue) / (maxValue - minValue)) * 100}%, rgba(255,255,255,0.1) ${((currentValue - minValue) / (maxValue - minValue)) * 100}%, rgba(255,255,255,0.1) 100%)`
                          }}
                        />

                        {/* Min/Max labels */}
                        <div className="flex justify-between mt-1">
                          <span className="text-[10px] text-white/40">{minValue}</span>
                          <span className="text-[10px] text-white/40">{maxValue}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Recommended Order - always shown, auto-generated */}
                <PizzaOrderSummary />

                <GuestPreferencesList />
                <PizzaStyleAndToppings />
                <BeverageSettings />
              </>
            )}

            {activeTab === 'details' && (
              <EventDetailsTab />
            )}
          </div>
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
