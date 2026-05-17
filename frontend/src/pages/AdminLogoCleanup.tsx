import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, Shield, Check, X, ArrowRight, AlertCircle } from 'lucide-react';
import { Layout } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchUnderbossMe,
  fetchLogoBgAudit,
  applyLogoBgFix,
  fetchLogoBgPreviewBlob,
  type LogoCleanupItem,
} from '../lib/api';

// Inline checkerboard background so transparency is visible against both
// light and dark logo pixels. 20px tiles.
const CHECKERBOARD_STYLE: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, #2a2a2a 25%, transparent 25%), ' +
    'linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), ' +
    'linear-gradient(45deg, transparent 75%, #2a2a2a 75%), ' +
    'linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
  backgroundColor: '#3a3a3a',
};

interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error';
}

function PreviewImage({ logoUrl }: { logoUrl: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    setSrc(null);
    setError(null);
    fetchLogoBgPreviewBlob(logoUrl)
      .then((blob) => {
        if (cancelled) return;
        const obj = URL.createObjectURL(blob);
        revoke = obj;
        setSrc(obj);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message || 'Failed to load preview');
      });
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [logoUrl]);

  if (error) {
    return (
      <div className="flex items-center justify-center text-xs text-red-300 p-4">
        <AlertCircle size={14} className="mr-1" />
        {error}
      </div>
    );
  }
  if (!src) {
    return (
      <div className="flex items-center justify-center text-white/40 p-4">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt="Suggested stripped logo"
      className="max-h-40 max-w-full object-contain"
    />
  );
}

export function AdminLogoCleanup() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<LogoCleanupItem[]>([]);
  const [applying, setApplying] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  // Auth check
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // Not logged in — bounce to home with alert
      window.alert('Graphics admin access required. Please log in.');
      navigate('/');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchUnderbossMe();
        if (cancelled) return;
        if (me.isAdmin || me.isGraphicsAdmin) {
          setAuthorized(true);
        } else {
          window.alert('Graphics admin access required.');
          navigate('/');
        }
      } catch {
        if (cancelled) return;
        window.alert('Graphics admin access required.');
        navigate('/');
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, navigate]);

  // Load audit
  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchLogoBgAudit();
        if (cancelled) return;
        setItems(res.items);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Failed to load audit');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authorized]);

  const visibleItems = items.filter((i) => !removed.has(i.logoUrl));

  const whitePngCount = visibleItems.filter((i) => i.classification === 'white_bg_png').length;
  const jpegCount = visibleItems.filter((i) => i.classification === 'jpeg_white').length;

  const handleApprove = async (item: LogoCleanupItem) => {
    if (applying.has(item.logoUrl)) return;
    setApplying((prev) => new Set(prev).add(item.logoUrl));
    try {
      const res = await applyLogoBgFix(item.logoUrl);
      pushToast(
        `Replaced. ${res.sponsorsUpdated} sponsor${res.sponsorsUpdated === 1 ? '' : 's'} updated${
          res.sponsorUserUpdated ? ' (master record synced)' : ''
        }.`,
        'success'
      );
      setRemoved((prev) => new Set(prev).add(item.logoUrl));
    } catch (e: any) {
      pushToast(e?.message || 'Failed to apply fix', 'error');
    } finally {
      setApplying((prev) => {
        const next = new Set(prev);
        next.delete(item.logoUrl);
        return next;
      });
    }
  };

  const handleSkip = (item: LogoCleanupItem) => {
    setRemoved((prev) => new Set(prev).add(item.logoUrl));
  };

  if (!authChecked || authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="text-white/40 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!authorized) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-32 px-4">
          <Shield size={48} className="text-white/20 mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Access denied</h1>
          <p className="text-white/50 text-center max-w-md">Graphics admin access required.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Helmet>
        <title>Logo Cleanup | RSV.Pizza</title>
      </Helmet>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white mb-2">Logo background cleanup</h1>
          <p className="text-sm text-white/50">
            Auto-stripped previews for sponsor logos with white / opaque-JPEG backgrounds. Approve
            to replace the canonical record (and, where applicable, propagate to every linked event).
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-24 text-white/50">
            <Loader2 size={24} className="animate-spin mr-3" />
            Scanning sponsor logos — initial load takes ~15s while we download and classify them.
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 p-4 mb-6">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="mb-6 inline-flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/80">
              <span className="font-semibold text-white">{visibleItems.length}</span>
              <span>logo{visibleItems.length === 1 ? '' : 's'} need cleanup.</span>
              <span className="text-white/40">
                {whitePngCount} white-bg PNG{whitePngCount === 1 ? '' : 's'}, {jpegCount} JPEG
                {jpegCount === 1 ? '' : 's'}.
              </span>
            </div>

            {visibleItems.length === 0 ? (
              <div className="text-center py-16 text-white/40">
                Nothing to clean up. All sponsor logos look fine.
              </div>
            ) : (
              <div className="space-y-4">
                {visibleItems.map((item) => {
                  const isApplying = applying.has(item.logoUrl);
                  const syncLabel = item.sponsorUserId
                    ? `Sync: master record${item.sponsorUserName ? ` (${item.sponsorUserName})` : ''}`
                    : 'Sync: one-off';
                  const partnerNames = Array.from(
                    new Set(item.sponsors.map((s) => s.partnerName).filter(Boolean))
                  );
                  return (
                    <div
                      key={item.logoUrl}
                      className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5"
                    >
                      <div className="flex flex-col sm:flex-row gap-4 items-stretch">
                        <div
                          className="flex-1 rounded-xl overflow-hidden flex items-center justify-center min-h-[140px] p-3"
                          style={CHECKERBOARD_STYLE}
                        >
                          <img
                            src={item.logoUrl}
                            alt="Original logo"
                            className="max-h-40 max-w-full object-contain"
                          />
                        </div>
                        <div className="flex items-center justify-center text-white/40">
                          <ArrowRight size={20} />
                        </div>
                        <div
                          className="flex-1 rounded-xl overflow-hidden flex items-center justify-center min-h-[140px] p-3"
                          style={CHECKERBOARD_STYLE}
                        >
                          <PreviewImage logoUrl={item.logoUrl} />
                        </div>
                      </div>

                      <div className="mt-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                        <div className="text-sm">
                          <div className="font-medium text-white">
                            {partnerNames.join(', ') || '(unnamed)'}
                          </div>
                          <div className="text-white/50 mt-0.5">
                            {item.eventCount} event{item.eventCount === 1 ? '' : 's'}
                            {item.eventCount > 0 && (
                              <span className="text-white/30">
                                {' '}
                                &middot; {item.sponsors.slice(0, 4).map((s) => s.partyCity || s.partyName).join(', ')}
                                {item.sponsors.length > 4 ? `, +${item.sponsors.length - 4} more` : ''}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-white/40 mt-1">
                            {syncLabel}
                            <span className="ml-2 inline-block rounded bg-white/[0.04] px-1.5 py-0.5 border border-white/10">
                              {item.classification === 'white_bg_png' ? 'white-bg PNG' : 'JPEG white'}
                            </span>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSkip(item)}
                            disabled={isApplying}
                            className="px-3 py-2 rounded-lg text-sm bg-white/[0.04] text-white/70 border border-white/10 hover:bg-white/[0.07] disabled:opacity-40 transition-colors inline-flex items-center gap-1.5"
                          >
                            <X size={14} /> Skip
                          </button>
                          <button
                            onClick={() => handleApprove(item)}
                            disabled={isApplying}
                            className="px-3 py-2 rounded-lg text-sm bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5"
                          >
                            {isApplying ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Check size={14} />
                            )}
                            Approve & replace
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-3 text-sm shadow-lg border ${
              t.kind === 'success'
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-100'
                : 'bg-red-500/20 border-red-500/40 text-red-100'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Layout>
  );
}

export default AdminLogoCleanup;
