import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, MessageSquare, Loader2 } from 'lucide-react';
import { IconInput } from '../IconInput';

export interface RejectReasonModalProps {
  isOpen: boolean;
  /**
   * What we're rejecting — used in the modal heading.
   *  - single: `Reject payment for {hostName}?`
   *  - bulk:   `Reject {n} payments?`
   */
  context:
    | { kind: 'single'; hostName: string }
    | { kind: 'bulk'; count: number };
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

const MAX_LEN = 1000;

/**
 * crudo-91827: In-app replacement for `window.prompt('Rejection reason...')`,
 * which is silently blocked by popup blockers / Brave / Arc / many browser
 * extensions — making the /payments Reject (X) button appear to do nothing
 * for some admins.
 *
 * Uses the standard project modal pattern: createPortal → fixed backdrop
 * (`bg-black/60 backdrop-blur-sm`) → `z-50` → click-outside-to-close → card
 * body. Caller is responsible for closing the modal on success (so it can
 * coordinate the surrounding refresh()).
 */
export const RejectReasonModal: React.FC<RejectReasonModalProps> = ({
  isOpen,
  context,
  onCancel,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset state whenever the modal transitions to closed (so re-opening is
  // a clean slate).
  useEffect(() => {
    if (!isOpen) {
      setReason('');
      setBusy(false);
      setErrorMsg(null);
    }
  }, [isOpen]);

  // Close on Escape (only when the modal is open and not mid-submit).
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, busy, onCancel]);

  if (!isOpen) return null;

  const trimmed = reason.trim();
  const disabled = busy || trimmed.length === 0;

  const heading =
    context.kind === 'single'
      ? `Reject payment for ${context.hostName}?`
      : `Reject ${context.count} payment${context.count === 1 ? '' : 's'}?`;

  async function handleConfirm() {
    if (disabled) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      await onConfirm(trimmed);
      // Caller closes the modal on success (so it can sequence refreshes
      // first). If `onConfirm` resolves without the parent closing us, we'll
      // still drop back to idle so the user can retry / cancel.
    } catch (err: any) {
      setErrorMsg(err?.message || 'Reject failed');
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto bg-theme-surface border border-theme-stroke rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-theme-text">{heading}</h2>
          <button
            type="button"
            onClick={() => {
              if (!busy) onCancel();
            }}
            disabled={busy}
            className="p-1.5 rounded-md hover:bg-theme-surface-hover text-theme-text-muted disabled:opacity-50"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <IconInput
          icon={MessageSquare}
          multiline
          rows={4}
          placeholder="Why are you rejecting? (Visible to the host on their payouts list.)"
          value={reason}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setReason(e.target.value.slice(0, MAX_LEN))
          }
          maxLength={MAX_LEN}
          disabled={busy}
          autoFocus
        />
        <div className="mt-1 text-xs text-theme-text-muted text-right">
          {trimmed.length}/{MAX_LEN}
        </div>

        {errorMsg && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-100 text-red-700 border border-red-300 text-sm">
            {errorMsg}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Reject
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
};
