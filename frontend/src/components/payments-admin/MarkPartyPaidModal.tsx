import React, { useEffect, useMemo, useState } from 'react';
import { X, DollarSign, Loader2, Pencil, AlertTriangle, Archive } from 'lucide-react';
import { IconInput } from '../IconInput';
import {
  fetchMarkPartyPaidPreview,
  markPartyPaid,
  type MarkPartyPaidPreviewResponse,
} from '../../lib/api';
import type { PayoutMethod } from '../../types';

type MarkPaidMode = 'mark_paid' | 'withdraw_pending';

/**
 * parmigiana-58291: strip the "Global Pizza Party " prefix from event names
 * everywhere this modal shows the party name. Same convention as PayoutRow,
 * PrepayQueueTable, and CreatePrepaymentModal.
 */
function stripGppPrefix(name: string): string {
  return name.replace(/^Global Pizza Party\s+/i, '');
}

type PaidMethodChoice = PayoutMethod | 'external' | 'unchanged';

const METHOD_LABELS: Record<PaidMethodChoice, string> = {
  unchanged: 'Leave method unchanged',
  mercury_card: 'Mercury virtual card',
  wire: 'Wire transfer',
  usdc_base: 'USDC on Base',
  external: 'External / off-platform',
};

interface MarkPartyPaidModalProps {
  partyId: string;
  /**
   * Hint name for the modal header while the preview is loading. The
   * authoritative name comes back in the preview response and overrides this
   * once it lands.
   */
  partyNameHint?: string;
  onClose: () => void;
  /**
   * Called after a successful mark-paid POST. Parent should refresh both the
   * payouts list (so rows flip to paid) and the prepay queue (so the source
   * party drops off). The summary lets the parent flash a city-specific toast.
   *
   * caciotta-92103: `mode` is the resolved mode the server applied so the
   * toast can phrase "Marked N paid" vs "Withdrew N pending claims".
   */
  onSuccess: (summary: { count: number; mode: MarkPaidMode; partyName: string }) => void;
}

/**
 * panettone-92103: admin modal that flips every in-flight (pending + approved)
 * payout for a single party to `paid` in one atomic transaction. Used when the
 * admin paid the host the full amount out-of-band (Venmo / wire / etc.) and
 * wants to close out everything without clicking through each row.
 *
 * On mount fetches the preview via `GET /api/admin/parties/:partyId/mark-paid-preview`
 * so the modal renders accurate count + total + per-row breakdown before the
 * admin confirms. Count=0 is a valid result — the modal renders a "nothing to
 * mark paid" notice and disables the destructive button.
 *
 * The shared `note` is appended (with timestamp) to each row's `admin_notes`
 * and also written to the per-row payout_audit entry. Optional `paidMethod`
 * stamps on each payout's `payout_method` ONLY when currently null — existing
 * methods are preserved server-side.
 *
 * Reversible: each row can be flipped back via the existing PayoutReviewModal
 * "Revert to Pending" path (caprino-92103) — no confirm step here per project
 * convention (feedback_reversible_actions_no_confirm).
 */
export const MarkPartyPaidModal: React.FC<MarkPartyPaidModalProps> = ({
  partyId,
  partyNameHint,
  onClose,
  onSuccess,
}) => {
  const [preview, setPreview] = useState<MarkPartyPaidPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [note, setNote] = useState<string>(() => `Marked paid in bulk on ${today}`);
  const [method, setMethod] = useState<PaidMethodChoice>('unchanged');
  /**
   * caciotta-92103: mode selector. `null` until the preview lands; then we
   * default to the server's suggestedMode. Admin can override either way.
   */
  const [mode, setMode] = useState<MarkPaidMode | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Esc to close — same pattern as CreatePrepaymentModal and PayoutReviewModal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Pre-fetch the in-flight payout list so the body can render the impact
  // summary before the admin confirms.
  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    fetchMarkPartyPaidPreview(partyId)
      .then((res) => {
        if (cancelled) return;
        setPreview(res);
        // caciotta-92103: default-select the server's recommendation. Admin
        // can still override before submitting.
        setMode(res.suggestedMode);
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviewError(err?.message || 'Failed to load preview');
      })
      .finally(() => {
        if (cancelled) return;
        setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [partyId]);

  const partyName = preview?.party.name ?? partyNameHint ?? 'this event';
  const cityName = stripGppPrefix(partyName);
  const count = preview?.count ?? 0;
  const totalUsd = preview?.totalUsd ?? 0;
  const existingPaidCount = preview?.existingPaidCount ?? 0;
  const existingPaidUsd = preview?.existingPaidUsd ?? 0;

  const canSubmit =
    !!preview && count > 0 && !submitting && !previewLoading && mode !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const trimmedNote = note.trim();
      const body: {
        note?: string;
        paidMethod?: PayoutMethod | 'external';
        mode?: MarkPaidMode;
      } = {};
      if (trimmedNote) body.note = trimmedNote;
      // payout_method is meaningful for mark_paid only; we skip it for
      // withdraw_pending because we don't touch payout_method on withdraw.
      if (mode === 'mark_paid' && method !== 'unchanged') body.paidMethod = method;
      if (mode) body.mode = mode;
      const res = await markPartyPaid(partyId, body);
      onSuccess({ count: res.count, mode: res.mode, partyName: cityName });
      onClose();
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to mark party paid');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-theme-surface rounded-2xl shadow-2xl border border-theme-stroke w-full max-w-[95vw] sm:max-w-lg max-h-[95vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-theme-stroke">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-theme-text truncate">
              Mark party paid: {cityName}
            </h2>
            <p className="text-xs text-theme-text-muted mt-0.5">
              Flips every pending + approved payout for this event to paid.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-theme-surface-hover text-theme-text-muted"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Preview summary */}
          {previewLoading && (
            <div className="flex items-center gap-2 text-sm text-theme-text-muted">
              <Loader2 size={14} className="animate-spin" />
              Loading in-flight payouts...
            </div>
          )}
          {previewError && !previewLoading && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/40 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{previewError}</span>
            </div>
          )}
          {preview && !previewLoading && (
            <div>
              <div className="rounded-lg border border-theme-stroke bg-theme-surface-hover p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-xs uppercase tracking-wide text-theme-text-muted">
                    In-flight payouts
                  </div>
                  <div className="text-sm text-theme-text">
                    <span className="font-semibold">{count}</span>
                    {count > 0 && (
                      <>
                        {' '}for a total of{' '}
                        <span className="font-semibold">${totalUsd.toFixed(2)}</span>
                      </>
                    )}
                  </div>
                </div>
                {/* caciotta-92103: show what's already been paid on this party
                    so the admin sees the recommendation rationale. When this
                    is >= the in-flight sum the modal defaults to Withdraw
                    pending so a re-click after recording an external payment
                    doesn't double-count. */}
                {existingPaidCount > 0 && (
                  <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
                    <div className="uppercase tracking-wide text-theme-text-muted">
                      Existing paid
                    </div>
                    <div className="text-theme-text">
                      <span className="font-semibold">
                        ${existingPaidUsd.toFixed(2)}
                      </span>
                      <span className="text-theme-text-muted">
                        {' '}({existingPaidCount})
                      </span>
                    </div>
                  </div>
                )}
                {count === 0 ? (
                  <p className="text-xs text-theme-text-muted mt-2">
                    Nothing to mark paid — every payout for this event is already
                    paid, rejected, or withdrawn.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1 text-xs text-theme-text-secondary">
                    {preview.payouts.map((p) => (
                      <li key={p.id} className="flex items-baseline gap-2">
                        <span className="text-theme-text-muted uppercase text-[10px] tracking-wide w-16 flex-shrink-0">
                          {p.status}
                        </span>
                        <span className="flex-1 truncate">
                          {p.hostName ?? p.hostEmail ?? 'Unknown host'}
                        </span>
                        <span className="font-medium text-theme-text">
                          ${p.finalAmountUsd.toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* caciotta-92103: mode selector — Mark all as paid (legacy) vs
              Withdraw pending (new). Default-selected radio mirrors the
              server's suggestedMode so the safe action is one-click in the
              common "I already paid externally and recorded it" case. */}
          {preview && !previewLoading && count > 0 && mode !== null && (
            <div>
              <div className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">
                What should happen to these {count} payment{count === 1 ? '' : 's'}?
              </div>
              <div className="space-y-2">
                {(['mark_paid', 'withdraw_pending'] as MarkPaidMode[]).map((m) => {
                  const active = mode === m;
                  const isMarkPaid = m === 'mark_paid';
                  const title = isMarkPaid
                    ? 'Mark all as paid'
                    : 'Withdraw pending (reconciled by existing paid)';
                  const explanation = isMarkPaid
                    ? `Creates ${count} new paid record${count === 1 ? '' : 's'} summing to $${totalUsd.toFixed(2)}. Use this if you actually paid out additionally.`
                    : `Closes out ${count} pending claim${count === 1 ? '' : 's'} without creating new paid records. Use this when you've already recorded the payment externally and the pending claims are duplicates.`;
                  return (
                    <label
                      key={m}
                      className={`flex items-start gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        active
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-theme-stroke bg-theme-surface hover:border-theme-stroke-strong'
                      }`}
                    >
                      <input
                        type="radio"
                        name="markPaidMode"
                        value={m}
                        checked={active}
                        onChange={() => setMode(m)}
                        className="mt-1"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-theme-text font-medium">
                          {title}
                        </span>
                        <span className="block text-xs text-theme-text-muted mt-0.5">
                          {explanation}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Shared note */}
          <IconInput
            icon={Pencil}
            multiline
            rows={3}
            placeholder="Shared admin note (appended to each row's admin_notes)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
          />

          {/* Optional method override — only meaningful for mark_paid; the
              withdraw_pending mode never stamps payout_method. */}
          {mode === 'mark_paid' && (
          <div>
            <div className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">
              Payout method (optional)
            </div>
            <div className="space-y-1.5">
              {(Object.keys(METHOD_LABELS) as PaidMethodChoice[]).map((k) => {
                const active = method === k;
                return (
                  <label
                    key={k}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      active
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'border-theme-stroke bg-theme-surface hover:border-theme-stroke-strong'
                    }`}
                  >
                    <input
                      type="radio"
                      name="paidMethod"
                      value={k}
                      checked={active}
                      onChange={() => setMethod(k)}
                    />
                    <span className="text-sm text-theme-text">{METHOD_LABELS[k]}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-theme-text-muted mt-1">
              Only stamps the method on payouts that don't already have one —
              existing methods are preserved.
            </p>
          </div>
          )}

          {submitError && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/40 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-theme-stroke px-5 py-3 flex items-center justify-end gap-2 bg-theme-surface">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 ${
              mode === 'withdraw_pending'
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-red-500 hover:bg-red-600'
            }`}
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : mode === 'withdraw_pending' ? (
              <Archive size={14} />
            ) : (
              <DollarSign size={14} />
            )}
            {count > 0
              ? mode === 'withdraw_pending'
                ? `Withdraw ${count} pending claim${count === 1 ? '' : 's'}`
                : `Mark ${count} payment${count === 1 ? '' : 's'} paid ($${totalUsd.toFixed(2)})`
              : 'Mark party paid'}
          </button>
        </div>
      </form>
    </div>
  );
};
