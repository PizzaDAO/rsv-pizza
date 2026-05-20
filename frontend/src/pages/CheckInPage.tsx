import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { Layout } from '../components/Layout';
import { Loader2, CheckCircle2, XCircle, AlertCircle, QrCode } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { vouchForGuest, checkInGuest, getDiscountStatus, claimDiscount, type Attestation } from '../lib/api';
import { CheckInQRDisplay } from '../components/CheckInQRDisplay';
import { GPPClouds } from '../components/GPPClouds';

// provolone-39042: friendly display name for an attestation row.
const attestationDisplay = (a: Attestation): string => a.name || a.email || 'someone';

const DISCOUNT_CLOUDS = [
  // Mobile clouds — above and below content
  { src: '/gpp-cloud-2.png', top: '4%', left: '-8%', width: 140, anim: 'cloud-drift-left 40s ease-in-out infinite' },
  { src: '/gpp-cloud-3.png', top: '10%', right: '-5%', width: 110, anim: 'cloud-drift-right 48s ease-in-out infinite' },
  { src: '/gpp-cloud-1.png', bottom: '12%', left: '-5%', width: 130, anim: 'cloud-drift-left 44s ease-in-out infinite', flip: true },
  { src: '/gpp-cloud-2.png', bottom: '6%', right: '-8%', width: 120, anim: 'cloud-drift-right 52s ease-in-out infinite' },
  // Desktop extras — sides
  { src: '/gpp-cloud-1.png', top: '20%', left: '-4%', width: 260, anim: 'cloud-drift-left 50s ease-in-out infinite', mdOnly: true },
  { src: '/gpp-cloud-1.png', top: '55%', right: '-3%', width: 240, anim: 'cloud-drift-right 46s ease-in-out infinite', flip: true, mdOnly: true },
] as const;

const C = {
  skyTop: '#7EC8E3',
  skyBot: '#B6E4F7',
  red: '#E52828',
  green: '#2E7D32',
  darkText: '#1a1a1a',
  mutedText: '#555',
  cardBg: 'rgba(255,255,255,0.92)',
  cardBorder: 'rgba(0,0,0,0.08)',
};

type CheckInState = 'loading' | 'show-qr' | 'vouching' | 'success' | 'already-checked-in' | 'not-checked-in' | 'unauthorized' | 'error' | 'not-found' | 'discount-available' | 'discount-claimed' | 'discount-ineligible';

export function CheckInPage() {
  const { inviteCode, guestId } = useParams<{ inviteCode: string; guestId: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation('checkin');

  const [state, setState] = useState<CheckInState>('loading');
  const [guestName, setGuestName] = useState<string>('');
  const [checkedInAt, setCheckedInAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [hasAttempted, setHasAttempted] = useState(false);
  const [discountData, setDiscountData] = useState<any>(null);
  const [discountChecked, setDiscountChecked] = useState(false);
  // provolone-39042: check-in attribution history
  const [attestations, setAttestations] = useState<Attestation[]>([]);

  // Pre-auth discount check: if event has ended, show discount flow instead of check-in
  useEffect(() => {
    if (!inviteCode || !guestId || discountChecked) return;

    const checkDiscount = async () => {
      try {
        const status = await getDiscountStatus(inviteCode, guestId);
        setDiscountChecked(true);

        if (status.hasEnded) {
          setDiscountData(status);
          setGuestName(status.guestName);
          if (status.isCheckedIn && !status.discountClaimedAt) {
            setState('discount-available');
          } else if (status.isCheckedIn && status.discountClaimedAt) {
            setState('discount-claimed');
          } else {
            setState('discount-ineligible');
          }
          return;
        }
      } catch {
        // If discount check fails, fall through to normal check-in flow
      }
      setDiscountChecked(true);
    };

    checkDiscount();
  }, [inviteCode, guestId, discountChecked]);

  // Redirect to login if not authenticated (skip if discount flow is active, wait for discount check)
  useEffect(() => {
    if (!discountChecked) return;
    if (!authLoading && !user && state !== 'discount-available' && state !== 'discount-claimed' && state !== 'discount-ineligible') {
      const currentUrl = `/checkin/${inviteCode}/${guestId}`;
      sessionStorage.setItem('authReturnUrl', currentUrl);
      navigate(`/login?redirect=${encodeURIComponent(currentUrl)}`);
    }
  }, [authLoading, user, inviteCode, guestId, navigate, state, discountChecked]);

  // Determine what to show
  useEffect(() => {
    if (authLoading || !user || hasAttempted || !inviteCode || !guestId || !discountChecked) return;
    // Skip check-in flow if discount state is already resolved
    if (state === 'discount-available' || state === 'discount-claimed' || state === 'discount-ineligible') return;

    const determine = async () => {
      setHasAttempted(true);
      setState('loading');

      try {
        const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
        const token = localStorage.getItem('authToken');

        // Fetch target guest status
        const resp = await fetch(`${apiUrl}/api/checkin/${inviteCode}/${guestId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          if (resp.status === 403) {
            // User is not host, not target guest, and not checked in
            setState('not-checked-in');
            return;
          }
          if (resp.status === 404) {
            setState('not-found');
            setErrorMessage(errData.message || 'Guest or event not found');
            return;
          }
          throw new Error(errData.message || 'Failed to fetch check-in status');
        }

        const data = await resp.json();
        setGuestName(data.guest?.name || 'Guest');
        // provolone-39042: capture attestation history from GET response
        setAttestations(data.attestations || []);

        // If the target guest is already checked in
        if (data.isCheckedIn) {
          setState('already-checked-in');
          setCheckedInAt(data.guest?.checkedInAt);
          return;
        }

        // If caller IS the target guest — show QR code
        if (data.callerIsTarget) {
          setState('show-qr');
          return;
        }

        // If caller is host/co-host/admin — use the manual host-check-in route
        // (bypasses the peer-vouch "must be checked in" gate that doesn't honor admin roles)
        if (data.callerIsHost) {
          setState('vouching');
          try {
            const result = await checkInGuest(inviteCode, guestId);
            if (result.success) {
              setGuestName(result.guest?.name || guestName);
              setAttestations(result.attestations || []);
              if (result.alreadyCheckedIn) {
                setState('already-checked-in');
                setCheckedInAt(result.guest?.checkedInAt || null);
              } else {
                setState('success');
                setCheckedInAt(result.guest?.checkedInAt || null);
              }
            } else {
              setState('error');
              setErrorMessage(result.message || 'Check-in failed');
            }
          } catch (err: any) {
            setState('error');
            setErrorMessage(err.message || 'Check-in failed');
          }
          return;
        }

        // Otherwise: peer attestation (caller is a fellow checked-in guest)
        setState('vouching');
        try {
          const result = await vouchForGuest(inviteCode, guestId);
          if (result.success) {
            setGuestName(result.guest?.name || guestName);
            setAttestations(result.attestations || []);
            if (result.alreadyCheckedIn) {
              setState('already-checked-in');
              setCheckedInAt(result.guest?.checkedInAt || null);
            } else {
              setState('success');
              setCheckedInAt(result.guest?.checkedInAt || null);
            }
          } else {
            setState('error');
            setErrorMessage(result.message || 'Check-in failed');
          }
        } catch (err: any) {
          if (err.message?.includes('SELF_VOUCH') || err.message?.includes("can't check yourself")) {
            setState('show-qr');
          } else if (err.message?.includes('NOT_CHECKED_IN') || err.message?.includes('must be checked in')) {
            setState('not-checked-in');
          } else {
            setState('error');
            setErrorMessage(err.message || 'Check-in failed');
          }
        }
      } catch (error: any) {
        console.error('Check-in page error:', error);
        setState('error');
        setErrorMessage(error.message || 'An error occurred');
      }
    };

    determine();
  }, [authLoading, user, inviteCode, guestId, hasAttempted, state, discountChecked]);

  const handleClaimDiscount = async () => {
    try {
      const result = await claimDiscount(inviteCode!, guestId!);
      setDiscountData(result);
      setState('discount-claimed');
    } catch (err) {
      setState('error');
      setErrorMessage(t('postCheckIn.failedToClaim'));
    }
  };

  const formatCheckInTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  // provolone-39042: render "Checked in by X" + optional "Also vouched for by N more"
  const renderAttestationAttribution = () => {
    if (!attestations || attestations.length === 0) return null;
    const first = attestations[0];
    const extras = attestations.slice(1);
    const previewNames = extras.slice(0, 3).map(attestationDisplay).join(', ');
    const moreSuffix = extras.length > 3 ? `, +${extras.length - 3} more` : '';
    return (
      <div className="mt-3 space-y-1 text-sm">
        <p className="text-theme-text-secondary">
          {t('attribution.checkedInBy', { name: attestationDisplay(first) })}
        </p>
        {extras.length > 0 && (
          <p className="text-theme-text-muted text-xs">
            {t('attribution.alsoVouchedBy', {
              count: extras.length,
              names: previewNames + moreSuffix,
            })}
          </p>
        )}
      </div>
    );
  };

  const renderContent = () => {
    if (authLoading || state === 'loading' || state === 'vouching') {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 size={48} className="animate-spin text-[#ff393a] mb-4" />
          <p className="text-theme-text-secondary">
            {state === 'vouching' ? t('vouching') : t('loading')}
          </p>
        </div>
      );
    }

    if (state === 'discount-available') {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-6xl mb-4">🍕</div>
          <h2 className="text-2xl font-bold text-theme-text mb-2">{t('postCheckIn.claim10Title')}</h2>
          <p className="text-theme-text-secondary mb-6">{t('postCheckIn.claim10Desc')}</p>
          <button
            onClick={handleClaimDiscount}
            className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-8 rounded-lg text-lg transition-colors"
          >
            {t('postCheckIn.claimDiscount')}
          </button>
        </div>
      );
    }

    if (state === 'discount-claimed') {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mb-6">
            <CheckCircle2 size={48} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-green-400 mb-2">{t('postCheckIn.discountClaimedTitle')}</h2>
          <p className="text-theme-text-secondary mb-2">{t('postCheckIn.discountClaimedSubtitle')}</p>
          <p className="text-theme-text-muted text-sm">
            {t('postCheckIn.discountClaimedAt', { date: new Date(discountData?.discountClaimedAt || discountData?.claimedAt).toLocaleDateString() })}
          </p>
        </div>
      );
    }

    if (state === 'discount-ineligible') {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-theme-text mb-2">{t('postCheckIn.discountUnavailable')}</h2>
          <p className="text-theme-text-secondary">{t('postCheckIn.discountUnavailableDesc')}</p>
        </div>
      );
    }

    if (state === 'show-qr' && inviteCode && guestId) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-16 h-16 rounded-full bg-[#ff393a]/20 flex items-center justify-center mb-4">
            <QrCode size={32} className="text-[#ff393a]" />
          </div>
          <h2 className="text-xl font-bold text-theme-text mb-2">{t('postCheckIn.showQrCode')}</h2>
          <p className="text-theme-text-secondary text-sm mb-6 max-w-xs">
            {t('postCheckIn.qrDescription')}
          </p>
          <div className="bg-white rounded-xl p-4 inline-block mb-4">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(`https://rsv.pizza/checkin/${inviteCode}/${guestId}`)}`}
              alt="Check-in QR code"
              width={250}
              height={250}
              className="block"
            />
          </div>
          <p className="text-theme-text-muted text-xs">
            {guestName && <span className="block text-theme-text-secondary mb-1">{guestName}</span>}
            {t('postCheckIn.qrSubmsg')}
          </p>
        </div>
      );
    }

    if (state === 'success') {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mb-6">
            <CheckCircle2 size={48} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-theme-text mb-2">{t('success.title')}</h2>
          <p className="text-xl text-theme-text mb-4">{guestName}</p>
          {checkedInAt && (
            <p className="text-theme-text-muted text-sm flex items-center gap-2">
              <span>{formatCheckInTime(checkedInAt)}</span>
            </p>
          )}
          {renderAttestationAttribution()}
        </div>
      );
    }

    if (state === 'already-checked-in') {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-20 h-20 rounded-full bg-blue-500/20 flex items-center justify-center mb-6">
            <CheckCircle2 size={48} className="text-blue-500" />
          </div>
          <h2 className="text-2xl font-bold text-theme-text mb-2">{t('alreadyCheckedIn.title')}</h2>
          <p className="text-xl text-theme-text mb-4">{guestName}</p>
          {checkedInAt && (
            <p className="text-theme-text-muted text-sm flex items-center gap-2">
              <span>{t('alreadyCheckedIn.checkedInAt', { time: formatCheckInTime(checkedInAt) })}</span>
            </p>
          )}
          {renderAttestationAttribution()}
        </div>
      );
    }

    if (state === 'not-checked-in') {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-20 h-20 rounded-full bg-yellow-500/20 flex items-center justify-center mb-6">
            <AlertCircle size={48} className="text-yellow-500" />
          </div>
          <h2 className="text-2xl font-bold text-theme-text mb-2">{t('notCheckedIn.title')}</h2>
          <p className="text-theme-text-secondary mb-4 max-w-md">
            {t('notCheckedIn.message')}
          </p>
        </div>
      );
    }

    if (state === 'not-found') {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-20 h-20 rounded-full bg-gray-500/20 flex items-center justify-center mb-6">
            <XCircle size={48} className="text-gray-500" />
          </div>
          <h2 className="text-2xl font-bold text-theme-text mb-2">{t('notFound.title')}</h2>
          <p className="text-theme-text-secondary mb-4 max-w-md">{errorMessage}</p>
          <button onClick={() => navigate('/')} className="mt-4 btn-secondary">{t('notFound.goHome')}</button>
        </div>
      );
    }

    if (state === 'unauthorized') {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-20 h-20 rounded-full bg-yellow-500/20 flex items-center justify-center mb-6">
            <AlertCircle size={48} className="text-yellow-500" />
          </div>
          <h2 className="text-2xl font-bold text-theme-text mb-2">{t('unauthorized.title')}</h2>
          <p className="text-theme-text-secondary mb-4 max-w-md">{errorMessage}</p>
          <button onClick={() => navigate('/')} className="mt-4 btn-secondary">{t('unauthorized.goHome')}</button>
        </div>
      );
    }

    // Error state
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-20 h-20 rounded-full bg-[#ff393a]/20 flex items-center justify-center mb-6">
          <XCircle size={48} className="text-[#ff393a]" />
        </div>
        <h2 className="text-2xl font-bold text-theme-text mb-2">{t('error.title')}</h2>
        <p className="text-theme-text-secondary mb-4 max-w-md">{errorMessage}</p>
        <div className="flex gap-4 mt-4">
          <button
            onClick={() => { setHasAttempted(false); setState('loading'); }}
            className="btn-primary"
          >
            {t('error.tryAgain')}
          </button>
          <button onClick={() => navigate('/')} className="btn-secondary">{t('error.goHome')}</button>
        </div>
      </div>
    );
  };

  const renderDiscountContent = () => {
    if (state === 'discount-available') {
      return (
        <>
          <img src="/gpp-discount.png" alt="10% Discount" className="w-full max-w-xs md:max-w-md mx-auto mb-6 md:mb-8 rounded-2xl shadow-lg" />
          <button
            onClick={handleClaimDiscount}
            className="w-full max-w-xs md:max-w-md mx-auto flex items-center justify-center gap-2 py-4 md:py-5 text-lg md:text-xl font-semibold text-white rounded-xl transition-all hover:-translate-y-0.5"
            style={{ background: C.red }}
          >
            {t('postCheckIn.claim10Button')}
          </button>
          <p className="text-sm md:text-base mt-4" style={{ color: C.mutedText }}>{t('postCheckIn.oneTimeUse')}</p>
        </>
      );
    }

    if (state === 'discount-claimed') {
      return (
        <>
          <img src="/gpp-discount.png" alt="10% Discount" className="w-full max-w-xs md:max-w-md mx-auto mb-6 md:mb-8 rounded-2xl shadow-lg" />
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: `${C.green}22` }}>
            <CheckCircle2 className="w-9 h-9 md:w-12 md:h-12" style={{ color: C.green }} />
          </div>
          <h2 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: C.green }}>{t('postCheckIn.discountClaimedTitle')}</h2>
          <p className="text-sm md:text-base mb-2" style={{ color: C.darkText }}>{t('postCheckIn.discountClaimedSubtitle')}</p>
          <p className="text-xs md:text-sm" style={{ color: C.mutedText }}>
            {t('postCheckIn.discountClaimedAt', { date: new Date(discountData?.discountClaimedAt || discountData?.claimedAt).toLocaleDateString() })}
          </p>
        </>
      );
    }

    if (state === 'discount-ineligible') {
      return (
        <>
          <img src="/gpp-discount.png" alt="10% Discount" className="w-full max-w-xs md:max-w-md mx-auto mb-6 md:mb-8 rounded-2xl shadow-lg opacity-50" />
          <h2 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: C.darkText }}>{t('postCheckIn.discountUnavailable')}</h2>
          <p className="text-sm md:text-base" style={{ color: C.mutedText }}>{t('postCheckIn.discountUnavailableDesc')}</p>
        </>
      );
    }

    return null;
  };

  const renderDiscountPage = () => (
    <div className="min-h-screen relative overflow-hidden" style={{ background: `linear-gradient(180deg, ${C.skyTop} 0%, ${C.skyBot} 100%)` }}>
      {/* Clouds — visible on mobile above/below content */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
        {DISCOUNT_CLOUDS.map((c, i) => (
          <img
            key={i}
            src={c.src}
            alt=""
            className={`absolute${c.mdOnly ? ' hidden md:block' : ''}`}
            style={{
              ...(c.top ? { top: c.top } : {}),
              ...(c.bottom ? { bottom: c.bottom } : {}),
              ...(c.right ? { right: c.right } : {}),
              ...(c.left ? { left: c.left } : {}),
              width: c.width,
              opacity: 0.7,
              ...(c.flip ? { transform: 'scaleX(-1)' } : {}),
              animation: c.anim,
            }}
          />
        ))}
      </div>
      <Helmet>
        <title>Claim 10% Discount | Global Pizza Party</title>
        <meta property="og:image" content="https://rsv.pizza/gpp-flyer-2026-og.jpg" />
        <meta name="twitter:image" content="https://rsv.pizza/gpp-flyer-2026-og.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
      </Helmet>

      {/* Light header */}
      <header className="relative z-10 border-b border-black/10 bg-theme-surface-hover backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <img src="/logo.png" alt="RSV.Pizza" className="h-8 sm:h-10" />
            <span className="hidden sm:inline" style={{ fontFamily: "'Bangers', cursive", fontSize: '1.3rem', color: C.darkText }}>
              RSV.Pizza
            </span>
          </a>
        </div>
      </header>

      {/* Content centered */}
      <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-80px)] px-4 py-12">
        <div className="max-w-sm md:max-w-lg w-full text-center">
          {renderDiscountContent()}
        </div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 py-6 border-t" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
        <div className="flex flex-col items-center gap-1">
          <a href="https://pizzadao.org" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
            <img src="/pizzadao-logo.svg" alt="PizzaDAO" className="h-7" />
          </a>
        </div>
      </footer>
    </div>
  );

  const isDiscountState = state === 'discount-available' || state === 'discount-claimed' || state === 'discount-ineligible';

  if (isDiscountState) {
    return renderDiscountPage();
  }

  return (
    <Layout>
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="card p-8">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-theme-text mb-2">{t('title')}</h1>
          </div>
          {renderContent()}
        </div>
      </div>
    </Layout>
  );
}
