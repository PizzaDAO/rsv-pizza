import React, { useMemo, useState } from 'react';
import { Loader2, StickyNote, BadgeDollarSign, Users, AlertTriangle } from 'lucide-react';
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

/**
 * speck-89172: the $675 per-payment hard ceiling is still informative — USDC
 * execute still caps at $675 per tx (cassoeula-92103, was $650), so a single
 * oversize submission may require admin to split into multiple sends. Host
 * submission is no longer blocked; instead we render an amber warning so the
 * host knows what to expect on the admin side.
 */
const PER_PAYMENT_HARD_CEILING_USD = 675;

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
  // pomodoro-92110: event photos are a separate dropzone (cap 30) persisted as
  // kind:'event' payout documents.
  const [eventPhotos, setEventPhotos] = useState<PizzaPhotoItem[]>([]);
  const [notes, setNotes] = useState('');
  const [overrideAmount, setOverrideAmount] = useState<number | null>(null);

  // arugula-38633 v3 (follow-up): read payment method + destination from the
  // authenticated user record (saved via PaymentDetailsCard at the top of
  // the Payments tab). These are now PURELY optional at submit time — when
  // unset, the payout persists with payout_method=NULL and admin asks the
  // host to fill them in before execute.
  const savedMethod = user?.preferredPayoutMethod ?? null;
  const savedWallet = user?.payoutWalletAddress ?? null;
  const savedBank = user?.payoutBankDetails ?? null;
  // We still gate the per-method payload (wallet for usdc, bank for wire)
  // on a basic validity check so we don't post half-typed data. When
  // invalid, we just don't forward the method — submit still works.
  const savedMethodValid = useMemo(() => {
    if (savedMethod == null) return false;
    if (savedMethod === 'usdc_base') {
      return !!savedWallet && /^0x[0-9a-fA-F]{40}$/.test(savedWallet.trim());
    }
    if (savedMethod === 'wire') {
      // arugula-38633 (follow-up): wire is now a single email field; legacy
      // rows that still have account-holder + routing/IBAN are also accepted
      // so we don't drop already-saved details from existing hosts.
      if (!savedBank) return false;
      const email = savedBank.email?.trim() ?? '';
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return true;
      // Legacy fallback: account-holder + bank-name + (US OR Intl) routing.
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

  // mortadella-92103: exclude receipts whose currency couldn't be resolved
  // (the `$` ambiguity in non-USD countries) from the auto-sum. They keep
  // their preview row but aren't counted until the host picks a currency
  // via CurrencyOverrideSelect. The amber notice below tells the host what
  // to do. `r.ocr.amount` is USD-converted (see OcrPreviewResult).
  const ocrSum = useMemo(
    () => receipts
      .filter(r => r.status === 'done' && r.ocr && r.ocr.ocrError !== 'CURRENCY_UNRESOLVED')
      .reduce((sum, r) => sum + (r.ocr?.amount ?? 0), 0),
    [receipts]
  );
  // mortadella-92103: count of unresolved-currency receipts so we can show
  // a single amber notice rather than per-row warnings (the per-receipt
  // row already shows its low-confidence state via the dropdown).
  const unresolvedReceiptCount = useMemo(
    () => receipts.filter(r =>
      r.status === 'done' && r.ocr && r.ocr.ocrError === 'CURRENCY_UNRESOLVED'
    ).length,
    [receipts]
  );
  const finalAmount = overrideAmount != null ? overrideAmount : ocrSum;

  const isProcessing = receipts.some(r => r.status === 'uploading' || r.status === 'ocring')
    || pizzaPhotos.some(p => p.status === 'uploading')
    || eventPhotos.some(p => p.status === 'uploading');

  // When the attendance section is shown, require a positive integer before submit.
  const attendanceValid = !askForAttendance
    || (estimatedAttendance != null && estimatedAttendance > 0);

  // speck-89172: hosts can now submit any positive amount. The party-cap and
  // $675 hard-ceiling checks are surfaced as non-blocking amber warnings
  // instead. Admin moderates over-cap rows from /payments.
  const effectiveCapUsd = party?.effectiveReimbursementCapUsd ?? null;
  const exceedsPartyCap =
    effectiveCapUsd != null && effectiveCapUsd > 0 && finalAmount > effectiveCapUsd;
  const exceedsHardCeiling = finalAmount > PER_PAYMENT_HARD_CEILING_USD;

  // pizzaiolo-92103: re-introduce the payment-method gate that arugula-38633
  // v3 removed. Hosts can submit receipts only when they have a saved method
  // AND its required field is filled in. Mirrors the methodValid check used
  // by PaymentDetailsCard (see comment there). Wallet validity is non-empty
  // only — ENS strings count (taleggio-30219), no 0x regex enforcement.
  const userMethodValid = useMemo(() => {
    const m = user?.preferredPayoutMethod;
    if (m == null) return false;
    if (m === 'usdc_base') {
      return Boolean((user?.payoutWalletAddress ?? '').trim());
    }
    if (m === 'wire') {
      const email = user?.payoutBankDetails?.email;
      return typeof email === 'string'
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }
    return true; // mercury_card has no extra required fields
  }, [user]);

  // pizzaiolo-92103: explanatory message for the amber notice — varies by
  // which sub-state of "no valid method" the host is in.
  const methodNoticeText = useMemo(() => {
    const m = user?.preferredPayoutMethod;
    if (m == null) {
      return 'Set your payment method on the Payments tab to submit this receipt.';
    }
    if (m === 'usdc_base') {
      return 'Add your USDC wallet address on the Payments tab to submit this receipt.';
    }
    if (m === 'wire') {
      return 'Add the email for bank correspondence on the Payments tab to submit this receipt.';
    }
    return '';
  }, [user]);

  // pizzaiolo-92103: submission now requires a valid saved payment method
  // (gate also enforced backend-side as PAYMENT_METHOD_NOT_SET /
  // PAYMENT_METHOD_INCOMPLETE).
  const canSubmit = finalAmount > 0
    && attendanceValid
    && !isProcessing
    && !submitting
    && userMethodValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // arugula-38633 v3 follow-up: only forward the payout method (and its
      // payload) when it's both set AND validates. Otherwise we omit it
      // entirely so the backend persists payout_method=NULL.
      const forwardMethod = savedMethod && savedMethodValid;
      const created = await createPayout(partyId, {
        receiptPhotos: receipts
          .filter(r => r.status === 'done' && r.url)
          .map(r => ({
            url: r.url!,
            fileName: r.fileName,
            fileSize: r.fileSize,
            mimeType: r.mimeType,
            // provolone-49301: forward the preview-OCR payload so the backend
            // skips a second gpt-4o pass. These already reflect any host
            // currency override (CurrencyOverrideSelect mutates r.ocr in
            // place). USD amount/rate are intentionally NOT sent — the backend
            // re-locks FX via convertToUSD. Include the CURRENCY_UNRESOLVED
            // case too (originalAmount is still set) so the backend treats it
            // as forwarded and doesn't re-OCR.
            ocrOriginalAmount: r.ocr?.originalAmount,
            ocrOriginalCurrency: r.ocr?.originalCurrency,
            ocrConfidence: r.ocr?.confidence,
            ocrLineItems: r.ocr?.lineItems,
            ocrRaw: r.ocr?.ocrRaw,
            ocrError: r.ocr?.ocrError,
          })),
        pizzaPhotos: pizzaPhotos
          .filter(p => p.status === 'done' && p.url)
          .map(p => ({
            url: p.url!,
            fileName: p.fileName,
            fileSize: p.fileSize,
            mimeType: p.mimeType,
          })),
        // pomodoro-92110: event photos persist as kind:'event' payout docs.
        eventPhotos: eventPhotos
          .filter(p => p.status === 'done' && p.url)
          .map(p => ({
            url: p.url!,
            fileName: p.fileName,
            fileSize: p.fileSize,
            mimeType: p.mimeType,
          })),
        hostNotes: notes.trim() || undefined,
        ...(forwardMethod
          ? {
              payoutMethod: savedMethod!,
              ...(savedMethod === 'usdc_base' && savedWallet
                ? { payoutWalletAddress: savedWallet.trim() }
                : {}),
              ...(savedMethod === 'wire' && savedBank
                ? { payoutBankDetails: savedBank }
                : {}),
              saveAsDefault: true,
            }
          : {}),
        // arugula-38633 v3 follow-up: forward finalAmountUsd whenever the
        // host has typed an override. Note: with zero receipts, canSubmit
        // already requires `finalAmount > 0`, which can only come from the
        // override (ocrSum is 0 with no receipts) — so override is always
        // set on the no-receipts path.
        ...(overrideAmount != null ? { finalAmountUsd: overrideAmount } : {}),
        ...(estimatedAttendance != null ? { estimatedAttendance } : {}),
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

      {/* 2. Pizza photos (pomodoro-92110: cap 10) */}
      <div className="card p-6">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-theme-text">Pizza photos</h3>
          <p className="text-xs text-theme-text-muted mt-0.5">
            Photos of the pizza help your reviewer.
          </p>
        </div>
        <PizzaPhotoUpload
          partyId={partyId}
          payoutTempId={payoutTempId}
          kind="pizza"
          maxItems={10}
          items={pizzaPhotos}
          onChange={setPizzaPhotos}
        />
      </div>

      {/* 2b. Event photos (pomodoro-92110: cap 30) */}
      <div className="card p-6">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-theme-text">Event photos</h3>
          <p className="text-xs text-theme-text-muted mt-0.5">
            Photos from the event help your reviewer.
          </p>
        </div>
        <PizzaPhotoUpload
          partyId={partyId}
          payoutTempId={payoutTempId}
          kind="event"
          maxItems={30}
          items={eventPhotos}
          onChange={setEventPhotos}
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

      {/* mortadella-92103: amber notice when one or more receipts have an
          unresolved currency (OCR returned $ without a strong country prior).
          The auto-sum excludes those receipts until the host picks a code via
          the per-row CurrencyOverrideSelect dropdown. */}
      {unresolvedReceiptCount > 0 && (
        <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/10">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="text-amber-300 mt-0.5 flex-shrink-0" size={16} />
            <div className="flex-1 text-sm text-amber-100">
              {unresolvedReceiptCount === 1
                ? "1 receipt's currency could not be detected. Use the currency picker on that row to set the correct currency — it isn't counted in the total yet."
                : `${unresolvedReceiptCount} receipts' currencies could not be detected. Use the currency picker on those rows — they aren't counted in the total yet.`}
            </div>
          </div>
        </div>
      )}

      {/* speck-89172: party-cap amber warning. Non-blocking — submit stays
          enabled, admin reviews from /payments. Only renders when the party
          has an effective cap AND the typed amount exceeds it. */}
      {exceedsPartyCap && (
        <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/10">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="text-amber-300 mt-0.5 flex-shrink-0" size={16} />
            <div className="flex-1 text-sm text-amber-100">
              Heads up: receipts total ${finalAmount.toFixed(2)}, but your reimbursement cap is ${effectiveCapUsd!.toFixed(2)}. We'll reimburse the cap; the receipts stay attached as evidence. Admin can approve more in special cases.
            </div>
          </div>
        </div>
      )}

      {/* speck-89172: $675 hard-ceiling amber warning. USDC execute caps at
          $675 per tx, so admin may need to split this into multiple sends. */}
      {exceedsHardCeiling && (
        <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/10">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="text-amber-300 mt-0.5 flex-shrink-0" size={16} />
            <div className="flex-1 text-sm text-amber-100">
              Heads up: ${finalAmount.toFixed(2)} exceeds the ${PER_PAYMENT_HARD_CEILING_USD} per-payment maximum. Admin may need to split into multiple sends.
            </div>
          </div>
        </div>
      )}

      {/* pizzaiolo-92103: payment-method gate reinstated. When the host
          hasn't saved a valid method (or a method-specific field is missing),
          render an amber notice with an anchor link back up to the
          PaymentDetailsCard at the top of the Payments tab. Submit stays
          disabled until userMethodValid is true. Backend mirrors this gate
          (PAYMENT_METHOD_NOT_SET / PAYMENT_METHOD_INCOMPLETE). */}
      {!userMethodValid && (
        <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/10">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="text-amber-300 mt-0.5 flex-shrink-0" size={16} />
            <div className="flex-1 text-sm text-amber-100">
              {methodNoticeText}{' '}
              <a
                href="#payment-details-card"
                className="underline underline-offset-2 hover:text-amber-50"
              >
                Go to payment details →
              </a>
            </div>
          </div>
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
