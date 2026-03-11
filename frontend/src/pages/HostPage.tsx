import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, AlertCircle, Settings, Pizza, Users, Camera, LayoutGrid, Home } from 'lucide-react';
import { PizzaProvider, usePizza } from '../contexts/PizzaContext';
import { useAuth } from '../contexts/AuthContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { Layout } from '../components/Layout';
import { PartyHeader } from '../components/PartyHeader';
import { GuestList } from '../components/GuestList';
import { PizzaOrderSummary } from '../components/PizzaOrderSummary';
import { BeverageSettings } from '../components/BeverageSettings';
import { EventDetailsTab } from '../components/EventDetailsTab';
import { PizzaStyleAndToppings } from '../components/PizzaStyleAndToppings';
import { PizzeriaSelection } from '../components/PizzeriaSelection';
import { AiCallHistory } from '../components/AiCallHistory';
import { DonationSummary } from '../components/DonationSummary';
import { PhotoGallery } from '../components/photos';
import { updateParty } from '../lib/supabase';
import { AppsHub } from '../components/AppsHub';
import { SponsorCRM } from '../components/sponsors';
import { VenueWidget } from '../components/venue';
import { VenueReportWidget } from '../components/venue-report';
import { MusicWidget } from '../components/music';
import { ReportWidget } from '../components/report';
import { StaffingWidget } from '../components/staffing';
import { DisplaysWidget } from '../components/displays';
import { RaffleWidget } from '../components/raffle';
import { BudgetTab } from '../components/budget';
import { ChecklistTab } from '../components/checklist';
import { PartyKitWidget } from '../components/kit';
import { PromoWidget } from '../components/promo';
import { PINNABLE_APPS } from '../lib/appDefinitions';
import { GPPDashboardTab } from '../components/gpp-dashboard';

// Super admin email that can edit any party
const SUPER_ADMIN_EMAIL = 'hello@rarepizzas.com';

type TabType = 'dashboard' | 'details' | 'venue' | 'pizza' | 'guests' | 'photos' | 'sponsors' | 'music' | 'report' | 'staff' | 'displays' | 'raffle' | 'budget' | 'checklist' | 'gpp' | 'promo' | 'apps';

const ALL_VALID_TABS: TabType[] = ['dashboard', 'details', 'venue', 'pizza', 'guests', 'photos', 'sponsors', 'music', 'report', 'staff', 'displays', 'raffle', 'budget', 'checklist', 'gpp', 'promo', 'apps'];

function HostPageContent() {
  const { inviteCode, tab } = useParams<{ inviteCode: string; tab?: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { loadParty, party, partyLoading, guests, generateRecommendations, orderExpectedGuests, setOrderExpectedGuests } = usePizza();
  const [error, setError] = useState<string | null>(null);
  const [loadedCode, setLoadedCode] = useState<string | null>(null);

  const canEdit = useMemo(() => {
    if (!party || !user) return false;
    if (user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return true;
    if (party.userId === user.id) return true;
    if (party.coHosts && Array.isArray(party.coHosts)) {
      const isEditor = party.coHosts.some(
        (h: any) => h.email?.toLowerCase() === user.email.toLowerCase() && h.canEdit === true
      );
      if (isEditor) return true;
    }
    return false;
  }, [party, user]);

  useEffect(() => {
    if (!authLoading && !partyLoading && party && !canEdit) {
      navigate(`/rsvp/${inviteCode}`, { replace: true });
    }
  }, [authLoading, partyLoading, party, canEdit, navigate, inviteCode]);

  const isGPP = party?.eventType === 'gpp';
  const defaultTab: TabType = isGPP ? 'dashboard' : 'details';
  const activeTab: TabType = (tab && ALL_VALID_TABS.includes(tab as TabType)) ? tab as TabType : defaultTab;

  const setActiveTab = (newTab: TabType) => {
    if (newTab === defaultTab) {
      navigate(`/host/${inviteCode}`);
    } else {
      navigate(`/host/${inviteCode}/${newTab}`);
    }
  };

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

  const guestsWithRequests = useMemo(() => {
    return guests.filter(g =>
      g.toppings.length > 0 ||
      g.dislikedToppings.length > 0 ||
      g.dietaryRestrictions.length > 0 ||
      (g.likedBeverages && g.likedBeverages.length > 0) ||
      (g.dislikedBeverages && g.dislikedBeverages.length > 0)
    ).length;
  }, [guests]);

  const prevExpectedGuests = useRef<number | null>(null);
  const prevGuestsWithRequests = useRef<number>(0);
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (!party || guests.length === 0) return;

    const currentExpected = orderExpectedGuests ?? party?.maxGuests ?? guests.length;

    if (!hasInitialized.current) {
      hasInitialized.current = true;
      prevExpectedGuests.current = currentExpected;
      prevGuestsWithRequests.current = guestsWithRequests;
      generateRecommendations();
      return;
    }

    if (prevExpectedGuests.current !== currentExpected) {
      prevExpectedGuests.current = currentExpected;
      generateRecommendations();
      return;
    }

    if (prevGuestsWithRequests.current !== guestsWithRequests) {
      prevGuestsWithRequests.current = guestsWithRequests;
      generateRecommendations();
    }
  }, [party, guests.length, orderExpectedGuests, guestsWithRequests, generateRecommendations]);

  if (authLoading || partyLoading || (inviteCode && inviteCode !== loadedCode)) {
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
            <h1 className="text-2xl font-bold text-theme-text mb-2">Party Not Found</h1>
            <p className="text-theme-text-secondary mb-6">{error || 'Unable to load party.'}</p>
            <button onClick={() => navigate('/')} className="btn-primary">
              Go to Home
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  if (!canEdit) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
        </div>
      </Layout>
    );
  }

  const coreTabs = [
    ...(isGPP ? [{ id: 'dashboard' as TabType, label: 'Dashboard', icon: Home }] : []),
    { id: 'details' as TabType, label: 'Settings', icon: Settings },
    { id: 'guests' as TabType, label: 'Guests', icon: Users },
    { id: 'pizza' as TabType, label: 'Pizza & Drinks', icon: Pizza },
    { id: 'photos' as TabType, label: 'Photos', icon: Camera },
  ];

  // Build pinned tabs from party.pinnedApps
  const pinnedTabs = (party?.pinnedApps ?? []).map(appId => {
    const appDef = PINNABLE_APPS.find(a => a.id === appId);
    if (!appDef) return null;
    return { id: appDef.tab as TabType, label: appDef.name, icon: appDef.icon };
  }).filter((t): t is { id: TabType; label: string; icon: React.ComponentType<{ size?: number; className?: string }> } => t !== null);

  const tabs = [...coreTabs, ...pinnedTabs, { id: 'apps' as TabType, label: 'Apps', icon: LayoutGrid }];

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <PartyHeader />

        <div className="host-tabs border-b border-theme-stroke mb-6 flex gap-8 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-1 pb-3 font-medium text-sm transition-all whitespace-nowrap relative ${activeTab === tab.id
                    ? 'text-theme-text'
                    : 'text-theme-text-muted hover:text-theme-text-secondary'
                  }`}
              >
                <Icon size={18} />
                <span className="hidden sm:inline">{tab.label}</span>
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-theme-text" />
                )}
              </button>
            );
          })}
        </div>

        {activeTab === 'dashboard' && party ? (
          <GPPDashboardTab />
        ) : activeTab === 'apps' && party ? (
          <AppsHub inviteCode={party.inviteCode} pinnedApps={party.pinnedApps ?? []} partyId={party.id} />
        ) : activeTab !== 'apps' && activeTab !== 'dashboard' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 space-y-3">
              {activeTab === 'guests' && (
                <>
                  <GuestList />
                  <DonationSummary />
                </>
              )}

              {activeTab === 'pizza' && (
                <>
                  <div className="card p-4 bg-theme-header border-theme-stroke">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <span className="text-sm font-medium text-theme-text">Expected Guests</span>
                        <p className="text-xs text-theme-text-muted mt-0.5">Adjust for non-respondents</p>
                      </div>
                      <input
                        type="number"
                        min="0"
                        value={orderExpectedGuests ?? party?.maxGuests ?? guests.length}
                        onChange={(e) => {
                          const value = e.target.value ? parseInt(e.target.value, 10) : null;
                          setOrderExpectedGuests(value);
                        }}
                        className="w-20 bg-theme-surface-hover border border-theme-stroke-hover rounded-lg px-3 py-2 text-theme-text text-center focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                      />
                    </div>

                    {(() => {
                      const currentValue = orderExpectedGuests ?? party?.maxGuests ?? guests.length;
                      const minValue = 0;
                      const baseMax = Math.max(guestsWithRequests, guests.length, currentValue);
                      const dynamicMax = Math.max(baseMax + 10, Math.ceil(baseMax * 1.5));
                      const maxCap = guests.length > 0 ? guests.length * 5 : 100;
                      const maxValue = Math.min(dynamicMax, maxCap);
                      const requestsPercent = ((guestsWithRequests - minValue) / (maxValue - minValue)) * 100;
                      const rsvpsPercent = ((guests.length - minValue) / (maxValue - minValue)) * 100;

                      return (
                        <div className="relative pt-6 pb-2">
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
                              <span className="text-[10px] text-theme-text-secondary font-medium whitespace-nowrap">
                                {guests.length} RSVPs
                              </span>
                              <div className="w-0.5 h-2 bg-theme-surface-hover mt-0.5" />
                            </div>
                          )}

                          <input
                            type="range"
                            min={minValue}
                            max={maxValue}
                            value={currentValue}
                            onChange={(e) => setOrderExpectedGuests(parseInt(e.target.value, 10))}
                            className="w-full h-2 bg-theme-surface-hover rounded-lg appearance-none cursor-pointer accent-[#ff393a]"
                            style={{
                              background: `linear-gradient(to right, #ff393a 0%, #ff393a ${((currentValue - minValue) / (maxValue - minValue)) * 100}%, rgba(255,255,255,0.1) ${((currentValue - minValue) / (maxValue - minValue)) * 100}%, rgba(255,255,255,0.1) 100%)`
                            }}
                          />

                          <div className="flex justify-between mt-1">
                            <span className="text-[10px] text-theme-text-muted">{minValue}</span>
                            <span className="text-[10px] text-theme-text-muted">{maxValue}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <PizzaOrderSummary />
                  <AiCallHistory partyId={party.id} />
                  <PizzaStyleAndToppings firstSection={<PizzeriaSelection embedded />} />
                  <BeverageSettings />
                </>
              )}

              {activeTab === 'details' && (
                <EventDetailsTab />
              )}

              {activeTab === 'venue' && party && (
                <>
                  <div className="card p-6">
                    <VenueWidget
                      partyId={party.id}
                      onVenueSelect={() => {
                        if (party?.inviteCode) {
                          loadParty(party.inviteCode);
                        }
                      }}
                    />
                  </div>
                  <div className="card p-6 mt-4">
                    <VenueReportWidget partyId={party.id} />
                  </div>
                </>
              )}

              {activeTab === 'music' && (
                <MusicWidget isHost={true} />
              )}

              {activeTab === 'photos' && party && (
                <div className="card p-6 space-y-4">
                  <PhotoGallery
                    partyId={party.id}
                    isHost={true}
                    uploaderName={user?.name || undefined}
                    uploaderEmail={user?.email}
                    photoModeration={true}
                  />
                </div>
              )}

              {activeTab === 'sponsors' && party && (
                <SponsorCRM partyId={party.id} />
              )}

              {activeTab === 'staff' && party && (
                <StaffingWidget partyId={party.id} />
              )}

              {activeTab === 'report' && party && (
                <ReportWidget partyId={party.id} />
              )}

              {activeTab === 'displays' && party && (
                <DisplaysWidget partyId={party.id} />
              )}

              {activeTab === 'raffle' && party && (
                <RaffleWidget partyId={party.id} />
              )}

              {activeTab === 'budget' && party && (
                <BudgetTab partyId={party.id} />
              )}

              {activeTab === 'checklist' && party && (
                <ChecklistTab partyId={party.id} />
              )}

              {activeTab === 'promo' && (
                <PromoWidget />
              )}

              {activeTab === 'gpp' && party && (
                <div className="space-y-4">
                  <div className="mb-4">
                    <h2 className="text-xl font-semibold text-theme-text">Global Pizza Party</h2>
                    <p className="text-theme-text-secondary text-sm mt-1">
                      Request party kits and access GPP-specific features for your event.
                    </p>
                  </div>
                  <PartyKitWidget partyId={party.id} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function HostPageThemeWrapper() {
  const { party } = usePizza();
  const isGPP = party?.eventType === 'gpp';
  return (
    <ThemeProvider theme={isGPP ? 'gpp' : 'dark'}>
      <HostPageContent />
    </ThemeProvider>
  );
}

export function HostPage() {
  return (
    <PizzaProvider>
      <HostPageThemeWrapper />
    </PizzaProvider>
  );
}
