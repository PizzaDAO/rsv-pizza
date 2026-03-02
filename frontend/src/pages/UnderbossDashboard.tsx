import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, Shield, AlertCircle, Globe } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { RegionStats, EventTable } from '../components/underboss';
import { fetchUnderbossDashboard } from '../lib/api';
import { GPP_REGIONS } from '../types';
import type { UnderbossDashboardData, GPPRegion } from '../types';

export function UnderbossDashboard() {
  const { region } = useParams<{ region: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [data, setData] = useState<UnderbossDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const regionLabel = GPP_REGIONS.find((r) => r.id === region)?.label || region || 'Unknown';

  useEffect(() => {
    if (!region || !token) {
      setError('Missing region or access token');
      setLoading(false);
      return;
    }

    const validRegions = GPP_REGIONS.map((r) => r.id);
    if (!validRegions.includes(region as GPPRegion)) {
      setError(`Invalid region: ${region}`);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetchUnderbossDashboard(region as GPPRegion, token)
      .then((result) => {
        setData(result);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load dashboard');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [region, token]);

  // Error state - no token
  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
        <Header />
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <Shield size={48} className="mx-auto mb-4 text-red-400/60" />
          <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-white/50">
            This dashboard requires an access token. Please use the link provided to you.
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
        <Header />
        <div className="flex flex-col items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-white/40 mb-4" />
          <p className="text-white/40 text-sm">Loading {regionLabel} dashboard...</p>
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
              <h1 className="text-2xl font-bold text-white">{regionLabel}</h1>
              <p className="text-sm text-white/40">
                Global Pizza Party &middot; Underboss Dashboard
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3 text-sm text-white/30">
            <Shield size={14} />
            <span>Signed in as {data.underboss.name}</span>
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
