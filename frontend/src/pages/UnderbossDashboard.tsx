import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, Shield, AlertCircle, Globe, ChevronDown, LogIn } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { LoginModal } from '../components/LoginModal';
import { RegionStats, EventTable } from '../components/underboss';
import { fetchUnderbossDashboard, fetchUnderbossMe } from '../lib/api';
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

  const regionLabel = GPP_REGIONS.find((r) => r.id === region)?.label || region || 'Unknown';

  const loadDashboard = useCallback(async (targetRegion: string) => {
    setLoading(true);
    setError(null);

    const validRegions = GPP_REGIONS.map((r) => r.id);
    if (!validRegions.includes(targetRegion as GPPRegion)) {
      setError(`Invalid region: ${targetRegion}`);
      setLoading(false);
      return;
    }

    try {
      const result = await fetchUnderbossDashboard(targetRegion as GPPRegion);
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
        } else if (me.isUnderboss && me.region) {
          setIsAdmin(false);
          // Underboss: auto-redirect to their region
          if (!region || region !== me.region) {
            navigate(`/underboss/${me.region}`, { replace: true });
          }
          loadDashboard(me.region);
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
  const handleRegionSwitch = (newRegion: GPPRegion) => {
    setRegionDropdownOpen(false);
    navigate(`/underboss/${newRegion}`);
  };

  // Not logged in
  if (!authLoading && !user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
        <Header />
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <Shield size={48} className="mx-auto mb-4 text-orange-400/60" />
          <h1 className="text-2xl font-bold text-white mb-2">Underboss Dashboard</h1>
          <p className="text-white/50 mb-6">
            Please log in to access the underboss dashboard.
          </p>
          <button
            onClick={() => setShowLoginModal(true)}
            className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-xl font-medium transition-colors"
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
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
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
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
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
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      <Helmet>
        <title>{regionLabel} Dashboard | GPP Underboss</title>
      </Helmet>

      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
              <Globe size={20} className="text-orange-400" />
            </div>
            <div>
              {/* Region title with switcher for admins */}
              {isAdmin ? (
                <div className="relative">
                  <button
                    onClick={() => setRegionDropdownOpen(!regionDropdownOpen)}
                    className="flex items-center gap-2 text-2xl font-bold text-white hover:text-orange-300 transition-colors"
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
                      <div className="absolute top-full left-0 mt-2 z-50 bg-gray-800 border border-white/10 rounded-xl shadow-2xl py-2 min-w-[220px]">
                        {GPP_REGIONS.map((r) => (
                          <button
                            key={r.id}
                            onClick={() => handleRegionSwitch(r.id)}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                              r.id === region
                                ? 'bg-orange-500/20 text-orange-300 font-medium'
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
              ) : (
                <h1 className="text-2xl font-bold text-white">{regionLabel}</h1>
              )}
              <p className="text-sm text-white/40">
                Global Pizza Party &middot; Underboss Dashboard
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3 text-sm text-white/30">
            <Shield size={14} />
            <span>
              {isAdmin
                ? `Signed in as Admin (${data.underboss.email})`
                : `Signed in as ${data.underboss.name}`}
            </span>
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
          <EventTable events={data.events} />
        </section>
      </main>

      <Footer />
    </div>
  );
}
