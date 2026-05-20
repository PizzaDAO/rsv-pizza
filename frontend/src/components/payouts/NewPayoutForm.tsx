import React, { useMemo, useState } from 'react';
import { Loader2, StickyNote, BadgeDollarSign, Users, AlertCircle } from 'lucide-react';
import { IconInput } from '../IconInput';
import { useAuth } from '../../contexts/AuthContext';
import { usePizza } from '../../contexts/PizzaContext';
import { Payout } from '../../types';
import { createPayout } from '../../lib/api';
import { parsePartyKitCapFromTags } from '../../lib/reimbursementCap';
import { ReceiptUpload, ReceiptItem } from './ReceiptUpload';
import { PizzaPhotoUpload, PizzaPhotoItem } from './PizzaPhotoUpload';
import { PayoutAmountSummary } from './PayoutAmountSummary';
import { AppealCapModal } from './AppealCapModal';

interface NewPayoutFormProps {
  partyId: string;
  onCreated: (payout: Payout) => void;
  onCancel: () => void;
  /** Reimbursement cap (arugula-38633 v2) — banner only renders if non-null. */
  reimbursementCapUsd?: number | null;
  /** Previous appeal note (if any) — shown in re-appeal flow. */
  reimbursementCapAppealNote?: string | null;
  /** Previous appeal timestamp — non-null means host has already appealed. */
  reimbursementCapAppealedAt?: string | null;
  /**
   * Sum of finalAmountUsd for already-paid payouts on this party.
   * Shown inside the cap banner (and standalone if there's no cap).
   * arugula-38633 v2 follow-up.
   */
  totalPaidUsd?: number;
  /**
   * Current value of `parties.expectedGuests`. When null, the form prompts the
   * host for an attendance estimate (asked once per event); when set, the
   * estimated-attendance section is hidden entirely.
   */
  expectedGuests?: number | null;
}

/**
 * Single-page submission form (no multi-step wizard — matches pizza-faucet-v2).
 *
 * Sections:
 *   0. Estimated attendance (only if `expectedGuests` is currently null)
 *   1. Receipts (multi-upload + per-receipt OCR preview)
 *   2. Pizza / event photos (multi-upload, no OCR)
 *   3. Notes
 *   4. Amount summary (auto-summed + manual override)
 *   5. Submit
 *
 * Note (arugula-38633 v3): the payout-method picker was hoisted to a
 * persistent PaymentDetailsCard at the top of the Payments tab. This form
 * now reads the user's saved `preferredPayoutMethod` / `payoutWalletAddress`
 * / `payoutBankDetails` from AuthContext and forwards them to `createPayout`
 * — it no longer asks the host per submission.
 */
export const NewPayoutForm: React.FC<NewPayoutFormProps> = ({
  partyId,
  onCreated,
  onCancel,
  reimbursementCapUsd,
  reimbursementCapAppealNote,
  reimbursementCapAppealedAt,
  totalPaidUsd = 0,
  expectedGuests,
}) => {
  const { user } = useAuth();
  const { party } = usePizza();
  // Party-kit cap: parsed from an event_tag of the form `k40`, `k50`, etc.
  // When set, the cap banner appends " and up to $Y of party kit expenses".
  const partyKitCapUsd = parsePartyKitCapFromTags(party?.eventTags);
  // Stable id for this in-flight form, used as the storage-path grouping key.
  const [payoutTempId] = useState(() => `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  // Cap appeal modal + local mirror of appeal state so submissions update the
  // banner without requiring the parent to reload the Party context.
  const [showAppealModal, setShowAppealModal] = useState(false);
  const [localAppealNote, setLocalAppealNote] = useState<string | null>(reimbursementCapAppealNote ?? null);
  const [localAppealedAt, setLocalAppealedAt] = useState<string | null>(reimbursementCapAppealedAt ?? null);

  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [pizzaPhotos, setPizzaPhotos] = useState<PizzaPhotoItem[]>([]);
  const [notes, setNotes] = useState('');
  const [overrideAmount, setOverrideAmount] = useState<number | null>(null);

  // arugula-38633 v3: read payment method + destination from the
  // authenticated user record (saved via PaymentDetailsCard at the top of
  // the Payments tab). When unset, the submit button is disabled and an
  // inline message points the host upward.
  const savedMethod = user?.preferredPayoutMethod ?? null;
  const savedWallet = user?.payoutWalletAddress ?? null;
  const savedBank = user?.payoutBankDetails ?? null;
  // Validity mirror of PaymentDetailsCard.methodValid (kept duplicated
  // intentionally — the card may not yet have persisted a partially typed
  // wire row when the host clicks Submit).
  const savedMethodValid = useMemo(() => {
    if (savedMethod == null) return false;
    if (savedMethod === 'usdc_base') {
      return !!savedWallet && /^0x[0-9a-fA-F]{40}$/.test(savedWallet.trim());
    }
    if (savedMethod === 'wire') {
      if (!savedBank) return false;
      if (!savedBank.accountHolderName?.trim() || !savedBank.bankName?.trim()) return false;
      const hasUs = !!savedBank.routingNumber?.trim() && !!savedBank.accountNumber?.trim();
      const hasIntl = !!savedBank.iban?.trim() || !!savedBank.swift?.trim();
      return hasUs || hasIntl;
    }
    return true; // mercury_card has no extra required destination data
  }, [savedMethod, savedWallet, savedBank]);

  // Estimated attendance: asked once per event. Pre-fills from the party's
  // existing `expectedGuests` if set; otherwise the host is prompted.
  const askForAttendance = expectedGuests == null;
  const [estimatedAttendance, setEstimatedAttendance] = useState<number | null>(
    expectedGuests ?? null
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const ocrSum = useMemo(
    () => receipts
      .filter(r => r.status === 'done' && r.ocr)
      .reduce((sum, r) => sum + (r.ocr?.amount ?? 0), 0),
    [receipts]
  );
  const finalAmount = overrideAmount != null ? overrideAmount : ocrSum;

  const hasUploadedReceipt = receipts.some(r => r.status === 'done' && r.url);
  const isProcessing = receipts.some(r => r.status === 'uploading' || r.status === 'ocring')
    || pizzaPhotos.some(p => p.status === 'uploading');

  // When the attendance section is shown, require a positive integer before submit.
  const attendanceValid = !askForAttendance
    || (estimatedAttendance != null && estimatedAttendance > 0);

  const canSubmit = hasUploadedReceipt
    && finalAmount > 0
    && savedMethodValid
    && attendanceValid
    && !isProcessing
    && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !savedMethod) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createPayout(partyId, {
        receiptPhotos: receipts
          .filter(r => r.status === 'done' && r.url)
          .map(r => ({
            url: r.url!,
            fileName: r.fileName,
            fileSize: r.fileSize,
            mimeType: r.mimeType,
          })),
        pizzaPhotos: pizzaPhotos
          .filter(p => p.status === 'done' && p.url)
          .map(p => ({
            url: p.url!,
            fileName: p.fileName,
            fileSize: p.fileSize,
            mimeType: p.mimeType,
          })),
        hostNotes: notes.trim() || undefined,
        // arugula-38633 v3: payout destination is sourced from the user's
        // PaymentDetailsCard, not the form. Backend payout.routes still
        // mirrors saveAsDefault → users.* on its end — kept for symmetry,
        // though PaymentDetailsCard already writes them directly via PATCH
        // /api/user/me on the host's first save.
        payoutMethod: savedMethod,
        ...(savedMethod === 'usdc_base' && savedWallet
          ? { payoutWalletAddress: savedWallet.trim() }
          : {}),
        ...(savedMethod === 'wire' && savedBank
          ? { payoutBankDetails: savedBank }
          : {}),
        ...(overrideAmount != null ? { finalAmountUsd: overrideAmount } : {}),
        ...(estimatedAttendance != null ? { estimatedAttendance } : {}),
        saveAsDefault: true,
      });
      onCreated(created);
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to submit receipt');
    } finally {
      setSubmitting(false);
    }
  };

  const showCapBanner = typeof reimbursementCapUsd === 'number' && reimbursementCapUsd > 0;
  // arugula-38633 v2 follow-up: when there's no cap (neither underboss-validated
  // nor a numeric event_tag), show a polite notice in place of the cap banner.
  const showPaidOnlyBanner = !showCapBanner && totalPaidUsd > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 0. Reimbursement cap banner (arugula-38633 v2) — only when underboss-validated */}
      {showCapBanner && (
        <div className="card p-4 sm:p-5 border-l-4 border-l-[#ff393a] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <BadgeDollarSign size={22} className="text-[#ff393a] mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-theme-text">
                We'll reimburse you for up to ${reimbursementCapUsd!.toFixed(2)}
                {partyKitCapUsd != null && (
                  <> of pizza and up to ${partyKitCapUsd.toFixed(2)} of party kit expenses</>
                )}
                .
                {totalPaidUsd > 0 && (
                  <> ${totalPaidUsd.toFixed(2)} paid so far.</>
                )}
              </p>
              <p className="text-xs text-theme-text-muted mt-0.5">
                {localAppealedAt
                  ? 'Appeal submitted — an underboss will review.'
                  : 'Submissions above this amount may not be fully reimbursed.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowAppealModal(true)}
            className="text-xs text-theme-text-secondary hover:text-theme-text underline underline-offset-2 whitespace-nowrap"
          >
            {localAppealedAt ? 'Update appeal' : 'Appeal cap →'}
          </button>
        </div>
      )}

      {/* Paid-so-far standalone banner (no cap) — only when there's at least one
          paid payout. Same visual treatment as the cap banner so the layout is
          consistent. */}
      {showPaidOnlyBanner && (
        <div className="card p-4 sm:p-5 border-l-4 border-l-emerald-500 flex items-start gap-3">
          <BadgeDollarSign size={22} className="text-emerald-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-theme-text">
              ${totalPaidUsd.toFixed(2)} paid so far.
            </p>
          </div>
        </div>
      )}

      {/* No-cap notice was hoisted to PayoutsTab (top of the Payments section)
          so it's always visible — removed here to avoid duplication. */}

      {/* 0. Estimated attendance — asked once per event */}
      {askForAttendance && (
        <div className="card p-6">
          <div className="mb-3">
            <h3 className="text-base font-semibold text-theme-text">Estimated attendance</h3>
            <p className="text-xs text-theme-text-muted mt-0.5">
              How many people are you expecting at your event? (You'll only be asked this once.)
            </p>
          </div>
          <IconInput
            icon={Users}
            type="number"
            placeholder="e.g. 50"
            value={estimatedAttendance ?? ''}
            onChange={e =>
              setEstimatedAttendance(
                e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : null
              )
            }
            min={1}
          />
        </div>
      )}

      {/* 1. Receipts */}
      <div className="card p-6">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-theme-text">Receipts</h3>
          <p className="text-xs text-theme-text-muted mt-0.5">
            Upload each of your receipts. We'll add up the total.
          </p>
        </div>
        <ReceiptUpload
          partyId={partyId}
          payoutTempId={payoutTempId}
          items={receipts}
          onChange={setReceipts}
        />
      </div>

      {/* 2. Pizza photos */}
      <div className="card p-6">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-theme-text">Pizza or event photos</h3>
          <p className="text-xs text-theme-text-muted mt-0.5">
            Proof-of-event photos help your reviewer.
          </p>
        </div>
        <PizzaPhotoUpload
          partyId={partyId}
          payoutTempId={payoutTempId}
          items={pizzaPhotos}
          onChange={setPizzaPhotos}
        />
      </div>

      {/* 3. Notes */}
      <div className="card p-6">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-theme-text">Notes</h3>
        </div>
        <IconInput
          icon={StickyNote}
          multiline
          rows={3}
          placeholder="What was this for? Pizza + venue, etc."
          value={notes}
          onChange={e => setNotes(e.target.value)}
          maxLength={500}
        />
        <p className="text-xs text-theme-text-muted mt-1">{notes.length}/500</p>
      </div>

      {/* 4. Amount summary */}
      <div className="card p-6">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-theme-text">Amount</h3>
        </div>
        <PayoutAmountSummary
          receipts={receipts}
          overrideAmount={overrideAmount}
          onOverrideChange={setOverrideAmount}
        />
      </div>

      {/* 5. Submit */}
      {submitError && (
        <div className="card p-4 border-red-500/40 bg-red-500/10 text-sm text-red-300">
          {submitError}
        </div>
      )}

      {/* arugula-38633 v3: payout method is now configured in the
          PaymentDetailsCard above. If the host hasn't set one yet, show an
          inline hint and disable submit. */}
      {!savedMethodValid && (
        <div className="card p-4 border-l-4 border-l-amber-500 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-theme-text">
            Set your <span className="font-semibold">payment details</span> above before submitting a receipt.
          </p>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary inline-flex items-center gap-2 justify-center"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {isProcessing
            ? 'Waiting for uploads…'
            : submitting
            ? 'Submitting…'
            : `Submit $${finalAmount.toFixed(2)} receipt`}
        </button>
      </div>

      {showAppealModal && showCapBanner && (
        <AppealCapModal
          partyId={partyId}
          capUsd={reimbursementCapUsd!}
          previousAppealedAt={localAppealedAt}
          previousNote={localAppealNote}
          onClose={() => setShowAppealModal(false)}
          onSubmitted={({ note, appealedAt }) => {
            setLocalAppealNote(note);
            setLocalAppealedAt(appealedAt);
          }}
        />
      )}
    </form>
  );
};
