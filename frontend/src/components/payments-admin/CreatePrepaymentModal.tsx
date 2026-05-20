import React, { useEffect, useMemo, useState } from 'react';
import { X, DollarSign, Loader2, Pencil, AlertTriangle, Star } from 'lucide-react';
import { IconInput } from '../IconInput';
import { PayoutMethodIcon, PAYOUT_METHOD_LABELS } from '../payments-shared';
import { isMercuryBlocked } from '../../lib/mercuryBlockedCountries';
import { createPayout } from '../../lib/api';
import type { PrepayCandidate, PrepayQueueRow } from '../../types';

interface CreatePrepaymentModalProps {
  row: PrepayQueueRow;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * bismarck-92103: admin modal for issuing a prepayment to a host whose payment
 * method is already on file. Submits as a regular Payout via the existing
 * `POST /api/parties/:partyId/payouts` with the `recipientHostUserId` admin
 * override so the resulting row is credited to the chosen cohost.
 *
 * The amount defaults to 50% of the event's effective reimbursement cap (the
 * "prepay" convention — half upfront, half on reimbursement). Mercury card
 * candidates are disabled when the party's country is on the Mercury block
 * list (see `mercuryBlockedCountries`).
 */
export const CreatePrepaymentModal: React.FC<CreatePrepaymentModalProps> = ({
  row,
  onClose,
  onCreated,
}) => {
  const { party, candidates } = row;
  const cap = party.effectiveReimbursementCapUsd ?? 0;
  const defaultAmount = Math.max(1, Math.round(0.5 * cap));

  const mercuryBlocked = isMercuryBlocked(party.country);

  // Auto-select the first non-disabled candidate. Most rows have one candidate,
  // in which case it's pre-selected automatically.
  const initialCandidateId = useMemo(() => {
    const firstAllowed = candidates.find(
      (c) => !(c.method === 'mercury_card' && mercuryBlocked),
    );
    return firstAllowed?.userId ?? candidates[0]?.userId ?? '';
  }, [candidates, mercuryBlocked]);

  const [selectedUserId, setSelectedUserId] = useState<string>(initialCandidateId);
  const [amountStr, setAmountStr] = useState(String(defaultAmount));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selectedCandidate: PrepayCandidate | undefined = useMemo(
    () => candidates.find((c) => c.userId === selectedUserId),
    [candidates, selectedUserId],
  );

  const amountNum = useMemo(() => Number(amountStr), [amountStr]);

  const canSubmit =
    !!selectedCandidate &&
    !(selectedCandidate.method === 'mercury_card' && mercuryBlocked) &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selectedCandidate) return;
    setSubmitting(true);
    setError(null);
    try {
      await createPayout(party.id, {
        pizzaPhotos: [],
        receiptPhotos: [],
        payoutMethod: selectedCandidate.method,
        payoutWalletAddress:
          selectedCandidate.method === 'usdc_base' && selectedCandidate.walletAddress
            ? selectedCandidate.walletAddress
            : undefined,
        payoutBankDetails:
          selectedCandidate.method === 'wire' && selectedCandidate.bankEmail
            ? { email: selectedCandidate.bankEmail }
            : undefined,
        finalAmountUsd: amountNum,
        adminNotes: notes.trim() || `Prepayment for ${party.name}`,
        hostNotes: 'Prepayment created by admin',
        recipientHostUserId: selectedCandidate.userId,
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create prepayment');
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
        className="bg-theme-surface rounded-2xl shadow-2xl border border-theme-stroke w-full max-w-lg max-h-[95vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-theme-stroke">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-theme-text truncate">
              Prepay {party.name}
            </h2>
            {cap > 0 && (
              <p className="text-xs text-theme-text-muted mt-0.5">
                Cap: ${cap.toLocaleString()}
                {party.country ? ` • ${party.country}` : ''}
              </p>
            )}
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
          {/* Recipient radio list */}
          <div>
            <div className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">
              Recipient
            </div>
            <div className="space-y-2">
              {candidates.map((c) => {
                const disabled = c.method === 'mercury_card' && mercuryBlocked;
                const active = selectedUserId === c.userId;
                const label = c.name && c.name.trim() ? c.name : c.email;
                return (
                  <label
                    key={c.userId}
                    className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                      active && !disabled
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : disabled
                          ? 'border-theme-stroke bg-theme-surface opacity-60 cursor-not-allowed'
                          : 'border-theme-stroke bg-theme-surface hover:border-theme-stroke-strong'
                    }`}
                  >
                    <input
                      type="radio"
                      name="recipient"
                      value={c.userId}
                      checked={active}
                      onChange={() => !disabled && setSelectedUserId(c.userId)}
                      disabled={disabled}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-theme-text">
                        {c.isPrimaryHost && (
                          <Star size={12} className="text-amber-500 shrink-0" />
                        )}
                        <span className="truncate">{label}</span>
                      </div>
                      <div className="text-xs text-theme-text-muted truncate">
                        {c.email}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <PayoutMethodIcon method={c.method} size={12} />
                        <span className="text-xs text-theme-text-secondary">
                          {PAYOUT_METHOD_LABELS[c.method]}
                        </span>
                      </div>
                      {disabled && (
                        <div className="mt-1.5 flex items-start gap-1 text-xs text-amber-500">
                          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                          <span>
                            Mercury card unavailable in {party.country ?? 'this country'}
                            — pick another method or recipient.
                          </span>
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Amount */}
          <div>
            <IconInput
              icon={DollarSign}
              type="number"
              step="0.01"
              min="0"
              placeholder="Amount USD *"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              required
            />
            <p className="text-xs text-theme-text-muted mt-1">
              Default is 50% of the event's reimbursement cap. Edit if needed.
            </p>
          </div>

          {/* Internal note (optional) */}
          <IconInput
            icon={Pencil}
            multiline
            rows={3}
            placeholder={`Internal note (optional, defaults to "Prepayment for ${party.name}")`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
          />

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-100 text-red-700 border border-red-300 text-sm">
              {error}
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
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Create prepayment
          </button>
        </div>
      </form>
    </div>
  );
};
