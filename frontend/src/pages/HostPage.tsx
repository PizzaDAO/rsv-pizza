import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle, Settings, Pizza, Users, Camera, LayoutGrid, Home, Zap } from 'lucide-react';
import { PizzaProvider, usePizza } from '../contexts/PizzaContext';
import { useGuestsRealtime } from '../hooks/useGuestsRealtime';
import { useAuth } from '../contexts/AuthContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { Layout } from '../components/Layout';
import { PartyHeader } from '../components/PartyHeader';
import { GuestList } from '../components/GuestList';
import { PizzaOrderSummary } from '../components/PizzaOrderSummary';
import { BeverageSettings } from '../components/BeverageSettings';
import { DietarySettings } from '../components/DietarySettings';
import { EventDetailsTab } from '../components/EventDetailsTab';
import { PizzaStyleAndToppings } from '../components/PizzaStyleAndToppings';
import { PizzeriaSelection } from '../components/PizzeriaSelection';
import { AiCallHistory } from '../components/AiCallHistory';
import { DonationSummary } from '../components/DonationSummary';
import { PhotoGallery } from '../components/photos';
import { updateParty, proxyAvatarToStorage } from '../lib/supabase';
import { uuid } from '../lib/utils';
import { fetchXAvatarToSupabase } from '../utils/avatarUtils';
import { CoHost } from '../types';
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
import { FlyerTab } from '../components/flyer';
import { PrintTab } from '../components/print';
import { PreviousYearPhotos } from '../components/PreviousYearPhotos';
import { PINNABLE_APPS } from '../lib/appDefinitions';
import { GPPDashboardTab } from '../components/gpp-dashboard';
import { PayoutsTab } from '../components/payouts';
import { DayOfTab } from '../components/day-of';

// Super admin email that can edit any party
const SUPER_ADMIN_EMAIL = 'hello@rarepizzas.com';

type TabType = 'dashboard' | 'day-of' | 'details' | 'venue' | 'pizza' | 'guests' | 'photos' | 'partners' | 'music' | 'report' | 'staff' | 'displays' | 'raffle' | 'budget' | 'checklist' | 'gpp' | 'promo' | 'flyer' | 'print' | 'payouts' | 'apps';

const ALL_VALID_TABS: TabType[] = ['dashboard', 'day-of', 'details', 'venue', 'pizza', 'guests', 'photos', 'partners', 'music', 'report', 'staff', 'displays', 'raffle', 'budget', 'checklist', 'gpp', 'promo', 'flyer', 'print', 'payouts', 'apps'];

function HostPageContent() {
  const { t } = useTranslation('host');
  const { inviteCode, tab } = useParams<{ inviteCode: string; tab?: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { loadParty, party, partyLoading, guests, generateRecommendations, orderExpectedGuests, setOrderExpectedGuests, setGuests, setParty } = usePizza();
  const [error, setError] = useState<string | null>(null);
  const [loadedCode, setLoadedCode] = useState<string | null>(null);

  // calabrese-58204: opt-in Supabase Realtime subscription, host-only. See
  // `frontend/src/hooks/useGuestsRealtime.ts` for the outage context.
  useGuestsRealtime(party?.id, (nextGuests) => {
    setGuests(nextGuests);
    // party.guests is the visible list — drop rejected (approved===false) here
    // so the consumers that read party.guests inherit the filter automatically.
    const visibleGuests = nextGuests.filter(g => g.approved !== false);
    setParty(prev => prev ? { ...prev, guests: visibleGuests } : null);
  });

  const canEdit = useMemo(() => {
    if (!party || !user) return false;
    if (user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return true;
    if (party.userId === user.id) return true;
    if (party.canEdit) return true; // Backend already verified co-host permissions
    return false;
  }, [party, user]);

  useEffect(() => {
    if (!authLoading && !partyLoading && party && !canEdit) {
      // mushroom-48468: logged-out users hit /login with redirect back to /host/...
      // so they can sign in and reach their dashboard (root cause was iOS auto-cap
      // creating duplicate User rows; this prevents an orphaned-dashboard UX while
      // the dedup migration is being applied). Authenticated-but-unauthorized
      // visitors fall through to /rsvp as before.
      if (!user) {
        navigate(`/login?redirect=${encodeURIComponent(`/host/${inviteCode}`)}`, { replace: true });
      } else {
        navigate(`/rsvp/${inviteCode}`, { replace: true });
      }
    }
  }, [authLoading, partyLoading, party, canEdit, navigate, inviteCode, user]);

  // Determine if this user is the owner or super admin (full access)
  const isOwnerOrAdmin = useMemo(() => {
    if (!party || !user) return false;
    if (user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return true;
    if (party.userId === user.id) return true;
    return false;
  }, [party, user]);

  // Resolve co-host tab permissions from the party.allowedTabs field (set by backend)
  // undefined = all tabs (legacy/owner), string[] = restricted (including empty = no tabs)
  const allowedTabs = useMemo<'all' | string[]>(() => {
    if (isOwnerOrAdmin) return 'all';
    // party.allowedTabs is set by the backend for restricted co-hosts
    if (Array.isArray(party?.allowedTabs)) {
      return party.allowedTabs;
    }
    return 'all'; // Backward compat: no allowedTabs field = full access
  }, [isOwnerOrAdmin, party?.allowedTabs]);

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
      if (authLoading) return; // Wait for auth to resolve before loading party
      if (inviteCode && inviteCode !== loadedCode) {
        setError(null);
        const success = await loadParty(inviteCode);
        setLoadedCode(inviteCode);
        if (!success) {
          setError(t('errors.partyNotFoundDesc'));
        }
      }
    }
    load();
  }, [inviteCode, loadParty, loadedCode, authLoading]);

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

  // All hooks must be called before any conditional returns (React Rules of Hooks)
  const tabs = useMemo(() => {
    const coreTabs = [
      ...(isGPP ? [{ id: 'dashboard' as TabType, label: t('tabs.dashboard'), icon: Home }] : []),
      // pepperoni-58341: Day-of host dashboard (also mirrored at /run/:inviteCode for mobile)
      { id: 'day-of' as TabType, label: 'Day Of', icon: Zap },
      { id: 'details' as TabType, label: t('tabs.settings'), icon: Settings },
      { id: 'guests' as TabType, label: t('tabs.guests'), icon: Users },
      { id: 'pizza' as TabType, label: isGPP ? t('tabs.pizza') : t('tabs.pizzaAndDrinks'), icon: Pizza },
      { id: 'photos' as TabType, label: t('tabs.photos'), icon: Camera },
    ];

    // Build pinned tabs from party.pinnedApps
    const pinnedTabs = (party?.pinnedApps ?? []).map(appId => {
      const appDef = PINNABLE_APPS.find(a => a.id === appId);
      if (!appDef) return null;
      return { id: appDef.tab as TabType, label: appDef.name, icon: appDef.icon };
    }).filter((t): t is { id: TabType; label: string; icon: React.ComponentType<{ size?: number; className?: string }> } => t !== null);

    const allTabs = [...coreTabs, ...pinnedTabs, { id: 'apps' as TabType, label: t('tabs.apps'), icon: LayoutGrid }];

    // Filter tabs based on co-host permissions
    // 'apps' tab is always visible so co-hosts can see the hub
    return allowedTabs === 'all'
      ? allTabs
      : allTabs.filter(t => t.id === 'apps' || allowedTabs.includes(t.id));
  }, [isGPP, party?.pinnedApps, allowedTabs]);

  // Redirect to first allowed tab if current tab is not permitted
  useEffect(() => {
    if (!party || allowedTabs === 'all') return;
    // activeTab is forbidden if it's not 'apps' and not in allowedTabs
    if (activeTab !== 'apps' && !allowedTabs.includes(activeTab)) {
      const firstAllowed = tabs.find(t => t.id !== 'apps');
      if (firstAllowed) {
        setActiveTab(firstAllowed.id);
      }
    }
  }, [activeTab, allowedTabs, party, tabs]);

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
            <h1 className="text-2xl font-bold text-theme-text mb-2">{t('errors.partyNotFound')}</h1>
            <p className="text-theme-text-secondary mb-6">{error || t('errors.unableToLoad')}</p>
            <button onClick={() => navigate('/')} className="btn-primary">
              {t('errors.goHome')}
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
                data-testid={`host-tab-${tab.id}`}
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
        ) : activeTab === 'day-of' && party ? (
          <DayOfTab party={party} />
        ) : activeTab === 'apps' && party ? (
          <AppsHub inviteCode={party.inviteCode} pinnedApps={party.pinnedApps ?? []} partyId={party.id} />
        ) : activeTab === 'partners' && party ? (
          <SponsorCRM
            partyId={party.id}
            onAddAsCoHost={async (data) => {
              // Use manually-provided avatar if available, otherwise auto-fetch from socials
              let avatarUrl: string | undefined;
              if (data.avatarUrl) {
                avatarUrl = await proxyAvatarToStorage(data.avatarUrl);
              } else {
                const xAvatar = data.twitter ? await fetchXAvatarToSupabase(data.twitter) : null;
                if (xAvatar) {
                  avatarUrl = xAvatar;
                } else if (data.instagram) {
                  const igAvatar = `https://unavatar.io/instagram/${data.instagram}`;
                  avatarUrl = await proxyAvatarToStorage(igAvatar);
                }
              }

              const newCoHost: CoHost = {
                id: uuid(),
                name: data.name,
                website: data.website || undefined,
                twitter: data.twitter || undefined,
                instagram: data.instagram || undefined,
                avatar_url: avatarUrl,
                showOnEvent: true,
              };

              const existing = party.coHosts || [];
              // Deduplicate — update existing co-host if name matches, otherwise add new
              const existingIdx = existing.findIndex(c => c.name?.toLowerCase() === data.name.toLowerCase());
              const updated = existingIdx >= 0
                ? existing.map((c, i) => i === existingIdx ? { ...c, ...newCoHost, id: c.id } : c)
                : [...existing, newCoHost];
              await updateParty(party.id, { co_hosts: updated });
              if (party.inviteCode) await loadParty(party.inviteCode);
            }}
          />
        ) : activeTab !== 'apps' && activeTab !== 'dashboard' && activeTab !== 'day-of' && activeTab !== 'partners' && (
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
                        <span className="text-sm font-medium text-theme-text">{t('pizza.expectedGuests')}</span>
                        <p className="text-xs text-theme-text-muted mt-0.5">{t('pizza.adjustForNonRespondents')}</p>
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
                      const maxCap = guests.length > 0 ? Math.max(guests.length * 5, currentValue) : Math.max(100, currentValue);
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
                                {t('pizza.requests', { count: guestsWithRequests })}
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
                                {t('pizza.rsvps', { count: guests.length })}
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
                  <DietarySettings />
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
                <div className="space-y-4">
                  <div className="card p-6 space-y-4">
                    <PhotoGallery
                      partyId={party.id}
                      isHost={true}
                      uploaderName={user?.name || undefined}
                      uploaderEmail={user?.email}
                      photoModeration={true}
                    />
                  </div>

                  {/* Previous Year Photos — GPP events only */}
                  {party.eventType === 'gpp' && party.customUrl && (
                    <div className="card p-6">
                      <PreviousYearPhotos />
                    </div>
                  )}
                </div>
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

              {activeTab === 'flyer' && party && (
                <FlyerTab />
              )}

              {activeTab === 'print' && party && (
                <PrintTab />
              )}

              {activeTab === 'payouts' && party && (
                <PayoutsTab
                  partyId={party.id}
                  reimbursementCapUsd={party.reimbursementCapUsd}
                  reimbursementCapAppealNote={party.reimbursementCapAppealNote}
                  reimbursementCapAppealedAt={party.reimbursementCapAppealedAt}
                  expectedGuests={party.expectedGuests}
                />
              )}

              {activeTab === 'gpp' && party && (
                <div className="space-y-4">
                  <div className="mb-4">
                    <h2 className="text-xl font-semibold text-theme-text">{t('gpp.title')}</h2>
                    <p className="text-theme-text-secondary text-sm mt-1">
                      {t('gpp.description')}
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
