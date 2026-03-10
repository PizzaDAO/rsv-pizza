import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, Shield, AlertCircle, Globe, ChevronDown, LogIn, UserPlus, X } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { LoginModal } from '../components/LoginModal';
import { RegionStats, EventTable } from '../components/underboss';
import { fetchUnderbossDashboard, fetchUnderbossMe, createUnderboss } from '../lib/api';
import type { UnderbossMeResponse } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { GPP_REGIONS } from '../types';
import type { UnderbossDashboardData, GPPRegion } from '../types';

export function UnderbossDashboard() {
  const { region } = useParams<{ region: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [data, setData] = useState<UnderbossDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [meData, setMeData] = useState<UnderbossMeResponse | null>(null);
  const [showAddUnderboss, setShowAddUnderboss] = useState(false);
  const [addUbForm, setAddUbForm] = useState({ name: '', email: '' });
  const [newUbRegions, setNewUbRegions] = useState<string[]>([]);
  const [addUbLoading, setAddUbLoading] = useState(false);
  const [addUbError, setAddUbError] = useState<string | null>(null);
  const [addUbSuccess, setAddUbSuccess] = useState(false);

  const regionLabel = region === 'all' ? 'All Regions' : (GPP_REGIONS.find((r) => r.id === region)?.label || region || 'Unknown');

  const loadDashboard = useCallback(async (targetRegion: string) => {
    setLoading(true);
    setError(null);

    const validRegions = GPP_REGIONS.map((r) => r.id);
    if (targetRegion !== 'all' && !validRegions.includes(targetRegion as GPPRegion)) {
      setError(`Invalid region: ${targetRegion}`);
      setLoading(false);
      return;
    }

    try {
      const result = await fetchUnderbossDashboard(targetRegion as GPPRegion | 'all');
      setData(result);
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
          // Admin with no region param: default to first region
          const targetRegion = region || GPP_REGIONS[0].id;
          if (!region) {
            navigate(`/underboss/${targetRegion}`, { replace: true });
          }
          loadDashboard(targetRegion);
        } else if (me.isUnderboss) {
          setIsAdmin(false);
          // Determine assigned regions (fall back to [region] for legacy)
          const assignedRegions = (me.regions && me.regions.length > 0) ? me.regions : (me.region ? [me.region] : []);
          if (assignedRegions.length === 0) {
            setLoading(false);
            setError('You are not authorized to access the underboss dashboard.');
            return;
          }
          // If no region param or current region is not in assigned regions, redirect to first assigned region
          if (!region || !assignedRegions.includes(region)) {
            navigate(`/underboss/${assignedRegions[0]}`, { replace: true });
            loadDashboard(assignedRegions[0]);
          } else {
            loadDashboard(region);
          }
        } else {
          // Not authorized
          setLoading(false);
          setError('You are not authorized to access the underboss dashboard.');
        }
      } catch (err: any) {
        setLoading(false);
        setError(err.message || 'Failed to check access');
      }
    }

    checkAccess();
  }, [user, authLoading, region, navigate, loadDashboard]);

  // Handle region switch for admins
  const handleRegionSwitch = (newRegion: string) => {
    setRegionDropdownOpen(false);
    navigate(`/underboss/${newRegion}`);
  };

  // Not logged in
  if (!authLoading && !user) {
    return (
      <div className="min-h-screen gpp-theme gpp-gray">
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
      <div className="min-h-screen gpp-theme gpp-gray">
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
      <div className="min-h-screen gpp-theme gpp-gray">
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

  if (!data) return null;

  return (
    <div className="min-h-screen gpp-theme gpp-gray">
      <Helmet>
        <title>{regionLabel} Dashboard | GPP Underboss</title>
      </Helmet>

      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
              <Globe size={20} className="text-red-500" />
            </div>
            <div>
              {/* Region title with switcher for admins and multi-region underbosses */}
              {(() => {
                const assignedRegions = meData?.regions && meData.regions.length > 0
                  ? meData.regions
                  : (meData?.region ? [meData.region] : []);
                const showSwitcher = isAdmin || assignedRegions.length > 1;

                if (showSwitcher) {
                  const filteredRegions = isAdmin
                    ? GPP_REGIONS
                    : GPP_REGIONS.filter(r => assignedRegions.includes(r.id));

                  return (
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
                          <div className="absolute top-full left-0 mt-2 z-50 bg-white border border-white/10 rounded-xl shadow-2xl py-2 min-w-[220px]">
                            {/* All Regions option for admins */}
                            {isAdmin && (
                              <>
                                <button
                                  key="all"
                                  onClick={() => handleRegionSwitch('all')}
                                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                                    region === 'all'
                                      ? 'bg-red-500/20 text-red-500 font-medium'
                                      : 'text-white/70 hover:bg-white/5 hover:text-white'
                                  }`}
                                >
                                  All Regions
                                </button>
                                {/* Divider */}
                                <div className="border-b border-white/10 my-1" />
                              </>
                            )}
                            {filteredRegions.map((r) => (
                              <button
                                key={r.id}
                                onClick={() => handleRegionSwitch(r.id)}
                                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                                  r.id === region
                                    ? 'bg-red-500/20 text-red-500 font-medium'
                                    : 'text-white/70 hover:bg-white/5 hover:text-white'
                                }`}
                              >
                                {r.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                } else {
                  return <h1 className="text-2xl font-bold text-white">{regionLabel}</h1>;
                }
              })()}
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
                  ? `Signed in as Admin (${data.underboss.email})`
                  : `Signed in as ${data.underboss.name}`}
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
          <RegionStats stats={data.stats} />
        </section>

        {/* Events Table */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">
            Events ({data.events.length})
          </h2>
          <EventTable events={data.events} showRegion={region === 'all'} />
        </section>
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
