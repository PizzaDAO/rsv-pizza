import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, MessageSquare } from 'lucide-react';
import { IconInput } from '../IconInput';
import { appealReimbursementCap } from '../../lib/api';

interface AppealCapModalProps {
  partyId: string;
  capUsd: number;
  /** ISO string — null if the host hasn't appealed yet. */
  previousAppealedAt: string | null;
  /** Previous note, if any — shown when the user is re-appealing. */
  previousNote: string | null;
  onClose: () => void;
  onSubmitted: (result: { note: string; appealedAt: string }) => void;
}

const MAX_NOTE_LEN = 2000;

/**
 * Modal for hosts to appeal their reimbursement cap (arugula-38633 v2).
 *
 * Submits to POST /api/parties/:id/reimbursement-cap/appeal which lives
 * outside the payouts soft-launch gate, so hosts can still register an
 * appeal even before they can submit payouts.
 */
export const AppealCapModal: React.FC<AppealCapModalProps> = ({
  partyId,
  capUsd,
  previousAppealedAt,
  previousNote,
  onClose,
  onSubmitted,
}) => {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isReappeal = !!previousAppealedAt;
  const trimmed = note.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_NOTE_LEN && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await appealReimbursementCap(partyId, trimmed);
      setSuccess(true);
      if (res.reimbursementCapAppealedAt) {
        onSubmitted({
          note: res.reimbursementCapAppealNote ?? trimmed,
          appealedAt: res.reimbursementCapAppealedAt,
        });
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to submit appeal');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card p-6 sm:p-8 max-w-lg w-full relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text transition-colors"
          aria-label="Close"
        >
          <X size={24} />
        </button>

        <div className="mb-4">
          <h2 className="text-xl font-bold text-theme-text mb-1">Appeal payment cap</h2>
          <p className="text-sm text-theme-text-muted">
            Your cap is currently <span className="font-medium text-theme-text">${capUsd.toFixed(2)}</span>.
            Tell us why it should be higher and an underboss will review.
          </p>
        </div>

        {success ? (
          <div className="space-y-4">
            <div className="bg-green-500/10 border border-green-500/30 text-green-300 p-4 rounded-xl text-sm">
              Thanks — your appeal has been recorded. An underboss will review it
              and follow up if they need more info.
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full btn-secondary"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {isReappeal && (
              <div className="bg-theme-surface border border-theme-stroke p-3 rounded-xl text-xs text-theme-text-muted">
                You've already appealed this cap. Submitting again replaces your
                previous note{previousNote ? `: "${previousNote.slice(0, 120)}${previousNote.length > 120 ? '…' : ''}"` : '.'}
              </div>
            )}

            <div>
              <IconInput
                icon={MessageSquare}
                multiline
                rows={5}
                placeholder="Why should the cap be higher? (e.g. expensive venue, larger crowd than usual, sponsor commitments…)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={MAX_NOTE_LEN}
                autoFocus
              />
              <p className="text-xs text-white/40 mt-1">
                {trimmed.length}/{MAX_NOTE_LEN}
              </p>
            </div>

            {error && (
              <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
                {error}
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="btn-primary inline-flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                {submitting ? 'Submitting…' : 'Submit appeal'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
};
