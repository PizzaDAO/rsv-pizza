/**
 * TransferOwnershipModal (fontina-91827)
 *
 * Admin-only modal that hits POST /api/admin/parties/:partyId/transfer-ownership
 * to atomically swap parties.user_id, scrub the old owner from co_hosts, drop
 * their payment opt-in row, and canonicalize the new owner.
 *
 * Mounted from HostsManager under the primary host row when the caller is an
 * admin or underboss.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mail, AlertCircle, ArrowRightLeft, Loader2, X } from 'lucide-react';
import { Checkbox } from '../Checkbox';
import { IconInput } from '../IconInput';
import { transferEventOwnership } from '../../lib/api';

export interface TransferOwnershipModalProps {
  isOpen: boolean;
  partyId: string;
  currentOwnerName: string | null;
  currentOwnerEmail: string;
  candidateCoHosts: Array<{ name: string | null; email: string }>;
  onClose: () => void;
  onTransferred: () => void;
}

const TransferOwnershipModal: React.FC<TransferOwnershipModalProps> = ({
  isOpen,
  partyId,
  currentOwnerName,
  currentOwnerEmail,
  candidateCoHosts,
  onClose,
  onTransferred,
}) => {
  const [newOwnerEmail, setNewOwnerEmail] = useState('');
  const [removeOldFromCoHosts, setRemoveOldFromCoHosts] = useState(true);
  const [deleteOldOptIn, setDeleteOldOptIn] = useState(true);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open/close so a re-open doesn't reveal the previous attempt
  useEffect(() => {
    if (isOpen) {
      setNewOwnerEmail('');
      setRemoveOldFromCoHosts(true);
      setDeleteOldOptIn(true);
      setNote('');
      setSubmitting(false);
      setError(null);
    }
  }, [isOpen]);

  // De-duplicate candidates (case-insensitive) and drop the current owner so
  // the suggestion dropdown never offers the no-op.
  const dedupedCandidates = useMemo(() => {
    const currentLower = currentOwnerEmail.toLowerCase();
    const seen = new Set<string>();
    const out: Array<{ name: string | null; email: string }> = [];
    for (const c of candidateCoHosts) {
      const e = (c.email || '').toLowerCase().trim();
      if (!e) continue;
      if (e === currentLower) continue;
      if (seen.has(e)) continue;
      seen.add(e);
      out.push({ name: c.name ?? null, email: c.email });
    }
    return out;
  }, [candidateCoHosts, currentOwnerEmail]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    const trimmed = newOwnerEmail.trim();
    if (!trimmed) {
      setError('Enter the new owner email.');
      return;
    }
    if (trimmed.toLowerCase() === currentOwnerEmail.toLowerCase()) {
      setError('New owner is the same as the current owner.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await transferEventOwnership(partyId, {
        newOwnerEmail: trimmed,
        removeOldFromCoHosts,
        deleteOldOptIn,
        note: note.trim() || undefined,
      });
      onTransferred();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transfer failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const displayName = currentOwnerName ?? currentOwnerEmail;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-theme-text flex items-center gap-2">
            <ArrowRightLeft size={18} className="text-[#ff393a]" />
            Transfer ownership
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/50 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-white/60 mb-4">
          Currently owned by <span className="text-white font-medium">{displayName}</span>{' '}
          <span className="text-white/40">({currentOwnerEmail})</span>.
        </p>

        <div className="space-y-3">
          <div>
            <IconInput
              icon={Mail}
              type="email"
              value={newOwnerEmail}
              onChange={(e) => setNewOwnerEmail(e.target.value)}
              placeholder="New owner email"
              autoComplete="off"
            />
            <p className="text-xs text-white/40 mt-1">
              Must be an existing rsv.pizza user — they need to have logged in at least once.
            </p>
          </div>

          {dedupedCandidates.length > 0 && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-white/50 mb-1.5 px-1">Pick from cohosts:</p>
              <div className="flex flex-wrap gap-1.5">
                {dedupedCandidates.map((c) => (
                  <button
                    key={c.email}
                    type="button"
                    onClick={() => setNewOwnerEmail(c.email)}
                    className={`text-xs px-2 py-1 rounded-md transition-colors ${
                      newOwnerEmail.trim().toLowerCase() === c.email.toLowerCase()
                        ? 'bg-[#ff393a]/20 text-[#ff393a] border border-[#ff393a]/40'
                        : 'bg-white/5 text-white/70 hover:bg-white/10 border border-white/10'
                    }`}
                  >
                    {c.name ? `${c.name} (${c.email})` : c.email}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 pt-1">
            <Checkbox
              checked={removeOldFromCoHosts}
              onChange={() => setRemoveOldFromCoHosts((v) => !v)}
              label="Remove old owner from the cohost list"
              size={16}
              labelClassName="text-sm text-white/70"
            />
            <Checkbox
              checked={deleteOldOptIn}
              onChange={() => setDeleteOldOptIn((v) => !v)}
              label="Delete old owner's payment opt-in for this event"
              size={16}
              labelClassName="text-sm text-white/70"
            />
          </div>

          <IconInput
            multiline
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason / notes (optional)"
          />

          {error && (
            <div className="flex items-start gap-2 text-sm text-[#ff393a] bg-[#ff393a]/10 border border-[#ff393a]/30 rounded-lg p-3">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !newOwnerEmail.trim()}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <ArrowRightLeft size={16} />}
            {submitting ? 'Transferring...' : 'Transfer'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default TransferOwnershipModal;
