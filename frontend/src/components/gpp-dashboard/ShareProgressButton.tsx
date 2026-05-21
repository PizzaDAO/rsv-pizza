import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share2, X, Download, Copy, Loader2 } from 'lucide-react';
import type { Party, EventReport } from '../../types';
import { useProgressCardImage } from '../../hooks/useProgressCardImage';

interface ShareProgressButtonProps {
  party: Party;
  report: EventReport;
}

/**
 * napoli-93184: Share button + modal preview of the host-progress card.
 *
 * Lazy generation — card is only rendered when the modal opens. Blob is
 * tracked in state and the corresponding object URL is revoked on unmount
 * / close to avoid leaks (PNG blobs are big).
 *
 * Clipboard support is feature-detected at render: on platforms missing
 * `ClipboardItem` (notably older iOS Safari) the Copy button is hidden
 * entirely. Download is the always-available fallback.
 */
export const ShareProgressButton: React.FC<ShareProgressButtonProps> = ({ party, report }) => {
  const { t } = useTranslation('host');
  const { generate } = useProgressCardImage();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Feature-detect ClipboardItem at render. `'ClipboardItem' in window` is
  // safe across SSR-free Vite environments but we guard for completeness.
  const canCopy = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return (
      'ClipboardItem' in window &&
      !!navigator.clipboard &&
      typeof navigator.clipboard.write === 'function'
    );
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // Run generation when the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true);
    setGenError(false);
    generate(party, report)
      .then((blob) => {
        if (cancelled) return;
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch((err) => {
        console.error('napoli-93184: progress card generation failed', err);
        if (!cancelled) setGenError(true);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, generate, party, report]);

  // Revoke object URL when it changes or the modal closes / unmounts.
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  // Clear timers on unmount.
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      setObjectUrl(null);
    }
    blobRef.current = null;
    setGenError(false);
  }, [objectUrl]);

  const filename = useMemo(() => {
    const slug = party.customUrl || party.inviteCode || 'event';
    return `rsvpizza-progress-${slug}.png`;
  }, [party.customUrl, party.inviteCode]);

  const handleDownload = useCallback(() => {
    if (!objectUrl) return;
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [objectUrl, filename]);

  const handleCopy = useCallback(async () => {
    if (!blobRef.current || !canCopy) return;
    try {
      const item = new ClipboardItem({ 'image/png': blobRef.current });
      await navigator.clipboard.write([item]);
      showToast(t('dashboard.share.copySuccess'));
    } catch (err) {
      console.error('napoli-93184: clipboard copy failed', err);
      showToast(t('dashboard.share.copyFailed'));
    }
  }, [canCopy, showToast, t]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-theme-card border border-theme-stroke text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover transition-colors"
        aria-label={t('dashboard.share.buttonLabel')}
        title={t('dashboard.share.buttonLabel')}
      >
        <Share2 size={16} />
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('dashboard.share.modalTitle')}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <div className="bg-theme-header rounded-2xl border border-theme-stroke w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-theme-stroke">
              <div className="flex items-center gap-2">
                <Share2 size={18} className="text-[#ff393a]" />
                <h2 className="text-lg font-bold text-theme-text">
                  {t('dashboard.share.modalTitle')}
                </h2>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="p-1.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors"
                aria-label={t('dashboard.share.close')}
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center gap-4">
              <div
                className="relative w-full bg-theme-card rounded-lg overflow-hidden border border-theme-stroke flex items-center justify-center"
                style={{ aspectRatio: '1200 / 630', maxWidth: 600 }}
              >
                {busy && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-theme-text-muted">
                    <Loader2 size={28} className="animate-spin" />
                    <span className="text-sm">{t('dashboard.share.generating')}</span>
                  </div>
                )}
                {!busy && genError && (
                  <div className="text-sm text-theme-text-muted px-4 text-center">
                    {t('dashboard.share.generateFailed')}
                  </div>
                )}
                {!busy && !genError && objectUrl && (
                  <img
                    src={objectUrl}
                    alt={t('dashboard.share.modalTitle')}
                    width={600}
                    height={315}
                    className="block w-full h-auto"
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 w-full">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={busy || !objectUrl}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#ff393a] text-white text-sm font-semibold hover:bg-[#ff5052] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Download size={16} />
                  {t('dashboard.share.download')}
                </button>
                {canCopy && (
                  <button
                    type="button"
                    onClick={handleCopy}
                    disabled={busy || !objectUrl}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-theme-card border border-theme-stroke text-theme-text text-sm font-semibold hover:bg-theme-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Copy size={16} />
                    {t('dashboard.share.copy')}
                  </button>
                )}
              </div>

              {toast && (
                <div className="text-xs text-theme-text-muted bg-theme-card border border-theme-stroke px-3 py-1.5 rounded-full">
                  {toast}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
