import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, Loader2, CheckCircle2, XCircle, ExternalLink, AlertTriangle } from 'lucide-react';
import type { AdminPayout } from '../../types';
import { bulkExecutePayouts, type BulkSendResult } from '../../lib/api';

interface BulkSendModalProps {
  isOpen: boolean;
  /** Full current selection. Modal filters to eligible USDC-approved-valid-wallet rows itself. */
  selectedPayouts: AdminPayout[];
  onCancel: () => void;
  onComplete: (results: BulkSendResult[]) => void;
}

type Phase = 'idle' | 'sending' | 'done' | 'error';

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * salsiccia-49102: bulk USDC send for selected approved payouts on the
 * /payments admin dashboard. Filters non-eligible rows client-side (so the
 * preview count matches what the backend will actually attempt), shows a
 * sending-progress indicator, and renders a per-row result list (paid /
 * failed + tx link / error) after completion.
 *
 * Sequential execution happens server-side (one tx at a time — nonce
 * safety). Client just POSTs the eligible ids and awaits the response.
 */
export const BulkSendModal: React.FC<BulkSendModalProps> = ({
  isOpen,
  selectedPayouts,
  onCancel,
  onComplete,
}) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [results, setResults] = useState<BulkSendResult[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Eligibility filter — keep in sync with backend bulk-execute filter
  // (USDC + approved-or-failed + valid 0x wallet). passata-49102 added
  // failed-status retry. Anything not matching is shown as "skipped".
  const { eligible, skippedCount, totalUsd, distinctRecipients } = useMemo(() => {
    const e: AdminPayout[] = [];
    let skipped = 0;
    const recipients = new Set<string>();
    for (const p of selectedPayouts) {
      if (
        p.payoutMethod === 'usdc_base' &&
        (p.status === 'approved' || p.status === 'failed') &&
        p.payoutWalletAddress &&
        WALLET_RE.test(p.payoutWalletAddress)
      ) {
        e.push(p);
        recipients.add(p.payoutWalletAddress.toLowerCase());
      } else {
        skipped += 1;
      }
    }
    const sum = e.reduce((acc, p) => acc + (Number(p.finalAmountUsd) || 0), 0);
    return {
      eligible: e,
      skippedCount: skipped,
      totalUsd: sum,
      distinctRecipients: recipients.size,
    };
  }, [selectedPayouts]);

  // Reset state every time the modal opens for a fresh selection.
  useEffect(() => {
    if (isOpen) {
      setPhase('idle');
      setResults([]);
      setErrorMsg(null);
    }
  }, [isOpen]);

  // Close on Escape (only when not sending — never cancel an in-flight batch)
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && phase !== 'sending') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel, phase]);

  if (!isOpen) return null;

  // Build a quick lookup from id -> payout for the result list (so we can
  // render the recipient address + amount alongside the success/failure).
  const eligibleById = new Map(eligible.map((p) => [p.id, p]));

  async function handleSend() {
    if (eligible.length === 0) return;
    setPhase('sending');
    setErrorMsg(null);
    try {
      const ids = eligible.map((p) => p.id);
      const res = await bulkExecutePayouts(ids);
      setResults(res);
      setPhase('done');
      onComplete(res);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Bulk send failed');
      setPhase('error');
    }
  }

  const paidCount = results.filter((r) => r.status === 'paid').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;

  const body = (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
      onClick={() => {
        if (phase !== 'sending') onCancel();
      }}
    >
      <div
        className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto bg-theme-surface rounded-2xl shadow-2xl border border-theme-stroke"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-theme-text">
              {phase === 'done'
                ? 'Bulk send complete'
                : phase === 'sending'
                ? 'Sending USDC payouts…'
                : `Send ${eligible.length} payout${eligible.length === 1 ? '' : 's'}`}
            </h2>
            {phase === 'idle' && (
              <p className="text-xs text-theme-text-muted mt-0.5">
                Sequential — one transaction at a time from the hot wallet on Base.
              </p>
            )}
          </div>
          {phase !== 'sending' && (
            <button
              type="button"
              onClick={onCancel}
              className="p-1.5 rounded-md hover:bg-theme-surface-hover text-theme-text-muted"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* IDLE — preview the batch */}
        {phase === 'idle' && (
          <>
            <div className="px-3 py-3 rounded-lg bg-theme-surface-hover border border-theme-stroke text-sm mb-4">
              <p className="text-theme-text">
                <span className="font-semibold">Total: ${totalUsd.toFixed(2)}</span>
                {' — '}
                {eligible.length} USDC transaction{eligible.length === 1 ? '' : 's'} from the hot
                wallet to {distinctRecipients} recipient{distinctRecipients === 1 ? '' : 's'}.
              </p>
              {skippedCount > 0 && (
                <div className="flex items-start gap-1.5 mt-2 text-xs text-amber-500/90">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>
                    {skippedCount} selected payout{skippedCount === 1 ? '' : 's'} skipped (non-USDC,
                    wrong status, or invalid wallet).
                  </span>
                </div>
              )}
            </div>

            {eligible.length === 0 && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 mb-4">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  No eligible payouts in selection — pick at least one USDC payout in approved or
                  failed status with a valid 0x recipient wallet.
                </span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-theme-stroke">
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-2 rounded-lg text-sm text-theme-text-muted hover:text-theme-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={eligible.length === 0}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={14} />
                Send {eligible.length} payout{eligible.length === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}

        {/* SENDING — in-flight (batch is server-driven, so we can't show per-tx
            progress without a stream. Show a single spinner + "Sending N…"). */}
        {phase === 'sending' && (
          <div className="py-8 flex flex-col items-center justify-center text-center">
            <Loader2 size={32} className="animate-spin text-emerald-500 mb-3" />
            <p className="text-sm text-theme-text">
              Sending {eligible.length} USDC payout{eligible.length === 1 ? '' : 's'}…
            </p>
            <p className="text-xs text-theme-text-muted mt-1">
              Each tx waits for confirmation on Base — please don't close this tab.
            </p>
          </div>
        )}

        {/* ERROR — batch-level failure (insufficient balance, validation, etc.) */}
        {phase === 'error' && (
          <>
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400 mb-4">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{errorMsg || 'Bulk send failed'}</span>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-theme-stroke">
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-2 rounded-lg text-sm bg-theme-surface-hover hover:bg-theme-surface text-theme-text"
              >
                Close
              </button>
            </div>
          </>
        )}

        {/* DONE — per-row result list */}
        {phase === 'done' && (
          <>
            <div className="px-3 py-3 rounded-lg bg-theme-surface-hover border border-theme-stroke text-sm mb-3">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-medium text-emerald-500">{paidCount}</span>
                <span className="text-theme-text-muted">paid</span>
                {failedCount > 0 && (
                  <>
                    <span className="text-theme-text-muted">•</span>
                    <span className="font-medium text-red-500">{failedCount}</span>
                    <span className="text-theme-text-muted">failed</span>
                  </>
                )}
                {skippedCount > 0 && (
                  <>
                    <span className="text-theme-text-muted">•</span>
                    <span className="font-medium text-amber-500">{skippedCount}</span>
                    <span className="text-theme-text-muted">skipped</span>
                  </>
                )}
              </div>
            </div>

            <ul className="space-y-2 mb-4 max-h-[40vh] overflow-y-auto">
              {results.map((r) => {
                const p = eligibleById.get(r.id);
                const addr = p?.payoutWalletAddress ?? '';
                const shortAddr = addr.length >= 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
                const amount = p ? Number(p.finalAmountUsd).toFixed(2) : '?';
                const isPaid = r.status === 'paid';
                return (
                  <li
                    key={r.id}
                    className={`flex items-start gap-2 px-3 py-2 rounded-lg text-sm border ${
                      isPaid
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100'
                        : 'bg-red-500/10 border-red-500/30 text-red-100'
                    }`}
                  >
                    {isPaid ? (
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" />
                    ) : (
                      <XCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-mono text-xs">{shortAddr}</span>
                        <span className="text-xs text-theme-text-muted">${amount}</span>
                        {isPaid && r.txHash && (
                          <a
                            href={`https://basescan.org/tx/${r.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs underline hover:text-white"
                          >
                            tx <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                      {!isPaid && r.error && (
                        <p className="text-xs mt-1 break-words text-red-200/90">{r.error}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-theme-stroke">
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(body, document.body);
};
