import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Sparkles, Copy, Check, Loader2, X } from 'lucide-react';
import {
  getPartnerAiShareToken,
  createPartnerAiShareToken,
  revokePartnerAiShareToken,
  type PartnerAiShareTokenResponse,
} from '../../lib/api';

interface ShareWithAiButtonProps {
  tag: string | null;
}

// scamorza-71819: button + modal that lets a partner mint, copy and revoke a
// long-lived read-only AI-share link for their consolidated report.
export function ShareWithAiButton({ tag }: ShareWithAiButtonProps) {
  const { t } = useTranslation('partner');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PartnerAiShareTokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [acting, setActing] = useState<'create' | 'rotate' | 'revoke' | null>(null);

  const effectiveTag = tag || undefined;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    getPartnerAiShareToken(effectiveTag)
      .then(setData)
      .catch((e: any) => setError(e?.message || 'Failed to load token'))
      .finally(() => setLoading(false));
  }, [open, effectiveTag]);

  useEffect(() => {
    if (!copied) return;
    const t2 = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t2);
  }, [copied]);

  const handleCreate = async () => {
    setActing('create');
    setError(null);
    try {
      const next = await createPartnerAiShareToken(effectiveTag);
      setData(next);
    } catch (e: any) {
      setError(e?.message || 'Failed to create token');
    } finally {
      setActing(null);
    }
  };

  const handleRotate = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(t('consolidated.shareWithAiRegenerateConfirm') as string)) return;
    setActing('rotate');
    setError(null);
    try {
      const next = await createPartnerAiShareToken(effectiveTag);
      setData(next);
    } catch (e: any) {
      setError(e?.message || 'Failed to regenerate token');
    } finally {
      setActing(null);
    }
  };

  const handleRevoke = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(t('consolidated.shareWithAiRevokeConfirm') as string)) return;
    setActing('revoke');
    setError(null);
    try {
      await revokePartnerAiShareToken(effectiveTag);
      setData({ token: null, url: null, tag: effectiveTag || '', createdAt: null, lastUsedAt: null });
    } catch (e: any) {
      setError(e?.message || 'Failed to revoke token');
    } finally {
      setActing(null);
    }
  };

  const handleCopy = async () => {
    if (!data?.url) return;
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
    } catch {
      // ignore — user can select manually
    }
  };

  const lastUsedDisplay = data?.lastUsedAt
    ? new Date(data.lastUsedAt).toLocaleString()
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-white/70 hover:bg-white border border-black/10 text-theme-text-secondary hover:text-theme-text transition-colors"
      >
        <Sparkles size={14} />
        {t('consolidated.shareWithAi')}
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <div
              className="bg-white border border-theme-stroke rounded-2xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-semibold text-theme-text flex items-center gap-2">
                  <Sparkles size={18} />
                  {t('consolidated.shareWithAi')}
                </h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-theme-text-faint hover:text-theme-text-secondary"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>

              <p className="text-sm text-theme-text-muted mb-4">
                {t('consolidated.shareWithAiHint')}
              </p>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={20} className="animate-spin text-theme-text-muted" />
                </div>
              ) : data?.token && data.url ? (
                <>
                  <div className="mb-3">
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={data.url}
                        onFocus={(e) => e.currentTarget.select()}
                        className="flex-1 px-3 py-2 rounded-lg bg-theme-surface border border-theme-stroke text-sm text-theme-text font-mono"
                      />
                      <button
                        type="button"
                        onClick={handleCopy}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied
                          ? t('consolidated.shareWithAiCopied')
                          : t('consolidated.shareWithAiCopy')}
                      </button>
                    </div>
                  </div>

                  <div className="text-xs text-theme-text-faint mb-4">
                    {lastUsedDisplay
                      ? `${t('consolidated.shareWithAiLastUsed')}: ${lastUsedDisplay}`
                      : t('consolidated.shareWithAiNever')}
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleRevoke}
                      disabled={acting !== null}
                      className="px-3 py-2 rounded-lg text-sm bg-white border border-red-500 hover:bg-red-50 text-red-500 hover:text-red-600 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      {acting === 'revoke' ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : null}
                      {t('consolidated.shareWithAiRevoke')}
                    </button>
                    <button
                      type="button"
                      onClick={handleRotate}
                      disabled={acting !== null}
                      className="px-3 py-2 rounded-lg text-sm bg-theme-surface border border-theme-stroke hover:border-theme-text-muted text-theme-text disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      {acting === 'rotate' ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : null}
                      {t('consolidated.shareWithAiRegenerate')}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 py-6">
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={acting !== null || !effectiveTag}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium disabled:opacity-50"
                  >
                    {acting === 'create' ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                    {t('consolidated.shareWithAiCreate')}
                  </button>
                  {!effectiveTag && (
                    <p className="text-xs text-theme-text-faint text-center max-w-xs">
                      {t('consolidated.shareWithAiNoTag')}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-500">
                  {error}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
