import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  Info,
  BadgeDollarSign,
  CheckCircle2,
  Circle,
  Clock,
  Users,
} from 'lucide-react';
import { TaxFormType } from '../../types';
import {
  fetchMyReimbursement,
  addReimbursementReceipts,
  removeReimbursementReceipt,
  submitReimbursement,
  unsubmitReimbursement,
  fetchEventReimbursements,
  CreatePayoutPhotoInput,
  MyReimbursementResponse,
  EventReimbursementCohost,
} from '../../lib/api';
import { usePizza } from '../../contexts/PizzaContext';
import { parsePartyKitCapFromTags } from '../../lib/reimbursementCap';
import { getUnderbossContact } from '../../utils/underbossContacts';
import { Checkbox } from '../Checkbox';
import { ExpectedGuestsCard } from './ExpectedGuestsCard';
import { EventPhotosCard } from './EventPhotosCard';
import { PrepayCheckbox } from './PrepayCheckbox';
import { PaymentDetailsCard } from './PaymentDetailsCard';
import { AppealCapModal } from './AppealCapModal';
import { ReceiptsLibrary } from './ReceiptsLibrary';
import { TaxFormSection } from './TaxFormSection';
import { ReceiptUpload, ReceiptItem } from './ReceiptUpload';
import { PayoutStatusPill } from '../payments-shared/PayoutStatusPill';

interface PayoutsTabProps {
  partyId: string;
  /**
   * Raw underboss-validated cap (DB column). Used for the appeal flow only —
   * host-visible cap display should use `effectiveReimbursementCapUsd`.
   */
  reimbursementCapUsd?: number | null;
  /**
   * arugula-38633 v2 follow-up: effective cap after numeric-tag fallback.
   * Precedence: reimbursementCapUsd → max(numeric event_tags) → null.
   * Host-visible UI (banner, stat header, null-cap notice) reads THIS.
   */
  effectiveReimbursementCapUsd?: number | null;
  reimbursementCapAppealNote?: string | null;
  reimbursementCapAppealedAt?: string | null;
  /** Threaded to ExpectedGuestsCard. */
  expectedGuests?: number | null;
}

/**
 * ziti-58300 Phase 3: the host Payments tab is now ONE rolling
 * "Your reimbursement" page for the signed-in co-host. There is no list / new
 * view switch and no discrete "create payout" flow — the co-host adds receipts
 * to their event anytime (auto-saved), sets payment details whenever, and flips
 * a single "Submit for review" toggle when everything is ready.
 *
 * Gating model (Snax): gate ONLY the final action. Every section is editable in
 * any order. The "Submit for review" button is disabled until the server says
 * `readiness.readyToSubmit` AND the attestation checkbox is ticked. Payment
 * details is now UN-gated (reverses calzone-58297's lock).
 *
 * marzano-49102: Payments is open to all signed-in party hosts/cohosts.
 * The cap dollar value is gated by the 'go' event_tag at the HostPage source
 * (props arrive as null when 'go' isn't set), so downstream consumers
 * naturally hide the number.
 */
export const PayoutsTab: React.FC<PayoutsTabProps> = ({
  partyId,
  // `reimbursementCapUsd` (raw) is no longer read directly — the appeal modal
  // uses `effectiveReimbursementCapUsd` for the displayed cap and the appeal
  // note/timestamp for the re-appeal hint. Kept on the interface for HostPage.
  effectiveReimbursementCapUsd,
  reimbursementCapAppealNote,
  reimbursementCapAppealedAt,
  expectedGuests,
}) => {
  const { t } = useTranslation('host');
  const { party } = usePizza();
  const partyKitCapUsd = parsePartyKitCapFromTags(party?.eventTags);

  const [data, setData] = useState<MyReimbursementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // mascarpone-58927: inline appeal trigger in the green reimburse banner.
  const [showAppealModal, setShowAppealModal] = useState(false);

  // TaxFormSection auto-open (kept for parity — a future TAX_FORM_REQUIRED
  // error path can forward the requested type here).
  const [taxFormAutoOpen] = useState<TaxFormType | null>(null);

  // Live receipt upload buffer (folded in from NewPayoutForm). Once a row
  // finishes OCR it is appended to the rolling record via
  // addReimbursementReceipts, then cleared from this buffer.
  const [uploadItems, setUploadItems] = useState<ReceiptItem[]>([]);
  const [uploadTempId] = useState(
    () => `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const [addingReceipts, setAddingReceipts] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [capWarning, setCapWarning] = useState<string | null>(null);

  // porchetta-58296: receipts-itemized attestation (re-used key).
  const [attested, setAttested] = useState(false);

  // Submit / reopen action state.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [removingDocId, setRemovingDocId] = useState<string | null>(null);

  // Event-level roll-up (read-only).
  const [eventCohosts, setEventCohosts] = useState<EventReimbursementCohost[] | null>(null);

  const loadMine = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMyReimbursement(partyId);
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load your reimbursement');
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  const loadEvent = useCallback(async () => {
    try {
      const res = await fetchEventReimbursements(partyId);
      setEventCohosts(res.cohosts);
    } catch {
      /* soft-fail — the roll-up is a secondary read-only view */
    }
  }, [partyId]);

  useEffect(() => {
    loadMine();
    loadEvent();
  }, [loadMine, loadEvent]);

  const readiness = data; // MyReimbursementResponse extends ReimbursementReadiness
  const submittedAt = data?.submittedForReviewAt ?? null;
  const receipts = data?.receipts ?? [];
  const eligibleTotalUsd = data?.eligibleTotalUsd
    ?? Number(data?.reimbursement?.finalAmountUsd ?? 0);

  // calzone-58297 (relabel): after the event date passes, "expected" → "estimated".
  const eventHasHappened = party?.date ? new Date(party.date) < new Date() : false;

  // --- Receipts: append finished uploads to the rolling record ---------------

  // Convert a finished ReceiptItem into the per-detected-receipt payload shape
  // (same as NewPayoutForm's submit forwarding).
  const buildDocsFromItem = useCallback((item: ReceiptItem): CreatePayoutPhotoInput[] => {
    const detected = item.receipts ?? [];
    const count = detected.length;
    return detected.map((rc, k) => ({
      url: item.url!,
      fileName: item.fileName,
      fileSize: item.fileSize,
      mimeType: item.mimeType,
      ocrOriginalAmount: rc.originalAmount,
      ocrOriginalCurrency: rc.originalCurrency,
      ocrConfidence: rc.confidence,
      ocrLineItems: rc.lineItems,
      ocrRaw: rc.ocrRaw,
      ocrError: rc.ocrError,
      sourceReceiptIndex: count > 1 ? k : undefined,
      sourceReceiptCount: count > 1 ? count : undefined,
    }));
  }, []);

  // Auto-save: when an upload row finishes OCR (status 'done' with a url and at
  // least one detected receipt), append it to the rolling record and remove it
  // from the live buffer. Rows still uploading/ocring stay in the buffer; error
  // rows stay so the host can see + remove them.
  useEffect(() => {
    const ready = uploadItems.filter(
      (r) => r.status === 'done' && !!r.url && (r.receipts?.length ?? 0) > 0
    );
    if (ready.length === 0 || addingReceipts) return;

    let cancelled = false;
    (async () => {
      setAddingReceipts(true);
      setReceiptError(null);
      try {
        const docs = ready.flatMap(buildDocsFromItem);
        const res = await addReimbursementReceipts(partyId, docs);
        if (cancelled) return;
        setCapWarning(res.capWarning ?? null);
        // Remove the appended rows from the live buffer.
        const appendedIds = new Set(ready.map((r) => r.id));
        setUploadItems((prev) => prev.filter((r) => !appendedIds.has(r.id)));
        // Refresh the rolling record + event roll-up from the server.
        setData((prev) =>
          prev
            ? {
                ...prev,
                reimbursement: res.reimbursement,
                receipts: res.receipts,
                eligibleTotalUsd: res.eligibleTotalUsd,
                hasReceipt: res.receipts.length > 0,
              }
            : prev
        );
        loadMine();
        loadEvent();
      } catch (err: any) {
        if (cancelled) return;
        setReceiptError(err?.message || 'Failed to add receipt');
      } finally {
        if (!cancelled) setAddingReceipts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadItems, addingReceipts, partyId, buildDocsFromItem]);

  const handleRemoveReceipt = async (docId: string) => {
    setRemovingDocId(docId);
    setReceiptError(null);
    try {
      const res = await removeReimbursementReceipt(partyId, docId);
      setData((prev) =>
        prev
          ? {
              ...prev,
              reimbursement: res.reimbursement,
              receipts: res.receipts,
              eligibleTotalUsd: res.eligibleTotalUsd,
              hasReceipt: res.receipts.length > 0,
            }
          : prev
      );
      loadMine();
      loadEvent();
    } catch (err: any) {
      setReceiptError(err?.message || 'Failed to remove receipt');
    } finally {
      setRemovingDocId(null);
    }
  };

  // --- Submit / reopen -------------------------------------------------------

  const readyToSubmit = readiness?.readyToSubmit === true;
  const canSubmit = readyToSubmit && attested && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await submitReimbursement(partyId, true);
      setData((prev) =>
        prev
          ? {
              ...prev,
              reimbursement: res.reimbursement,
              submittedForReviewAt: res.reimbursement.submittedForReviewAt ?? null,
            }
          : prev
      );
      loadMine();
      loadEvent();
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to submit for review');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopen = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await unsubmitReimbursement(partyId);
      setData((prev) =>
        prev
          ? {
              ...prev,
              reimbursement: res.reimbursement,
              submittedForReviewAt: res.reimbursement.submittedForReviewAt ?? null,
            }
          : prev
      );
      loadMine();
      loadEvent();
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to reopen');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  };

  // Missing-requirement labels derived from server readiness.
  const missing = useMemo<string[]>(() => {
    if (!readiness) return [];
    const list: string[] = [];
    if (!readiness.attendanceSet) list.push(t('payouts.missingAttendance'));
    if (!readiness.hasGroupPhoto) list.push(t('payouts.missingGroupPhoto'));
    if (!readiness.hasBoxStackPhoto) list.push(t('payouts.missingBoxStackPhoto'));
    if (!readiness.hasPizzaPhoto) list.push(t('payouts.missingPizzaPhoto'));
    if (!readiness.hasReceipt) list.push(t('payouts.missingReceipt'));
    if (!readiness.paymentMethodValid) list.push(t('payouts.missingPaymentMethod'));
    return list;
  }, [readiness, t]);

  if (loading) {
    return (
      <div className="card p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <AlertCircle className="w-12 h-12 text-[#ff393a] mx-auto mb-4" />
        <p className="text-theme-text-secondary mb-4">{error}</p>
        <button
          onClick={loadMine}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <RefreshCw size={16} />
          {t('payouts.tryAgain')}
        </button>
      </div>
    );
  }

  const photosAllDesignated =
    !!readiness?.hasGroupPhoto && !!readiness?.hasBoxStackPhoto && !!readiness?.hasPizzaPhoto;

  return (
    <div className="space-y-4">
      {/* ===== Cap / funding banner (unchanged precedence) ===== */}
      {(() => {
        const needsExpectedGuests = !party?.expectedGuests || party.expectedGuests <= 0;
        const needsLocation = !party?.address;
        const hasCap = typeof effectiveReimbursementCapUsd === 'number' && effectiveReimbursementCapUsd > 0;

        if (needsExpectedGuests || needsLocation) {
          const guestsLabel = t(eventHasHappened ? 'payouts.bannerEstimatedGuests' : 'payouts.bannerExpectedGuests');
          const msg =
            needsExpectedGuests && needsLocation
              ? t('payouts.bannerSetGuestsAndLocation', { guests: guestsLabel })
              : needsExpectedGuests
                ? t('payouts.bannerSetGuests', { guests: guestsLabel })
                : t('payouts.bannerSetLocation');
          return (
            <div className="card p-4 sm:p-5 border-l-4 border-l-amber-500 flex items-start gap-3">
              <Info size={20} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm font-medium text-theme-text">{msg}</div>
            </div>
          );
        }
        if (hasCap) {
          return (
            <div className="card p-4 sm:p-5 border-l-4 border-l-emerald-500 flex items-start gap-3">
              <BadgeDollarSign size={20} className="text-emerald-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm font-medium text-theme-text">
                {partyKitCapUsd != null
                  ? t('payouts.capReimburseWithKit', {
                      cap: effectiveReimbursementCapUsd!.toFixed(2),
                      kitCap: partyKitCapUsd.toFixed(2),
                    })
                  : t('payouts.capReimburse', { cap: effectiveReimbursementCapUsd!.toFixed(2) })}
                <button
                  type="button"
                  onClick={() => setShowAppealModal(true)}
                  className="text-emerald-300 hover:underline ml-2 text-sm"
                >
                  {t('payouts.appeal')}
                </button>
              </div>
            </div>
          );
        }
        return (
          <div className="card p-4 sm:p-5 border-l-4 border-l-amber-500 flex items-start gap-3">
            <Info size={20} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm font-medium text-theme-text">
              {t('payouts.underbossReviewing')}
              {(() => {
                const contact = getUnderbossContact(party?.country);
                if (!contact) return null;
                return (
                  <>
                    {' '}{t('payouts.reachOnTelegram')}{' '}
                    <a
                      href={contact.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#ff393a] hover:underline"
                    >
                      {contact.handle}
                    </a>
                    .
                  </>
                );
              })()}
            </div>
          </div>
        );
      })()}

      {/* ===== 1. Status banner ===== */}
      {submittedAt ? (
        <div className="card p-4 sm:p-5 border-l-4 border-l-emerald-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="text-emerald-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm font-medium text-theme-text">
              {t('payouts.statusSubmitted', { date: formatDate(submittedAt) })}
            </div>
          </div>
          <button
            type="button"
            onClick={handleReopen}
            disabled={submitting}
            className="btn-secondary inline-flex items-center justify-center gap-2 text-sm whitespace-nowrap disabled:opacity-50"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {t('payouts.reopenToEdit')}
          </button>
        </div>
      ) : readyToSubmit ? (
        <div className="card p-4 sm:p-5 border-l-4 border-l-emerald-500 flex items-start gap-3">
          <CheckCircle2 size={20} className="text-emerald-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm font-medium text-theme-text">{t('payouts.statusReady')}</div>
        </div>
      ) : (
        <div className="card p-4 sm:p-5 border-l-4 border-l-amber-500">
          <div className="flex items-start gap-3">
            <Clock size={20} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm font-medium text-theme-text">
              {t('payouts.statusMissingHeader')}
            </div>
          </div>
          {missing.length > 0 && (
            <ul className="mt-2 ml-8 space-y-1">
              {missing.map((m, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-theme-text-secondary">
                  <Circle size={8} className="text-amber-500 flex-shrink-0" />
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <PrepayCheckbox partyId={partyId} />

      {/* ===== 2. Estimated attendance (hard requirement) ===== */}
      <div className="relative">
        <ExpectedGuestsCard partyId={partyId} expectedGuests={expectedGuests} />
        {readiness?.attendanceSet && (
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 text-xs text-emerald-500">
            <CheckCircle2 size={14} /> {t('payouts.done')}
          </span>
        )}
      </div>

      {/* ===== 3. Event photos (event-level / shared) ===== */}
      <div>
        {photosAllDesignated && (
          <div className="card p-3 mb-2 border-l-4 border-l-emerald-500 flex items-center gap-2 text-sm text-theme-text">
            <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />
            {t('payouts.eventPhotosDone')}
          </div>
        )}
        <EventPhotosCard partyId={partyId} onRolesChange={() => loadMine()} />
      </div>

      {/* ===== 4. Receipts (rolling, auto-saved) ===== */}
      <div className="card p-6">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-theme-text">{t('payouts.receiptsHeader')}</h3>
          <p className="text-xs text-theme-text-muted mt-0.5">{t('payouts.receiptsRollingHelp')}</p>
        </div>

        <ReceiptUpload
          partyId={partyId}
          payoutTempId={uploadTempId}
          items={uploadItems}
          onChange={setUploadItems}
        />

        {addingReceipts && (
          <p className="text-xs text-theme-text-muted mt-2 inline-flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> {t('payouts.savingReceipt')}
          </p>
        )}
        {receiptError && (
          <p className="text-xs text-[#ff393a] mt-2">{receiptError}</p>
        )}
        {capWarning && (
          <div className="mt-3 card p-3 border-l-4 border-l-amber-500 bg-amber-50 text-sm text-amber-800">
            {capWarning}
          </div>
        )}

        {/* Current receipts on the rolling record — removable. */}
        {receipts.length > 0 && (
          <ul className="mt-4 divide-y divide-theme-stroke">
            {receipts.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 py-3">
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 w-12 h-12 rounded border border-theme-stroke overflow-hidden bg-theme-surface flex items-center justify-center"
                  title={doc.fileName}
                >
                  {(doc.mimeType || '').startsWith('image/') ? (
                    <img src={doc.url} alt={doc.fileName} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <BadgeDollarSign size={18} className="text-theme-text-muted" />
                  )}
                </a>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-theme-text truncate">{doc.fileName}</span>
                    {doc.isDuplicate && (
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-red-500 text-[#ffffff]">
                        {t('payouts.duplicatePill')}
                      </span>
                    )}
                    {doc.ineligible && !doc.isDuplicate && (
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500 text-[#ffffff]">
                        {t('payouts.ineligiblePill')}
                      </span>
                    )}
                  </div>
                  {doc.ocrAmount != null && doc.ocrCurrency && (
                    <div className="text-xs text-white/40 mt-0.5">
                      {doc.ocrAmount.toFixed(2)} {doc.ocrCurrency}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveReceipt(doc.id)}
                  disabled={removingDocId === doc.id || !!submittedAt}
                  className="text-sm text-theme-text-muted hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1 flex-shrink-0"
                  title={submittedAt ? t('payouts.reopenToEdit') : t('payouts.remove')}
                >
                  {removingDocId === doc.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    t('payouts.remove')
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Running total. */}
        <div className="mt-4 pt-4 border-t border-theme-stroke flex items-center justify-between">
          <span className="text-sm text-theme-text-muted">{t('payouts.runningTotal')}</span>
          <span className="text-xl font-bold text-theme-text">
            ${eligibleTotalUsd.toFixed(2)} <span className="text-sm font-normal text-theme-text-muted">USD</span>
          </span>
        </div>

        {/* Set host expectations on payout timing. */}
        <div className="flex items-start gap-2 text-xs text-theme-text-muted mt-3">
          <Info size={14} className="mt-0.5 flex-shrink-0" />
          <span>{t('payouts.payoutTimingNote')}</span>
        </div>
      </div>

      {/* ===== 5. Attestation ===== */}
      <div className="card p-6">
        <Checkbox
          checked={attested}
          onChange={() => setAttested((v) => !v)}
          disabled={!readiness?.hasReceipt}
          label={t('payouts.receiptAttestation')}
        />
        {!readiness?.hasReceipt && (
          <p className="text-xs text-theme-text-muted mt-1">{t('payouts.receiptAttestationHelp')}</p>
        )}
      </div>

      {/* ===== Tax form (per-event admin flag) ===== */}
      {party?.taxFormRequired === true && (
        <TaxFormSection autoOpenFormType={taxFormAutoOpen} />
      )}

      {/* ===== 6. Payment details (UN-GATED) ===== */}
      <PaymentDetailsCard />

      {/* ===== 7. Submit for review ===== */}
      <div className="card p-6">
        {submitError && (
          <div className="mb-3 card p-3 border-red-500/40 bg-red-500/10 text-sm text-red-300">
            {submitError}
          </div>
        )}
        {submittedAt ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-emerald-500">
              <CheckCircle2 size={18} />
              {t('payouts.statusSubmitted', { date: formatDate(submittedAt) })}
            </div>
            <button
              type="button"
              onClick={handleReopen}
              disabled={submitting}
              className="btn-secondary inline-flex items-center justify-center gap-2 text-sm disabled:opacity-50"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {t('payouts.reopenToEdit')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {t('payouts.submitForReview')}
            </button>
            {!readyToSubmit && (
              <p className="text-xs text-theme-text-muted">{t('payouts.submitDisabledHelp')}</p>
            )}
            {readyToSubmit && !attested && (
              <p className="text-xs text-theme-text-muted">{t('payouts.submitNeedsAttestation')}</p>
            )}
          </div>
        )}
      </div>

      {/* ===== Receipts library (party-scoped, read-only) ===== */}
      <ReceiptsLibrary partyId={partyId} />

      {/* ===== 8. Event-level receipts roll-up (read-only) ===== */}
      {eventCohosts && eventCohosts.length > 0 && (
        <div className="card p-6">
          <div className="mb-3">
            <h3 className="text-base font-semibold text-theme-text">{t('payouts.eventRollupTitle')}</h3>
            <p className="text-xs text-theme-text-muted mt-0.5">{t('payouts.eventRollupSubtitle')}</p>
          </div>
          <ul className="divide-y divide-theme-stroke">
            {eventCohosts.map((c, i) => {
              const who = c.uploadedByName || c.uploadedByEmail || t('payouts.unknownCohost');
              return (
                <li key={c.uploadedByUserId ?? `${who}-${i}`} className="flex items-center gap-3 py-3">
                  <div className="w-9 h-9 rounded-full bg-theme-surface-hover flex items-center justify-center flex-shrink-0">
                    <Users size={16} className="text-theme-text-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-theme-text truncate">{who}</span>
                      {c.recordStatus && <PayoutStatusPill status={c.recordStatus} />}
                      {c.submittedForReviewAt && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                          <CheckCircle2 size={12} />
                          {t('payouts.rollupSubmitted', { date: formatDate(c.submittedForReviewAt) })}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-white/40 mt-0.5">
                      {t('payouts.rollupReceiptCount', { count: c.receiptCount })}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-theme-text flex-shrink-0">
                    ${c.eligibleTotalUsd.toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ===== Cap appeal modal ===== */}
      {showAppealModal && partyId && (
        <AppealCapModal
          partyId={partyId}
          capUsd={effectiveReimbursementCapUsd ?? 0}
          previousAppealedAt={party?.reimbursementCapAppealedAt ?? reimbursementCapAppealedAt ?? null}
          previousNote={party?.reimbursementCapAppealNote ?? reimbursementCapAppealNote ?? null}
          onClose={() => setShowAppealModal(false)}
          onSubmitted={() => {
            setShowAppealModal(false);
          }}
        />
      )}
    </div>
  );
};
