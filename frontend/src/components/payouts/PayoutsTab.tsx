import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  fetchPayoutRecipients,
  CreatePayoutPhotoInput,
  MyReimbursementResponse,
  EventReimbursementCohost,
  PayoutRecipientCandidate,
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
import { RecipientPickerModal } from './RecipientPickerModal';

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

// tiramisu-58530: hosts must upload at least this many ADDITIONAL event photos
// (gallery photos beyond the 3 designated role photos) before submitting.
const REQUIRED_ADDITIONAL_PHOTOS = 5;

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

  // grissini-58511: silent receipt-save failures. The automatic auto-save pass
  // must NOT keep re-POSTing failed items on its own (render loop), so we track
  // the ids of items whose save attempt failed and exclude them from the
  // AUTOMATIC `ready` set. The explicit Retry button bumps `retryNonce`, which
  // bypasses the failed-flag for one pass.
  const [failedSaveIds, setFailedSaveIds] = useState<Set<string>>(new Set());
  const [retryNonce, setRetryNonce] = useState(0);

  // caciocavallo-58535: when an aggregator (admin / scoped underboss) uploads on
  // behalf of a local host, the backend rejects the upload with RECIPIENT_REQUIRED
  // until a recipient is explicitly chosen. We capture the candidate list + the
  // docs that need re-sending, then resubmit with `recipientHostUserId` once the
  // host picks. Ordinary hosts never trigger this path (they're reimbursed as
  // themselves) so they see no picker.
  const [recipientPicker, setRecipientPicker] = useState<{
    candidates: PayoutRecipientCandidate[];
    docs: CreatePayoutPhotoInput[];
    attemptedIds: string[];
  } | null>(null);
  const [recipientSubmitting, setRecipientSubmitting] = useState(false);
  // caciocavallo-58535: prefetched candidate hosts. Non-null ⇒ the current user
  // is an aggregator (admin / scoped underboss) for this party — the endpoint
  // 403s for ordinary hosts, so we leave this null for them and they never see
  // the picker. We use it to proactively open the picker before the upload POST
  // (rather than waiting for the RECIPIENT_REQUIRED round-trip).
  const aggregatorCandidatesRef = useRef<PayoutRecipientCandidate[] | null>(null);

  // sfogliatella-58523: ref-based in-flight guard for the auto-save effect. The
  // previous `addingReceipts`-state + `cancelled`-cleanup guard leaked: during a
  // multi-file upload every finished file mutated `uploadItems`, the effect
  // cleanup flipped `cancelled = true` on the in-flight save, the POST still
  // persisted server-side, but the continuation bailed BEFORE removing the saved
  // rows / refetching AND left `addingReceipts === true` forever → permanent
  // deadlock until reload. `savingRef` is the re-entrancy guard now and ALWAYS
  // releases in `finally`; `addingReceipts` state only drives the "Saving…" UI.
  // `inFlightIdsRef` excludes ids already mid-POST from the next `ready` filter
  // so a re-run mid-save can't double-write payout_documents (no backend dedup).
  const savingRef = useRef(false);
  const inFlightIdsRef = useRef<Set<string>>(new Set());

  // porchetta-58296: receipts-itemized attestation (re-used key).
  const [attested, setAttested] = useState(false);

  // Submit / reopen action state.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [removingDocId, setRemovingDocId] = useState<string | null>(null);

  // Event-level roll-up (read-only).
  const [eventCohosts, setEventCohosts] = useState<EventReimbursementCohost[] | null>(null);

  // ziti-58300 hotfix: `silent` skips the page-level `loading` toggle. The full
  // `loading` spinner unmounts the page body (see the early return below), which
  // unmounts EventPhotosCard — and its mount effect calls `onRolesChange`. If a
  // refresh flips `loading`, EventPhotosCard remounts → onRolesChange → refresh
  // → loading → remount … an infinite reimbursement/me + photos loop (429).
  // Background refreshes (role change) must be silent so the body stays mounted.
  const loadMine = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetchMyReimbursement(partyId);
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load your reimbursement');
    } finally {
      if (!silent) setLoading(false);
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

  // ziti-58300 hotfix: STABLE callback for EventPhotosCard.onRolesChange.
  // Previously an inline `() => loadMine()` was passed — a new reference every
  // render. EventPhotosCard's effect deps include onRolesChange, so it re-fired
  // every render → loadMine → setState → re-render → … request storm. Stable +
  // silent breaks both the unstable-dep loop and the loading-remount loop.
  const handleRolesChange = useCallback(() => {
    loadMine(true);
    loadEvent();
  }, [loadMine, loadEvent]);

  useEffect(() => {
    loadMine();
    loadEvent();
  }, [loadMine, loadEvent]);

  // caciocavallo-58535: detect aggregator status once. The endpoint 403s for
  // ordinary hosts (ref stays null → no picker), and returns the candidate hosts
  // for admins / scoped underbosses. The primary host (even if they happen to be
  // a scoped underboss for their own city) is excluded by the backend's
  // `party.userId !== req.userId` rule, so an aggregator who IS the primary host
  // is never asked to pick — handled server-side; here we only need the list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const candidates = await fetchPayoutRecipients(partyId);
        if (!cancelled) aggregatorCandidatesRef.current = candidates;
      } catch {
        // 403 (ordinary host) or any error → no proactive picker; the
        // RECIPIENT_REQUIRED fallback still covers the aggregator case.
        if (!cancelled) aggregatorCandidatesRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partyId]);

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
  // grissini-58511: an item is "ready to persist" when OCR finished, it has a
  // url + at least one detected receipt, AND its head receipt is not still in
  // the OCR_FAILED dead-state (the host hasn't entered a manual amount yet —
  // entering one clears `ocrError` to null). Without this guard the synthetic
  // OCR_FAILED $0 receipt gets auto-persisted before the host can fix it.
  const isReadyItem = useCallback((r: ReceiptItem): boolean => {
    if (r.status !== 'done' || !r.url || (r.receipts?.length ?? 0) === 0) return false;
    const head = r.receipts?.[0];
    if (head && head.ocrError === 'OCR_FAILED') return false; // grissini-58511
    return true;
  }, []);

  useEffect(() => {
    // sfogliatella-58523: re-entrancy guard is `savingRef` (NOT `addingReceipts`
    // state) so it can never get stuck true. Automatic pass: exclude items whose
    // previous save attempt failed (so we don't loop — Retry bumps `retryNonce`
    // to bypass the flag) and items already mid-POST (`inFlightIdsRef`).
    if (savingRef.current) return;
    // caciocavallo-58535: don't auto-fire a new POST while the recipient picker
    // is open — wait for the host to choose (confirmRecipient does the save).
    if (recipientPicker) return;
    const ready = uploadItems.filter(
      (r) => isReadyItem(r) && !failedSaveIds.has(r.id) && !inFlightIdsRef.current.has(r.id)
    );
    if (ready.length === 0) return;

    const attemptedIds = ready.map((r) => r.id);
    const docs = ready.flatMap(buildDocsFromItem);

    // caciocavallo-58535: if we already know the user is an aggregator (the
    // payout-recipients prefetch resolved), open the picker BEFORE the upload
    // instead of taking the RECIPIENT_REQUIRED round-trip. Flag the items so the
    // auto-save loop pauses on them until the host picks a recipient.
    if (aggregatorCandidatesRef.current) {
      setFailedSaveIds((prev) => {
        const next = new Set(prev);
        attemptedIds.forEach((id) => next.add(id));
        return next;
      });
      setRecipientPicker({
        candidates: aggregatorCandidatesRef.current,
        docs,
        attemptedIds,
      });
      return;
    }

    savingRef.current = true;
    attemptedIds.forEach((id) => inFlightIdsRef.current.add(id));
    setAddingReceipts(true);
    setReceiptError(null);

    (async () => {
      try {
        const res = await addReimbursementReceipts(partyId, docs);
        // The POST persisted server-side, so ALWAYS reconcile (no cancellation
        // bail-out) — that bail-out is what lost the UI before.
        setCapWarning(res.capWarning ?? null);
        // Remove the appended rows from the live buffer.
        const appended = new Set(attemptedIds);
        setUploadItems((prev) => prev.filter((r) => !appended.has(r.id)));
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
        // ziti-58300: silent refresh — the loud `loading` spinner remounts the
        // body (and EventPhotosCard), tripping the onRolesChange refetch loop.
        loadMine(true);
        loadEvent();
      } catch (err: any) {
        // caciocavallo-58535: an aggregator (admin / scoped underboss) must pick
        // which host the reimbursement is for. The backend returns a candidate
        // list in `err.data.candidates`; open the picker (don't surface a raw
        // error) and stash the docs so we can resubmit with the chosen recipient.
        if (err?.code === 'RECIPIENT_REQUIRED') {
          const candidates = (err?.data?.candidates as PayoutRecipientCandidate[]) ?? [];
          // Flag the attempted items so the automatic pass stops retrying them
          // while the picker is open; the resubmit clears them on success.
          setFailedSaveIds((prev) => {
            const next = new Set(prev);
            attemptedIds.forEach((id) => next.add(id));
            return next;
          });
          setRecipientPicker({ candidates, docs, attemptedIds });
        } else {
          // grissini-58511: keep the failed items in the buffer (don't drop them)
          // and flag them so the automatic pass stops retrying. The Retry button
          // clears these flags for one pass.
          setReceiptError(err?.message || 'Failed to add receipt');
          setFailedSaveIds((prev) => {
            const next = new Set(prev);
            attemptedIds.forEach((id) => next.add(id));
            return next;
          });
        }
      } finally {
        attemptedIds.forEach((id) => inFlightIdsRef.current.delete(id));
        savingRef.current = false;
        setAddingReceipts(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadItems, partyId, buildDocsFromItem, isReadyItem, failedSaveIds, retryNonce, loadMine, loadEvent, recipientPicker]);

  // grissini-58511: explicit Retry — clear the failed flags so the auto-save
  // effect re-attempts the now-unblocked items on its next run, and bump the
  // nonce to guarantee the effect re-fires even if `failedSaveIds` was already
  // empty (e.g. a transient render).
  const retrySave = useCallback(() => {
    setReceiptError(null);
    setFailedSaveIds(new Set());
    setRetryNonce((n) => n + 1);
  }, []);

  // caciocavallo-58535: resubmit the stashed receipt docs with the host the
  // aggregator picked. On success, reconcile exactly like the happy-path
  // auto-save (clear the buffer rows, refresh the rolling record + roll-up).
  const confirmRecipient = useCallback(
    async (recipientUserId: string) => {
      if (!recipientPicker) return;
      const { docs, attemptedIds } = recipientPicker;
      setRecipientSubmitting(true);
      setReceiptError(null);
      try {
        const res = await addReimbursementReceipts(partyId, docs, recipientUserId);
        setCapWarning(res.capWarning ?? null);
        const appended = new Set(attemptedIds);
        setUploadItems((prev) => prev.filter((r) => !appended.has(r.id)));
        // Clear the failed flags for these items now that they've been saved.
        setFailedSaveIds((prev) => {
          const next = new Set(prev);
          attemptedIds.forEach((id) => next.delete(id));
          return next;
        });
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
        loadMine(true);
        loadEvent();
        setRecipientPicker(null);
      } catch (err: any) {
        setReceiptError(err?.message || 'Failed to add receipt');
      } finally {
        setRecipientSubmitting(false);
      }
    },
    [recipientPicker, partyId, loadMine, loadEvent]
  );

  // Closing the picker without choosing: clear the stash. The attempted items
  // stay flagged (failedSaveIds) so the auto-save loop won't immediately re-fire
  // the same RECIPIENT_REQUIRED rejection; the host can Retry to reopen it.
  const closeRecipientPicker = useCallback(() => {
    setRecipientPicker(null);
  }, []);

  // grissini-58511: are there local uploads that haven't been persisted yet?
  // (still uploading/ocring, in error, or done-but-pending/failed save). Used to
  // swap the misleading "upload a receipt" attestation helper.
  const hasUnsavedUploads = uploadItems.length > 0;

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
    // tiramisu-58530: require >=5 additional event photos beyond the 3 roles.
    const addl = readiness.additionalPhotoCount ?? 0;
    if (addl < REQUIRED_ADDITIONAL_PHOTOS)
      list.push(t('payouts.missingAdditionalPhotos', { count: addl, required: REQUIRED_ADDITIONAL_PHOTOS }));
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
    !!readiness?.hasGroupPhoto && !!readiness?.hasBoxStackPhoto &&
    !!readiness?.hasPizzaPhoto &&
    (readiness?.additionalPhotoCount ?? 0) >= REQUIRED_ADDITIONAL_PHOTOS;

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

      {/* rigatoni-58301: 50% prepayment only makes sense before the event —
          hide the opt-in once the event date has passed. */}
      {!eventHasHappened && <PrepayCheckbox partyId={partyId} />}

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
        <EventPhotosCard
          partyId={partyId}
          onRolesChange={handleRolesChange}
          onPhotosChange={handleRolesChange}
        />
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
        {/* grissini-58511: loud + sticky + retryable auto-save failure. The
            backend always writes a row on a successful POST, so a missing row
            means this POST genuinely failed — surface it prominently and let
            the host retry instead of silently leaving receipts unsubmitted. */}
        {receiptError && (
          <div className="mt-3 card p-3 border-l-4 border-l-amber-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertCircle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm font-medium text-theme-text">
                {t('payouts.receiptsSaveFailedBanner')}
              </div>
            </div>
            <button
              type="button"
              onClick={retrySave}
              disabled={addingReceipts}
              className="btn-secondary inline-flex items-center justify-center gap-2 text-sm whitespace-nowrap disabled:opacity-50"
            >
              {addingReceipts ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {t('payouts.receiptsRetrySave')}
            </button>
          </div>
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
          <p className="text-xs text-theme-text-muted mt-1">
            {/* grissini-58511: if the host has local uploads that haven't been
                persisted (still saving, or a failed save), the server-truth
                "upload a receipt" helper is misleading — point them at the
                unresolved uploads above instead. */}
            {hasUnsavedUploads
              ? t('payouts.receiptAttestationUnsaved')
              : t('payouts.receiptAttestationHelp')}
          </p>
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

      {/* ===== caciocavallo-58535: aggregator recipient picker ===== */}
      {recipientPicker && (
        <RecipientPickerModal
          candidates={recipientPicker.candidates}
          submitting={recipientSubmitting}
          onConfirm={confirmRecipient}
          onClose={closeRecipientPicker}
        />
      )}
    </div>
  );
};
