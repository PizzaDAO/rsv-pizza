import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { Loader2, Shield, AlertCircle, Globe, ChevronDown, LogIn, UserPlus, X, Check } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { LoginModal } from '../components/LoginModal';
import { RegionStats, EventTable, TelegramBroadcast, CitiesTable, PartnerManager, CityScopePicker, FakeDetectionTable, OutreachTab } from '../components/underboss';
import { triggerFlyerRegenForEvents } from '../components/flyer/autoRegenFlyer';
import { fetchUnderbossDashboard, fetchUnderbossMe, createUnderboss, fetchSponsorUsers } from '../lib/api';
import type { UnderbossMeResponse } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
// GPP theme applied directly — Underboss dashboard is always GPP
import { GPP_REGIONS } from '../types';
import type { UnderbossDashboardData, UnderbossStats, UnderbossEvent } from '../types';

function recomputeStats(events: UnderbossDashboardData['events']): UnderbossStats {
  const totalEvents = events.length;
  let totalRsvps = 0;
  let totalInvited = 0;
  let totalApproved = 0;
  let eventsWithVenue = 0;
  let eventsWithBudget = 0;

  for (const e of events) {
    totalRsvps += e.guestCount;
    totalInvited += e.invitedCount || 0;
    totalApproved += e.approvedCount;
    if (e.progress.hasVenue) eventsWithVenue++;
    if (e.progress.hasBudget) eventsWithBudget++;
  }

  return {
    totalEvents,
    totalRsvps,
    totalInvited,
    totalApproved,
    eventsWithVenue,
    eventsWithBudget,
    completionRate: {
      venue: totalEvents > 0 ? Math.round((eventsWithVenue / totalEvents) * 100) : 0,
      budget: totalEvents > 0 ? Math.round((eventsWithBudget / totalEvents) * 100) : 0,
    },
    avgRsvpsPerEvent: totalEvents > 0 ? Math.round(totalRsvps / totalEvents) : 0,
  };
}

export function UnderbossDashboard() {
  const { t } = useTranslation('admin');
  const { user, loading: authLoading } = useAuth();
  const themeClass = 'gpp-theme';
  const backgroundStyle = { background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)' } as React.CSSProperties;

  // Set body class for elements outside React tree
  useEffect(() => {
    document.body.classList.add('gpp-theme-active');
    return () => { document.body.classList.remove('gpp-theme-active'); };
  }, []);

  const [allData, setAllData] = useState<UnderbossDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [meData, setMeData] = useState<UnderbossMeResponse | null>(null);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [availableRegions, setAvailableRegions] = useState<string[]>([]);

  // Tab state
  const [activeTab, setActiveTab] = useState<'events' | 'cities' | 'partners' | 'fake-detection' | 'outreach'>('events');

  const [tableFilteredEvents, setTableFilteredEvents] = useState<UnderbossEvent[] | null>(null);

  // Telegram broadcast modal state
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastCities, setBroadcastCities] = useState<string[]>([]);

  // Partner tags for EventRow indicator
  const [partnerTags, setPartnerTags] = useState<string[]>([]);

  // Add underboss modal state
  const [showAddUnderboss, setShowAddUnderboss] = useState(false);
  const [addUbForm, setAddUbForm] = useState({ name: '', email: '' });
  const [newUbRegions, setNewUbRegions] = useState<string[]>([]);
  const [newUbCities, setNewUbCities] = useState<string[]>([]);
  const [addUbLoading, setAddUbLoading] = useState(false);
  const [addUbError, setAddUbError] = useState<string | null>(null);
  const [addUbSuccess, setAddUbSuccess] = useState(false);

  // Cities filter (mozzarella-25815): only shown for city-scoped underbosses
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);

  // Extract a city key from an event name ("Global Pizza Party {City}")
  // Mirrors backend `cityKeyFromPartyName` + frontend `CitiesTable` regex.
  function cityFromEvent(event: { name: string }): string | null {
    const match = event.name.match(/Global Pizza Party\s+(.+)/i);
    if (!match) return null;
    return match[1].trim().toLowerCase();
  }

  // mozzarella-25815: city-scoped UBs may have NO regions, so the
  // "regions.length === availableRegions.length" allSelected check needs
  // to consider that no-region UBs simply have nothing to filter via region.
  const hasCitiesFilter = (meData?.cities?.length ?? 0) > 0;

  // Filter events and recompute stats based on selected regions + cities
  const filteredData = useMemo(() => {
    if (!allData) return null;
    const allRegionsSelected = availableRegions.length === 0 || selectedRegions.length === availableRegions.length;
    const allCitiesSelected = !hasCitiesFilter || selectedCities.length === (meData?.cities?.length ?? 0);
    if (allRegionsSelected && allCitiesSelected) return allData;

    const selectedCityKeys = selectedCities.map((c) => c.toLowerCase().trim());
    const filteredEvents = allData.events.filter((e) => {
      // Region match
      const regionMatch = !!(e.region && selectedRegions.includes(e.region));
      // City match (additive)
      const cityKey = cityFromEvent(e);
      const cityMatch = hasCitiesFilter && !!cityKey && selectedCityKeys.includes(cityKey);
      return regionMatch || cityMatch;
    });
    return {
      ...allData,
      stats: recomputeStats(filteredEvents),
      events: filteredEvents,
    };
  }, [allData, selectedRegions, availableRegions.length, selectedCities, hasCitiesFilter, meData?.cities?.length]);

  const displayData = useMemo(() => {
    if (!filteredData) return null;
    if (activeTab !== 'events' || !tableFilteredEvents) return filteredData;
    return {
      ...filteredData,
      stats: recomputeStats(tableFilteredEvents),
      events: tableFilteredEvents,
    };
  }, [filteredData, activeTab, tableFilteredEvents]);

  // quattro-12847: count of in-scope events with at least one unreviewed
  // cap appeal — drives the red pill on the Events tab nav.
  const openAppealCount = useMemo(() => {
    if (!filteredData) return 0;
    return filteredData.events.filter((e) => e.hasOpenAppeal === true).length;
  }, [filteredData]);

  useEffect(() => {
    if (activeTab !== 'events') setTableFilteredEvents(null);
  }, [activeTab]);

  useEffect(() => {
    setTableFilteredEvents(null);
  }, [allData]);

  // Derive the region label for the header
  const regionLabel = useMemo(() => {
    if (selectedRegions.length === 0) return t('underbossDashboard.noRegions');
    if (selectedRegions.length === availableRegions.length) return t('underbossDashboard.allRegions');
    if (selectedRegions.length === 1) {
      return GPP_REGIONS.find((r) => r.id === selectedRegions[0])?.label || selectedRegions[0];
    }
    return t('underbossDashboard.regionsCount', { count: selectedRegions.length });
  }, [selectedRegions, availableRegions.length, t]);

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const result = await fetchUnderbossDashboard('all');
      setAllData(result);

      // Load partner tags for EventRow indicator (admin only, non-blocking)
      try {
        const { sponsorUsers } = await fetchSponsorUsers();
        const tags = sponsorUsers
          .filter(su => su.autoCoHost && su.isActive)
          .map(su => su.tag);
        setPartnerTags(tags);
      } catch {
        // Non-critical — partner tags indicator won't show
      }
    } catch (err: any) {
      if (!silent) setError(err.message || 'Failed to load dashboard');
      else console.error('Silent dashboard refetch failed:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // On mount / user change: determine access via /me endpoint
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setLoading(false);
      setError(null);
      return;
    }

    async function checkAccess() {
      try {
        const me = await fetchUnderbossMe();
        setMeData(me);

        if (me.isAdmin) {
          setIsAdmin(true);
          const allRegionIds = GPP_REGIONS.map((r) => r.id);
          setAvailableRegions(allRegionIds);
          setSelectedRegions(allRegionIds);
          loadDashboard();
        } else if (me.isUnderboss) {
          setIsAdmin(false);
          const assignedRegions = (me.regions && me.regions.length > 0) ? me.regions : (me.region ? [me.region] : []);
          const assignedCities = me.cities || [];
          // mozzarella-25815: allow access if EITHER regions OR cities are assigned.
          if (assignedRegions.length === 0 && assignedCities.length === 0) {
            setLoading(false);
            setError('You are not authorized to access the underboss dashboard.');
            return;
          }
          setAvailableRegions(assignedRegions);
          setSelectedRegions(assignedRegions);
          // For city-scoped UBs, pre-select all assigned cities in the cities filter
          if (assignedCities.length > 0) {
            setSelectedCities(assignedCities);
          }
          loadDashboard();
        } else {
          setLoading(false);
          setError('You are not authorized to access the underboss dashboard.');
        }
      } catch (err: any) {
        setLoading(false);
        setError(err.message || 'Failed to check access');
      }
    }

    checkAccess();
  }, [user, authLoading, loadDashboard]);

  const toggleRegion = (regionId: string) => {
    setSelectedRegions((prev) => {
      if (prev.includes(regionId)) {
        return prev.filter((r) => r !== regionId);
      }
      return [...prev, regionId];
    });
  };

  const toggleAllRegions = () => {
    const allSelected = selectedRegions.length === availableRegions.length;
    setSelectedRegions(allSelected ? [] : [...availableRegions]);
  };

  // Handle flyer regen when a partner is created/updated and synced to events
  const handleFlyerRegenForTag = useCallback((tag: string) => {
    if (!allData) return;
    const affected = allData.events.filter(e => e.eventTags?.includes(tag));
    if (affected.length > 0) {
      triggerFlyerRegenForEvents(affected);
    }
  }, [allData]);

  // Handle optimistic event updates from EventRow (host status, approval, tags)
  const handleEventUpdate = useCallback((eventId: string, updates: Partial<UnderbossEvent>) => {
    setAllData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        events: prev.events.map((e) =>
          e.id === eventId ? { ...e, ...updates } : e
        ),
      };
    });
  }, []);

  // Not logged in
  if (!authLoading && !user) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <Shield size={48} className="mx-auto mb-4 text-red-500/60" />
          <h1 className="text-2xl font-bold text-theme-text mb-2">{t('underbossDashboard.title')}</h1>
          <p className="text-theme-text-muted mb-6">
            {t('underbossDashboard.loginPrompt')}
          </p>
          <button
            onClick={() => setShowLoginModal(true)}
            className="inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-xl font-medium transition-colors"
          >
            <LogIn size={18} />
            {t('underbossDashboard.logIn')}
          </button>
        </div>
        <Footer />
        <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
      </div>
    );
  }

  // Loading state
  if (loading || authLoading) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex flex-col items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-theme-text-muted mb-4" />
          <p className="text-theme-text-muted text-sm">{t('underbossDashboard.loadingDashboard')}</p>
        </div>
        <Footer />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <AlertCircle size={48} className="mx-auto mb-4 text-red-400/60" />
          <h1 className="text-2xl font-bold text-theme-text mb-2">{t('underbossDashboard.error')}</h1>
          <p className="text-theme-text-muted">{error}</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (!filteredData || !displayData) return null;

  const showMultiSelect = availableRegions.length > 1;
  const showRegionColumn = selectedRegions.length > 1;
  const filteredGppRegions = GPP_REGIONS.filter((r) => availableRegions.includes(r.id));

  return (
    <div className={`min-h-screen ${themeClass} relative overflow-hidden`} style={backgroundStyle}>
      {/* Floating deco */}
      <img src="/gpp-cloud-1.png" alt="" className="absolute pointer-events-none select-none hidden md:block" style={{ top: '5%', right: '-4%', width: 280, opacity: 0.5, animation: 'drift-right 14s ease-in-out infinite' }} />
      <img src="/gpp-cloud-2.png" alt="" className="absolute pointer-events-none select-none hidden md:block" style={{ top: '2%', left: '-2%', width: 150, opacity: 0.5, animation: 'drift-left 12s ease-in-out infinite' }} />
      <img src="/gpp-cloud-3.png" alt="" className="absolute pointer-events-none select-none" style={{ top: '35%', left: '1%', width: 100, opacity: 0.4, animation: 'drift-right 16s ease-in-out infinite' }} />
      <img src="/gpp-cloud-2.png" alt="" className="absolute pointer-events-none select-none hidden md:block" style={{ top: '55%', right: '1%', width: 120, opacity: 0.4, animation: 'drift-left 13s ease-in-out infinite' }} />
      <img src="/gpp-cloud-3.png" alt="" className="absolute pointer-events-none select-none" style={{ top: '80%', left: '3%', width: 90, opacity: 0.35, animation: 'drift-right 11s ease-in-out infinite' }} />

      <Helmet>
        <title>{regionLabel} Dashboard | GPP Underboss</title>
      </Helmet>

      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        <div className="rounded-2xl p-6 sm:p-8" style={{ background: 'rgba(240, 240, 240, 0.95)' }}>
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
              <Globe size={20} className="text-red-500" />
            </div>
            <div>
              {showMultiSelect ? (
                <div className="relative">
                  <button
                    onClick={() => setRegionDropdownOpen(!regionDropdownOpen)}
                    className="flex items-center gap-2 text-2xl font-bold text-theme-text hover:text-red-500 transition-colors"
                  >
                    {regionLabel}
                    <ChevronDown size={20} className={`transition-transform ${regionDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {regionDropdownOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setRegionDropdownOpen(false)}
                      />
                      <div className="absolute top-full left-0 mt-2 z-50 bg-theme-card border border-theme-stroke rounded-xl shadow-2xl py-2 min-w-[240px]">
                        {/* Select All */}
                        <button
                          onClick={toggleAllRegions}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
                            selectedRegions.length === availableRegions.length
                              ? 'text-red-500 font-medium'
                              : 'text-theme-text-secondary hover:bg-theme-surface hover:text-theme-text'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                            selectedRegions.length === availableRegions.length
                              ? 'bg-red-500 border-red-500' : 'border-theme-stroke-hover'
                          }`}>
                            {selectedRegions.length === availableRegions.length && <Check size={12} className="text-theme-text" />}
                          </div>
                          {t('underbossDashboard.selectAll')}
                        </button>
                        <div className="border-b border-theme-stroke my-1" />
                        {filteredGppRegions.map((r) => (
                          <button
                            key={r.id}
                            onClick={() => toggleRegion(r.id)}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
                              selectedRegions.includes(r.id)
                                ? 'text-red-500 font-medium'
                                : 'text-theme-text-secondary hover:bg-theme-surface hover:text-theme-text'
                            }`}
                          >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                              selectedRegions.includes(r.id)
                                ? 'bg-red-500 border-red-500' : 'border-theme-stroke-hover'
                            }`}>
                              {selectedRegions.includes(r.id) && <Check size={12} className="text-theme-text" />}
                            </div>
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <h1 className="text-2xl font-bold text-theme-text">{regionLabel}</h1>
              )}
              <p className="text-sm text-theme-text-muted">
                {t('underbossDashboard.gppSubtitle')} &middot; {t('underbossDashboard.underbossSubtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <div className="flex items-center gap-2 text-sm text-theme-text-faint">
              <Shield size={14} />
              <span>
                {isAdmin
                  ? t('underbossDashboard.signedInAdmin', { email: filteredData.underboss.email })
                  : t('underbossDashboard.signedInAs', { name: filteredData.underboss.name })}
              </span>
            </div>
            {isAdmin && (
              <button
                onClick={() => setShowAddUnderboss(true)}
                className="flex items-center gap-1.5 text-sm text-red-500/70 hover:text-red-500 transition-colors"
              >
                <UserPlus size={14} />
                {t('underbossDashboard.addUnderboss')}
              </button>
            )}
          </div>

          {/* Cities filter pill — only shown for city-scoped UBs (mozzarella-25815) */}
          {hasCitiesFilter && meData && (
            <div className="mt-3 relative">
              <button
                onClick={() => setCityDropdownOpen(!cityDropdownOpen)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-theme-surface border border-theme-stroke text-sm text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
              >
                <span>
                  {selectedCities.length === (meData.cities?.length ?? 0)
                    ? t('underbossDashboard.allCities', 'All cities')
                    : t('underbossDashboard.citiesCount', { count: selectedCities.length, defaultValue: '{{count}} cities' })}
                </span>
                <ChevronDown size={14} className={`transition-transform ${cityDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {cityDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setCityDropdownOpen(false)} />
                  <div className="absolute top-full left-0 mt-2 z-50 bg-theme-card border border-theme-stroke rounded-xl shadow-2xl py-2 min-w-[240px] max-h-[60vh] overflow-y-auto">
                    <button
                      onClick={() => setSelectedCities(meData.cities || [])}
                      className="w-full text-left px-4 py-2 text-sm text-theme-text-secondary hover:bg-theme-surface transition-colors"
                    >
                      {t('underbossDashboard.selectAll')}
                    </button>
                    <button
                      onClick={() => setSelectedCities([])}
                      className="w-full text-left px-4 py-2 text-sm text-theme-text-faint hover:bg-theme-surface transition-colors"
                    >
                      {t('underbossDashboard.clearAll', 'Clear')}
                    </button>
                    <div className="border-b border-theme-stroke my-1" />
                    {(meData.cities || []).map((c) => {
                      const isSel = selectedCities.some((s) => s.toLowerCase().trim() === c.toLowerCase().trim());
                      return (
                        <button
                          key={c}
                          onClick={() => {
                            const key = c.toLowerCase().trim();
                            if (isSel) {
                              setSelectedCities((prev) => prev.filter((s) => s.toLowerCase().trim() !== key));
                            } else {
                              setSelectedCities((prev) => [...prev, c]);
                            }
                          }}
                          className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2 ${
                            isSel ? 'text-red-500 font-medium' : 'text-theme-text-secondary hover:bg-theme-surface hover:text-theme-text'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                            isSel ? 'bg-red-500 border-red-500' : 'border-theme-stroke-hover'
                          }`}>
                            {isSel && <Check size={12} className="text-theme-text" />}
                          </div>
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Stats */}
        <section className="mb-8">
          <RegionStats stats={displayData.stats} />
        </section>

        {/* Events / Cities Tabs */}
        <section>
          <div className="border-b border-theme-stroke mb-4 flex gap-6">
            <button
              onClick={() => setActiveTab('events')}
              className={`pb-3 text-lg font-semibold transition-all whitespace-nowrap relative ${
                activeTab === 'events'
                  ? 'text-theme-text'
                  : 'text-theme-text-muted hover:text-theme-text-secondary'
              }`}
            >
              {t('underbossDashboard.tabs.events')} ({displayData.events.length})
              {openAppealCount > 0 && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 text-[10px] font-semibold ml-1.5"
                  title={`${openAppealCount} event${openAppealCount === 1 ? '' : 's'} with an open cap appeal`}
                >
                  {openAppealCount}
                </span>
              )}
              {activeTab === 'events' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-500" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('cities')}
              className={`pb-3 text-lg font-semibold transition-all whitespace-nowrap relative ${
                activeTab === 'cities'
                  ? 'text-theme-text'
                  : 'text-theme-text-muted hover:text-theme-text-secondary'
              }`}
            >
              {t('underbossDashboard.tabs.cities')}
              {activeTab === 'cities' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-500" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('partners')}
              className={`pb-3 text-lg font-semibold transition-all whitespace-nowrap relative ${
                activeTab === 'partners'
                  ? 'text-theme-text'
                  : 'text-theme-text-muted hover:text-theme-text-secondary'
              }`}
            >
              {t('underbossDashboard.tabs.partners')}
              {activeTab === 'partners' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-500" />
              )}
            </button>
            {isAdmin && (
              <button
                onClick={() => setActiveTab('fake-detection')}
                className={`pb-3 text-lg font-semibold transition-all whitespace-nowrap relative ${
                  activeTab === 'fake-detection'
                    ? 'text-theme-text'
                    : 'text-theme-text-muted hover:text-theme-text-secondary'
                }`}
              >
                {t('underbossDashboard.tabs.fakeDetection')}
                {activeTab === 'fake-detection' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-500" />
                )}
              </button>
            )}
            <button
              onClick={() => setActiveTab('outreach')}
              className={`pb-3 text-lg font-semibold transition-all whitespace-nowrap relative ${
                activeTab === 'outreach'
                  ? 'text-theme-text'
                  : 'text-theme-text-muted hover:text-theme-text-secondary'
              }`}
            >
              {t('underbossDashboard.tabs.outreach')}
              {activeTab === 'outreach' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-500" />
              )}
            </button>
          </div>

          {activeTab === 'events' && (
            <EventTable events={filteredData.events} showRegion={showRegionColumn} onEventUpdate={handleEventUpdate} onBulkAction={() => loadDashboard(true)} onTelegramBroadcast={(cities) => { setBroadcastCities(cities); setShowBroadcast(true); }} partnerTags={partnerTags} onFilteredEventsChange={setTableFilteredEvents} isAdmin={isAdmin} />
          )}

          {activeTab === 'cities' && (
            <CitiesTable events={filteredData.events} selectedRegions={selectedRegions} meData={meData} onTelegramBroadcast={(cities) => { setBroadcastCities(cities); setShowBroadcast(true); }} />
          )}

          {activeTab === 'partners' && (
            <PartnerManager isAdmin={isAdmin} events={allData?.events} onSyncComplete={() => loadDashboard(true)} onFlyerRegenNeeded={handleFlyerRegenForTag} />
          )}

          {isAdmin && activeTab === 'fake-detection' && (
            <FakeDetectionTable />
          )}

          {activeTab === 'outreach' && (
            <OutreachTab isAdmin={isAdmin} />
          )}

        </section>
        </div>
      </main>

      <Footer />

      {/* Telegram Broadcast Modal */}
      {showBroadcast && <TelegramBroadcast onClose={() => { setShowBroadcast(false); setBroadcastCities([]); }} preSelectedCities={broadcastCities} events={filteredData?.events ?? []} />}

      {/* Add Underboss Modal */}
      {showAddUnderboss && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAddUnderboss(false)}>
          <div className="bg-theme-card border border-theme-stroke rounded-2xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-theme-text">{t('underbossDashboard.addUnderboss')}</h3>
              <button onClick={() => setShowAddUnderboss(false)} className="text-theme-text-faint hover:text-theme-text-secondary">
                <X size={20} />
              </button>
            </div>

            {addUbSuccess ? (
              <div className="text-center py-6">
                <p className="text-green-400 font-medium mb-2">{t('underbossDashboard.underbossCreated')}</p>
                <button
                  onClick={() => { setShowAddUnderboss(false); setAddUbSuccess(false); setAddUbForm({ name: '', email: '' }); setNewUbRegions([]); setNewUbCities([]); }}
                  className="text-sm text-theme-text-muted hover:text-theme-text-secondary"
                >
                  {t('underbossDashboard.close')}
                </button>
              </div>
            ) : (
              <form onSubmit={async (e) => {
                e.preventDefault();
                // mozzarella-25815: require at least one region OR city
                if (newUbRegions.length === 0 && newUbCities.length === 0) return;
                setAddUbLoading(true);
                setAddUbError(null);
                try {
                  await createUnderboss({ ...addUbForm, regions: newUbRegions, cities: newUbCities });
                  setAddUbSuccess(true);
                } catch (err: any) {
                  setAddUbError(err.message || 'Failed to create underboss');
                } finally {
                  setAddUbLoading(false);
                }
              }} className="space-y-4">
                <div>
                  <input
                    type="text"
                    placeholder={t('underbossDashboard.namePlaceholder')}
                    value={addUbForm.name}
                    onChange={(e) => setAddUbForm({ ...addUbForm, name: e.target.value })}
                    required
                    className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
                  />
                </div>
                <div>
                  <input
                    type="email"
                    placeholder={t('underbossDashboard.emailPlaceholder')}
                    value={addUbForm.email}
                    onChange={(e) => setAddUbForm({ ...addUbForm, email: e.target.value })}
                    required
                    className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
                  />
                </div>
                <div>
                  <p className="text-sm text-theme-text-secondary mb-2">{t('underbossDashboard.regions')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {GPP_REGIONS.map(r => (
                      <label key={r.id} className="flex items-center gap-2 text-sm text-theme-text cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newUbRegions.includes(r.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewUbRegions(prev => [...prev, r.id]);
                            } else {
                              setNewUbRegions(prev => prev.filter(id => id !== r.id));
                            }
                          }}
                          className="rounded border-theme-stroke-hover bg-theme-surface"
                        />
                        {r.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm text-theme-text-secondary mb-2">{t('underboss.cities', 'Cities')}</p>
                  <CityScopePicker selected={newUbCities} onChange={setNewUbCities} />
                </div>
                {addUbError && <p className="text-sm text-red-400">{addUbError}</p>}
                <button
                  type="submit"
                  disabled={addUbLoading || (newUbRegions.length === 0 && newUbCities.length === 0)}
                  className="w-full bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  {addUbLoading ? t('underbossDashboard.creating') : t('underbossDashboard.createUnderboss')}
                </button>
              </form>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
