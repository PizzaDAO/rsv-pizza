/**
 * stromboli-58524: Mercury wire auto-reconciliation UI
 *
 * Admin-only panel rendered inside SponsorCRM.
 * - "Check Mercury for wire payments" button triggers POST /api/admin/mercury/reconcile
 * - Shows result toast with counts
 * - Needs-review queue: list unmatched/needs-review wires with invoice picker to resolve
 */

import React, { useState, useEffect, createPortal } from 'react';
import { Zap, AlertTriangle, RefreshCw, X, Check, ChevronDown } from 'lucide-react';
import { MercuryWireMatch, MercuryReconcileResult, Invoice } from '../../types';
import { reconcileMercuryWires, getMercuryMatches, resolveMercuryMatch } from '../../lib/api';

interface MercuryReconcilePanelProps {
  /** All open invoices for the current party — used to populate the invoice picker */
  invoices: Invoice[];
  /** Called after a match is resolved so the parent can refresh its invoice list */
  onInvoiceUpdate?: (invoiceId: string) => void;
}

// ──────────────────────────────────────────────
// Helper: format cents as $X,XXX
// ──────────────────────────────────────────────
function formatAmount(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

// ──────────────────────────────────────────────
// Resolve modal (pick invoice + confirm)
// ──────────────────────────────────────────────

interface ResolveModalProps {
  match: MercuryWireMatch;
  invoices: Invoice[];
  onClose: () => void;
  onResolved: (matchId: string, invoiceId: string) => void;
}

function ResolveModal({ match, invoices, onClose, onResolved }: ResolveModalProps) {
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResolve = async () => {
    if (!selectedInvoiceId) return;
    setLoading(true);
    setError(null);
    try {
      await resolveMercuryMatch(match.id, selectedInvoiceId);
      onResolved(match.id, selectedInvoiceId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve match');
    } finally {
      setLoading(false);
    }
  };

  const payableInvoices = invoices.filter((inv) =>
    inv.status === 'issued' || inv.status === 'viewed'
  );

  return createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div
        className="bg-theme-header border border-theme-stroke rounded-xl w-full max-w-sm mx-4 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-theme-text">Link wire to invoice</h3>
          <button
            onClick={onClose}
            className="p-1 text-theme-text-muted hover:text-theme-text"
            disabled={loading}
          >
            <X size={16} />
          </button>
        </div>

        {/* Wire summary */}
        <div className="bg-theme-surface border border-theme-stroke rounded-lg p-3 mb-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-theme-text-muted">Amount</span>
            <span className="text-sm font-semibold text-theme-text">{formatAmount(match.amount)}</span>
          </div>
          {match.counterparty && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-theme-text-muted">From</span>
              <span className="text-xs text-theme-text">{match.counterparty}</span>
            </div>
          )}
          {match.memo && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-theme-text-muted">Memo</span>
              <span className="text-xs text-theme-text truncate max-w-[60%]">{match.memo}</span>
            </div>
          )}
          {match.postedAt && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-theme-text-muted">Posted</span>
              <span className="text-xs text-theme-text">
                {new Date(match.postedAt).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>

        {/* Invoice picker */}
        <div className="mb-4">
          <p className="text-xs text-theme-text-muted mb-2">Select invoice to mark paid</p>
          {payableInvoices.length === 0 ? (
            <p className="text-xs text-theme-text-faint italic">No open invoices for this party</p>
          ) : (
            <div className="relative">
              <select
                className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text appearance-none pr-8 focus:outline-none focus:border-white/30"
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value)}
              >
                <option value="">— pick an invoice —</option>
                {payableInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    #{inv.invoiceNumber} — {inv.billToCompany || inv.sponsor?.name || 'Unknown'} — {formatAmount(inv.total)}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none"
              />
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-3 py-2 text-sm border border-theme-stroke rounded-lg text-theme-text-muted hover:text-theme-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleResolve}
            disabled={loading || !selectedInvoiceId}
            className="flex-1 px-3 py-2 text-sm bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-1"
          >
            {loading ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            Mark Paid
          </button>
        </div>
      </div>
      {/* Click-outside to close */}
      <div className="absolute inset-0 -z-10" onClick={onClose} />
    </div>,
    document.body
  );
}

// ──────────────────────────────────────────────
// Main panel
// ──────────────────────────────────────────────

export function MercuryReconcilePanel({ invoices, onInvoiceUpdate }: MercuryReconcilePanelProps) {
  const [reconciling, setReconciling] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [matches, setMatches] = useState<MercuryWireMatch[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<MercuryWireMatch | null>(null);

  // Auto-dismiss toast after 4s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleReconcile = async () => {
    setReconciling(true);
    setToast(null);
    try {
      const result: MercuryReconcileResult = await reconcileMercuryWires();
      const parts: string[] = [];
      if (result.autoPaid > 0) parts.push(`${result.autoPaid} auto-paid`);
      if (result.needsReview > 0) parts.push(`${result.needsReview} need review`);
      if (result.unmatched > 0) parts.push(`${result.unmatched} unmatched`);
      setToast({
        kind: result.autoPaid > 0 || result.needsReview === 0 ? 'success' : 'success',
        message: parts.length > 0 ? parts.join(' · ') : 'No new wires found',
      });
      // Reload queue
      if (result.needsReview > 0 || result.unmatched > 0) {
        setShowQueue(true);
        await loadQueue();
      }
    } catch (err) {
      setToast({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Reconcile failed',
      });
    } finally {
      setReconciling(false);
    }
  };

  const loadQueue = async () => {
    setLoadingMatches(true);
    try {
      const result = await getMercuryMatches('needs_review,unmatched');
      setMatches(result.matches);
    } catch (err) {
      console.error('Failed to load Mercury matches:', err);
    } finally {
      setLoadingMatches(false);
    }
  };

  const handleToggleQueue = async () => {
    if (!showQueue) {
      setShowQueue(true);
      await loadQueue();
    } else {
      setShowQueue(false);
    }
  };

  const handleResolved = (matchId: string, invoiceId: string) => {
    // Optimistically remove from queue
    setMatches((prev) => prev.filter((m) => m.id !== matchId));
    if (onInvoiceUpdate) onInvoiceUpdate(invoiceId);
  };

  const pendingCount = matches.length;

  return (
    <div className="border border-theme-stroke rounded-xl bg-theme-header p-4">
      {/* Row: button + status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-theme-text">
          <Zap size={15} className="text-yellow-400" />
          Mercury Wire Sync
        </div>

        <button
          onClick={handleReconcile}
          disabled={reconciling}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/30 rounded-lg transition-colors disabled:opacity-40"
        >
          {reconciling ? (
            <RefreshCw size={12} className="animate-spin" />
          ) : (
            <Zap size={12} />
          )}
          Check Mercury
        </button>

        {pendingCount > 0 && (
          <button
            onClick={handleToggleQueue}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border border-orange-500/30 rounded-lg transition-colors"
          >
            <AlertTriangle size={12} />
            {pendingCount} pending
          </button>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`mt-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${
            toast.kind === 'success'
              ? 'bg-green-500/15 text-green-300 border border-green-500/25'
              : 'bg-red-500/15 text-red-300 border border-red-500/25'
          }`}
        >
          {toast.kind === 'success' ? <Check size={12} /> : <AlertTriangle size={12} />}
          {toast.message}
        </div>
      )}

      {/* Needs-review queue */}
      {showQueue && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-theme-text-muted">Needs review</span>
            {loadingMatches && <RefreshCw size={11} className="animate-spin text-theme-text-muted" />}
          </div>

          {!loadingMatches && matches.length === 0 && (
            <p className="text-xs text-theme-text-faint italic">No pending matches</p>
          )}

          <div className="space-y-2">
            {matches.map((match) => (
              <div
                key={match.id}
                className="flex items-center gap-3 p-2.5 bg-theme-surface border border-theme-stroke rounded-lg"
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-theme-text">
                      {formatAmount(match.amount)}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        match.status === 'needs_review'
                          ? 'bg-orange-500/20 text-orange-300'
                          : 'bg-red-500/20 text-red-300'
                      }`}
                    >
                      {match.status === 'needs_review' ? 'amount match' : 'unmatched'}
                    </span>
                  </div>
                  {match.counterparty && (
                    <p className="text-xs text-theme-text-muted truncate">{match.counterparty}</p>
                  )}
                  {match.memo && (
                    <p className="text-xs text-theme-text-faint truncate">{match.memo}</p>
                  )}
                </div>
                <button
                  onClick={() => setResolveTarget(match)}
                  className="shrink-0 px-2.5 py-1 text-xs font-medium bg-green-500/20 hover:bg-green-500/30 text-green-300 border border-green-500/30 rounded-lg transition-colors"
                >
                  Resolve
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resolve modal */}
      {resolveTarget && (
        <ResolveModal
          match={resolveTarget}
          invoices={invoices}
          onClose={() => setResolveTarget(null)}
          onResolved={handleResolved}
        />
      )}
    </div>
  );
}
