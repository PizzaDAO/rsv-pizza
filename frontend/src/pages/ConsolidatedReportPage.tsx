import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useSearchParams, Link } from 'react-router-dom';
import { Loader2, Shield, FileText, ArrowLeft } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { LoginModal } from '../components/LoginModal';
import { Checkbox } from '../components/Checkbox';
import { useAuth } from '../contexts/AuthContext';
import { fetchSponsorMe, fetchSponsorConsolidatedReport } from '../lib/api';
import { ConsolidatedReportPreview } from '../components/report/ConsolidatedReportPreview';
import type { SponsorMeResponse, ConsolidatedReport } from '../types';

const themeClass = 'gpp-theme';
const backgroundStyle = { background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)' } as React.CSSProperties;

// pecorino-64118: private consolidated cross-event report at /partner/report.
// Partner-login-only — no public slug/password. Rolls up everything the partner
// can access into one view.
export function ConsolidatedReportPage() {
  const { t } = useTranslation('partner');
  const { user, loading: authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tagParam = searchParams.get('tag') || undefined;
  // pecorino-64118 follow-up: admin-only "Approved events only" opt-in.
  // Read from URL so the filter persists across reloads / shares.
  const approvedOnlyParam = ['1', 'true', 'yes'].includes(
    (searchParams.get('approvedOnly') || '').toLowerCase()
  );

  // Set body class for elements outside React tree
  useEffect(() => {
    document.body.classList.add('gpp-theme-active');
    return () => { document.body.classList.remove('gpp-theme-active'); };
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);
  const [meData, setMeData] = useState<SponsorMeResponse | null>(null);
  const [report, setReport] = useState<ConsolidatedReport | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setLoading(false);
      return;
    }

    async function load() {
      try {
        const me = await fetchSponsorMe();
        setMeData(me);

        if (!me.isSponsor) {
          setLoading(false);
          return;
        }

        // Resolve tag: explicit ?tag= wins; else for a single-tag partner use their tag.
        const resolvedTag = tagParam
          || (!me.isAdmin && me.sponsor?.tag)
          || undefined;

        try {
          const data = await fetchSponsorConsolidatedReport(resolvedTag, approvedOnlyParam);
          setReport(data);
        } catch (err: any) {
          // Backend not deployed yet (preview talks to prod backend) → friendly state.
          const msg = String(err?.message || '');
          if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
            setNotAvailable(true);
          } else {
            throw err;
          }
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load consolidated report');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user, authLoading, tagParam, approvedOnlyParam]);

  // pecorino-64118 follow-up: toggle the approvedOnly URL param (admin-only).
  // useSearchParams will trigger the load effect above to re-fetch.
  const handleToggleApprovedOnly = () => {
    const next = new URLSearchParams(searchParams);
    if (approvedOnlyParam) {
      next.delete('approvedOnly');
    } else {
      next.set('approvedOnly', '1');
    }
    setSearchParams(next, { replace: true });
  };

  // Loading state
  if (authLoading || loading) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-theme-text-muted" />
        </div>
        <Footer />
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-theme-text-faint mb-4" />
          <h1 className="text-2xl font-bold text-theme-text mb-2">{t('consolidated.title', { name: '' }).trim() || t('title')}</h1>
          <p className="text-theme-text-muted text-center max-w-md mb-6">{t('loginPrompt')}</p>
          <button
            onClick={() => setShowLoginModal(true)}
            className="px-6 py-2 bg-[#E52828] text-white rounded-xl text-sm font-medium hover:bg-[#CC2020] transition-colors"
          >
            {t('logIn')}
          </button>
        </div>
        <Footer />
        <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-red-400/60 mb-4" />
          <h1 className="text-2xl font-bold text-theme-text mb-2">{t('error')}</h1>
          <p className="text-theme-text-muted text-center max-w-md">{error}</p>
        </div>
        <Footer />
      </div>
    );
  }

  // Not a partner
  if (!meData?.isSponsor) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-theme-text-faint mb-4" />
          <h1 className="text-2xl font-bold text-theme-text mb-2">{t('accessDenied')}</h1>
          <p className="text-theme-text-muted text-center max-w-md">{t('accessDeniedDesc')}</p>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${themeClass} relative overflow-hidden`} style={backgroundStyle}>
      <Helmet>
        <title>{t('consolidated.pageTitle')} | RSV.Pizza</title>
      </Helmet>

      <Header />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        <div className="rounded-2xl p-6 sm:p-8" style={{ background: 'rgba(240, 240, 240, 0.95)' }}>
          <Link
            to={tagParam ? `/partner?tag=${encodeURIComponent(tagParam)}` : '/partner'}
            className="inline-flex items-center gap-1.5 text-sm text-theme-text-muted hover:text-theme-text-secondary transition-colors mb-6"
          >
            <ArrowLeft size={14} />
            {t('consolidated.backToDashboard')}
          </Link>

          {notAvailable ? (
            <div className="text-center py-16">
              <FileText size={48} className="text-theme-text-faint mx-auto mb-4" />
              <h1 className="text-xl font-semibold text-theme-text mb-2">{t('consolidated.notAvailableTitle')}</h1>
              <p className="text-theme-text-muted max-w-md mx-auto">{t('consolidated.notAvailableDesc')}</p>
            </div>
          ) : report ? (
            <>
              {/* pecorino-64118 follow-up: admin-only "Approved events only" toggle.
                  Non-admins are already server-scoped to approved+non-cancelled. */}
              {report.isAdmin && (
                <div className="mb-4 flex justify-end">
                  <Checkbox
                    checked={!!report.approvedOnly}
                    onChange={handleToggleApprovedOnly}
                    label={t('consolidated.approvedOnly')}
                    labelClassName="text-sm text-theme-text-secondary"
                  />
                </div>
              )}
              <ConsolidatedReportPreview report={report} />
            </>
          ) : (
            <div className="text-center py-16">
              <FileText size={48} className="text-theme-text-faint mx-auto mb-4" />
              <p className="text-theme-text-muted">{t('consolidated.notAvailableDesc')}</p>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
