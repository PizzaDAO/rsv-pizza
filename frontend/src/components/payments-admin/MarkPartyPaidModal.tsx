import React, { useEffect, useMemo, useState } from 'react';
import { X, DollarSign, Loader2, Pencil, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { IconInput } from '../IconInput';
import { SwcHubWarning } from './SwcHubWarning';
import {
  fetchMarkPartyPaidPreview,
  markPartyPaid,
  type MarkPartyPaidPreviewResponse,
} from '../../lib/api';
import type { PayoutMethod } from '../../types';

// provolone-92103: 'mark_pending_complete' replaces caciotta's
// 'withdraw_pending' — the close-out terminal state is now `'completed'`
// (city paid in full, this claim done) instead of `'withdrawn'` (claim invalid).
type MarkPaidMode = 'mark_paid' | 'mark_pending_complete';

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
  /**
   * parmigiana-92104: caller-supplied SWC Hub signal. The preview endpoint
   * doesn't surface party.country / party.eventTags, so the parent (which has
   * the full row in hand) passes the resolved flag in. When `true`, the modal
   * renders the amber warning + ack and disables the Mark/Close button until
   * the admin ticks the override. Optional for backward-compat with callers
   * that haven't been threaded yet.
   */
  isSwcHub?: boolean;
  onClose: () => void;
  /**
   * Called after a successful mark-paid POST. Parent should refresh both the
   * payouts list (so rows flip to paid) and the prepay queue (so the source
   * party drops off). The summary lets the parent flash a city-specific toast.
   *
   * caciotta-92103 + provolone-92103: `mode` is the resolved mode the server
   * applied so the toast can phrase "Marked N paid" vs "Closed out N pending
   * claims as completed".
   * pinsa-92103: `action` lets the parent vary the toast copy — `'closed'`
   * (or `'mark_paid'` when the flip auto-stamped the close timestamp) means
   * the city is now fully closed-out.
   */
  onSuccess: (summary: {
    count: number;
    mode?: MarkPaidMode;
    partyName: string;
    action?:
      | 'mark_paid'
      | 'mark_pending_complete'
      | 'closed'
      | 'already_closed'
      | 'noop';
    paymentsClosedAt?: string | null;
  }) => void;
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
  isSwcHub = false,
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

  // parmigiana-92104: SWC Hub ack — required when `isSwcHub` is true.
  // Reset when the modal target changes so an ack doesn't carry across
  // distinct parties (parent unmounts/remounts the modal per partyId, but
  // belt-and-suspenders on partyId change for safety).
  const [swcAck, setSwcAck] = useState(false);
  useEffect(() => {
    setSwcAck(false);
  }, [partyId]);

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
  // pinsa-92103: separate from caciotta's existingPaid* (which is the same
  // data via a different field name). Modal body uses `paidCount` /
  // `paidTotalUsd` for the close-out copy, falling back to caciotta's fields
  // so the optional pinsa fields don't break in older payloads.
  const paidCount = preview?.paidCount ?? existingPaidCount;
  const paidTotalUsd = preview?.paidTotalUsd ?? existingPaidUsd;
  const alreadyClosedAt = preview?.paymentsClosedAt ?? null;

  // pinsa-92103: close-out mode = preview loaded, nothing in-flight, party has
  // paid history, and not already closed. In this mode the modal hides the
  // method-override radio and switches the button copy to "Close out {city}".
  const isCloseOutMode =
    !!preview && count === 0 && paidCount > 0 && !alreadyClosedAt;

  // caciotta + pinsa: standard mark-paid mode requires in-flight rows AND a
  // resolved mode selection. Close-out mode (pinsa) is a valid submit even
  // with count===0 because it stamps a timestamp; it doesn't need `mode`.
  // parmigiana-92104: an SWC Hub party additionally requires an ack from the
  // admin before any path is enabled.
  const canSubmit =
    !!preview &&
    !submitting &&
    !previewLoading &&
    (isCloseOutMode || (count > 0 && mode !== null)) &&
    (!isSwcHub || swcAck);

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
      // payout_method is meaningful for mark_paid only; skip it for
      // mark_pending_complete (provolone) and for close-out mode (pinsa)
      // since neither path touches payout_method on existing rows.
      if (!isCloseOutMode && mode === 'mark_paid' && method !== 'unchanged') {
        body.paidMethod = method;
      }
      // caciotta-92103 + provolone-92103: send the resolved mode when there's
      // something to act on. In close-out mode we leave it unset and let the
      // server pick the pure close-out path.
      if (!isCloseOutMode && mode) body.mode = mode;
      const res = await markPartyPaid(partyId, body);
      onSuccess({
        count: res.count,
        mode: res.mode,
        partyName: cityName,
        action: res.action,
        paymentsClosedAt: res.party?.paymentsClosedAt ?? null,
      });
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
              {isCloseOutMode
                ? `Mark ${cityName} as fully paid out`
                : `Mark party paid: ${cityName}`}
            </h2>
            <p className="text-xs text-theme-text-muted mt-0.5">
              {isCloseOutMode
                ? 'Closes out this city — every expected reimbursement is already paid.'
                : 'Flips every pending + approved payout for this event to paid.'}
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
          {/* parmigiana-92104: SWC Hub reimbursement warning. Parent passes
              `isSwcHub` based on the row's party.country / event_tags; the
              preview endpoint doesn't surface those fields. Confirm button
              stays disabled until the admin ticks the ack. */}
          <SwcHubWarning
            isSwcHub={isSwcHub}
            acked={swcAck}
            onAckChange={setSwcAck}
          />

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
              {/* pinsa-92103: close-out mode renders a distinct emerald
                  panel so admins immediately see this is the "no work to do,
                  just record completion" path, not the bulk-flip one. */}
              {isCloseOutMode ? (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <CheckCircle2
                      size={16}
                      className="text-emerald-500 mt-0.5 flex-shrink-0"
                    />
                    <div className="text-sm text-theme-text">
                      <p>
                        This city has no pending payments. Closing it out
                        records that all expected reimbursements have been
                        completed.
                      </p>
                      <p className="text-xs text-theme-text-muted mt-2">
                        Existing paid records ({paidCount} payment
                        {paidCount === 1 ? '' : 's'},{' '}
                        <span className="font-medium text-theme-text">
                          ${paidTotalUsd.toFixed(2)}
                        </span>{' '}
                        total) stay unchanged.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
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
                  {/* caciotta-92103 + provolone-92103: show what's already
                      been paid on this party so the admin sees the
                      recommendation rationale. When this is >= the in-flight
                      sum the modal defaults to Mark pending complete so a
                      re-click after recording an external payment doesn't
                      double-count. */}
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
                      {alreadyClosedAt
                        ? 'This city is already closed out — every payout is paid, completed, rejected, or withdrawn.'
                        : 'Nothing to mark paid — every payout for this event is already paid, completed, rejected, or withdrawn.'}
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
              )}
            </div>
          )}

          {/* caciotta-92103 + provolone-92103: mode selector — Mark all as
              paid (legacy) vs Mark pending complete (new). Default-selected
              radio mirrors the server's suggestedMode so the safe action is
              one-click in the common "I already paid externally and recorded
              it" case. */}
          {preview && !previewLoading && count > 0 && mode !== null && (
            <div>
              <div className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">
                What should happen to these {count} payment{count === 1 ? '' : 's'}?
              </div>
              <div className="space-y-2">
                {(['mark_paid', 'mark_pending_complete'] as MarkPaidMode[]).map((m) => {
                  const active = mode === m;
                  const isMarkPaid = m === 'mark_paid';
                  const title = isMarkPaid
                    ? 'Mark all as paid'
                    : 'Mark pending complete (city fully paid)';
                  const explanation = isMarkPaid
                    ? `Creates ${count} new paid record${count === 1 ? '' : 's'} summing to $${totalUsd.toFixed(2)}. Use this if you actually paid out additionally.`
                    : `Closes out ${count} pending claim${count === 1 ? '' : 's'} as completed without creating new paid records. The city is fully paid even if the org paid less than the requested amount.`;
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

          {/* Optional method override.
              caciotta-92103 + provolone-92103: only meaningful for mark_paid;
              mark_pending_complete never stamps payout_method.
              pinsa-92103: hidden in close-out mode — there are no in-flight
              rows for the method to stamp, so the choice is meaningless. */}
          {!isCloseOutMode && mode === 'mark_paid' && (
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
              isCloseOutMode
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : mode === 'mark_pending_complete'
                  ? 'bg-teal-600 hover:bg-teal-700'
                  : 'bg-red-500 hover:bg-red-600'
            }`}
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isCloseOutMode ? (
              <CheckCircle2 size={14} />
            ) : mode === 'mark_pending_complete' ? (
              <CheckCircle2 size={14} />
            ) : (
              <DollarSign size={14} />
            )}
            {isCloseOutMode
              ? `Close out ${cityName}`
              : count > 0
                ? mode === 'mark_pending_complete'
                  ? `Mark ${count} pending complete`
                  : `Mark ${count} payment${count === 1 ? '' : 's'} paid ($${totalUsd.toFixed(2)})`
                : 'Mark party paid'}
          </button>
        </div>
      </form>
    </div>
  );
};
