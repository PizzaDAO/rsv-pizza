import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, UserCheck, X } from 'lucide-react';
import { Checkbox } from '../Checkbox';
import type { PayoutRecipientCandidate } from '../../lib/api';

interface RecipientPickerModalProps {
  candidates: PayoutRecipientCandidate[];
  /** True while the resubmit is in flight (disables the confirm button). */
  submitting?: boolean;
  onConfirm: (recipientUserId: string) => void;
  onClose: () => void;
}

/**
 * caciocavallo-58535: "Reimburse which host?" picker.
 *
 * Shown when an aggregator (admin / scoped underboss) uploads receipts on behalf
 * of a local host. The reimbursement is credited to the SELECTED host's wallet,
 * not the uploader's — so the choice is explicit (no default selection) and the
 * copy makes the destination clear.
 */
export const RecipientPickerModal: React.FC<RecipientPickerModalProps> = ({
  candidates,
  submitting = false,
  onConfirm,
  onClose,
}) => {
  const [selected, setSelected] = useState<string>('');

  const body = (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
      onClick={submitting ? undefined : onClose}
    >
      <div
        className="bg-theme-surface rounded-2xl shadow-2xl border border-theme-stroke w-full max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-theme-stroke">
          <UserCheck size={20} className="text-theme-accent flex-shrink-0" />
          <h2 className="text-lg font-semibold text-theme-text flex-1">
            Reimburse which host?
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-theme-muted hover:text-theme-text disabled:opacity-50"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto">
          <p className="text-sm text-theme-muted mb-4">
            You are uploading these receipts on behalf of a local host. The
            reimbursement will be paid to the selected host&apos;s wallet, not
            yours. Choose who this reimbursement is for.
          </p>

          <div className="flex flex-col gap-2">
            {candidates.map((c) => {
              const primary = c.isPrimaryHost ? ' (primary host)' : '';
              const sub = c.email && c.name ? c.email : '';
              const label = `${c.name || c.email || 'Unknown host'}${primary}`;
              return (
                <div
                  key={c.userId}
                  className={`rounded-xl border p-3 transition-colors ${
                    selected === c.userId
                      ? 'border-theme-accent bg-theme-accent/10'
                      : 'border-theme-stroke hover:border-theme-accent/50'
                  }`}
                >
                  <Checkbox
                    checked={selected === c.userId}
                    onChange={() => setSelected(c.userId)}
                    label={label}
                  />
                  {sub && (
                    <div className="text-xs text-theme-muted truncate pl-7 mt-0.5">
                      {sub}
                    </div>
                  )}
                </div>
              );
            })}
            {candidates.length === 0 && (
              <p className="text-sm text-theme-muted">
                No eligible recipient hosts found for this event.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-theme-stroke">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg border border-theme-stroke text-theme-text hover:bg-theme-stroke/30 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected || submitting}
            className="px-4 py-2 text-sm rounded-lg bg-theme-accent text-white font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            Confirm recipient
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
};
