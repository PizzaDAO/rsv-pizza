import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, Loader2, CheckCircle2, XCircle, ExternalLink, AlertTriangle } from 'lucide-react';
import { Checkbox } from '../Checkbox';
import type { AdminPayout, WalletPaidTotal } from '../../types';
import { bulkExecutePayouts, fetchWalletPaidTotal, type BulkSendResult } from '../../lib/api';

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

  // bianco-89172: per-wallet prior-paid totals (lowercased addr → WalletPaidTotal).
  // Fetched once per modal-open, then locally combined with the in-batch
  // amounts to determine which wallets would push past the $651 cap. The
  // admin must tick `overrideCap` to enable Send when any wallet would exceed.
  const [walletTotals, setWalletTotals] = useState<Map<string, WalletPaidTotal>>(new Map());
  const [walletTotalsLoading, setWalletTotalsLoading] = useState(false);
  const [overrideCap, setOverrideCap] = useState(false);

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
      setWalletTotals(new Map());
      setOverrideCap(false);
    }
  }, [isOpen]);

  // bianco-89172: fetch prior-paid totals for every distinct recipient wallet
  // in the selection. Skipped when modal isn't open or no eligible rows.
  // Failures fall back to an empty entry per address so the rest of the UI
  // still renders — the server-side pre-flight will still catch issues.
  useEffect(() => {
    if (!isOpen || eligible.length === 0) return;
    let cancelled = false;
    const distinctAddrs = Array.from(
      new Set(eligible.map((p) => (p.payoutWalletAddress || '').toLowerCase()).filter(Boolean)),
    );
    if (distinctAddrs.length === 0) return;
    setWalletTotalsLoading(true);
    Promise.all(
      distinctAddrs.map(async (addr) => {
        try {
          const total = await fetchWalletPaidTotal(addr);
          return [addr, total] as const;
        } catch {
          return [
            addr,
            { address: addr, paidUsd: 0, paidCount: 0, capUsd: 651, wouldExceed: null },
          ] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setWalletTotals(new Map(entries));
      setWalletTotalsLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // `eligible` is derived from `selectedPayouts` and is stable per modal open
    // (the parent re-renders the modal closed/open on selection change), so
    // this re-runs only when the modal opens or the selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedPayouts]);

  // bianco-89172: combine prior-paid + in-batch amounts per wallet to figure
  // out which selected rows would push the recipient past the cap. Returns
  // {overCapRowIds, overCapWalletCount, capUsd} — used for the disabled state
  // on Send + the warning panel.
  const capAnalysis = useMemo(() => {
    if (walletTotals.size === 0 || eligible.length === 0) {
      return { overCapRowIds: new Set<string>(), overCapWalletCount: 0, capUsd: 651 };
    }
    // First, sum up each wallet's in-batch total.
    const inBatchByWallet = new Map<string, number>();
    for (const p of eligible) {
      const addr = (p.payoutWalletAddress || '').toLowerCase();
      if (!addr) continue;
      inBatchByWallet.set(addr, (inBatchByWallet.get(addr) || 0) + Number(p.finalAmountUsd || 0));
    }
    let capUsd = 651;
    const overCapWallets = new Set<string>();
    for (const [addr, batchTotal] of inBatchByWallet.entries()) {
      const wt = walletTotals.get(addr);
      if (!wt) continue;
      capUsd = wt.capUsd; // server is the source of truth — same for every row
      if (wt.paidUsd + batchTotal > wt.capUsd) {
        overCapWallets.add(addr);
      }
    }
    const overCapRowIds = new Set<string>();
    for (const p of eligible) {
      const addr = (p.payoutWalletAddress || '').toLowerCase();
      if (overCapWallets.has(addr)) overCapRowIds.add(p.id);
    }
    return { overCapRowIds, overCapWalletCount: overCapWallets.size, capUsd };
  }, [walletTotals, eligible]);

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
    // bianco-89172: block submit if any row is over-cap and the admin hasn't
    // ticked the override checkbox.
    if (capAnalysis.overCapWalletCount > 0 && !overrideCap) return;
    setPhase('sending');
    setErrorMsg(null);
    try {
      const ids = eligible.map((p) => p.id);
      const res = await bulkExecutePayouts(ids, {
        allowOverPerAddressCap: capAnalysis.overCapWalletCount > 0 ? overrideCap : false,
      });
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
        className="card p-4 sm:p-6 w-full max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto bg-theme-surface rounded-2xl shadow-2xl border border-theme-stroke"
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

            {/* bianco-89172: per-address cap warning. Surfaces a count of
                wallets in this selection whose prior-paid + in-batch total
                would exceed the $651 cap, and requires an explicit override
                checkbox to enable Send. The server-side pre-flight is the
                ultimate gate; this is just defense-in-depth for admins. */}
            {walletTotalsLoading && eligible.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-theme-surface-hover border border-theme-stroke text-xs text-theme-text-muted mb-4">
                <Loader2 size={12} className="animate-spin" />
                Checking per-address cap…
              </div>
            )}
            {!walletTotalsLoading && capAnalysis.overCapWalletCount > 0 && (
              <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/10 mb-4">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="text-amber-300 mt-0.5 flex-shrink-0" size={16} />
                  <div className="flex-1 text-sm">
                    <div className="font-medium text-amber-200 mb-1">
                      Per-address cap warning
                    </div>
                    <div className="text-theme-text-secondary text-xs">
                      {capAnalysis.overCapWalletCount} selected wallet
                      {capAnalysis.overCapWalletCount === 1 ? '' : 's'} would exceed the
                      ${capAnalysis.capUsd} per-address cap once this batch sends
                      ({capAnalysis.overCapRowIds.size} row
                      {capAnalysis.overCapRowIds.size === 1 ? '' : 's'} in this batch).
                    </div>
                    <div className="mt-3">
                      <Checkbox
                        checked={overrideCap}
                        onChange={() => setOverrideCap((v) => !v)}
                        label="Allow over-cap sends — I acknowledge"
                        labelClassName="text-sm text-amber-100"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* bianco-89172: per-row indicator so admins can see WHICH wallets
                in their selection would exceed. Folded into the existing
                eligibility list (kept concise — first 8 rows). */}
            {capAnalysis.overCapRowIds.size > 0 && (
              <ul className="space-y-1 mb-4 max-h-[20vh] overflow-y-auto text-xs">
                {eligible
                  .filter((p) => capAnalysis.overCapRowIds.has(p.id))
                  .slice(0, 8)
                  .map((p) => {
                    const addr = p.payoutWalletAddress || '';
                    const shortAddr =
                      addr.length >= 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
                    const wt = walletTotals.get(addr.toLowerCase());
                    return (
                      <li
                        key={p.id}
                        className="flex items-baseline gap-2 px-2 py-1 rounded bg-amber-500/5 border border-amber-500/20"
                      >
                        <AlertTriangle size={10} className="text-amber-400 shrink-0 self-center" />
                        <span className="font-mono text-[11px] text-amber-100">{shortAddr}</span>
                        <span className="text-theme-text-muted">
                          ${Number(p.finalAmountUsd).toFixed(2)}
                        </span>
                        {wt && (
                          <span className="text-amber-300/80">
                            prior ${wt.paidUsd.toFixed(2)}
                          </span>
                        )}
                      </li>
                    );
                  })}
                {capAnalysis.overCapRowIds.size > 8 && (
                  <li className="text-theme-text-muted text-[11px] px-2">
                    …and {capAnalysis.overCapRowIds.size - 8} more.
                  </li>
                )}
              </ul>
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
                disabled={
                  eligible.length === 0 ||
                  walletTotalsLoading ||
                  // bianco-89172: block Send when over-cap and admin hasn't ack'd
                  (capAnalysis.overCapWalletCount > 0 && !overrideCap)
                }
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
