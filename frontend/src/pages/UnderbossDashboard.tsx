import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { Loader2, Shield, AlertCircle, Globe, ChevronDown, LogIn, UserPlus, X, Check } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { LoginModal } from '../components/LoginModal';
import { RegionStats, EventTable } from '../components/underboss';
import { fetchUnderbossDashboard, fetchUnderbossMe, createUnderboss } from '../lib/api';
import type { UnderbossMeResponse } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { GPP_REGIONS } from '../types';
import type { UnderbossDashboardData, UnderbossStats } from '../types';

function recomputeStats(events: UnderbossDashboardData['events']): UnderbossStats {
  const totalEvents = events.length;
  let totalRsvps = 0;
  let totalApproved = 0;
  let eventsWithVenue = 0;
  let eventsWithBudget = 0;
  let eventsWithKit = 0;

  for (const e of events) {
    totalRsvps += e.guestCount;
    totalApproved += e.approvedCount;
    if (e.progress.hasVenue) eventsWithVenue++;
    if (e.progress.hasBudget) eventsWithBudget++;
    if (e.progress.hasPartyKit) eventsWithKit++;
  }

  return {
    totalEvents,
    totalRsvps,
    totalApproved,
    eventsWithVenue,
    eventsWithBudget,
    eventsWithKit,
    completionRate: {
      venue: totalEvents > 0 ? Math.round((eventsWithVenue / totalEvents) * 100) : 0,
      budget: totalEvents > 0 ? Math.round((eventsWithBudget / totalEvents) * 100) : 0,
      partyKit: totalEvents > 0 ? Math.round((eventsWithKit / totalEvents) * 100) : 0,
    },
    avgRsvpsPerEvent: totalEvents > 0 ? Math.round(totalRsvps / totalEvents) : 0,
  };
}

export function UnderbossDashboard() {
  const { user, loading: authLoading } = useAuth();
  const { themeClass, backgroundStyle } = useTheme();

  const [allData, setAllData] = useState<UnderbossDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [meData, setMeData] = useState<UnderbossMeResponse | null>(null);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [availableRegions, setAvailableRegions] = useState<string[]>([]);

  // Add underboss modal state
  const [showAddUnderboss, setShowAddUnderboss] = useState(false);
  const [addUbForm, setAddUbForm] = useState({ name: '', email: '' });
  const [newUbRegions, setNewUbRegions] = useState<string[]>([]);
  const [addUbLoading, setAddUbLoading] = useState(false);
  const [addUbError, setAddUbError] = useState<string | null>(null);
  const [addUbSuccess, setAddUbSuccess] = useState(false);

  // Filter events and recompute stats based on selected regions
  const filteredData = useMemo(() => {
    if (!allData) return null;
    const allSelected = selectedRegions.length === availableRegions.length;
    if (allSelected) return allData;

    const filteredEvents = allData.events.filter(
      (e) => e.region && selectedRegions.includes(e.region)
    );
    return {
      ...allData,
      stats: recomputeStats(filteredEvents),
      events: filteredEvents,
    };
  }, [allData, selectedRegions, availableRegions.length]);

  // Derive the region label for the header
  const regionLabel = useMemo(() => {
    if (selectedRegions.length === 0) return 'No Regions';
    if (selectedRegions.length === availableRegions.length) return 'All Regions';
    if (selectedRegions.length === 1) {
      return GPP_REGIONS.find((r) => r.id === selectedRegions[0])?.label || selectedRegions[0];
    }
    return `${selectedRegions.length} Regions`;
  }, [selectedRegions, availableRegions.length]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchUnderbossDashboard('all');
      setAllData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
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
          if (assignedRegions.length === 0) {
            setLoading(false);
            setError('You are not authorized to access the underboss dashboard.');
            return;
          }
          setAvailableRegions(assignedRegions);
          setSelectedRegions(assignedRegions);
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
        // Don't allow deselecting the last region
        if (prev.length === 1) return prev;
        return prev.filter((r) => r !== regionId);
      }
      return [...prev, regionId];
    });
  };

  const selectAllRegions = () => {
    setSelectedRegions([...availableRegions]);
  };

  // Not logged in
  if (!authLoading && !user) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <Shield size={48} className="mx-auto mb-4 text-red-500/60" />
          <h1 className="text-2xl font-bold text-white mb-2">Underboss Dashboard</h1>
          <p className="text-white/50 mb-6">
            Please log in to access the underboss dashboard.
          </p>
          <button
            onClick={() => setShowLoginModal(true)}
            className="inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-xl font-medium transition-colors"
          >
            <LogIn size={18} />
            Log In
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
          <Loader2 size={32} className="animate-spin text-white/40 mb-4" />
          <p className="text-white/40 text-sm">Loading dashboard...</p>
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
          <h1 className="text-2xl font-bold text-white mb-2">Error</h1>
          <p className="text-white/50">{error}</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (!filteredData) return null;

  const showMultiSelect = availableRegions.length > 1;
  const showRegionColumn = selectedRegions.length > 1;
  const filteredGppRegions = GPP_REGIONS.filter((r) => availableRegions.includes(r.id));

  return (
    <div className={`min-h-screen ${themeClass} relative overflow-hidden`} style={backgroundStyle}>
      {/* Floating deco */}
      <img src="/gpp-deco-1.png" alt="" className="absolute pointer-events-none select-none hidden md:block" style={{ top: '5%', right: '-4%', width: 280, opacity: 0.5, animation: 'drift-right 14s ease-in-out infinite' }} />
      <img src="/gpp-deco-2.png" alt="" className="absolute pointer-events-none select-none hidden md:block" style={{ top: '2%', left: '-2%', width: 150, opacity: 0.5, animation: 'drift-left 12s ease-in-out infinite' }} />
      <img src="/gpp-deco-3.png" alt="" className="absolute pointer-events-none select-none" style={{ top: '35%', left: '1%', width: 100, opacity: 0.4, animation: 'drift-right 16s ease-in-out infinite' }} />
      <img src="/gpp-deco-2.png" alt="" className="absolute pointer-events-none select-none hidden md:block" style={{ top: '55%', right: '1%', width: 120, opacity: 0.4, animation: 'drift-left 13s ease-in-out infinite' }} />
      <img src="/gpp-deco-3.png" alt="" className="absolute pointer-events-none select-none" style={{ top: '80%', left: '3%', width: 90, opacity: 0.35, animation: 'drift-right 11s ease-in-out infinite' }} />

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
                    className="flex items-center gap-2 text-2xl font-bold text-white hover:text-red-500 transition-colors"
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
                      <div className="absolute top-full left-0 mt-2 z-50 bg-white border border-white/10 rounded-xl shadow-2xl py-2 min-w-[240px]">
                        {/* Select All */}
                        <button
                          onClick={selectAllRegions}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
                            selectedRegions.length === availableRegions.length
                              ? 'text-red-500 font-medium'
                              : 'text-white/70 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                            selectedRegions.length === availableRegions.length
                              ? 'bg-red-500 border-red-500' : 'border-white/30'
                          }`}>
                            {selectedRegions.length === availableRegions.length && <Check size={12} className="text-white" />}
                          </div>
                          All Regions
                        </button>
                        <div className="border-b border-white/10 my-1" />
                        {filteredGppRegions.map((r) => (
                          <button
                            key={r.id}
                            onClick={() => toggleRegion(r.id)}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
                              selectedRegions.includes(r.id)
                                ? 'text-red-500 font-medium'
                                : 'text-white/70 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                              selectedRegions.includes(r.id)
                                ? 'bg-red-500 border-red-500' : 'border-white/30'
                            }`}>
                              {selectedRegions.includes(r.id) && <Check size={12} className="text-white" />}
                            </div>
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <h1 className="text-2xl font-bold text-white">{regionLabel}</h1>
              )}
              <p className="text-sm text-white/40">
                Global Pizza Party &middot; Underboss Dashboard
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <div className="flex items-center gap-2 text-sm text-white/30">
              <Shield size={14} />
              <span>
                {isAdmin
                  ? `Signed in as Admin (${filteredData.underboss.email})`
                  : `Signed in as ${filteredData.underboss.name}`}
              </span>
            </div>
            {isAdmin && (
              <button
                onClick={() => setShowAddUnderboss(true)}
                className="flex items-center gap-1.5 text-sm text-red-500/70 hover:text-red-500 transition-colors"
              >
                <UserPlus size={14} />
                Add Underboss
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <section className="mb-8">
          <RegionStats stats={filteredData.stats} />
        </section>

        {/* Events Table */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">
            Events ({filteredData.events.length})
          </h2>
          <EventTable events={filteredData.events} showRegion={showRegionColumn} />
        </section>
        </div>
      </main>

      <Footer />

      {/* Add Underboss Modal */}
      {showAddUnderboss && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAddUnderboss(false)}>
          <div className="bg-white border border-white/10 rounded-2xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Add Underboss</h3>
              <button onClick={() => setShowAddUnderboss(false)} className="text-white/30 hover:text-white/60">
                <X size={20} />
              </button>
            </div>

            {addUbSuccess ? (
              <div className="text-center py-6">
                <p className="text-green-400 font-medium mb-2">Underboss created!</p>
                <button
                  onClick={() => { setShowAddUnderboss(false); setAddUbSuccess(false); setAddUbForm({ name: '', email: '' }); setNewUbRegions([]); }}
                  className="text-sm text-white/50 hover:text-white/70"
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={async (e) => {
                e.preventDefault();
                if (newUbRegions.length === 0) return;
                setAddUbLoading(true);
                setAddUbError(null);
                try {
                  await createUnderboss({ ...addUbForm, regions: newUbRegions });
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
                    placeholder="Name"
                    value={addUbForm.name}
                    onChange={(e) => setAddUbForm({ ...addUbForm, name: e.target.value })}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
                  />
                </div>
                <div>
                  <input
                    type="email"
                    placeholder="Email"
                    value={addUbForm.email}
                    onChange={(e) => setAddUbForm({ ...addUbForm, email: e.target.value })}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
                  />
                </div>
                <div>
                  <p className="text-sm text-white/60 mb-2">Regions</p>
                  <div className="grid grid-cols-2 gap-2">
                    {GPP_REGIONS.map(r => (
                      <label key={r.id} className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
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
                          className="rounded border-white/20 bg-white/5"
                        />
                        {r.label}
                      </label>
                    ))}
                  </div>
                </div>
                {addUbError && <p className="text-sm text-red-400">{addUbError}</p>}
                <button
                  type="submit"
                  disabled={addUbLoading || newUbRegions.length === 0}
                  className="w-full bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  {addUbLoading ? 'Creating...' : 'Create Underboss'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
