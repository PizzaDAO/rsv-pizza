import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Shield, Building2, Info } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { LoginModal } from '../components/LoginModal';
import { useAuth } from '../contexts/AuthContext';
import { fetchBizdevReport, BizdevReportError } from '../lib/api';
import type { BizdevReport, BizdevBucket } from '../lib/api';

const themeClass = 'gpp-theme';
const backgroundStyle = {
  background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)',
} as React.CSSProperties;

// soppressata-72251: per-partner BizDev industry report at /partner/bizdev?partner={tag}.
// Companies-only (NO PII — domains never tied to a guest name/email). Scope is
// approved GPP events; the partner only changes which buckets are FEATURED.
//
// NOTE: the data comes from the backend /api/bizdev endpoint, which only ships
// from master. On Vercel preview branches the page renders but the fetch 404s
// (preview frontend → prod backend that doesn't yet have the route), so the
// "report not available yet" state is expected until backend deploys.
export function PartnerBizdevPage() {
  const { user, loading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const partnerParam = (searchParams.get('partner') || '').trim();

  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<BizdevReport | null>(null);
  const [errStatus, setErrStatus] = useState<number | null>(null);
  const [errMessage, setErrMessage] = useState<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Set body class for elements outside the React tree (matches ConsolidatedReportPage).
  useEffect(() => {
    document.body.classList.add('gpp-theme-active');
    return () => { document.body.classList.remove('gpp-theme-active'); };
  }, []);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setErrStatus(401);
      setLoading(false);
      return;
    }

    if (!partnerParam) {
      setErrStatus(404);
      setErrMessage('No partner specified.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErrStatus(null);
    setErrMessage(null);

    fetchBizdevReport(partnerParam)
      .then((data) => { if (!cancelled) setReport(data); })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof BizdevReportError) {
          setErrStatus(err.status);
          setErrMessage(err.message);
        } else {
          setErrStatus(500);
          setErrMessage(err instanceof Error ? err.message : 'Failed to load report');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [user, authLoading, partnerParam]);

  const shell = (children: React.ReactNode) => (
    <div className={`min-h-screen ${themeClass} relative overflow-hidden`} style={backgroundStyle}>
      <Helmet>
        <title>Partner BizDev Report | RSV.Pizza</title>
      </Helmet>
      <Header />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 relative z-10">{children}</main>
      <Footer />
    </div>
  );

  // Loading
  if (authLoading || loading) {
    return shell(
      <div className="flex items-center justify-center py-32">
        <Loader2 size={32} className="animate-spin text-theme-text-muted" />
      </div>
    );
  }

  // 401 — logged out
  if (errStatus === 401) {
    return shell(
      <div className="flex flex-col items-center justify-center px-4 py-32 text-center">
        <Shield size={48} className="text-theme-text-faint mb-4" />
        <h1 className="text-2xl font-bold text-theme-text mb-2">Partner BizDev Report</h1>
        <p className="text-theme-text-muted max-w-md mb-6">
          Log in with your partner account to view your industry RSVP report.
        </p>
        <button
          onClick={() => setShowLoginModal(true)}
          className="px-6 py-2 bg-[#E52828] text-[#ffffff] rounded-xl text-sm font-medium hover:bg-[#CC2020] transition-colors"
        >
          Log in
        </button>
        <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
      </div>
    );
  }

  // 403 — not authorized for this partner
  if (errStatus === 403) {
    return shell(
      <div className="flex flex-col items-center justify-center px-4 py-32 text-center">
        <Shield size={48} className="text-red-400/60 mb-4" />
        <h1 className="text-2xl font-bold text-theme-text mb-2">Not authorized</h1>
        <p className="text-theme-text-muted max-w-md">
          You’re signed in, but your account isn’t authorized to view this partner’s report.
        </p>
      </div>
    );
  }

  // 404 — unknown partner / no partner
  if (errStatus === 404) {
    return shell(
      <div className="flex flex-col items-center justify-center px-4 py-32 text-center">
        <Building2 size={48} className="text-theme-text-faint mb-4" />
        <h1 className="text-2xl font-bold text-theme-text mb-2">Unknown partner</h1>
        <p className="text-theme-text-muted max-w-md">
          {errMessage || `No BizDev report exists for “${partnerParam}”.`}
        </p>
      </div>
    );
  }

  // Other errors (incl. backend not yet deployed on preview → typically a
  // network/parse failure rather than a clean status).
  if (errStatus || !report) {
    return shell(
      <div className="flex flex-col items-center justify-center px-4 py-32 text-center">
        <Info size={48} className="text-theme-text-faint mb-4" />
        <h1 className="text-xl font-semibold text-theme-text mb-2">Report not available</h1>
        <p className="text-theme-text-muted max-w-md">
          {errMessage || 'This report could not be loaded right now. If you’re on a preview deploy, the BizDev endpoint only ships from the production backend.'}
        </p>
      </div>
    );
  }

  const { coverage } = report;
  const hasFeatured = report.featured.some((b) => b.companies.length > 0);
  const hasOther = report.other.some((b) => b.companies.length > 0);

  return shell(
    <div
      className="rounded-2xl p-6 sm:p-8"
      style={{ background: 'rgba(240, 240, 240, 0.95)' }}
    >
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs uppercase tracking-wide text-theme-text-faint mb-1">
          BizDev report · approved GPP events
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-theme-text">{report.label}</h1>
        {report.blurb && (
          <p className="text-sm text-theme-text-muted mt-1">{report.blurb}</p>
        )}
      </div>

      {/* Coverage banner */}
      <div className="rounded-xl border border-black/10 bg-white/70 p-4 mb-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
          <Stat label="Approved events" value={coverage.events} />
          <Stat label="Companies" value={coverage.distinctCompanies} />
          <Stat label="Matched RSVPs" value={coverage.matched} />
          <Stat label="Total RSVPs" value={coverage.totalEmails} />
        </div>
        <p className="flex items-start gap-2 text-xs text-theme-text-muted">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            These counts are a <strong>floor, not a census</strong>. Most guests RSVP with a
            personal email, so company affiliation is only visible for the{' '}
            {coverage.matched.toLocaleString()} of {coverage.totalEmails.toLocaleString()} RSVPs on a
            recognizable work domain. No personal data (names or emails) is shown — only companies
            inferred from email domains. <em>(inferred)</em> marks a keyword-matched domain we
            couldn’t verify.
          </span>
        </p>
      </div>

      {/* Featured (lens) buckets */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-theme-text mb-1">Featured for {report.label}</h2>
        <p className="text-xs text-theme-text-muted mb-4">
          Industries most relevant to your lens.
        </p>
        {hasFeatured ? (
          <div className="space-y-6">
            {report.featured
              .filter((b) => b.companies.length > 0)
              .map((bucket) => (
                <BucketBlock key={bucket.bucketId} bucket={bucket} />
              ))}
          </div>
        ) : (
          <p className="text-sm text-theme-text-muted py-4">
            No companies matched your featured industries yet.
          </p>
        )}
      </section>

      {/* Other industries */}
      {hasOther && (
        <section>
          <h2 className="text-lg font-semibold text-theme-text mb-1">Other industries</h2>
          <p className="text-xs text-theme-text-muted mb-4">
            Companies that RSVP’d outside your lens.
          </p>
          <div className="space-y-6">
            {report.other
              .filter((b) => b.companies.length > 0)
              .map((bucket) => (
                <BucketBlock key={bucket.bucketId} bucket={bucket} />
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-bold text-theme-text">{value.toLocaleString()}</div>
      <div className="text-xs text-theme-text-muted">{label}</div>
    </div>
  );
}

function BucketBlock({ bucket }: { bucket: BizdevBucket }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold text-theme-text">{bucket.label}</h3>
        <span className="text-xs text-theme-text-faint">
          {bucket.companies.length} {bucket.companies.length === 1 ? 'company' : 'companies'}
        </span>
      </div>
      <div className="rounded-xl border border-black/10 bg-white/70 divide-y divide-black/5">
        {bucket.companies.map((c) => (
          <div
            key={`${bucket.bucketId}::${c.company}`}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0 flex items-center gap-2">
              <span className="truncate text-sm text-theme-text">{c.company}</span>
              {c.confidence === 'medium' && (
                <span className="shrink-0 text-[11px] text-theme-text-faint italic">(inferred)</span>
              )}
            </div>
            <div className="shrink-0 text-xs text-theme-text-muted tabular-nums">
              {c.rsvpCount.toLocaleString()} RSVP{c.rsvpCount === 1 ? '' : 's'}
              {' · '}
              {c.eventCount} {c.eventCount === 1 ? 'event' : 'events'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
