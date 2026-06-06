import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, StickyNote, BadgeDollarSign, Users, AlertTriangle, ImagePlus, Camera } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { useAuth } from '../../contexts/AuthContext';
import { usePizza } from '../../contexts/PizzaContext';
import { Payout, Photo } from '../../types';
import {
  createPayout,
  designatePhotoRole,
  fetchPayoutSubmissionReadiness,
  getPartyPhotos,
} from '../../lib/api';
import { parsePartyKitCapFromTags } from '../../lib/reimbursementCap';
import { ReceiptUpload, ReceiptItem } from './ReceiptUpload';
import { PayoutAmountSummary } from './PayoutAmountSummary';
import { AppealCapModal } from './AppealCapModal';
import { RolePhotoPicker, PayoutPhotoRole } from './RolePhotoPicker';
import { PhotoUpload } from '../photos/PhotoUpload';
import { TaxFormType } from '../../types';

const PAYOUT_ROLES: PayoutPhotoRole[] = ['group', 'box_stack', 'pizza'];

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
  /**
   * bottarga-92106: TaxFormSection now lives on the parent PayoutsTab. When
   * the backend returns TAX_FORM_REQUIRED, this callback lets the parent
   * auto-open the section to the requested form type. The form still scrolls
   * to `#tax-form-section` (the section's id, which now sits above this form
   * on the same tab).
   */
  onTaxFormRequired?: (formType: TaxFormType | null) => void;
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
  onTaxFormRequired,
}) => {
  const { t } = useTranslation('host');
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
  const [notes, setNotes] = useState('');
  const [overrideAmount, setOverrideAmount] = useState<number | null>(null);

  // porchetta-58296: the three host-designated event role photos. Each slot
  // holds the designated Photo (or undefined). Seeded on mount from the
  // gallery's payoutRole field. The actual designation is persisted via
  // designatePhotoRole when the host picks/uploads in the RolePhotoPicker.
  const [roles, setRoles] = useState<Record<PayoutPhotoRole, Photo | undefined>>({
    group: undefined,
    box_stack: undefined,
    pizza: undefined,
  });
  const [pickerRole, setPickerRole] = useState<PayoutPhotoRole | null>(null);
  const [designating, setDesignating] = useState(false);
  // porchetta-58296: host attestation that all receipts are uploaded + itemized.
  const [receiptAttested, setReceiptAttested] = useState(false);
  // Server readiness snapshot (receipt presence carries across page reloads /
  // receipts uploaded on a prior visit via the shared receipts library).
  const [readinessHasReceipt, setReadinessHasReceipt] = useState(false);
  const [showAdditionalUpload, setShowAdditionalUpload] = useState(false);

  // porchetta-58296: seed the role slots + receipt readiness on mount. Pull the
  // gallery (host view) and match the photos already carrying each payoutRole,
  // plus the server-side receipt/role readiness.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [photosRes, readiness] = await Promise.all([
        getPartyPhotos(partyId, { status: 'all', limit: 100 }),
        fetchPayoutSubmissionReadiness(partyId),
      ]);
      if (cancelled) return;
      const photos = photosRes?.photos ?? [];
      const next: Record<PayoutPhotoRole, Photo | undefined> = {
        group: undefined,
        box_stack: undefined,
        pizza: undefined,
      };
      for (const p of photos) {
        if (p.payoutRole && PAYOUT_ROLES.includes(p.payoutRole as PayoutPhotoRole)) {
          next[p.payoutRole as PayoutPhotoRole] = p;
        }
      }
      setRoles(next);
      if (readiness) setReadinessHasReceipt(readiness.hasReceipt);
    })();
    return () => {
      cancelled = true;
    };
  }, [partyId]);

  // porchetta-58296: designate (persist) the chosen photo for the open slot.
  const handleRoleSelect = async (photo: Photo) => {
    if (!pickerRole) return;
    setDesignating(true);
    const updated = await designatePhotoRole(partyId, photo.id, pickerRole);
    setDesignating(false);
    if (updated) {
      setRoles(prev => ({ ...prev, [pickerRole]: updated }));
      setPickerRole(null);
    }
  };

  const roleLabels: Record<PayoutPhotoRole, string> = {
    group: t('payouts.roles.group'),
    box_stack: t('payouts.roles.boxStack'),
    pizza: t('payouts.roles.pizza'),
  };

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
  // bottarga-92106: TaxFormSection no longer lives inside this form — when the
  // backend returns TAX_FORM_REQUIRED we forward the requested form type to
  // the parent PayoutsTab via `onTaxFormRequired` so the section (rendered
  // between PaymentDetailsCard and the receipts list) auto-opens the right
  // editor. Then we scroll to `#tax-form-section`, which lives above this
  // form on the same tab. Phase 1 still doesn't auto-infer US vs foreign;
  // when the backend doesn't supply a type, the section stays on the picker.

  // mortadella-92103: exclude receipts whose currency couldn't be resolved
  // (the `$` ambiguity in non-USD countries) from the auto-sum. They keep
  // their preview row but aren't counted until the host picks a currency
  // via CurrencyOverrideSelect. The amber notice below tells the host what
  // to do. `r.ocr.amount` is USD-converted (see OcrPreviewResult).
  // stracciatella-92114: a single uploaded photo can contain MULTIPLE detected
  // receipts. Flatten across every detected receipt of every file so the sum +
  // unresolved-count cover each receipt independently. `receipt.amount` is
  // USD-converted (see OcrReceiptPreview).
  const ocrSum = useMemo(
    () => receipts
      .filter(r => r.status === 'done')
      .flatMap(r => r.receipts ?? [])
      .filter(rc => rc.ocrError !== 'CURRENCY_UNRESOLVED')
      .reduce((sum, rc) => sum + (rc.amount ?? 0), 0),
    [receipts]
  );
  // mortadella-92103: count of unresolved-currency receipts so we can show
  // a single amber notice rather than per-row warnings (the per-receipt
  // row already shows its low-confidence state via the dropdown).
  // stracciatella-92114: now counts per detected receipt across all photos.
  const unresolvedReceiptCount = useMemo(
    () => receipts
      .filter(r => r.status === 'done')
      .flatMap(r => r.receipts ?? [])
      .filter(rc => rc.ocrError === 'CURRENCY_UNRESOLVED')
      .length,
    [receipts]
  );
  const finalAmount = overrideAmount != null ? overrideAmount : ocrSum;

  const isProcessing = receipts.some(r => r.status === 'uploading' || r.status === 'ocring');

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

  // porchetta-58296: at least one receipt is present when either a receipt was
  // uploaded in this session OR the server already has one on file.
  const hasReceiptUpload =
    receipts.some(r => r.status === 'done' && !!r.url) || readinessHasReceipt;
  // porchetta-58296: all three event role photos must be designated.
  const allRolesDesignated = !!roles.group && !!roles.box_stack && !!roles.pizza;

  // pizzaiolo-92103: submission now requires a valid saved payment method
  // (gate also enforced backend-side as PAYMENT_METHOD_NOT_SET /
  // PAYMENT_METHOD_INCOMPLETE).
  // porchetta-58296: also require the 3 designated role photos + a receipt +
  // the receipts-itemized attestation (all mirrored server-side).
  const canSubmit = finalAmount > 0
    && attendanceValid
    && !isProcessing
    && !submitting
    && userMethodValid
    && hasReceiptUpload
    && receiptAttested
    && allRolesDesignated;

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
        // stracciatella-92114: emit ONE payload entry PER DETECTED RECEIPT. A
        // single photo with N receipts produces N entries sharing
        // url/fileName/fileSize/mimeType, each carrying its own OCR fields +
        // sourceReceiptIndex (0..N-1) and sourceReceiptCount. The backend
        // persists one payout_documents row per entry. Single-receipt photos
        // emit exactly one entry, identical to before.
        receiptPhotos: receipts
          .filter(r => r.status === 'done' && r.url && (r.receipts?.length ?? 0) > 0)
          .flatMap(r => {
            const detected = r.receipts ?? [];
            const count = detected.length;
            return detected.map((rc, k) => ({
              url: r.url!,
              fileName: r.fileName,
              fileSize: r.fileSize,
              mimeType: r.mimeType,
              // provolone-49301: forward the preview-OCR payload so the backend
              // skips a second gpt-4o pass. These already reflect any host
              // currency override (CurrencyOverrideSelect mutates the receipt in
              // place). USD amount/rate are intentionally NOT sent — the backend
              // re-locks FX via convertToUSD. Include the CURRENCY_UNRESOLVED
              // case too (originalAmount is still set) so the backend treats it
              // as forwarded and doesn't re-OCR.
              ocrOriginalAmount: rc.originalAmount,
              ocrOriginalCurrency: rc.originalCurrency,
              ocrConfidence: rc.confidence,
              ocrLineItems: rc.lineItems,
              ocrRaw: rc.ocrRaw,
              ocrError: rc.ocrError,
              // stracciatella-92114: which detected receipt this entry is, and
              // how many were detected in the shared photo (drives "k of n").
              sourceReceiptIndex: count > 1 ? k : undefined,
              sourceReceiptCount: count > 1 ? count : undefined,
            }));
          }),
        // porchetta-58296: pizza/event role photos are no longer uploaded as
        // payout docs — they're designated in the gallery. Only receipts are
        // forwarded from here now.
        // porchetta-58296: attest receipts are submitted + itemized. Backend
        // rejects without it (RECEIPT_ATTESTATION_REQUIRED).
        receiptAttested,
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
      // salame-92110 / bottarga-92106: when the backend says a tax form is
      // required, ask the parent PayoutsTab to auto-open the TaxFormSection
      // (now rendered above this form, between PaymentDetailsCard and the
      // receipts list) and scroll to it. The section's `id="tax-form-section"`
      // is reachable cross-component since both live in the same tab.
      if (err?.code === 'TAX_FORM_REQUIRED') {
        const requiredType: TaxFormType | null = err?.requiredFormType ?? null;
        onTaxFormRequired?.(requiredType);
        setSubmitError(
          'A tax form is required before this payment can be submitted. Please complete the tax form above.',
        );
        // Scroll to the section the next tick after state has propagated.
        setTimeout(() => {
          document.getElementById('tax-form-section')?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }, 0);
      } else {
        setSubmitError(err?.message || 'Failed to submit receipt');
      }
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
        {/* porchetta-58296: receipts-itemized attestation. Disabled until at
            least one receipt is present (uploaded this session or on file). */}
        <div className="mt-4">
          <Checkbox
            checked={receiptAttested}
            onChange={() => setReceiptAttested(v => !v)}
            disabled={!hasReceiptUpload}
            label={t('payouts.receiptAttestation')}
          />
          {!hasReceiptUpload && (
            <p className="text-xs text-theme-text-muted mt-1">
              {t('payouts.receiptAttestationHelp')}
            </p>
          )}
        </div>
      </div>

      {/* 2. Event photos — porchetta-58296: three host-designated role photos.
          Each slot is selected from the gallery (host- or guest-uploaded) or
          uploaded new. All three are required to submit. */}
      <div className="card p-6">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-theme-text">{t('payouts.eventPhotosTitle')}</h3>
          <p className="text-xs text-theme-text-muted mt-0.5">
            {t('payouts.eventPhotosSubtitle')}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PAYOUT_ROLES.map(role => {
            const photo = roles[role];
            const isVideo = photo?.mimeType?.startsWith('video/');
            return (
              <button
                key={role}
                type="button"
                onClick={() => setPickerRole(role)}
                className="relative aspect-square rounded-xl overflow-hidden bg-theme-surface border border-theme-stroke hover:border-[#ff393a]/50 transition-colors text-left"
              >
                {photo ? (
                  <>
                    {isVideo ? (
                      <video src={photo.url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                    ) : (
                      <img
                        src={photo.thumbnailUrl || photo.url}
                        alt={roleLabels[role]}
                        className="w-full h-full object-cover"
                      />
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <span className="text-xs font-medium text-white">{roleLabels[role]}</span>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3 text-center">
                    <ImagePlus size={24} className="text-theme-text-muted" />
                    <span className="text-xs font-medium text-theme-text">{roleLabels[role]}</span>
                    <span className="text-[11px] text-theme-text-muted">{t('payouts.selectOrUpload')}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Optional additional photos — gallery upload, no role. */}
        <div className="mt-4">
          {showAdditionalUpload ? (
            <PhotoUpload
              partyId={partyId}
              isHost
              uploaderName={user?.name ?? undefined}
              uploaderEmail={user?.email ?? undefined}
              onClose={() => setShowAdditionalUpload(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowAdditionalUpload(true)}
              className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text transition-colors"
            >
              <Camera size={16} />
              {t('payouts.additionalPhotos')}
            </button>
          )}
        </div>
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

      {/* 4b. Tax form (salame-92110 / culatello-92106) moved to PayoutsTab
          (bottarga-92106) so hosts can pre-fill the form without opening a
          payout. TAX_FORM_REQUIRED errors here still scroll to it via the
          shared #tax-form-section anchor in the same tab. */}

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
        <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-50">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="text-amber-600 mt-0.5 flex-shrink-0" size={16} />
            <div className="flex-1 text-sm text-amber-800">
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
        <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-50">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="text-amber-600 mt-0.5 flex-shrink-0" size={16} />
            <div className="flex-1 text-sm text-amber-800">
              Heads up: receipts total ${finalAmount.toFixed(2)}, but your reimbursement cap is ${effectiveCapUsd!.toFixed(2)}. We'll reimburse the cap; the receipts stay attached as evidence. Admin can approve more in special cases.
            </div>
          </div>
        </div>
      )}

      {/* speck-89172: $675 hard-ceiling amber warning. USDC execute caps at
          $675 per tx, so admin may need to split this into multiple sends. */}
      {exceedsHardCeiling && (
        <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-50">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="text-amber-600 mt-0.5 flex-shrink-0" size={16} />
            <div className="flex-1 text-sm text-amber-800">
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
        <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-50">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="text-amber-600 mt-0.5 flex-shrink-0" size={16} />
            <div className="flex-1 text-sm text-amber-800">
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

      {/* porchetta-58296: role photo picker modal (select existing or upload). */}
      {pickerRole && (
        <RolePhotoPicker
          partyId={partyId}
          role={pickerRole}
          roleLabel={roleLabels[pickerRole]}
          eventStart={party?.date ?? null}
          selectedPhotoId={roles[pickerRole]?.id ?? null}
          onSelect={designating ? () => {} : handleRoleSelect}
          onClose={() => setPickerRole(null)}
        />
      )}

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
