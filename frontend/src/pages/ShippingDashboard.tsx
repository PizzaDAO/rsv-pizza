import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Loader2, Shield, AlertCircle, Truck, ChevronDown, LogIn, Check } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { LoginModal } from '../components/LoginModal';
import { KitStats, KitFilters, KitTable, KitDetailModal, CsvImportModal, CoordinatorManager, KitContentsModal } from '../components/shipping';
import {
  fetchShippingMe,
  fetchShippingKits,
  fetchShippingStats,
  updateShippingKit,
  bulkUpdateShippingKits,
  exportShippingKitsCsv,
} from '../lib/api';
import type { ShippingKitFilters } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { GPP_REGIONS } from '../types';
import type { ShippingKit, ShippingKitStats, ShippingMeResponse } from '../types';

export function ShippingDashboard() {
  const { t } = useTranslation('admin');
  const { user, loading: authLoading } = useAuth();
  const themeClass = 'gpp-theme';
  const backgroundStyle = { background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)' } as React.CSSProperties;

  // Set body class for elements outside React tree
  useEffect(() => {
    document.body.classList.add('gpp-theme-active');
    return () => { document.body.classList.remove('gpp-theme-active'); };
  }, []);

  const [meData, setMeData] = useState<ShippingMeResponse | null>(null);
  const [kits, setKits] = useState<ShippingKit[]>([]);
  const [stats, setStats] = useState<ShippingKitStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [sortField, setSortField] = useState('requestedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Region selector
  const [selectedRegion, setSelectedRegion] = useState<string>('');
  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);

  // Detail modal
  const [detailKit, setDetailKit] = useState<ShippingKit | null>(null);

  // Exporting
  const [exporting, setExporting] = useState(false);

  // CSV import modal
  const [showImportModal, setShowImportModal] = useState(false);

  // Kit contents modal
  const [showKitContents, setShowKitContents] = useState(false);

  // Available regions based on role
  const availableRegions = useMemo(() => {
    if (!meData) return [];
    if (meData.role === 'admin') return GPP_REGIONS.map((r) => r.id);
    return meData.regions;
  }, [meData]);

  // Region label for header
  const regionLabel = useMemo(() => {
    if (!selectedRegion || selectedRegion === '') {
      return t('shipping.allRegions');
    }
    return GPP_REGIONS.find((r) => r.id === selectedRegion)?.label || selectedRegion;
  }, [selectedRegion, t]);

  // Load kits and stats
  const loadData = useCallback(async () => {
    try {
      const filters: ShippingKitFilters = {};
      if (statusFilter) filters.status = statusFilter;
      if (countryFilter) filters.country = countryFilter;
      if (searchTerm) filters.search = searchTerm;
      if (selectedRegion) filters.region = selectedRegion;

      const [kitsResult, statsResult] = await Promise.all([
        fetchShippingKits(filters),
        fetchShippingStats(),
      ]);

      setKits(kitsResult.kits);
      setStats(statsResult.stats);
    } catch (err: any) {
      console.error('Failed to load shipping data:', err);
    }
  }, [statusFilter, countryFilter, searchTerm, selectedRegion]);

  // Initial access check
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }

    async function checkAccess() {
      try {
        const me = await fetchShippingMe();
        setMeData(me);

        if (!me.role) {
          setLoading(false);
          setError('You are not authorized to access the shipping dashboard.');
          return;
        }

        // Auto-select single region for single-region coordinators
        if (me.role === 'coordinator' && me.regions.length === 1) {
          setSelectedRegion(me.regions[0]);
        }
      } catch (err: any) {
        setLoading(false);
        setError(err.message || 'Failed to check access');
      }
    }

    checkAccess();
  }, [user, authLoading]);

  // Load data when access is confirmed
  useEffect(() => {
    if (!meData || !meData.role) return;

    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [meData, loadData]);

  // Unique countries from kit data
  const countries = useMemo(() => {
    const set = new Set(kits.map((k) => k.country));
    return Array.from(set).sort();
  }, [kits]);

  // Handle sort
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Client-side sort
  const sortedKits = useMemo(() => {
    const sorted = [...kits];
    sorted.sort((a, b) => {
      const aVal = (a as any)[sortField] ?? '';
      const bVal = (b as any)[sortField] ?? '';
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [kits, sortField, sortDir]);

  // Handle single kit status change
  const handleStatusChange = async (kitId: string, status: string) => {
    // Optimistic update
    setKits((prev) =>
      prev.map((k) => (k.id === kitId ? { ...k, status: status as any } : k))
    );
    try {
      await updateShippingKit(kitId, { status });
      // Refresh stats
      const statsResult = await fetchShippingStats();
      setStats(statsResult.stats);
    } catch (err) {
      // Revert on failure
      loadData();
    }
  };

  // Handle tier change
  const handleTierChange = async (kitId: string, tier: string) => {
    setKits((prev) =>
      prev.map((k) => (k.id === kitId ? { ...k, allocatedTier: tier as any } : k))
    );
    try {
      await updateShippingKit(kitId, { allocatedTier: tier });
    } catch (err) {
      loadData();
    }
  };

  // Handle tracking change
  const handleTrackingChange = async (kitId: string, trackingNumber: string, trackingUrl: string) => {
    try {
      await updateShippingKit(kitId, { trackingNumber, trackingUrl });
      setKits((prev) =>
        prev.map((k) => (k.id === kitId ? { ...k, trackingNumber, trackingUrl } : k))
      );
    } catch (err) {
      console.error('Failed to update tracking:', err);
    }
  };

  // Handle detail modal save
  const handleDetailUpdate = async (kitId: string, data: any) => {
    try {
      const result = await updateShippingKit(kitId, data);
      setKits((prev) =>
        prev.map((k) => (k.id === kitId ? result.kit : k))
      );
      const statsResult = await fetchShippingStats();
      setStats(statsResult.stats);
    } catch (err) {
      loadData();
    }
  };

  // Handle bulk update
  const handleBulkUpdate = async (kitIds: string[], updates: { status?: string; allocatedTier?: string }) => {
    try {
      await bulkUpdateShippingKits(kitIds, updates);
      loadData();
    } catch (err) {
      console.error('Failed to bulk update:', err);
    }
  };

  // Handle CSV export
  const handleExport = async () => {
    setExporting(true);
    try {
      const filters: ShippingKitFilters = {};
      if (statusFilter) filters.status = statusFilter;
      if (countryFilter) filters.country = countryFilter;
      if (searchTerm) filters.search = searchTerm;
      if (selectedRegion) filters.region = selectedRegion;

      const blob = await exportShippingKitsCsv(filters);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'shipping-kits-export.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Failed to export CSV:', err);
    } finally {
      setExporting(false);
    }
  };

  // Handle status filter from stat cards
  const handleStatCardFilter = (status: string | null) => {
    setStatusFilter(status || '');
  };

  // Show multi-region selector?
  const showRegionSelector = availableRegions.length > 1;
  const showRegionColumn = !selectedRegion || availableRegions.length > 1;
  const filteredGppRegions = GPP_REGIONS.filter((r) => availableRegions.includes(r.id));

  // Not logged in
  if (!authLoading && !user) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <Shield size={48} className="mx-auto mb-4 text-red-500/60" />
          <h1 className="text-2xl font-bold text-theme-text mb-2">{t('shipping.title')}</h1>
          <p className="text-theme-text-muted mb-6">
            {t('shipping.loginPrompt')}
          </p>
          <button
            onClick={() => setShowLoginModal(true)}
            className="inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-xl font-medium transition-colors"
          >
            <LogIn size={18} />
            {t('shipping.logIn')}
          </button>
        </div>
        <Footer />
        <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
      </div>
    );
  }

  // Loading
  if (loading || authLoading) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex flex-col items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-theme-text-muted mb-4" />
          <p className="text-theme-text-muted text-sm">{t('shipping.loading')}</p>
        </div>
        <Footer />
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <AlertCircle size={48} className="mx-auto mb-4 text-red-400/60" />
          <h1 className="text-2xl font-bold text-theme-text mb-2">{t('shipping.accessDenied')}</h1>
          <p className="text-theme-text-muted">{error}</p>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${themeClass} relative overflow-hidden`} style={backgroundStyle}>
      {/* Floating deco */}
      <img src="/gpp-cloud-1.png" alt="" className="absolute pointer-events-none select-none hidden md:block" style={{ top: '5%', right: '-4%', width: 280, opacity: 0.5, animation: 'drift-right 14s ease-in-out infinite' }} />
      <img src="/gpp-cloud-2.png" alt="" className="absolute pointer-events-none select-none hidden md:block" style={{ top: '2%', left: '-2%', width: 150, opacity: 0.5, animation: 'drift-left 12s ease-in-out infinite' }} />
      <img src="/gpp-cloud-3.png" alt="" className="absolute pointer-events-none select-none" style={{ top: '35%', left: '1%', width: 100, opacity: 0.4, animation: 'drift-right 16s ease-in-out infinite' }} />

      <Helmet>
        <title>{regionLabel} | Shipping Dashboard</title>
      </Helmet>

      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        <div className="rounded-2xl p-6 sm:p-8" style={{ background: 'rgba(240, 240, 240, 0.95)' }}>
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                <Truck size={20} className="text-red-500" />
              </div>
              <div>
                {showRegionSelector ? (
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
                        <div className="fixed inset-0 z-40" onClick={() => setRegionDropdownOpen(false)} />
                        <div className="absolute top-full left-0 mt-2 z-50 bg-theme-card border border-theme-stroke rounded-xl shadow-2xl py-2 min-w-[240px]">
                          {/* All Regions */}
                          <button
                            onClick={() => { setSelectedRegion(''); setRegionDropdownOpen(false); }}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
                              selectedRegion === '' ? 'text-red-500 font-medium' : 'text-theme-text-secondary hover:bg-theme-surface hover:text-theme-text'
                            }`}
                          >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                              selectedRegion === '' ? 'bg-red-500 border-red-500' : 'border-theme-stroke-hover'
                            }`}>
                              {selectedRegion === '' && <Check size={12} className="text-white" />}
                            </div>
                            {t('shipping.allRegions')}
                          </button>
                          <div className="border-b border-theme-stroke my-1" />
                          {filteredGppRegions.map((r) => (
                            <button
                              key={r.id}
                              onClick={() => { setSelectedRegion(r.id); setRegionDropdownOpen(false); }}
                              className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
                                selectedRegion === r.id ? 'text-red-500 font-medium' : 'text-theme-text-secondary hover:bg-theme-surface hover:text-theme-text'
                              }`}
                            >
                              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                                selectedRegion === r.id ? 'bg-red-500 border-red-500' : 'border-theme-stroke-hover'
                              }`}>
                                {selectedRegion === r.id && <Check size={12} className="text-white" />}
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
                  {t('shipping.subtitle')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3 text-sm text-theme-text-faint">
              <Shield size={14} />
              <span>
                {meData?.role === 'admin'
                  ? t('shipping.signedInAdmin', { email: meData.email })
                  : t('shipping.signedInAs', { name: meData?.name || meData?.email })}
              </span>
            </div>
          </div>

          {/* Stats */}
          {stats && (
            <section className="mb-6">
              <KitStats
                stats={stats}
                onStatusFilter={handleStatCardFilter}
                activeStatus={statusFilter || null}
              />
            </section>
          )}

          {/* Filters */}
          <section className="mb-6">
            <KitFilters
              statusFilter={statusFilter}
              onStatusFilter={setStatusFilter}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              countryFilter={countryFilter}
              onCountryFilter={setCountryFilter}
              countries={countries}
              onExport={handleExport}
              exporting={exporting}
              onImport={() => setShowImportModal(true)}
              onShowKitContents={() => setShowKitContents(true)}
            />
          </section>

          {/* Kit Table */}
          <section>
            <h2 className="text-lg font-semibold text-theme-text mb-4">
              {t('shipping.kitRequests', { count: kits.length })}
            </h2>
            <KitTable
              kits={sortedKits}
              onStatusChange={handleStatusChange}
              onTierChange={handleTierChange}
              onTrackingChange={handleTrackingChange}
              onViewDetail={setDetailKit}
              onBulkUpdate={handleBulkUpdate}
              showRegion={showRegionColumn}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
            />
          </section>

          {/* Coordinator Manager (admin only) */}
          {meData?.role === 'admin' && <CoordinatorManager />}
        </div>
      </main>

      <Footer />

      {/* Kit Detail Modal */}
      {detailKit && (
        <KitDetailModal
          kit={detailKit}
          onClose={() => setDetailKit(null)}
          onUpdate={handleDetailUpdate}
        />
      )}

      {/* CSV Import Modal */}
      {showImportModal && (
        <CsvImportModal
          onClose={() => setShowImportModal(false)}
          onSuccess={() => loadData()}
        />
      )}

      {/* Kit Contents Modal */}
      {showKitContents && (
        <KitContentsModal
          onClose={() => setShowKitContents(false)}
        />
      )}
    </div>
  );
}
