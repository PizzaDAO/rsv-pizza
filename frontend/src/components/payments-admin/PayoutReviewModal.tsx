import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Check, AlertTriangle, ExternalLink, Loader2, Pencil, Send, DollarSign, RefreshCw, Repeat2, Tag, Undo2, Flag, Coins, Play, ChevronDown, ChevronRight, Plus, Trash2, Copy } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { ClickableEmail } from '../ClickableEmail';
import { SwcHubWarning } from './SwcHubWarning';
import { isSwcHubParty } from '../../utils/swcHub';
import { updatePartyApi, updatePayoutDocument, retryPayoutDocumentOcr, markReceiptDuplicate } from '../../lib/api';
import { isVideoFile } from '../../lib/mediaUtils';
import { isPdfFile, derivePdfThumbnailUrl } from '../../lib/pdfUtils';
import type { AdminPayoutDetail, PayoutAuditEntry, WalletPaidTotal, ReceiptLineItem, ReceiptLineItemCategory } from '../../types';
import {
  PayoutStatusPill,
  PayoutMethodIcon,
  PAYOUT_METHOD_LABELS,
  formatUsd,
  formatOriginalCurrency,
  ReceiptLightbox,
} from '../payments-shared';
import { ReceiptEditor } from './ReceiptEditor';

/**
 * parmigiana-58291: strip the "Global Pizza Party " prefix from event names so
 * the city stays visible in the review-modal header. Same convention as
 * PayoutRow and PrepayQueueTable — inlined here to match those callsites.
 */
function stripGppPrefix(name: string): string {
  return name.replace(/^Global Pizza Party\s+/i, '');
}

/**
 * lasagna-92103: $675 is the "sane-default" per-submission soft cap. The
 * backend admin PATCH no longer enforces it (admin amount is canonical), so
 * this constant now drives a purely informational amber warning — no
 * Checkbox, no Save block. The USDC execute hard ceiling
 * (HARD_PER_TX_CEILING_USD in usdc-base.service.ts) remains as a separate
 * safety net at on-chain send time, but admins can split executes or record
 * external payments to handle larger sums.
 */
const PER_SUBMISSION_MAX_USD = 675;

interface PayoutReviewModalProps {
  payout: AdminPayoutDetail;
  /** When set, indicates the actor would be paying themselves — disables mutate buttons. */
  selfPayoutBlocked?: boolean;
  onClose: () => void;
  onApprove: (note?: string) => Promise<void> | void;
  /**
   * gouda-92103: optional second arg lets the admin opt into a silent
   * reject — backend suppresses host-notify side effects and records
   * `[silent]` on the audit row. Default (no opts) preserves today's
   * notify-on-reject contract.
   */
  onReject: (reason: string, opts?: { silent?: boolean }) => Promise<void> | void;
  /**
   * caprino-92103: revert an `approved` payout back to `pending`. Surfaced
   * as an amber "Revert to Pending" button in the modal footer when the
   * current status is `approved`. Returns a string error message (NOT
   * throws) when the call fails so the modal can surface it inline; resolves
   * to `undefined` on success.
   *
   * No confirm modal — reversible actions don't get a confirm step per
   * project convention.
   */
  onUnapprove?: () => Promise<string | void> | string | void;
  /**
   * culatello-92103: revert a `paid` payout back to `approved`. Surfaced as
   * an amber "Revert to Approved" button in the modal footer when the
   * current status is `paid`. Works for every payout method (USDC, wire,
   * mercury_card, external, off-platform) — previously there was no UI
   * affordance to undo a `mark-paid` after the fact.
   *
   * Mirrors `onUnapprove`'s contract: returns a string error message (NOT
   * throws) when the call fails so the modal can surface it inline;
   * resolves to `undefined` on success.
   *
   * Surfaces a one-step confirm before firing — the action clears
   * paidAt + tx metadata (preserving the audit trail) and the parent will
   * normally re-fetch the row, so a misclick is recoverable but unwanted.
   */
  onRevertPaid?: () => Promise<string | void> | string | void;
  /**
   * gnocchi-92104: flip an `approved` payout to `queued` (wire request sent,
   * awaiting settlement). Surfaced as an amber "Mark queued" button in the
   * footer when status === 'approved'. Confirms once with body copy
   * "Mark queued? This signals the wire request has been sent but not
   * settled yet." Reversible via `onUnmarkQueued`.
   *
   * Returns a string error message (NOT throws) when the call fails so the
   * modal can render it inline; resolves to undefined on success.
   */
  onMarkQueued?: () => Promise<string | void> | string | void;
  /**
   * gnocchi-92104: revert a `queued` payout back to `approved` (the "admin
   * oops un-queue" path). Surfaced as an amber "Un-queue" button when
   * status === 'queued'. Mirrors `onUnapprove`'s contract — no confirm,
   * reversible. Returns string error / void on success.
   */
  onUnmarkQueued?: () => Promise<string | void> | string | void;
  /**
   * lasagna-92103: backend admin PATCH no longer enforces the per-submission
   * cap, so `allowOverSubmissionCap` is no longer forwarded by this modal.
   * The signature still accepts the field for back-compat with parents that
   * pass it through to the API client; the value (if any) is ignored by the
   * server.
   *
   * Returns a string error message (NOT throws) when the save fails — the
   * modal renders it inline below the Save button so the failure isn't
   * silent. Returning `void` (or resolving to `undefined`) means success.
   */
  onSaveAmount: (
    newAmount: number,
    opts?: { note?: string; allowOverSubmissionCap?: boolean },
  ) => Promise<string | void> | string | void;
  onSaveAdminNotes: (notes: string) => Promise<void> | void;
  onMarkPaid: (refs: {
    wireReference?: string;
    transactionHash?: string;
    mercuryCardLast4?: string;
    mercuryCardId?: string;
    note?: string;
  }) => Promise<void> | void;
  /**
   * Execute payout (PR 5). For USDC → no body, server sends via Privy.
   * For wire / mercury_card → admin-supplied refs.
   *
   * `allowOverPerAddressCap` (bianco-89172): forwarded when the admin has
   * acknowledged the per-address $676 cap warning by ticking the override
   * checkbox in the execute form.
   */
  onExecute: (body: {
    wireReference?: string;
    mercuryCardLast4?: string;
    mercuryCardId?: string;
    note?: string;
    allowOverPerAddressCap?: boolean;
    /**
     * salame-92103: forwarded when the admin has ticked the per-party cap
     * override checkbox in the execute form. Server appends
     * `[override: party cap]` to the audit row's note.
     */
    allowOverPartyCap?: boolean;
  }) => Promise<void> | void;
  /**
   * Optional fetcher for the USDC daily-cap-remaining hint. Only called when
   * the admin opens the USDC execute confirmation. Returns null if unavailable.
   */
  fetchUsdcCapRemaining?: () => Promise<{ usedUsd: number; capUsd: number; remainingUsd: number } | null>;
  /**
   * bianco-89172: optional fetcher for the per-address paid total + would-exceed
   * check. Called when a USDC execute form opens so we can render the cap
   * warning panel before the admin clicks Send. Returns null if unavailable.
   */
  fetchWalletPaidTotal?: (address: string, amount: number) => Promise<WalletPaidTotal | null>;
  /** Re-open (clear rejected/failed) — uses mark-paid plumbing or a future endpoint. */
  onReopen?: () => Promise<void> | void;
  /**
   * tiramisu-49102: "Pay again to this wallet" — only surfaced when this
   * payout is already `paid`. Parent opens CreatePrepaymentModal pre-filled
   * with the same party + host + method/destination so the admin can issue a
   * follow-up payment without leaving the modal.
   */
  onPayAgain?: (payout: AdminPayoutDetail) => void;
  /**
   * tagliatelle-49102: the actor's admin role. Used to gate the in-modal
   * event_tags editor — only `admin` / `super_admin` see the add input and
   * the per-chip remove (×) buttons. `payment_admin` sees the chips
   * read-only (since they can't PATCH the party). Optional for backward-
   * compat with any caller that hasn't been threaded yet.
   */
  adminRole?: 'admin' | 'super_admin' | 'payment_admin' | null;
  /**
   * tagliatelle-49102: called after the modal successfully PATCHes the
   * party's `event_tags`. Parent should refresh its payouts list so the
   * underlying row picks up the new tag set (effective cap, etc.).
   */
  onTagsChanged?: (next: string[]) => void;
  /**
   * argentina-92103: viewer role. `'underboss'` hides Execute Payment +
   * Mark paid (manual) and surfaces a green "Flag ready for payment"
   * button instead. Defaults to `'admin'` so existing callers keep the
   * full power-user UI.
   */
  viewerRole?: 'admin' | 'underboss';
  /**
   * argentina-92103: flag the payout as "ready for payment" — writes an
   * audit row + notifies the payments team. Surfaced as a green Flag
   * button in the footer for underbosses; admins also see it so they can
   * pre-flag rows before exiting the modal. Returns an error message
   * string on failure (same contract as `onUnapprove`) so the modal can
   * render it inline.
   */
  onFlagReady?: () => Promise<string | void> | string | void;
  /**
   * panettone-92103: open MarkPartyPaidModal for this payout's party so the
   * admin can flip every in-flight (pending + approved) payout on the event
   * to paid in one transaction. Hidden for underbosses (admin-only handler).
   * Parent owns the modal state.
   */
  onMarkPartyPaid?: () => void;
  busy?: boolean;
}

export const PayoutReviewModal: React.FC<PayoutReviewModalProps> = ({
  payout,
  selfPayoutBlocked,
  onClose,
  onApprove,
  onReject,
  onUnapprove,
  onRevertPaid,
  onMarkQueued,
  onUnmarkQueued,
  onSaveAmount,
  onSaveAdminNotes,
  onMarkPaid,
  onExecute,
  fetchUsdcCapRemaining,
  fetchWalletPaidTotal,
  onReopen,
  onPayAgain,
  adminRole,
  onTagsChanged,
  viewerRole = 'admin',
  onFlagReady,
  onMarkPartyPaid,
  busy = false,
}) => {
  // argentina-92103: underbosses lose Execute/Mark-paid affordances. The
  // green Flag-ready button replaces them in the footer slot.
  const isAdminViewer = viewerRole === 'admin';
  // Flag-ready inline error (mirrors the unapproveError pattern).
  const [flagReadyError, setFlagReadyError] = useState<string | null>(null);
  // tagliatelle-49102: in-modal event_tags editor. Full admins (admin /
  // super_admin) can add + remove tags via PATCH /api/parties/:id;
  // payment_admin sees the chips read-only. Hooks must be declared above
  // any early return — see feedback_hooks_above_early_returns.
  const canEditTags = adminRole === 'admin' || adminRole === 'super_admin';
  const [tags, setTags] = useState<string[]>(payout.party.eventTags ?? []);
  const [newTag, setNewTag] = useState('');
  const [tagSaving, setTagSaving] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);

  // Re-sync the local tag state whenever the parent swaps in a fresh
  // `payout` (e.g. after refresh() reloads the detail). Without this the
  // chip list goes stale after an external mutation.
  useEffect(() => {
    setTags(payout.party.eventTags ?? []);
  }, [payout.id, payout.party.eventTags]);

  async function saveTags(nextTags: string[]) {
    setTagSaving(true);
    setTagError(null);
    try {
      // updatePartyApi handles the PATCH; backend enforces the 'go' tag
      // gating (payment_admin+) but full admins (the only ones who can
      // reach this code path) can freely set any tag.
      await updatePartyApi(payout.partyId, { eventTags: nextTags });
      setTags(nextTags);
      onTagsChanged?.(nextTags);
      return true;
    } catch (err: any) {
      setTagError(err?.message || 'Failed to update tags');
      return false;
    } finally {
      setTagSaving(false);
    }
  }

  async function handleAddTag(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newTag.trim();
    if (!trimmed) return;
    if (trimmed.length > 32) {
      setTagError('Tag must be 32 characters or less');
      return;
    }
    if (tags.includes(trimmed)) {
      setTagError(`Tag "${trimmed}" is already set`);
      return;
    }
    const nextTags = Array.from(new Set([...tags, trimmed]));
    const ok = await saveTags(nextTags);
    if (ok) setNewTag('');
  }

  async function handleRemoveTag(tag: string) {
    const nextTags = tags.filter((t) => t !== tag);
    await saveTags(nextTags);
  }

  const [editingAmount, setEditingAmount] = useState(false);
  const [draftAmount, setDraftAmount] = useState(String(payout.finalAmountUsd));
  const [adminNotes, setAdminNotes] = useState(payout.adminNotes ?? '');
  const [adminNotesDirty, setAdminNotesDirty] = useState(false);

  // lasagna-92103: `ackOverSubmissionCap` is gone — admin amount is now
  // canonical on the backend, so the modal doesn't gate Save on an
  // acknowledgement. The amber warning below stays as an informational
  // heads-up when the typed amount exceeds the $675 sane-default cap.
  // `saveAmountError` still renders inline below the Save button when
  // the backend (or any other failure path) rejects — wallet/method
  // validation, etc.
  const [saveAmountError, setSaveAmountError] = useState<string | null>(null);

  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // gouda-92103: silent-reject ack. UNCHECKED by default so today's
  // notify-on-reject contract holds; admin opts into suppression by ticking.
  const [rejectSilent, setRejectSilent] = useState(false);

  // caprino-92103: inline error for "Revert to Pending". Rendered below the
  // footer button row. Mirrors the saveAmountError pattern from aglio-62584.
  const [unapproveError, setUnapproveError] = useState<string | null>(null);

  // culatello-92103: inline error + confirm gate for "Revert to Approved"
  // (paid -> approved). Confirm is a one-click ack so the admin doesn't
  // accidentally drop the historical mark-paid record.
  const [revertPaidError, setRevertPaidError] = useState<string | null>(null);
  const [revertPaidConfirming, setRevertPaidConfirming] = useState(false);

  // gnocchi-92104: inline error + confirm gate for "Mark queued"
  // (approved -> queued). Single-click ack mirroring revertPaidConfirming
  // so the admin acknowledges they're signalling "the wire request has been
  // sent" even though no money has moved.
  const [markQueuedError, setMarkQueuedError] = useState<string | null>(null);
  const [markQueuedConfirming, setMarkQueuedConfirming] = useState(false);
  // Inline error for "Un-queue" (queued -> approved). No confirm — reversible
  // action, matches the unapprove pattern.
  const [unmarkQueuedError, setUnmarkQueuedError] = useState<string | null>(null);

  const [showMarkPaidForm, setShowMarkPaidForm] = useState(false);
  const [wireRef, setWireRef] = useState('');
  const [txHash, setTxHash] = useState('');
  const [cardLast4, setCardLast4] = useState('');
  const [cardId, setCardId] = useState('');
  const [paidNote, setPaidNote] = useState('');

  // Execute-payout (PR 5) — method-specific confirmation form
  const [showExecuteForm, setShowExecuteForm] = useState(false);
  const [execWireRef, setExecWireRef] = useState('');
  const [execCardLast4, setExecCardLast4] = useState('');
  const [execCardId, setExecCardId] = useState('');
  const [execNote, setExecNote] = useState('');
  const [usdcCap, setUsdcCap] = useState<
    { usedUsd: number; capUsd: number; remainingUsd: number } | null
  >(null);
  const [usdcCapLoading, setUsdcCapLoading] = useState(false);

  // bianco-89172: per-address $676 cap warning state. `walletPaidTotal` is
  // null until the USDC execute form opens; `overrideCap` is the admin's
  // acknowledgement of the warning (required to enable Execute when
  // `wouldExceed === true`).
  const [walletPaidTotal, setWalletPaidTotal] = useState<WalletPaidTotal | null>(null);
  const [walletPaidLoading, setWalletPaidLoading] = useState(false);
  const [overrideCap, setOverrideCap] = useState(false);

  // salame-92103: per-party cap override state. The amber warning + ack
  // surfaces when this proposed payment would push the party past its
  // effective reimbursement cap (already-paid total + this amount > cap).
  // Required to enable Execute when `partyWouldExceedCap === true`.
  const [overridePartyCap, setOverridePartyCap] = useState(false);

  // parmigiana-92104: SWC Hub ack. Reimbursement for SWC Hub parties is
  // processed through SWC, not rsv.pizza — admin reimbursement actions
  // (Approve, Execute, Mark paid manual) stay disabled until the admin ticks
  // the override. Revert-to-pending and revert-to-approved are NOT gated
  // (those are rollback actions, not reimbursement). Reset on every modal
  // close/reopen by the parent (PayoutReviewModal is re-mounted per payout).
  const swcHub = isSwcHubParty(payout.party);
  const [swcAck, setSwcAck] = useState(false);
  // Re-sync the ack on payout swap (parent reload after refresh()) so admins
  // don't carry an ack across distinct payouts displayed in the same modal.
  useEffect(() => {
    setSwcAck(false);
  }, [payout.id]);
  // True when an SWC Hub action button should be disabled (warning surfaces
  // and admin hasn't acked). Combined with the existing busy / selfPayout
  // / cap gates downstream.
  const swcBlocked = swcHub && !swcAck;

  // taralli-58291: lightbox uses an index into `allPhotos` so ArrowLeft /
  // ArrowRight can cycle through receipts + pizza photos. Hooks must be
  // declared above any early return — see feedback_hooks_above_early_returns.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // pesto-92104: the lightbox owns its visible index after open (so arrow
  // nav works without parent re-renders), but the parent needs to know
  // which doc is currently in view so it can supply the matching editor
  // pane. `lightboxCurrentIndex` is mirrored from the lightbox via its
  // `onIndexChange` prop.
  const [lightboxCurrentIndex, setLightboxCurrentIndex] = useState<number | null>(null);

  // agnolotti-58291: per-receipt OCR amount + currency edit state. The modal
  // ships an inline form per receipt row (gated to full admins + payment_admin)
  // so admins can correct OCR misreads without recomputing the parent payout.
  // `receiptOverrides` is a docId -> { ocrAmount, ocrCurrency, ocrLineItems }
  // map applied on top of `payout.documents` for rendering, so the row
  // reflects the saved value immediately without waiting for a parent refresh.
  //
  // taralli-92104: extended with `ocrLineItems` so the line item grid stays
  // in sync with what we just persisted (no parent re-fetch required).
  type ReceiptOverride = {
    ocrAmount: number | null;
    ocrCurrency: string | null;
    ocrLineItems?: ReceiptLineItem[] | null;
    // culatello-92104: per-receipt duplicate flag override so the modal
    // reflects an in-flight toggle without waiting for parent refresh.
    isDuplicate?: boolean;
    // caprino-92104: post-FX-recompute fields so the lightbox editor's "USD
    // value" + "at rate X" display refreshes immediately on save.
    originalAmount?: number | null;
    originalCurrency?: string | null;
    exchangeRate?: number | null;
  };
  const [receiptOverrides, setReceiptOverrides] = useState<Record<string, ReceiptOverride>>({});
  // Per-row save state.
  const [receiptSavingId, setReceiptSavingId] = useState<string | null>(null);
  const [receiptSaveErrors, setReceiptSaveErrors] = useState<Record<string, string>>({});
  // Per-row drafts so admins can edit without re-typing on re-render. Drafts
  // are seeded from the original OCR value on first edit and kept until the
  // row is saved or the modal closes.
  //
  // caprino-92104: draft now tracks the receipt's ORIGINAL-currency amount
  // (what's printed on the receipt) plus currency; USD is derived server-side
  // via FX on save. `manualUsdAmount` is an opt-in fallback when FX fails.
  type ReceiptDraft = {
    originalAmount: string;
    currency: string;
    manualUsdAmount?: string;
  };
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, ReceiptDraft>>({});
  // caprino-92104: per-row backend error code (e.g. FX_RATE_UNAVAILABLE) so
  // the editor can render the "Set USD manually" fallback toggle.
  const [receiptSaveErrorCodes, setReceiptSaveErrorCodes] = useState<Record<string, string>>({});

  // pancetta-92104: per-row "Retry OCR" state. Admin can re-trigger the OCR
  // pipeline on a single doc that previously errored (e.g. quota / timeout /
  // bad image). The retry resets ocr_attempt_count + ocr_attempted_at and
  // runs analyzeReceipt inline; on success we clear ocrError locally so the
  // per-row error chip and the global 429 banner both update without a
  // parent refetch.
  const [retryingDocId, setRetryingDocId] = useState<string | null>(null);
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  // Map of docId -> cleared (true) so the row stops rendering the stale
  // ocrError from `payout.documents` once retry succeeds. We only set true
  // on success; failures still surface a per-row error chip.
  const [retryClearedErrors, setRetryClearedErrors] = useState<Record<string, boolean>>({});

  // taralli-92104: per-receipt line-item editor state.
  //
  //  - `lineItemsExpanded` tracks the collapse caret per docId. Default
  //    collapsed (false) so the modal isn't overwhelming when a payout has
  //    many receipts.
  //  - `lineItemDrafts` holds the in-flight edits as string-typed inputs so
  //    admins can type freely (decimals, partial values, etc.) without us
  //    fighting the cursor. Numeric coercion happens at save time.
  //  - `lineItemsSavingId` and `lineItemsSaveErrors` are scoped to the
  //    line-items section so they don't collide with the amount/currency
  //    save state above.
  type LineItemDraft = {
    name: string;
    qty: string;
    unitPrice: string;
    subtotal: string;
    category: ReceiptLineItemCategory;
  };
  const [lineItemsExpanded, setLineItemsExpanded] = useState<Record<string, boolean>>({});
  const [lineItemDrafts, setLineItemDrafts] = useState<Record<string, LineItemDraft[]>>({});
  const [lineItemsSavingId, setLineItemsSavingId] = useState<string | null>(null);
  const [lineItemsSaveErrors, setLineItemsSaveErrors] = useState<Record<string, string>>({});

  // culatello-92104 (#1): docId of the right-pane receipt row currently
  // highlighted from a left-pane thumbnail click. Cleared by a setTimeout
  // ~1.5s later so the amber outline + animate-pulse fade out.
  const [highlightedReceiptId, setHighlightedReceiptId] = useState<string | null>(null);
  // culatello-92104 (#2): per-row "Mark duplicate" loading state and any
  // toggle errors. Scoped separately from the amount/currency save state
  // above so a dup-toggle failure doesn't clobber the inline edit error.
  const [duplicateSavingId, setDuplicateSavingId] = useState<string | null>(null);
  const [duplicateSaveErrors, setDuplicateSaveErrors] = useState<Record<string, string>>({});

  // Hooks must be declared above any early returns. There aren't any early
  // returns in this component today, but keeping all hooks grouped here makes
  // the rule-of-hooks invariant easier to verify.

  const canEditReceipts =
    adminRole === 'admin' || adminRole === 'super_admin' || adminRole === 'payment_admin';

  // Memoize the merged photo list so the keyboard handler's effect doesn't
  // re-bind on every render. taralli-58291 introduced the memoization for
  // lightbox keyboard nav; agnolotti-58291 layers receiptOverrides on top so
  // inline-edited rows render the saved OCR values immediately.
  const receipts = useMemo(
    () =>
      payout.documents
        .filter((d) => d.kind === 'receipt')
        .map((d) => {
          const ov = receiptOverrides[d.id];
          if (!ov) return d;
          // taralli-92104: layer the persisted line items on top of the
          // original document too so the grid renders the saved values
          // after PATCH without waiting for a parent refresh.
          // culatello-92104: same treatment for the duplicate flag so the
          // dim + pill update immediately on toggle.
          return {
            ...d,
            ocrAmount: ov.ocrAmount,
            ocrCurrency: ov.ocrCurrency,
            ocrLineItems:
              ov.ocrLineItems !== undefined ? ov.ocrLineItems : d.ocrLineItems,
            isDuplicate:
              ov.isDuplicate !== undefined ? ov.isDuplicate : d.isDuplicate,
            // caprino-92104: layer the FX recompute fields too so the
            // lightbox editor's "USD value" + rate display reflects the new
            // server-side values without a parent refetch.
            originalAmount:
              ov.originalAmount !== undefined ? ov.originalAmount : d.originalAmount,
            originalCurrency:
              ov.originalCurrency !== undefined ? ov.originalCurrency : d.originalCurrency,
            exchangeRate:
              ov.exchangeRate !== undefined ? ov.exchangeRate : d.exchangeRate,
          };
        }),
    [payout.documents, receiptOverrides],
  );
  const pizzas = useMemo(
    () => payout.documents.filter((d) => d.kind === 'pizza'),
    [payout.documents],
  );
  // bottarga-92103: event-level photos from the party's Photos tab. Separate
  // from payment-app photos (`payout.documents`). Optional on the wire — older
  // cached responses simply render an empty section.
  //
  // focaccia-92104: split party.photos into "Pizza photos" (tag `Pizza` — the
  // default-tagger value — or `pizza-selfie`, the EventPage selfie tag) and
  // "Event photos" (everything else). Case-insensitive to tolerate legacy
  // casing. `tags` may be missing on older cached payloads, in which case the
  // photo falls into Event photos.
  const allEventPhotos = useMemo(
    () => payout.eventPhotos ?? [],
    [payout.eventPhotos],
  );
  const pizzaPhotos = useMemo(
    () => allEventPhotos.filter((p) =>
      (p.tags ?? []).some((t) => {
        const tl = t.toLowerCase();
        return tl === 'pizza' || tl === 'pizza-selfie';
      })
    ),
    [allEventPhotos],
  );
  const eventPhotos = useMemo(
    () => allEventPhotos.filter((p) =>
      !(p.tags ?? []).some((t) => {
        const tl = t.toLowerCase();
        return tl === 'pizza' || tl === 'pizza-selfie';
      })
    ),
    [allEventPhotos],
  );
  // Unified lightbox carousel order (focaccia-92104):
  //   pizzas (payment-app) → receipts → pizzaPhotos → eventPhotos
  // Order matters so each thumbnail grid's offset into `allPhotos` resolves
  // to the right starting image.
  const allPhotos = useMemo(
    () => [
      ...pizzas.map((d) => ({
        url: d.url,
        fileName: d.fileName,
        mimeType: d.mimeType,
      })),
      ...receipts.map((d) => ({
        url: d.url,
        fileName: d.fileName,
        mimeType: d.mimeType,
      })),
      ...pizzaPhotos.map((p) => ({
        url: p.url,
        fileName: p.fileName,
        mimeType: p.mimeType,
      })),
      ...eventPhotos.map((p) => ({
        url: p.url,
        fileName: p.fileName,
        mimeType: p.mimeType,
      })),
    ],
    [pizzas, receipts, pizzaPhotos, eventPhotos],
  );

  async function saveReceiptEdit(docId: string) {
    const draft = receiptDrafts[docId];
    if (!draft) return;
    setReceiptSavingId(docId);
    setReceiptSaveErrors((m) => {
      const next = { ...m };
      delete next[docId];
      return next;
    });
    setReceiptSaveErrorCodes((m) => {
      const next = { ...m };
      delete next[docId];
      return next;
    });
    try {
      // caprino-92104: send `originalAmount` + `ocrCurrency` together. The
      // backend recomputes the USD value via convertToUSD() and returns the
      // canonical (ocrAmount, originalAmount, exchangeRate, originalCurrency)
      // tuple. When the admin has opted into manual-USD mode (after an
      // FX_RATE_UNAVAILABLE failure), send `ocrAmount` + `ocrCurrency`
      // instead — the backend's `adminSetBothExplicitly` branch trusts the
      // admin's numbers and skips FX.
      const trimmedOrig = draft.originalAmount.trim();
      const trimmedCur = draft.currency.trim();
      const patch: {
        ocrAmount?: number | null;
        ocrCurrency?: string | null;
        originalAmount?: number | null;
      } = {};

      if (trimmedCur === '') {
        patch.ocrCurrency = null;
      } else if (trimmedCur.length > 8) {
        throw new Error('Currency must be 8 characters or fewer');
      } else {
        patch.ocrCurrency = trimmedCur.toUpperCase();
      }

      if (draft.manualUsdAmount !== undefined) {
        // Manual-USD fallback: trust the admin's USD value verbatim. Still
        // persist the original amount so future re-conversions work.
        const trimmedUsd = draft.manualUsdAmount.trim();
        if (trimmedUsd === '') {
          patch.ocrAmount = null;
        } else {
          const n = Number(trimmedUsd);
          if (!Number.isFinite(n) || n < 0) {
            throw new Error('USD value must be a non-negative number');
          }
          patch.ocrAmount = n;
        }
        if (trimmedOrig !== '') {
          const n = Number(trimmedOrig);
          if (!Number.isFinite(n) || n < 0) {
            throw new Error('Original amount must be a non-negative number');
          }
          patch.originalAmount = n;
        }
      } else {
        // Standard FX path: send the original amount + currency and let the
        // backend derive USD. Empty original amount clears the field.
        if (trimmedOrig === '') {
          patch.originalAmount = null;
        } else {
          const n = Number(trimmedOrig);
          if (!Number.isFinite(n) || n <= 0) {
            throw new Error('Original amount must be a positive number');
          }
          patch.originalAmount = n;
        }
      }

      const updated = await updatePayoutDocument(docId, patch);
      setReceiptOverrides((m) => ({
        ...m,
        [docId]: {
          ocrAmount: updated.ocrAmount,
          ocrCurrency: updated.ocrCurrency,
          // taralli-92104: preserve any line items override that was already
          // saved (e.g. admin saved line items first, then bumped the total).
          // The backend echoes the current persisted array regardless of
          // whether we PATCHed it, so trust the server response.
          ocrLineItems: updated.ocrLineItems,
          // culatello-92104: server echoes the duplicate flag; carry it
          // through so a previous dup toggle isn't lost when amount/currency
          // is also edited.
          isDuplicate: updated.isDuplicate,
          // caprino-92104: surface the recomputed FX details so the lightbox
          // editor's "USD value" display renders the new numbers without a
          // parent refetch.
          originalAmount: updated.originalAmount,
          originalCurrency: updated.originalCurrency,
          exchangeRate: updated.exchangeRate,
        },
      }));
      // Sync the draft text to the canonical saved value so the inputs match
      // the rendered row on the next render. Drop manualUsdAmount because
      // the save succeeded (either FX path or admin's manual value — both
      // are now persisted as the canonical state).
      setReceiptDrafts((m) => ({
        ...m,
        [docId]: {
          originalAmount: updated.originalAmount == null
            ? ''
            : String(updated.originalAmount),
          currency: updated.ocrCurrency ?? '',
        },
      }));
    } catch (err: any) {
      setReceiptSaveErrors((m) => ({
        ...m,
        [docId]: err?.message || 'Failed to save',
      }));
      const code = (err && typeof err.code === 'string') ? err.code : '';
      if (code) {
        setReceiptSaveErrorCodes((m) => ({ ...m, [docId]: code }));
      }
    } finally {
      setReceiptSavingId(null);
    }
  }

  // pancetta-92104: admin-triggered single-doc OCR retry. Resets the cooldown
  // + attempt counter on the doc and re-runs analyzeReceipt inline. On a
  // non-quota success we drop the local ocrError so the row updates without
  // a parent refetch; on failure we surface the new error inline.
  async function retryOcr(docId: string) {
    setRetryingDocId(docId);
    setRetryErrors((m) => {
      const next = { ...m };
      delete next[docId];
      return next;
    });
    try {
      const res = await retryPayoutDocumentOcr(docId, { runNow: true });
      if (res.inlineError) {
        setRetryErrors((m) => ({ ...m, [docId]: res.inlineError ?? 'OCR failed' }));
      } else if (res.ranInline) {
        // Success — locally suppress the stale ocrError from payout.documents.
        setRetryClearedErrors((m) => ({ ...m, [docId]: true }));
      }
    } catch (err: any) {
      setRetryErrors((m) => ({
        ...m,
        [docId]: err?.message || 'Retry failed',
      }));
    } finally {
      setRetryingDocId(null);
    }
  }

  // pancetta-92104: collapse identical OpenAI 429/quota errors across rows
  // into ONE banner at the top of the receipt section. Cuts noise when the
  // entire event's receipts share the same upload-time OCR quota failure
  // (the Mexico City symptom that triggered this task). Per-row chips hide
  // when the banner is showing so admins don't see "429 You exceeded your
  // current quota" repeated six times.
  const quotaErrorRows = useMemo(() => {
    return receipts
      .filter((r) => !retryClearedErrors[r.id])
      .filter((r) => {
        const msg = (r.ocrError || '').toLowerCase();
        return msg && (msg.includes('429') || msg.includes('quota'));
      });
  }, [receipts, retryClearedErrors]);
  const showQuotaBanner = quotaErrorRows.length >= 2;

  // taralli-92104: helpers + persistence for the per-receipt line items
  // grid. Drafts are seeded on first expansion from the canonical
  // `ocrLineItems` so admins can edit freely without round-tripping every
  // keystroke. `saveLineItemsEdit` flushes the drafts through the same
  // `updatePayoutDocument` endpoint and updates `receiptOverrides` so the
  // rendered row reflects the saved values without a parent refresh.
  function lineItemToDraft(item: ReceiptLineItem): LineItemDraft {
    return {
      name: item.name ?? '',
      qty: String(item.qty ?? 0),
      unitPrice: String(item.unitPrice ?? 0),
      subtotal: String(item.subtotal ?? 0),
      category: item.category ?? 'other',
    };
  }

  function emptyLineItemDraft(): LineItemDraft {
    return { name: '', qty: '1', unitPrice: '0', subtotal: '0', category: 'other' };
  }

  function ensureLineItemDrafts(docId: string, items: ReceiptLineItem[] | null | undefined) {
    setLineItemDrafts((m) => {
      if (m[docId]) return m; // already seeded — don't clobber in-flight edits
      return {
        ...m,
        [docId]: (items ?? []).map(lineItemToDraft),
      };
    });
  }

  function toggleLineItems(docId: string, items: ReceiptLineItem[] | null | undefined) {
    setLineItemsExpanded((m) => {
      const next = !m[docId];
      if (next) ensureLineItemDrafts(docId, items);
      return { ...m, [docId]: next };
    });
  }

  function updateLineItemDraft(
    docId: string,
    idx: number,
    patch: Partial<LineItemDraft>,
  ) {
    setLineItemDrafts((m) => {
      const cur = m[docId] ?? [];
      const next = cur.slice();
      next[idx] = { ...next[idx], ...patch };
      return { ...m, [docId]: next };
    });
  }

  function addLineItem(docId: string) {
    setLineItemDrafts((m) => {
      const cur = m[docId] ?? [];
      return { ...m, [docId]: [...cur, emptyLineItemDraft()] };
    });
  }

  function removeLineItem(docId: string, idx: number) {
    setLineItemDrafts((m) => {
      const cur = m[docId] ?? [];
      const next = cur.slice();
      next.splice(idx, 1);
      return { ...m, [docId]: next };
    });
  }

  // Sum of subtotals across the current draft (used by the "Use line sum"
  // button + the live total at the bottom of the editor).
  function draftSubtotalSum(drafts: LineItemDraft[] | undefined): number {
    if (!drafts) return 0;
    let sum = 0;
    for (const d of drafts) {
      const n = Number(d.subtotal);
      if (Number.isFinite(n) && n >= 0) sum += n;
    }
    return sum;
  }

  // Clamp the receipt-amount draft to the current line-sum. Convenience
  // affordance — admins still get the explicit Save button to confirm.
  //
  // caprino-92104: line items are in the receipt's ORIGINAL currency (see
  // `sumCurrency` in ReceiptEditor), so the sum maps to `originalAmount`,
  // not the USD value.
  function useLineSumForAmount(docId: string) {
    const drafts = lineItemDrafts[docId];
    const sum = draftSubtotalSum(drafts);
    setReceiptDrafts((m) => {
      const prev = m[docId];
      // Preserve the existing currency draft (or empty) so we don't reset it.
      return {
        ...m,
        [docId]: {
          originalAmount: sum.toFixed(2),
          currency: prev?.currency ?? '',
        },
      };
    });
  }

  async function saveLineItemsEdit(docId: string) {
    const drafts = lineItemDrafts[docId];
    if (!drafts) return;
    setLineItemsSavingId(docId);
    setLineItemsSaveErrors((m) => {
      const next = { ...m };
      delete next[docId];
      return next;
    });
    try {
      const items: ReceiptLineItem[] = drafts.map((d, idx) => {
        const qty = Number(d.qty);
        const unitPrice = Number(d.unitPrice);
        const subtotal = Number(d.subtotal);
        if (!Number.isFinite(qty) || qty < 0) {
          throw new Error(`Line ${idx + 1}: qty must be a non-negative number`);
        }
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new Error(`Line ${idx + 1}: unit price must be a non-negative number`);
        }
        if (!Number.isFinite(subtotal) || subtotal < 0) {
          throw new Error(`Line ${idx + 1}: subtotal must be a non-negative number`);
        }
        return {
          name: d.name,
          qty,
          unitPrice,
          subtotal,
          category: d.category,
        };
      });
      const updated = await updatePayoutDocument(docId, { ocrLineItems: items });
      setReceiptOverrides((m) => ({
        ...m,
        [docId]: {
          ocrAmount: updated.ocrAmount,
          ocrCurrency: updated.ocrCurrency,
          ocrLineItems: updated.ocrLineItems,
          // culatello-92104: see saveReceiptEdit comment.
          isDuplicate: updated.isDuplicate,
        },
      }));
      // Re-seed the draft from the canonical saved array so the next render
      // matches the persisted state (server may have rounded/sanitized).
      setLineItemDrafts((m) => ({
        ...m,
        [docId]: (updated.ocrLineItems ?? []).map(lineItemToDraft),
      }));
    } catch (err: any) {
      setLineItemsSaveErrors((m) => ({
        ...m,
        [docId]: err?.message || 'Failed to save line items',
      }));
    } finally {
      setLineItemsSavingId(null);
    }
  }

  // culatello-92104 (#1): scroll-to + highlight the right-pane receipt row
  // matching `docId`. Triggered from a left-pane thumbnail click so admins
  // can immediately edit amount/currency/line items after seeing the photo.
  // Also expands the line-items section if it's collapsed so the editor is
  // fully visible. Highlight clears ~1.5s later via setTimeout — the row
  // gets an amber outline + animate-pulse class while active. We render
  // ALONGSIDE the lightbox (not instead of) so admins can review the photo
  // and edit at the same time; the lightbox already supports keyboard
  // dismiss.
  function scrollToReceiptRow(docId: string) {
    const el = document.getElementById(`receipt-row-${docId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setHighlightedReceiptId(docId);
    // Expand the line-items section so the editor is visible — same path
    // as the chevron click but always opens (doesn't toggle off).
    setLineItemsExpanded((m) => ({ ...m, [docId]: true }));
    // Seed the drafts if needed so the just-expanded grid is editable.
    const persistedItems = receipts.find((r) => r.id === docId)?.ocrLineItems;
    ensureLineItemDrafts(docId, persistedItems);
    window.setTimeout(() => {
      setHighlightedReceiptId((cur) => (cur === docId ? null : cur));
    }, 1500);
  }

  // culatello-92104 (#2): toggle the per-receipt duplicate flag via the
  // existing PATCH /documents/:docId endpoint. Optimistic-friendly: we
  // immediately mirror the new value into `receiptOverrides` so the dim/
  // pill update is instant, and roll back on error. Action is reversible
  // — same toggle un-marks (no confirm modal per project convention).
  async function toggleDuplicate(docId: string, nextValue: boolean) {
    setDuplicateSavingId(docId);
    setDuplicateSaveErrors((m) => {
      const next = { ...m };
      delete next[docId];
      return next;
    });
    // Capture the prior value so we can roll back on PATCH failure. Read
    // from the override map first; fall back to the canonical document.
    const prior = receipts.find((r) => r.id === docId);
    const priorIsDuplicate = prior?.isDuplicate === true;
    setReceiptOverrides((m) => {
      const cur = m[docId] ?? {
        ocrAmount: prior?.ocrAmount ?? null,
        ocrCurrency: prior?.ocrCurrency ?? null,
      };
      return { ...m, [docId]: { ...cur, isDuplicate: nextValue } };
    });
    try {
      const updated = await markReceiptDuplicate(docId, nextValue);
      setReceiptOverrides((m) => {
        const cur = m[docId] ?? {
          ocrAmount: updated.ocrAmount,
          ocrCurrency: updated.ocrCurrency,
        };
        return {
          ...m,
          [docId]: {
            ...cur,
            // Server is authoritative; sync the full override block.
            ocrAmount: updated.ocrAmount,
            ocrCurrency: updated.ocrCurrency,
            ocrLineItems: updated.ocrLineItems,
            isDuplicate: updated.isDuplicate,
          },
        };
      });
    } catch (err: any) {
      // Roll back the optimistic mirror so the UI matches the persisted
      // state when the PATCH failed.
      setReceiptOverrides((m) => {
        const cur = m[docId];
        if (!cur) return m;
        return { ...m, [docId]: { ...cur, isDuplicate: priorIsDuplicate } };
      });
      setDuplicateSaveErrors((m) => ({
        ...m,
        [docId]: err?.message || 'Failed to update duplicate flag',
      }));
    } finally {
      setDuplicateSavingId(null);
    }
  }

  // bresaola-89172: keyboard nav for the lightbox now lives inside the
  // ReceiptLightbox component itself (Esc to close, arrows to cycle). The
  // parent modal still listens for Esc here to close the review modal —
  // when the lightbox is open it stops Esc propagation, so only one of
  // these handlers fires per keypress.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (lightboxIndex == null && e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, lightboxIndex]);

  // pesto-92104: derive the receipt that's currently in the lightbox (if
  // any). The unified carousel order is pizzas → receipts → pizzaPhotos →
  // eventPhotos (see `allPhotos` above), so the receipt slice starts at
  // `pizzas.length` and runs through `pizzas.length + receipts.length`.
  const lightboxReceipt = useMemo(() => {
    if (lightboxCurrentIndex == null) return null;
    const offset = pizzas.length;
    const idx = lightboxCurrentIndex - offset;
    if (idx < 0 || idx >= receipts.length) return null;
    return receipts[idx];
  }, [lightboxCurrentIndex, pizzas.length, receipts]);

  // pesto-92104: "is the editor dirty?" — used by the navigation prompt
  // (Save / Discard / Cancel) so admins don't accidentally lose in-flight
  // amount / currency / line-item edits when arrow-keying through receipts.
  // Mirrors the dirty-check in the per-row right-pane editor below.
  function receiptHasUnsavedEdits(docId: string): boolean {
    const r = receipts.find((x) => x.id === docId);
    if (!r) return false;
    const draft = receiptDrafts[docId];
    if (draft) {
      // caprino-92104: compare against the originalAmount column (the field
      // the editor binds to) and the originalCurrency (falling back to
      // ocrCurrency when the FX detail isn't persisted yet).
      const seededOriginal =
        r.originalAmount != null
          ? String(r.originalAmount)
          : r.ocrAmount != null
            ? String(r.ocrAmount)
            : '';
      const seededCurrency = r.originalCurrency ?? r.ocrCurrency ?? '';
      if (
        draft.originalAmount !== seededOriginal
        || draft.currency !== seededCurrency
        || draft.manualUsdAmount !== undefined
      ) {
        return true;
      }
    }
    const liDrafts = lineItemDrafts[docId];
    if (liDrafts) {
      const persisted = (r.ocrLineItems ?? []).map(lineItemToDraft);
      if (persisted.length !== liDrafts.length) return true;
      for (let i = 0; i < liDrafts.length; i++) {
        const a = liDrafts[i];
        const b = persisted[i];
        if (
          a.name !== b.name ||
          a.qty !== b.qty ||
          a.unitPrice !== b.unitPrice ||
          a.subtotal !== b.subtotal ||
          a.category !== b.category
        ) {
          return true;
        }
      }
    }
    return false;
  }

  // pesto-92104: gate the lightbox's arrow / button nav when the current
  // receipt has unsaved edits. Surfaces a confirm() with three implied
  // outcomes — admins answer OK to discard and move on, Cancel to stay on
  // the current receipt. Save is a separate path (admins explicitly click
  // the Save button before navigating); we don't auto-save here because
  // arrow-key navigation through 6 receipts shouldn't fire 6 PATCH calls
  // in the happy path.
  const lightboxOnBeforeNavigate = useCallback(async (): Promise<boolean> => {
    if (!lightboxReceipt) return true;
    if (!receiptHasUnsavedEdits(lightboxReceipt.id)) return true;
    const ok = window.confirm(
      'This receipt has unsaved edits. Discard them and navigate?',
    );
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxReceipt, receiptDrafts, lineItemDrafts, receipts]);

  // pesto-92104: D key = mark-duplicate toggle for the currently-shown
  // receipt. Lightbox only wires this handler when an editor is mounted,
  // so non-receipt photos / non-admin viewers don't accidentally toggle.
  const lightboxOnDuplicateShortcut = useCallback(() => {
    if (!lightboxReceipt) return;
    toggleDuplicate(lightboxReceipt.id, !(lightboxReceipt.isDuplicate === true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxReceipt]);

  // pesto-92104: render the ReceiptEditor when the lightbox is showing a
  // receipt AND the viewer can edit (admin / super_admin / payment_admin).
  // Non-receipt thumbnails (event photos, pizza photos, payment-proof
  // pizzas) get the plain photo-only lightbox.
  const lightboxEditorPane = useMemo(() => {
    if (!lightboxReceipt) return null;
    if (!canEditReceipts) return null;
    const r = lightboxReceipt;
    // caprino-92104: seed the draft from the canonical persisted shape. Prefer
    // the receipt's `originalAmount` column (mortadella-92103+) and fall back
    // to `ocrAmount` for legacy rows (treats the stored value as the original-
    // currency amount on first edit — backend mirrors this fallback).
    const seededOriginal =
      r.originalAmount != null
        ? String(r.originalAmount)
        : r.ocrAmount != null
          ? String(r.ocrAmount)
          : '';
    const seededCurrency = r.originalCurrency ?? r.ocrCurrency ?? '';
    const draft: ReceiptDraft = receiptDrafts[r.id] ?? {
      originalAmount: seededOriginal,
      currency: seededCurrency,
    };
    const isDirty =
      draft.originalAmount !== seededOriginal
      || draft.currency !== seededCurrency
      || draft.manualUsdAmount !== undefined;
    // Seed line item drafts lazily (mirrors ensureLineItemDrafts on
    // expansion in the right-pane). For the lightbox we always show the
    // editor, so seed immediately if no draft exists yet.
    const liDraftsExisting = lineItemDrafts[r.id];
    const liDrafts =
      liDraftsExisting ?? (r.ocrLineItems ?? []).map(lineItemToDraft);
    const localOcrError = retryClearedErrors[r.id]
      ? null
      : (retryErrors[r.id] ?? r.ocrError);
    return (
      <ReceiptEditor
        doc={r}
        draft={draft}
        onDraftChange={(next) =>
          setReceiptDrafts((m) => ({ ...m, [r.id]: next }))
        }
        saving={receiptSavingId === r.id}
        saveError={receiptSaveErrors[r.id]}
        saveErrorCode={receiptSaveErrorCodes[r.id]}
        onSave={() => saveReceiptEdit(r.id)}
        isDirty={isDirty}
        isDuplicate={r.isDuplicate === true}
        dupSaving={duplicateSavingId === r.id}
        dupError={duplicateSaveErrors[r.id]}
        onToggleDuplicate={() => toggleDuplicate(r.id, !(r.isDuplicate === true))}
        lineItemDrafts={liDrafts}
        lineItemsSaving={lineItemsSavingId === r.id}
        lineItemsSaveError={lineItemsSaveErrors[r.id]}
        onLineItemDraftChange={(idx, patch) => {
          // If the parent hasn't yet seeded the draft (first edit from the
          // lightbox), persist the freshly seeded `liDrafts` into the draft
          // map so the next render keeps the in-flight edits.
          if (!liDraftsExisting) {
            setLineItemDrafts((m) => ({ ...m, [r.id]: liDrafts }));
          }
          updateLineItemDraft(r.id, idx, patch);
        }}
        onAddLineItem={() => {
          if (!liDraftsExisting) {
            setLineItemDrafts((m) => ({ ...m, [r.id]: liDrafts }));
          }
          addLineItem(r.id);
        }}
        onRemoveLineItem={(idx) => {
          if (!liDraftsExisting) {
            setLineItemDrafts((m) => ({ ...m, [r.id]: liDrafts }));
          }
          removeLineItem(r.id, idx);
        }}
        onSaveLineItems={() => {
          if (!liDraftsExisting) {
            setLineItemDrafts((m) => ({ ...m, [r.id]: liDrafts }));
          }
          saveLineItemsEdit(r.id);
        }}
        onUseLineSumForAmount={() => useLineSumForAmount(r.id)}
        hasOcrError={!!localOcrError}
        retrying={retryingDocId === r.id}
        retryError={retryErrors[r.id]}
        onRetryOcr={() => retryOcr(r.id)}
      />
    );
    // The deps list intentionally excludes the function references that
    // are stable across renders within this component (saveReceiptEdit,
    // toggleDuplicate, etc.) — they read fresh state internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    lightboxReceipt,
    canEditReceipts,
    receiptDrafts,
    receiptSavingId,
    receiptSaveErrors,
    receiptSaveErrorCodes,
    duplicateSavingId,
    duplicateSaveErrors,
    lineItemDrafts,
    lineItemsSavingId,
    lineItemsSaveErrors,
    retryingDocId,
    retryErrors,
    retryClearedErrors,
  ]);

  // culatello-92104: duplicates are evidence-only — exclude their OCR
  // amounts from the receipt sum so admins see the corrected total. The
  // host PATCH recompute path (backend/payout.routes.ts) does the same.
  const ocrSum = receipts.reduce(
    (sum, r) => sum + (r.isDuplicate ? 0 : (Number(r.ocrAmount) || 0)),
    0,
  );
  const duplicateCount = receipts.reduce(
    (n, r) => n + (r.isDuplicate ? 1 : 0),
    0,
  );

  // coppa-92103: the parent Payout row's `originalAmount` / `originalCurrency`
  // / `exchangeRate` columns only ever hold the FIRST successful FX conversion
  // (legacy single-value fields preserved for backwards compatibility). On a
  // multi-receipt payout (e.g. Marbella: 3 EUR receipts) this misleadingly
  // showed an arbitrary subset of the real original-currency total.
  //
  // After mortadella-92103 each receipt carries its own original_amount +
  // original_currency + exchange_rate, so aggregate the "Original / Rate /
  // Extracted" summary from those per-receipt fields instead. Falls back to
  // the parent-row single value when none of the receipts have the new FX
  // columns populated (pre-mortadella rows before the backfill lands).
  const originalSummary = useMemo(() => {
    const receiptsWithFx = receipts.filter(
      (r) =>
        // culatello-92104: exclude admin-marked duplicates from the
        // original-currency totals + the extracted USD sum so the summary
        // line reflects the corrected payout.
        !r.isDuplicate &&
        r.originalCurrency != null &&
        r.originalCurrency !== '' &&
        r.originalAmount != null &&
        Number.isFinite(Number(r.originalAmount)),
    );

    if (receiptsWithFx.length === 0) {
      // Legacy fallback — use the parent-row single value if present.
      if (
        payout.originalCurrency &&
        payout.originalCurrency.toUpperCase() !== 'USD' &&
        payout.originalAmount != null
      ) {
        return {
          mode: 'legacy' as const,
          line: `Original: ${formatOriginalCurrency(
            Number(payout.originalAmount),
            payout.originalCurrency,
          )} · Rate: ${Number(payout.exchangeRate).toFixed(4)} · Extracted: ${formatUsd(
            Number(payout.extractedAmountUsd),
          )}`,
        };
      }
      return null;
    }

    // Sum the USD-converted ocrAmount across the same receipts so the
    // "Extracted" half of the line matches the originals we're summarizing.
    const extractedUsdSum = receiptsWithFx.reduce(
      (s, r) => s + (Number(r.ocrAmount) || 0),
      0,
    );

    const distinctCurrencies = Array.from(
      new Set(
        receiptsWithFx.map((r) => (r.originalCurrency ?? '').toUpperCase()),
      ),
    );

    if (distinctCurrencies.length === 1) {
      const cur = distinctCurrencies[0];
      const sum = receiptsWithFx.reduce(
        (s, r) => s + Number(r.originalAmount),
        0,
      );
      // If every receipt is already in USD, suppress the Original line — it
      // would just repeat the Extracted total.
      if (cur === 'USD') {
        return null;
      }
      const rates = receiptsWithFx
        .map((r) => Number(r.exchangeRate))
        .filter((n) => Number.isFinite(n) && n > 0);
      let rateDisplay = '';
      if (rates.length > 0) {
        const minRate = Math.min(...rates);
        const maxRate = Math.max(...rates);
        rateDisplay =
          maxRate - minRate < 0.001
            ? rates[0].toFixed(4)
            : `${minRate.toFixed(4)}–${maxRate.toFixed(4)}`;
      }
      return {
        mode: 'single' as const,
        line: `Original: ${formatOriginalCurrency(sum, cur)}${
          rateDisplay ? ` · Rate: ${rateDisplay}` : ''
        } · Extracted: ${formatUsd(extractedUsdSum)}`,
      };
    }

    // Multi-currency — render a per-currency breakdown.
    const byCurrency = new Map<string, number>();
    for (const r of receiptsWithFx) {
      const cur = (r.originalCurrency ?? '').toUpperCase();
      byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + Number(r.originalAmount));
    }
    const parts = Array.from(byCurrency.entries()).map(([cur, amt]) =>
      formatOriginalCurrency(amt, cur),
    );
    return {
      mode: 'multi' as const,
      line: `Original: ${parts.join(' + ')} · Extracted: ${formatUsd(
        extractedUsdSum,
      )}`,
    };
  }, [
    receipts,
    payout.originalAmount,
    payout.originalCurrency,
    payout.exchangeRate,
    payout.extractedAmountUsd,
  ]);

  // salame-92103: party-cap analysis for the Execute panel. Derived from
  // `payout.party.effectiveReimbursementCapUsd` (the resolved cap — validated
  // cap OR max numeric event tag) and `payout.party.paidTotalUsd` (sum of
  // already-paid payouts on this party). When this proposed payment would push
  // the party's running paid total past its cap, the modal renders an amber
  // warning + ack checkbox and disables Execute until the admin ticks it.
  const partyCap = payout.party?.effectiveReimbursementCapUsd ?? null;
  const partyPaidSoFar = payout.party?.paidTotalUsd ?? 0;
  const proposedAmount = Number(payout.finalAmountUsd) || 0;
  const partyCapRemaining =
    partyCap != null ? Math.max(0, partyCap - partyPaidSoFar) : null;
  const partyWouldExceedCap =
    partyCap != null && partyPaidSoFar + proposedAmount > partyCap + 1e-9;
  const partyOverBy = partyWouldExceedCap && partyCap != null
    ? Math.max(0, partyPaidSoFar + proposedAmount - partyCap)
    : 0;

  const isPending = payout.status === 'pending';
  const isFailed = payout.status === 'failed';
  // passata-49102: failed payouts are now re-executable, so treat them like
  // 'approved' for the Execute affordance (button + form).
  const isApproved = payout.status === 'approved' || isFailed;
  const isPaid = payout.status === 'paid';
  // 'failed' is no longer "closed" — it has the Execute (Retry) button instead
  // of Re-open. Only 'rejected' remains terminal-until-reopened.
  const isClosed = payout.status === 'rejected';
  // gnocchi-92104: queued = wire request sent, awaiting settlement. Separate
  // footer cluster from approved — Mark Paid still works (queued → paid),
  // but Execute / Approve are hidden and Un-queue replaces Mark queued.
  const isQueued = payout.status === 'queued';

  // For Mercury, last4 must be exactly 4 digits before the button enables.
  const execMercuryValid = /^\d{4}$/.test(execCardLast4.trim());
  const execWireValid = execWireRef.trim().length > 0;

  async function openExecuteForm() {
    setShowExecuteForm(true);
    setExecWireRef('');
    setExecCardLast4('');
    setExecCardId('');
    setExecNote('');
    // bianco-89172: clear the per-address cap state on every open so the
    // ack checkbox doesn't carry over from a previous Execute attempt.
    setWalletPaidTotal(null);
    setOverrideCap(false);
    // salame-92103: clear the per-party cap ack on every open.
    setOverridePartyCap(false);
    if (payout.payoutMethod === 'usdc_base' && fetchUsdcCapRemaining) {
      setUsdcCapLoading(true);
      try {
        const cap = await fetchUsdcCapRemaining();
        setUsdcCap(cap);
      } catch {
        setUsdcCap(null);
      } finally {
        setUsdcCapLoading(false);
      }
    }
    // bianco-89172: fetch the per-address paid-total for the recipient wallet
    // so we can warn the admin if this payout would push past the $676 cap.
    if (
      payout.payoutMethod === 'usdc_base' &&
      payout.payoutWalletAddress &&
      fetchWalletPaidTotal
    ) {
      setWalletPaidLoading(true);
      try {
        const total = await fetchWalletPaidTotal(
          payout.payoutWalletAddress,
          Number(payout.finalAmountUsd),
        );
        setWalletPaidTotal(total);
      } catch {
        setWalletPaidTotal(null);
      } finally {
        setWalletPaidLoading(false);
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-theme-surface rounded-2xl shadow-2xl border border-theme-stroke w-full max-w-[95vw] sm:max-w-6xl max-h-[95vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-theme-stroke">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-theme-text">
                Payment {payout.id.slice(0, 8)}
              </h2>
              <PayoutStatusPill status={payout.status} size="md" />
              <PayoutMethodIcon method={payout.payoutMethod} showLabel />
            </div>
            <div className="text-xs text-theme-text-muted mt-0.5">
              {payout.host.name || '—'} ·{' '}
              {payout.host.email ? <ClickableEmail email={payout.host.email} /> : '—'} ·{' '}
              <a
                href={`/host/${payout.party.inviteCode}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {stripGppPrefix(payout.party.name)}
              </a>
            </div>
            {/* arugula-38633 v2 follow-up: planning vs actuals, prominent.
                arugula-38633 (cap-everywhere): cap appended when set. */}
            <div
              className="text-xs text-theme-text-secondary mt-1"
              title="Expected guests is the host's planning number. Confirmed RSVPs are direct submissions only (excludes bulk invites)."
            >
              <span className="font-medium">Expected guests:</span>{' '}
              {payout.party.expectedGuests != null ? payout.party.expectedGuests : '—'}
              {' · '}
              <span className="font-medium">Confirmed RSVPs:</span>{' '}
              {payout.party.rsvpCount}
              {payout.party.effectiveReimbursementCapUsd != null && (
                <>
                  {' · '}
                  <span className="font-medium">Cap:</span>{' '}
                  ${Number(payout.party.effectiveReimbursementCapUsd).toLocaleString()}
                </>
              )}
            </div>
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

        {selfPayoutBlocked && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-300 text-sm text-amber-800 flex items-center gap-2">
            <AlertTriangle size={14} />
            You are the host on this payment. Payment admins cannot approve/edit their own payments.
          </div>
        )}

        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4 p-5">
          {/* Left: photo galleries
              focaccia-92104: three explicit sections — Event photos, Pizza
              photos, Receipts. The party.photos list is split by tag
              (`Pizza` / `pizza-selfie` → Pizza photos; everything else →
              Event photos). The kind=pizza payment-app screenshots are
              demoted to "Payment proof" under Payments on the right.
              Lightbox carousel order: pizzas → receipts → pizzaPhotos →
              eventPhotos so arrow-key nav crosses all sections. */}
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-theme-text mb-2">
                Event photos ({eventPhotos.length})
              </h3>
              {eventPhotos.length === 0 ? (
                <p className="text-sm text-theme-text-faint">No event photos yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {eventPhotos.map((p, idx) => {
                    // focaccia-92104: event photos sit at the END of the
                    // merged carousel.
                    const carouselIdx =
                      pizzas.length + receipts.length + pizzaPhotos.length + idx;
                    const isHidden = p.status !== 'approved';
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setLightboxIndex(carouselIdx)}
                        className="relative aspect-square rounded-lg overflow-hidden border border-theme-stroke group"
                        title={p.caption || p.fileName}
                      >
                        {/* melanzane-92103: video event-photos render as
                            <video preload=metadata> so the browser pulls the
                            first frame for the poster, with a play-icon
                            overlay to signal it's playable. */}
                        {isVideoFile(p) ? (
                          <>
                            <video
                              src={p.url}
                              preload="metadata"
                              muted
                              playsInline
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="bg-black/50 rounded-full p-3">
                                <Play className="text-white" size={20} fill="white" />
                              </div>
                            </div>
                          </>
                        ) : (
                          <img
                            src={p.thumbnailUrl || p.url}
                            alt={p.fileName}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        )}
                        {isHidden && (
                          <span
                            className="absolute top-1 left-1 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-red-500 text-white"
                            title={`Photo status: ${p.status} — not visible to the public`}
                          >
                            Hidden
                          </span>
                        )}
                        {p.starred && (
                          <span className="absolute top-1 right-1 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-400 text-black">
                            ★
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* focaccia-92104: Pizza photos — party.photos tagged
                `Pizza` (default tagger) or `pizza-selfie` (EventPage). */}
            <div>
              <h3 className="text-sm font-semibold text-theme-text mb-2">
                Pizza photos ({pizzaPhotos.length})
              </h3>
              {pizzaPhotos.length === 0 ? (
                <p className="text-sm text-theme-text-faint">No pizza photos yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {pizzaPhotos.map((p, idx) => {
                    // focaccia-92104: pizza photos sit between receipts and
                    // event photos in the merged carousel.
                    const carouselIdx = pizzas.length + receipts.length + idx;
                    const isHidden = p.status !== 'approved';
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setLightboxIndex(carouselIdx)}
                        className="relative aspect-square rounded-lg overflow-hidden border border-theme-stroke group"
                        title={p.caption || p.fileName}
                      >
                        {isVideoFile(p) ? (
                          <>
                            <video
                              src={p.url}
                              preload="metadata"
                              muted
                              playsInline
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="bg-black/50 rounded-full p-3">
                                <Play className="text-white" size={20} fill="white" />
                              </div>
                            </div>
                          </>
                        ) : (
                          <img
                            src={p.thumbnailUrl || p.url}
                            alt={p.fileName}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        )}
                        {isHidden && (
                          <span
                            className="absolute top-1 left-1 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-red-500 text-white"
                            title={`Photo status: ${p.status} — not visible to the public`}
                          >
                            Hidden
                          </span>
                        )}
                        {p.starred && (
                          <span className="absolute top-1 right-1 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-400 text-black">
                            ★
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* focaccia-92104: Receipts photo grid — kind=receipt
                PayoutDocuments. The per-receipt OCR list on the right is the
                editable companion to these thumbnails. */}
            <div>
              <h3 className="text-sm font-semibold text-theme-text mb-2">
                Receipts ({receipts.length})
              </h3>
              {receipts.length === 0 ? (
                <p className="text-sm text-theme-text-faint">No receipts attached.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {receipts.map((doc, idx) => {
                    // focaccia-92104: receipt thumbnails sit after the
                    // payment-app pizzas in the merged carousel.
                    const carouselIdx = pizzas.length + idx;
                    const isDup = doc.isDuplicate === true;
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        // culatello-92104 (#1): clicking the thumbnail now
                        // does BOTH — opens the lightbox AND scrolls the
                        // right-pane editor row into view + highlights it.
                        // Picked the dual behavior over a corner-icon split
                        // so a single tap accomplishes "see this receipt
                        // and edit it" — the flow admins were doing manually.
                        onClick={() => {
                          setLightboxIndex(carouselIdx);
                          if (canEditReceipts) scrollToReceiptRow(doc.id);
                        }}
                        // culatello-92104 (#2): admin-marked duplicates dim
                        // to 50% so the grid visually reflects the corrected
                        // payout at a glance.
                        // coppa-92105: pair the dim with a red border so the
                        // exclusion reads as "rejected" rather than just
                        // "inactive". The diagonal-stripe overlay below
                        // reinforces it further.
                        className={`relative aspect-square rounded-lg overflow-hidden border group ${
                          isDup
                            ? 'opacity-50 border-red-500/60'
                            : 'border-theme-stroke'
                        }`}
                        title={
                          isDup
                            ? `[DUPLICATE — excluded from totals] ${doc.fileName}`
                            : doc.fileName
                        }
                      >
                        {isVideoFile(doc) ? (
                          <>
                            <video
                              src={doc.url}
                              preload="metadata"
                              muted
                              playsInline
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="bg-black/50 rounded-full p-3">
                                <Play className="text-white" size={20} fill="white" />
                              </div>
                            </div>
                          </>
                        ) : (
                          /* bocconcino-92104: PDF receipts thumbnail off their
                              sibling `.thumb.png` (rendered client-side at upload).
                              Image receipts render via the canonical URL. */
                          <img
                            src={isPdfFile(doc) ? derivePdfThumbnailUrl(doc.url) : doc.url}
                            alt={doc.fileName}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        )}
                        <span className="absolute top-1 left-1 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500 text-white">
                          receipt
                        </span>
                        {/* coppa-92105: 8px alternating dark/transparent
                            diagonal stripes laid over the thumbnail when
                            marked duplicate. The opacity-50 dim alone reads
                            as "inactive"; the stripes drive home "excluded
                            from totals". Mirrors the by-city grid treatment. */}
                        {isDup && (
                          <span
                            className="absolute inset-0 pointer-events-none"
                            style={{
                              backgroundImage:
                                'repeating-linear-gradient(45deg, rgba(0,0,0,0.35) 0 4px, transparent 4px 8px)',
                            }}
                          />
                        )}
                        {/* culatello-92104: DUPLICATE pill on the thumbnail
                            so admins see at a glance which receipts are
                            evidence-only. */}
                        {isDup && (
                          <span className="absolute top-1 right-1 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-red-500 text-white">
                            duplicate
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Right: details */}
          <section className="space-y-4">
            {/* parmigiana-92104: SWC Hub reimbursement warning + ack.
                Surfaces above every reimbursement-action control (the Amount
                edit and the footer's Approve / Execute / Mark paid). Sticks
                in the body so it scrolls with the rest of the right column
                instead of floating above the action footer. */}
            <SwcHubWarning
              isSwcHub={swcHub}
              acked={swcAck}
              onAckChange={setSwcAck}
            />

            {/* Amount */}
            <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-theme-text">Amount</h3>
                {!isPaid && !editingAmount && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftAmount(String(payout.finalAmountUsd));
                      setEditingAmount(true);
                      // lasagna-92103: clear any stale error from a prior open.
                      setSaveAmountError(null);
                    }}
                    disabled={selfPayoutBlocked || busy}
                    className="inline-flex items-center gap-1 text-xs text-theme-text-secondary hover:text-theme-text disabled:opacity-50"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                )}
              </div>
              {editingAmount ? (
                (() => {
                  // lasagna-92103: amber warning is informational only. Save
                  // is gated on validity (Number.isFinite + non-negative) and
                  // not-busy — no longer on an over-cap acknowledgement.
                  const draftNum = Number(draftAmount);
                  const draftIsValid = Number.isFinite(draftNum) && draftNum >= 0;
                  const exceedsCap = draftIsValid && draftNum > PER_SUBMISSION_MAX_USD;
                  const saveDisabled = busy || !draftIsValid;
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <IconInput
                          icon={DollarSign}
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Final USD amount"
                          value={draftAmount}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            setDraftAmount(e.target.value);
                            // Clear stale error once the admin starts typing again.
                            if (saveAmountError) setSaveAmountError(null);
                          }}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (!draftIsValid) return;
                            setSaveAmountError(null);
                            try {
                              // lasagna-92103: no longer forward
                              // `allowOverSubmissionCap` — the backend admin
                              // PATCH ignores it. Admin amount is canonical.
                              const result = await onSaveAmount(draftNum);
                              // Parent may return a string instead of throwing
                              // — surface it inline.
                              if (typeof result === 'string' && result.length > 0) {
                                setSaveAmountError(result);
                                return;
                              }
                              setEditingAmount(false);
                            } catch (err: any) {
                              setSaveAmountError(
                                (err && (err.message || String(err))) ||
                                  'Save failed — please try again.',
                              );
                            }
                          }}
                          disabled={saveDisabled}
                          className="px-3 py-2 rounded-lg bg-[#E52828] text-white text-sm disabled:opacity-50"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingAmount(false);
                            setSaveAmountError(null);
                          }}
                          className="px-3 py-2 rounded-lg text-sm text-theme-text-secondary hover:bg-theme-surface-hover"
                        >
                          Cancel
                        </button>
                      </div>
                      {/* lasagna-92103: informational amber heads-up when the
                          typed value exceeds the $675 sane-default cap. NOT a
                          gate — admin amount is canonical on the backend; the
                          warning is purely a visual nudge so admins notice
                          unusually large amounts before saving. */}
                      {exceedsCap && (
                        <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/10">
                          <div className="flex items-start gap-2.5">
                            <AlertTriangle className="text-amber-300 mt-0.5 flex-shrink-0" size={16} />
                            <div className="flex-1 text-sm">
                              <div className="font-medium text-amber-200 mb-1">
                                Heads-up: over per-submission soft cap
                              </div>
                              <div className="text-theme-text-secondary text-xs">
                                <b>${draftNum.toFixed(2)}</b> is over the{' '}
                                <b>${PER_SUBMISSION_MAX_USD}</b> per-submission
                                soft cap. Admin edits aren&apos;t gated by
                                this — proceed if intentional. USDC execute
                                still caps at <b>${PER_SUBMISSION_MAX_USD}</b>{' '}
                                per on-chain tx.
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Inline error surface so save failures aren't silent.
                          Covers backend rejections (bad wallet, etc.) and
                          network errors. */}
                      {saveAmountError && (
                        <div className="card p-3 border-l-4 border-l-red-500 bg-red-500/10">
                          <div className="flex items-start gap-2.5">
                            <AlertTriangle className="text-red-300 mt-0.5 flex-shrink-0" size={16} />
                            <div className="flex-1 text-sm text-red-100">
                              {saveAmountError}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                <div>
                  <div className="text-2xl font-semibold text-theme-text inline-flex items-center gap-2">
                    {formatUsd(Number(payout.finalAmountUsd))}
                    {/* speck-89172: amber AlertTriangle when the payout's
                        final amount exceeds the party's effective cap. Hosts
                        can now submit any amount; admin moderates over-cap
                        rows from /payments. */}
                    {payout.party?.effectiveReimbursementCapUsd != null &&
                      Number(payout.finalAmountUsd) > payout.party.effectiveReimbursementCapUsd && (
                        <span
                          className="inline-flex items-center text-amber-500 shrink-0"
                          title={`Submitted amount $${Number(payout.finalAmountUsd).toFixed(2)} exceeds the party's $${Number(payout.party.effectiveReimbursementCapUsd).toFixed(2)} cap.`}
                          aria-label="Amount exceeds party cap"
                        >
                          <AlertTriangle size={18} />
                        </span>
                      )}
                  </div>
                  {/* coppa-92103: aggregated per-receipt summary. The legacy
                      parent-row single value (originalAmount/Currency/Rate)
                      only captured the first FX conversion — misleading on
                      multi-receipt payouts. See `originalSummary` memo above. */}
                  {originalSummary && (
                    <div className="text-xs text-theme-text-muted mt-0.5">
                      {originalSummary.line}
                    </div>
                  )}
                  {/* lonza-92103: city-level cumulative paid total, mirrored
                      from the PayoutRow / PrepayQueueTable "Already paid"
                      caption (parmigiana-89172). Admins were having to close
                      the modal to scan the row for this number — surface it
                      here so it's visible alongside the amount. Amber when
                      the total has already reached the party's effective
                      cap, muted otherwise. */}
                  {payout.party.paidTotalCount != null &&
                    payout.party.paidTotalCount > 0 && (
                      <div
                        className={`text-xs mt-1 ${
                          payout.party.effectiveReimbursementCapUsd != null &&
                          (payout.party.paidTotalUsd ?? 0) >=
                            payout.party.effectiveReimbursementCapUsd
                            ? 'text-amber-300'
                            : 'text-theme-text-muted'
                        }`}
                      >
                        Already paid to this city: $
                        {(payout.party.paidTotalUsd ?? 0).toFixed(2)} ({payout.party.paidTotalCount})
                      </div>
                    )}
                </div>
              )}
            </div>

            {/* tagliatelle-49102: party event_tags editor. Full admins
                (admin / super_admin) can add + remove tags; payment_admin
                sees the chips read-only. Hidden entirely when there are no
                tags AND the actor can't edit — avoids visual clutter for
                payment_admin on an empty event. */}
            {(canEditTags || tags.length > 0) && (
              <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface">
                <h3 className="font-semibold text-theme-text mb-2 text-sm inline-flex items-center gap-1.5">
                  <Tag size={14} />
                  Tags
                </h3>
                <div className="flex flex-wrap gap-2">
                  {tags.length === 0 && (
                    <span className="text-xs text-theme-text-muted">No tags</span>
                  )}
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-theme-surface-hover px-2.5 py-1 text-xs text-theme-text-secondary"
                    >
                      {tag}
                      {canEditTags && (
                        <button
                          type="button"
                          onClick={() => handleRemoveTag(tag)}
                          disabled={tagSaving}
                          aria-label={`Remove tag ${tag}`}
                          className="inline-flex items-center justify-center rounded-full hover:bg-theme-stroke text-theme-text-muted hover:text-theme-text disabled:opacity-50"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                {canEditTags && (
                  <form onSubmit={handleAddTag} className="mt-2 flex gap-2">
                    <div className="flex-1">
                      <IconInput
                        icon={Tag}
                        placeholder="Add a tag (e.g. prepay, k500, swc)"
                        value={newTag}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setNewTag(e.target.value);
                          if (tagError) setTagError(null);
                        }}
                        maxLength={32}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={tagSaving || !newTag.trim()}
                      className="px-3 py-2 rounded-lg bg-[#E52828] text-white text-sm disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      {tagSaving ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
                    </button>
                  </form>
                )}
                {tagError && (
                  <div className="mt-2 text-xs text-red-300">{tagError}</div>
                )}
              </div>
            )}

            {/* Per-receipt OCR */}
            {receipts.length > 0 && (
              <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface">
                <h3 className="text-sm font-semibold text-theme-text mb-2">Receipts ({receipts.length})</h3>
                {/* pancetta-92104: global quota banner collapses N identical
                    429s into one row of context. Per-row chips are hidden
                    below when this banner is showing. */}
                {showQuotaBanner && (
                  <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-50 p-2 text-xs text-amber-900">
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <span className="font-semibold">OpenAI OCR quota exceeded</span>
                      {' '}— line-item extraction temporarily unavailable on{' '}
                      {quotaErrorRows.length} receipt{quotaErrorRows.length === 1 ? '' : 's'}.
                      Receipts uploaded normally; manual amount/currency edits work.
                      {canEditReceipts && (
                        <span className="block mt-0.5 text-amber-800">
                          Use Retry OCR on a row to re-attempt once the quota issue is resolved.
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <ul className="space-y-1.5">
                  {receipts.map((r) => {
                    const conf = r.ocrConfidence ?? 0;
                    const lowConf = conf > 0 && conf < 0.8;
                    // pancetta-92104: locally suppress ocrError after a
                    // successful inline retry so the per-row chip + dot
                    // refresh without a parent refetch.
                    const localOcrError = retryClearedErrors[r.id]
                      ? null
                      : (retryErrors[r.id] ?? r.ocrError);
                    const isQuotaErr = !!localOcrError
                      && (localOcrError.toLowerCase().includes('429')
                        || localOcrError.toLowerCase().includes('quota'));
                    // When the global banner is shown, per-row quota errors
                    // hide (the banner covers them). Non-quota errors still
                    // render so admins can distinguish which rows need a
                    // targeted fix vs which are waiting on the quota reset.
                    const hidePerRowError = isQuotaErr && showQuotaBanner;
                    const renderOcrError = hidePerRowError ? null : localOcrError;
                    const isRetrying = retryingDocId === r.id;
                    // agnolotti-58291: capture the OCR'd values as placeholders
                    // so admins can see what the model originally returned
                    // when they're correcting the field. `original*` reflects
                    // the saved-but-not-yet-overridden value.
                    //
                    // caprino-92104: the right-pane row's amount input now
                    // edits the receipt's ORIGINAL-currency value (same field
                    // the lightbox editor binds to) — on save, backend re-runs
                    // FX and stores the recomputed USD. Seeded from the
                    // `originalAmount` column, falling back to `ocrAmount`
                    // for legacy rows (mirrors the editor's seed logic).
                    const rawDoc = payout.documents.find((d) => d.id === r.id);
                    const placeholderAmt =
                      rawDoc?.originalAmount != null
                        ? String(rawDoc.originalAmount)
                        : rawDoc?.ocrAmount != null
                          ? String(rawDoc.ocrAmount)
                          : null;
                    const placeholderCur = rawDoc?.originalCurrency ?? rawDoc?.ocrCurrency ?? null;
                    const seededOriginalAmt =
                      r.originalAmount != null
                        ? String(r.originalAmount)
                        : r.ocrAmount != null
                          ? String(r.ocrAmount)
                          : '';
                    const seededCur = r.originalCurrency ?? r.ocrCurrency ?? '';
                    const draft = receiptDrafts[r.id];
                    const draftAmt = draft?.originalAmount ?? seededOriginalAmt;
                    const draftCur = draft?.currency ?? seededCur;
                    const dirty =
                      draftAmt !== seededOriginalAmt
                      || draftCur !== seededCur
                      || draft?.manualUsdAmount !== undefined;
                    const saving = receiptSavingId === r.id;
                    const saveError = receiptSaveErrors[r.id];
                    // culatello-92104: dim the row when marked duplicate +
                    // amber outline + pulse when admin clicked its thumbnail.
                    const isDup = r.isDuplicate === true;
                    const isHighlighted = highlightedReceiptId === r.id;
                    const dupSaving = duplicateSavingId === r.id;
                    const dupError = duplicateSaveErrors[r.id];
                    return (
                      <li
                        key={r.id}
                        id={`receipt-row-${r.id}`}
                        /* coppa-92105: the bare opacity-50 dim was too easy
                            to read past — admins (Snax) reported missing
                            it. Pair with a red left border + faint red
                            background tint so the row visibly registers as
                            "excluded from totals" rather than just
                            "inactive". */
                        className={`text-sm rounded ${
                          isHighlighted
                            ? 'ring-2 ring-amber-400 animate-pulse'
                            : ''
                        } ${
                          isDup
                            ? 'opacity-60 border-l-4 border-red-500/60 bg-red-500/5 pl-2 py-1'
                            : ''
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              localOcrError ? (isQuotaErr ? 'bg-amber-500' : 'bg-red-500') :
                              lowConf ? 'bg-amber-500' :
                              conf >= 0.8 ? 'bg-emerald-500' :
                              'bg-gray-400'
                            }`}
                          />
                          <span className="text-theme-text-muted flex-1 truncate">{r.fileName}</span>
                          {canEditReceipts ? (
                            <>
                              {/*
                                agnolotti-58291: tight inline data-grid edits.
                                IconInput is designed for full-width form
                                fields with placeholder-as-label semantics and
                                hardcodes `w-full !pl-14`, which doesn't fit a
                                per-row 2-input + Save layout. Treating this as
                                a data-grid cell, not a form field, so raw
                                inputs are intentional here.
                              */}
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                inputMode="decimal"
                                value={draftAmt}
                                placeholder={placeholderAmt ?? 'orig amt'}
                                title="Original-currency amount (printed on receipt). USD recomputed on save."
                                onChange={(e) =>
                                  setReceiptDrafts((m) => ({
                                    ...m,
                                    [r.id]: { originalAmount: e.target.value, currency: draftCur },
                                  }))
                                }
                                className="w-24 px-2 py-1 rounded border border-theme-stroke bg-theme-surface text-theme-text text-xs text-right"
                              />
                              <input
                                type="text"
                                maxLength={8}
                                value={draftCur}
                                placeholder={placeholderCur || 'CUR'}
                                onChange={(e) =>
                                  setReceiptDrafts((m) => ({
                                    ...m,
                                    [r.id]: { originalAmount: draftAmt, currency: e.target.value },
                                  }))
                                }
                                className="w-16 px-2 py-1 rounded border border-theme-stroke bg-theme-surface text-theme-text text-xs uppercase"
                              />
                              <button
                                type="button"
                                onClick={() => saveReceiptEdit(r.id)}
                                disabled={!dirty || saving}
                                className="px-2 py-1 rounded bg-[#E52828] text-white text-xs disabled:opacity-40 inline-flex items-center gap-1"
                                title="Save OCR override for this receipt"
                              >
                                {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                              </button>
                              {/* pancetta-92104: per-row "Retry OCR" — admin
                                  resets attempt counter + re-runs analyze
                                  inline. Surfaced for any failed row so a
                                  one-off bad image / timeout doesn't need
                                  the global backfill loop. */}
                              {localOcrError && (
                                <button
                                  type="button"
                                  onClick={() => retryOcr(r.id)}
                                  disabled={isRetrying}
                                  className="px-2 py-1 rounded border border-theme-stroke text-theme-text text-xs disabled:opacity-40 inline-flex items-center gap-1"
                                  title="Reset attempt counter and re-run OCR for this receipt"
                                >
                                  {isRetrying ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <RefreshCw size={12} />
                                  )}
                                  Retry OCR
                                </button>
                              )}
                              {/* culatello-92104 (#2): per-row "Mark duplicate"
                                  toggle. Reversible — label + tooltip flip when
                                  already marked. Triggers the optimistic
                                  override + PATCH /documents/:docId path;
                                  errors surface below the row alongside the
                                  amount-save error. */}
                              <button
                                type="button"
                                onClick={() => toggleDuplicate(r.id, !isDup)}
                                disabled={dupSaving}
                                className={`px-2 py-1 rounded text-xs disabled:opacity-40 inline-flex items-center gap-1 ${
                                  isDup
                                    ? 'border border-red-500 text-red-600 hover:bg-red-50'
                                    : 'border border-theme-stroke text-theme-text hover:bg-theme-surface'
                                }`}
                                title={
                                  isDup
                                    ? 'Un-mark this receipt as a duplicate'
                                    : 'Mark this receipt as a duplicate (excluded from sums)'
                                }
                              >
                                {dupSaving ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <Copy size={12} />
                                )}
                                {isDup ? 'Unmark duplicate' : 'Mark duplicate'}
                              </button>
                              {conf > 0 && (
                                <span className={`text-xs ${lowConf ? 'text-amber-600' : 'text-theme-text-faint'}`}>
                                  {(conf * 100).toFixed(0)}%
                                </span>
                              )}
                            </>
                          ) : renderOcrError ? (
                            <span className="text-xs text-red-600">{renderOcrError}</span>
                          ) : r.ocrAmount != null && r.ocrCurrency ? (
                            <>
                              {/* mortadella-92103: ocrAmount is the USD-converted
                                  value. Render the original-currency amount as
                                  a secondary pill when we have it on the doc,
                                  so admins can see exactly what each receipt
                                  was converted from. Falls back to just USD
                                  for pre-mortadella rows that lack the columns. */}
                              <span className="text-theme-text font-medium">
                                ${Number(r.ocrAmount).toFixed(2)} USD
                              </span>
                              {r.originalAmount != null
                                && r.originalCurrency
                                && r.originalCurrency.toUpperCase() !== 'USD' && (
                                <span
                                  className="text-xs text-theme-text-faint"
                                  title={
                                    r.exchangeRate != null
                                      ? `1 ${r.originalCurrency} = $${Number(r.exchangeRate).toFixed(6)} USD`
                                      : undefined
                                  }
                                >
                                  ({formatOriginalCurrency(Number(r.originalAmount), r.originalCurrency)}
                                  {r.exchangeRate != null && ` @ ${Number(r.exchangeRate).toFixed(4)}`})
                                </span>
                              )}
                              <span className={`text-xs ${lowConf ? 'text-amber-600' : 'text-theme-text-faint'}`}>
                                {(conf * 100).toFixed(0)}%
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-theme-text-faint">no OCR</span>
                          )}
                        </div>
                        {canEditReceipts && renderOcrError && (
                          <div className="text-xs text-red-600 mt-0.5 ml-4">{renderOcrError}</div>
                        )}
                        {saveError && (
                          <div className="text-xs text-red-600 mt-0.5 ml-4">{saveError}</div>
                        )}
                        {/* culatello-92104: duplicate-toggle error. Scoped
                            separately from amount/currency save errors. */}
                        {dupError && (
                          <div className="text-xs text-red-600 mt-0.5 ml-4">{dupError}</div>
                        )}
                        {/* taralli-92104: collapsed line item editor. Caret
                            toggles expansion; on expand we seed the drafts
                            from the canonical `ocrLineItems`. Renders for
                            every admin who can edit receipts, including
                            receipts with no items today (admin can add).
                        */}
                        {canEditReceipts && (() => {
                          const expanded = !!lineItemsExpanded[r.id];
                          const persistedItems = r.ocrLineItems ?? null;
                          const persistedCount = Array.isArray(persistedItems)
                            ? persistedItems.length
                            : 0;
                          const drafts = lineItemDrafts[r.id];
                          const draftCount = drafts?.length ?? persistedCount;
                          const lineSum = draftSubtotalSum(drafts);
                          const itemsSaving = lineItemsSavingId === r.id;
                          const itemsSaveError = lineItemsSaveErrors[r.id];
                          // Currency for the live sum label — receipt's
                          // original currency if known, else USD as a
                          // last-resort. The save endpoint stores numeric
                          // values; the label is purely informational.
                          const sumCurrency =
                            r.originalCurrency
                              ?? r.ocrCurrency
                              ?? 'USD';
                          return (
                            <div className="ml-4 mt-1">
                              <button
                                type="button"
                                onClick={() => toggleLineItems(r.id, persistedItems)}
                                className="text-xs text-theme-text-muted hover:text-theme-text inline-flex items-center gap-1"
                                title={expanded ? 'Hide line items' : 'Show line items'}
                              >
                                {expanded
                                  ? <ChevronDown size={12} />
                                  : <ChevronRight size={12} />}
                                <span>
                                  {expanded ? 'Hide' : 'Show'} line items ({draftCount})
                                </span>
                              </button>
                              {expanded && (
                                <div className="mt-2 rounded border border-theme-stroke p-2 bg-theme-bg space-y-1">
                                  {/*
                                    taralli-92104: data-grid cells, not form
                                    fields — IconInput hardcodes `w-full
                                    !pl-14` which doesn't fit a tight 4-cell
                                    + remove-button layout. Same precedent as
                                    agnolotti-58291's per-row amount/currency
                                    inputs above; raw inputs are intentional
                                    here.
                                  */}
                                  {(drafts ?? []).length === 0 && (
                                    <div className="text-xs text-theme-text-faint">
                                      No line items yet. Click "Add line" to start.
                                    </div>
                                  )}
                                  {(drafts ?? []).map((d, idx) => (
                                    <div
                                      key={idx}
                                      className="flex items-center gap-1.5"
                                    >
                                      <input
                                        type="text"
                                        value={d.name}
                                        placeholder="name"
                                        onChange={(e) =>
                                          updateLineItemDraft(r.id, idx, { name: e.target.value })
                                        }
                                        className="flex-1 min-w-0 px-2 py-1 rounded border border-theme-stroke bg-theme-surface text-theme-text text-xs"
                                      />
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        inputMode="decimal"
                                        value={d.qty}
                                        placeholder="qty"
                                        onChange={(e) =>
                                          updateLineItemDraft(r.id, idx, { qty: e.target.value })
                                        }
                                        className="w-14 px-2 py-1 rounded border border-theme-stroke bg-theme-surface text-theme-text text-xs text-right"
                                      />
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        inputMode="decimal"
                                        value={d.unitPrice}
                                        placeholder="unit"
                                        onChange={(e) =>
                                          updateLineItemDraft(r.id, idx, { unitPrice: e.target.value })
                                        }
                                        className="w-20 px-2 py-1 rounded border border-theme-stroke bg-theme-surface text-theme-text text-xs text-right"
                                      />
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        inputMode="decimal"
                                        value={d.subtotal}
                                        placeholder="subtotal"
                                        onChange={(e) =>
                                          updateLineItemDraft(r.id, idx, { subtotal: e.target.value })
                                        }
                                        className="w-20 px-2 py-1 rounded border border-theme-stroke bg-theme-surface text-theme-text text-xs text-right"
                                      />
                                      <select
                                        value={d.category}
                                        onChange={(e) =>
                                          updateLineItemDraft(r.id, idx, {
                                            category: e.target.value as ReceiptLineItemCategory,
                                          })
                                        }
                                        className="px-1 py-1 rounded border border-theme-stroke bg-theme-surface text-theme-text text-xs"
                                        title="Category — pizza-prices analytics filters on 'pizza'"
                                      >
                                        <option value="pizza">pizza</option>
                                        <option value="beverage">beverage</option>
                                        <option value="topping">topping</option>
                                        <option value="side">side</option>
                                        <option value="dessert">dessert</option>
                                        <option value="tax">tax</option>
                                        <option value="tip">tip</option>
                                        <option value="fee">fee</option>
                                        <option value="other">other</option>
                                      </select>
                                      <button
                                        type="button"
                                        onClick={() => removeLineItem(r.id, idx)}
                                        className="p-1 rounded text-theme-text-muted hover:text-red-500 hover:bg-red-50"
                                        title="Remove this line"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  ))}
                                  <div className="flex items-center gap-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => addLineItem(r.id)}
                                      className="px-2 py-1 rounded border border-theme-stroke text-theme-text text-xs inline-flex items-center gap-1 hover:bg-theme-surface"
                                      title="Append a new line"
                                    >
                                      <Plus size={12} />
                                      Add line
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => useLineSumForAmount(r.id)}
                                      className="px-2 py-1 rounded border border-theme-stroke text-theme-text text-xs inline-flex items-center gap-1 hover:bg-theme-surface"
                                      title="Copy the line sum into the receipt total above"
                                      disabled={(drafts ?? []).length === 0}
                                    >
                                      Use line sum
                                    </button>
                                    <span className="text-xs text-theme-text-muted ml-auto">
                                      Sum: {sumCurrency} {lineSum.toFixed(2)}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => saveLineItemsEdit(r.id)}
                                      disabled={itemsSaving}
                                      className="px-2 py-1 rounded bg-[#E52828] text-white text-xs disabled:opacity-40 inline-flex items-center gap-1"
                                      title="Save line items"
                                    >
                                      {itemsSaving
                                        ? <Loader2 size={12} className="animate-spin" />
                                        : 'Save lines'}
                                    </button>
                                  </div>
                                  {itemsSaveError && (
                                    <div className="text-xs text-red-600">{itemsSaveError}</div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </li>
                    );
                  })}
                </ul>
                <div className="text-xs text-theme-text-muted mt-2 border-t border-theme-stroke pt-2">
                  {/* mortadella-92103: ocrAmount is now USD (post-fix). Old
                      rows uploaded pre-mortadella may have non-USD amounts
                      stamped as USD — the backfill script corrects those.
                      culatello-92104: when admin-marked duplicates exist,
                      surface the count next to the sum so the exclusion is
                      visible (the sum has already filtered them out). */}
                  Sum of OCR amounts (USD): ${ocrSum.toFixed(2)}
                  {duplicateCount > 0 && (
                    <span className="ml-1 text-theme-text-faint">
                      (excludes {duplicateCount} duplicate{duplicateCount === 1 ? '' : 's'})
                    </span>
                  )}
                  {canEditReceipts && (
                    <span className="block mt-1 text-theme-text-faint">
                      Editing a receipt's OCR amount or currency here updates the document only —
                      use the Edit Amount affordance on the payment itself to change the final USD total.
                      Changing the currency re-runs FX automatically using the receipt's original amount.
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Payout target */}
            <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface text-sm space-y-1">
              <h3 className="font-semibold text-theme-text mb-1">
                {payout.payoutMethod
                  ? PAYOUT_METHOD_LABELS[payout.payoutMethod]
                  : 'Payment method not set'}
              </h3>
              {/* arugula-38633 v3 follow-up: when method is null, the host
                  submitted before configuring their PaymentDetailsCard.
                  Admin should ask them to set it (or PATCH the payout). */}
              {payout.payoutMethod == null && (
                <div className="text-xs text-amber-700">
                  Host has not configured their payment details yet. Ask them to set their
                  payment method, or edit this payment via the actions menu before executing.
                </div>
              )}
              {payout.payoutMethod === 'usdc_base' && payout.payoutWalletAddress && (
                <div className="font-mono text-xs break-all text-theme-text-secondary">
                  {/* caciotta-92104: when the host typed an ENS name, show
                      "name.eth -> 0xa1b2…" so admins see both the input and
                      the canonical on-chain destination. */}
                  {payout.payoutWalletInput &&
                  payout.payoutWalletInput.toLowerCase() !== payout.payoutWalletAddress.toLowerCase() ? (
                    <>
                      {payout.payoutWalletInput}
                      <span className="text-theme-text-muted"> → </span>
                      {payout.payoutWalletAddress}
                    </>
                  ) : (
                    payout.payoutWalletAddress
                  )}
                </div>
              )}
              {payout.payoutMethod === 'wire' && payout.payoutBankDetails && (
                <pre className="text-xs text-theme-text-secondary whitespace-pre-wrap font-mono">
                  {JSON.stringify(payout.payoutBankDetails, null, 2)}
                </pre>
              )}
              {payout.payoutMethod === 'mercury_card' && (
                <div className="text-xs text-theme-text-secondary">
                  {payout.mercuryCardLast4
                    ? `Card issued — ending in ••••${payout.mercuryCardLast4}`
                    : 'No card issued yet — issue via Mercury dashboard, then mark paid with the last 4.'}
                </div>
              )}
            </div>

            {/* focaccia-92104: Payment proof — demoted from its prior status
                as a top-level "Payment-app photos" gallery on the left. These
                are the kind=pizza PayoutDocument screenshots (proof-of-
                payment app evidence), so they belong next to the payment
                method/target rather than the party photos. */}
            {pizzas.length > 0 && (
              <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface">
                <h3 className="text-sm font-semibold text-theme-text mb-2">
                  Payment proof ({pizzas.length})
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {pizzas.map((doc, idx) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => setLightboxIndex(idx)}
                      className="relative aspect-square rounded-lg overflow-hidden border border-theme-stroke group"
                      title={doc.fileName}
                    >
                      {isVideoFile(doc) ? (
                        <>
                          <video
                            src={doc.url}
                            preload="metadata"
                            muted
                            playsInline
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="bg-black/50 rounded-full p-3">
                              <Play className="text-white" size={20} fill="white" />
                            </div>
                          </div>
                        </>
                      ) : (
                        <img src={doc.url} alt={doc.fileName} className="w-full h-full object-cover" loading="lazy" />
                      )}
                      <span className="absolute top-1 left-1 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-500 text-white">
                        pizza
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Host notes */}
            {payout.hostNotes && (
              <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface text-sm">
                <h3 className="font-semibold text-theme-text mb-1">Host notes</h3>
                <p className="text-theme-text-secondary whitespace-pre-wrap">{payout.hostNotes}</p>
              </div>
            )}

            {/* External proof (arugula-38633 v2 follow-up) — visible for any
                payout that has an externalProofUrl set, regardless of status. */}
            {payout.externalProofUrl && (
              <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface text-sm">
                <h3 className="font-semibold text-theme-text mb-1">External proof</h3>
                <a
                  href={payout.externalProofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-theme-text-secondary hover:underline break-all"
                >
                  {payout.externalProofUrl}
                  <ExternalLink size={12} />
                </a>
              </div>
            )}

            {/* Admin notes (editable) */}
            <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface">
              <h3 className="font-semibold text-theme-text mb-2 text-sm">Admin notes</h3>
              <IconInput
                icon={Pencil}
                multiline
                rows={3}
                placeholder="Internal notes (visible to admins only)"
                value={adminNotes}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                  setAdminNotes(e.target.value);
                  setAdminNotesDirty(true);
                }}
              />
              {adminNotesDirty && (
                <button
                  type="button"
                  onClick={async () => {
                    await onSaveAdminNotes(adminNotes);
                    setAdminNotesDirty(false);
                  }}
                  disabled={busy || selfPayoutBlocked}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-[#E52828] text-white text-xs disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Save notes'}
                </button>
              )}
            </div>

            {/* Status timeline */}
            <div className="rounded-xl border border-theme-stroke p-3 bg-theme-surface">
              <h3 className="font-semibold text-theme-text mb-2 text-sm">Audit trail</h3>
              <ul className="space-y-1.5 text-xs">
                {payout.audits.length === 0 && (
                  <li className="text-theme-text-faint">No audit entries.</li>
                )}
                {payout.audits.map((a) => (
                  <AuditEntry key={a.id} entry={a} />
                ))}
              </ul>
            </div>

            {/* Receipts for already-paid payouts */}
            {isPaid && (
              <div className="rounded-xl border border-emerald-300 p-3 bg-emerald-50 text-sm">
                <h3 className="font-semibold text-emerald-900 mb-1">Payment receipt</h3>
                {payout.transactionHash && (
                  <a
                    href={`https://basescan.org/tx/${payout.transactionHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-800 hover:underline break-all"
                  >
                    {payout.transactionHash}
                    <ExternalLink size={12} />
                  </a>
                )}
                {payout.wireReference && (
                  <div className="text-emerald-800">Wire reference: {payout.wireReference}</div>
                )}
                {payout.mercuryCardLast4 && (
                  <div className="text-emerald-800">
                    Mercury card ••••{payout.mercuryCardLast4}
                    {payout.mercuryCardId && <span className="text-emerald-700/70 ml-2">id: {payout.mercuryCardId}</span>}
                  </div>
                )}
                {payout.externalProofUrl && (
                  <a
                    href={payout.externalProofUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-800 hover:underline break-all"
                  >
                    External proof: {payout.externalProofUrl}
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            )}

            {/* Reject form */}
            {showRejectForm && (
              <div className="rounded-xl border border-red-300 p-3 bg-red-50 text-sm">
                <h3 className="font-semibold text-red-900 mb-2">Reject this payment</h3>
                <IconInput
                  icon={X}
                  multiline
                  rows={2}
                  placeholder="Reason (shown to host)"
                  value={rejectReason}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRejectReason(e.target.value)}
                />
                {/* gouda-92103: silent-removal ack. UNCHECKED by default so
                    today's notify-on-reject contract holds. Ticking forwards
                    `silent: true` to onReject → API; backend appends [silent]
                    to the audit note and skips any host-notify side effect. */}
                <div className="mt-2">
                  <Checkbox
                    checked={rejectSilent}
                    onChange={() => setRejectSilent((v) => !v)}
                    label="Don't notify host"
                    labelClassName="text-sm text-red-900"
                    disabled={busy}
                  />
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!rejectReason.trim()) return;
                      await onReject(rejectReason.trim(), { silent: rejectSilent });
                      setShowRejectForm(false);
                      setRejectReason('');
                      setRejectSilent(false);
                    }}
                    // parmigiana-92104: Reject is still a reimbursement action
                    // (the host gets notified the org isn't paying), so gate it
                    // behind the SWC Hub ack too.
                    disabled={busy || !rejectReason.trim() || swcBlocked}
                    className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs disabled:opacity-50"
                  >
                    Confirm reject
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRejectForm(false);
                      setRejectSilent(false);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs text-theme-text-secondary hover:bg-theme-surface-hover"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Execute payout form (PR 5) */}
            {showExecuteForm && (
              <div className="rounded-xl border border-emerald-300 p-3 bg-emerald-50 text-sm space-y-2">
                <h3 className="font-semibold text-emerald-900 mb-1">Execute payment</h3>

                {/* arugula-38633 v3 follow-up: when host submitted without
                    setting a method, execute is blocked until admin (or host)
                    fills it in. The server returns MISSING_PAYOUT_METHOD. */}
                {payout.payoutMethod == null && (
                  <div className="rounded-md bg-amber-100 border border-amber-300 px-3 py-2 text-amber-900">
                    No payment method is set on this payout. Ask the host to set their payment
                    details, or edit this payment to set the method directly, before executing.
                  </div>
                )}

                {/* salame-92103: per-party cap warning. Surfaces when the
                    proposed payment would push this party past its effective
                    reimbursement cap (e.g. a $135 cap already covered by a
                    $125 prepayment with $10 remaining can't take another $135
                    without an explicit acknowledgement). Mirrors the per-
                    address cap pattern (bianco-89172) — amber panel + ack
                    Checkbox + Execute button disabled until ticked. Method-
                    agnostic; the server-side check fires for usdc / wire /
                    mercury_card alike. */}
                {partyWouldExceedCap && partyCap != null && (
                  // ricotta-92103: amber values (text-amber-200/100/300) read
                  // fine on dark `.card` backgrounds but wash out on gpp-theme,
                  // where `.gpp-theme .card { background: rgba(255,255,255,.92)
                  // !important }` repaints the panel white. Override to dark
                  // amber under `.gpp-theme` via Tailwind arbitrary variants.
                  // See architecture_gpp_theme_text_white_override + screenshot
                  // 2026-05-29 (/payments/latam cap-warning unreadable).
                  <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/10">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="text-amber-300 [.gpp-theme_&]:text-amber-700 mt-0.5 flex-shrink-0" size={16} />
                      <div className="flex-1 text-sm">
                        <div className="font-medium text-amber-200 [.gpp-theme_&]:text-amber-900 mb-1">
                          Per-party cap warning
                        </div>
                        <div className="text-theme-text-secondary [.gpp-theme_&]:text-amber-900 text-xs">
                          This payment exceeds the party's ${partyCap.toFixed(2)} cap by{' '}
                          <b>${partyOverBy.toFixed(2)}</b>{' '}
                          (remaining: ${(partyCapRemaining ?? 0).toFixed(2)}).
                        </div>
                        <div className="mt-3">
                          <Checkbox
                            checked={overridePartyCap}
                            onChange={() => setOverridePartyCap((v) => !v)}
                            label="I acknowledge — proceed anyway"
                            labelClassName="text-sm text-amber-100 [.gpp-theme_&]:text-amber-900"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {payout.payoutMethod === 'usdc_base' && (
                  <div className="space-y-2">
                    <p className="text-emerald-900">
                      Send <strong>{formatUsd(Number(payout.finalAmountUsd))}</strong> USDC on Base to:
                    </p>
                    <p className="font-mono text-xs break-all text-emerald-900/80 bg-white/50 px-2 py-1.5 rounded">
                      {/* caciotta-92104: render ENS -> 0x when input differs
                          from the canonical 0x so admins see the human-readable
                          name AND the on-chain destination before executing. */}
                      {payout.payoutWalletAddress
                        ? payout.payoutWalletInput &&
                          payout.payoutWalletInput.toLowerCase() !== payout.payoutWalletAddress.toLowerCase()
                          ? `${payout.payoutWalletInput} → ${payout.payoutWalletAddress}`
                          : payout.payoutWalletAddress
                        : '(no address set — cannot execute)'}
                    </p>
                    <div className="text-xs text-emerald-800">
                      {usdcCapLoading ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 size={10} className="animate-spin" /> Checking daily cap…
                        </span>
                      ) : usdcCap ? (
                        <>
                          Daily cap remaining: <strong>{formatUsd(usdcCap.remainingUsd)}</strong>{' '}
                          (${usdcCap.usedUsd.toFixed(2)} used of ${usdcCap.capUsd.toFixed(2)} in last 24h)
                        </>
                      ) : (
                        <span className="text-emerald-800/70">Daily cap status unavailable.</span>
                      )}
                    </div>
                    {/* bianco-89172: per-address $676 cap warning. Only shown
                        when the proposed send would push the recipient's
                        cumulative paid total past the cap. The admin must
                        explicitly tick the override checkbox; until they do,
                        the Send button below is disabled. */}
                    {walletPaidLoading && (
                      <div className="text-xs text-emerald-800/80 inline-flex items-center gap-1">
                        <Loader2 size={10} className="animate-spin" /> Checking per-address total…
                      </div>
                    )}
                    {!walletPaidLoading && walletPaidTotal?.wouldExceed && payout.payoutWalletAddress && (
                      // ricotta-92103: same gpp-theme contrast fix as the
                      // per-party warning above. Bumps amber text to dark
                      // shades under `.gpp-theme` where the panel paints white.
                      <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/10">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle className="text-amber-300 [.gpp-theme_&]:text-amber-700 mt-0.5 flex-shrink-0" size={16} />
                          <div className="flex-1 text-sm">
                            <div className="font-medium text-amber-200 [.gpp-theme_&]:text-amber-900 mb-1">
                              Per-address cap warning
                            </div>
                            <div className="text-theme-text-secondary [.gpp-theme_&]:text-amber-900 text-xs">
                              Wallet{' '}
                              <code className="font-mono text-[11px]">
                                {payout.payoutWalletAddress.slice(0, 6)}…{payout.payoutWalletAddress.slice(-4)}
                              </code>{' '}
                              has already received{' '}
                              <b>${walletPaidTotal.paidUsd.toFixed(2)}</b>{' '}
                              across {walletPaidTotal.paidCount} payout
                              {walletPaidTotal.paidCount === 1 ? '' : 's'}. Sending{' '}
                              <b>${Number(payout.finalAmountUsd).toFixed(2)}</b> would push the total to{' '}
                              <b>
                                ${(walletPaidTotal.paidUsd + Number(payout.finalAmountUsd)).toFixed(2)}
                              </b>
                              , exceeding the ${walletPaidTotal.capUsd} per-address cap.
                            </div>
                            <div className="mt-3">
                              <Checkbox
                                checked={overrideCap}
                                onChange={() => setOverrideCap((v) => !v)}
                                label="I acknowledge — proceed anyway"
                                labelClassName="text-sm text-amber-100 [.gpp-theme_&]:text-amber-900"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {payout.payoutMethod === 'wire' && (
                  <div className="space-y-2">
                    <p className="text-emerald-900">
                      Confirm that the {formatUsd(Number(payout.finalAmountUsd))} wire has been sent
                      out-of-band, then enter the wire reference number for the audit trail.
                    </p>
                    <IconInput
                      icon={Pencil}
                      placeholder="Wire reference number (required)"
                      value={execWireRef}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExecWireRef(e.target.value)}
                    />
                  </div>
                )}

                {payout.payoutMethod === 'mercury_card' && (
                  <div className="space-y-2">
                    <p className="text-emerald-900">
                      Confirm that the {formatUsd(Number(payout.finalAmountUsd))} Mercury virtual card
                      has been issued via the Mercury dashboard, then record the last 4 digits below.
                    </p>
                    <IconInput
                      icon={Pencil}
                      placeholder="Card last 4 digits (required, exactly 4 numbers)"
                      value={execCardLast4}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setExecCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))
                      }
                      inputMode="numeric"
                      maxLength={4}
                    />
                    <IconInput
                      icon={Pencil}
                      placeholder="Mercury card id (optional)"
                      value={execCardId}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExecCardId(e.target.value)}
                    />
                  </div>
                )}

                {payout.payoutMethod !== 'usdc_base' && (
                  <IconInput
                    icon={Pencil}
                    placeholder="Note (optional)"
                    value={execNote}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExecNote(e.target.value)}
                  />
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      if (payout.payoutMethod === 'wire' && !execWireValid) return;
                      if (payout.payoutMethod === 'mercury_card' && !execMercuryValid) return;
                      if (payout.payoutMethod === 'usdc_base' && !payout.payoutWalletAddress) return;
                      // bianco-89172: block submit if the per-address cap would
                      // exceed and the admin hasn't ticked the override.
                      if (
                        payout.payoutMethod === 'usdc_base' &&
                        walletPaidTotal?.wouldExceed &&
                        !overrideCap
                      ) {
                        return;
                      }
                      // salame-92103: block submit if the per-party cap would
                      // exceed and the admin hasn't ticked the override.
                      if (partyWouldExceedCap && !overridePartyCap) {
                        return;
                      }
                      await onExecute({
                        wireReference: payout.payoutMethod === 'wire' ? execWireRef.trim() : undefined,
                        mercuryCardLast4:
                          payout.payoutMethod === 'mercury_card' ? execCardLast4.trim() : undefined,
                        mercuryCardId:
                          payout.payoutMethod === 'mercury_card' && execCardId.trim()
                            ? execCardId.trim()
                            : undefined,
                        note: execNote.trim() || undefined,
                        // bianco-89172: forward the admin's acknowledgement so
                        // the server bypasses its own per-address cap check.
                        allowOverPerAddressCap:
                          payout.payoutMethod === 'usdc_base' && walletPaidTotal?.wouldExceed
                            ? overrideCap
                            : undefined,
                        // salame-92103: forward the admin's acknowledgement so
                        // the server bypasses its own per-party cap check + adds
                        // `[override: party cap]` to the audit row's note.
                        allowOverPartyCap: partyWouldExceedCap ? overridePartyCap : undefined,
                      });
                      setShowExecuteForm(false);
                    }}
                    disabled={
                      busy ||
                      payout.payoutMethod == null ||
                      (payout.payoutMethod === 'wire' && !execWireValid) ||
                      (payout.payoutMethod === 'mercury_card' && !execMercuryValid) ||
                      (payout.payoutMethod === 'usdc_base' && !payout.payoutWalletAddress) ||
                      // bianco-89172: disabled until ack when the cap would exceed.
                      (payout.payoutMethod === 'usdc_base' &&
                        !!walletPaidTotal?.wouldExceed &&
                        !overrideCap) ||
                      // salame-92103: disabled until ack when the per-party cap would exceed.
                      (partyWouldExceedCap && !overridePartyCap) ||
                      // parmigiana-92104: disabled until ack when the party is an SWC Hub
                      // party (reimbursement should be processed via SWC, not rsv.pizza).
                      swcBlocked
                    }
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {busy && <Loader2 size={12} className="animate-spin" />}
                    {payout.payoutMethod == null ? 'Method not set' :
                      payout.payoutMethod === 'usdc_base' ? 'Send Payment' :
                      payout.payoutMethod === 'wire' ? 'Confirm wire sent' :
                      'Confirm card issued'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowExecuteForm(false)}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg text-xs text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Mark paid form */}
            {showMarkPaidForm && (
              <div className="rounded-xl border border-blue-300 p-3 bg-blue-50 text-sm space-y-2">
                <h3 className="font-semibold text-blue-900 mb-1">Mark as paid (manual)</h3>
                {payout.payoutMethod === 'wire' && (
                  <IconInput
                    icon={Pencil}
                    placeholder="Wire reference number"
                    value={wireRef}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWireRef(e.target.value)}
                  />
                )}
                {payout.payoutMethod === 'usdc_base' && (
                  <IconInput
                    icon={Pencil}
                    placeholder="Transaction hash (0x...)"
                    value={txHash}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTxHash(e.target.value)}
                  />
                )}
                {payout.payoutMethod === 'mercury_card' && (
                  <>
                    <IconInput
                      icon={Pencil}
                      placeholder="Card last 4 digits"
                      value={cardLast4}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCardLast4(e.target.value)}
                    />
                    <IconInput
                      icon={Pencil}
                      placeholder="Mercury card id (optional)"
                      value={cardId}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCardId(e.target.value)}
                    />
                  </>
                )}
                <IconInput
                  icon={Pencil}
                  placeholder="Note (optional)"
                  value={paidNote}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPaidNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await onMarkPaid({
                        wireReference: wireRef.trim() || undefined,
                        transactionHash: txHash.trim() || undefined,
                        mercuryCardLast4: cardLast4.trim() || undefined,
                        mercuryCardId: cardId.trim() || undefined,
                        note: paidNote.trim() || undefined,
                      });
                      setShowMarkPaidForm(false);
                    }}
                    // parmigiana-92104: also gate the inner "Confirm" in the
                    // Mark paid form so a stale ack flip between the outer
                    // button and this confirmation doesn't slip past the SWC
                    // Hub warning.
                    disabled={busy || swcBlocked}
                    className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMarkPaidForm(false)}
                    className="px-3 py-1.5 rounded-lg text-xs text-theme-text-secondary hover:bg-theme-surface-hover"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Footer actions */}
        <div className="border-t border-theme-stroke px-5 py-3 flex items-center gap-2 flex-wrap bg-theme-surface">
          {isPending && (
            <>
              <button
                type="button"
                onClick={() => onApprove()}
                disabled={busy || selfPayoutBlocked || swcBlocked}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Approve
              </button>
              <button
                type="button"
                onClick={() => setShowRejectForm(true)}
                disabled={busy || selfPayoutBlocked || swcBlocked}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium disabled:opacity-50"
              >
                <X size={14} />
                Reject
              </button>
            </>
          )}
          {isApproved && (
            <>
              {/* caprino-92103: revert approved -> pending. Only surfaced
                  when status is strictly 'approved' (not 'failed') and the
                  parent wired an onUnapprove handler. Placed first so it
                  sits visually distinct from the primary actions (Execute,
                  Mark Paid) that follow. Amber border to signal "reverse
                  course". No confirm modal — reversible action per project
                  convention (re-approve restores the prior state). */}
              {payout.status === 'approved' && onUnapprove && (
                <button
                  type="button"
                  onClick={async () => {
                    setUnapproveError(null);
                    const err = await onUnapprove();
                    if (typeof err === 'string' && err) {
                      setUnapproveError(err);
                    }
                  }}
                  disabled={busy || selfPayoutBlocked}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-amber-500/50 text-amber-300 hover:bg-amber-500/10 text-sm font-medium disabled:opacity-50"
                  title="Move this payout back to pending"
                >
                  <Undo2 size={14} />
                  Revert to Pending
                </button>
              )}
              {/* argentina-92103: Execute + Mark-paid are admin-only — they
                  send funds. Underbosses can still flag-ready (rendered below
                  in the shared block) but cannot run the funds operations. */}
              {isAdminViewer && (
                <>
                  <button
                    type="button"
                    onClick={openExecuteForm}
                    disabled={busy || selfPayoutBlocked || showExecuteForm || swcBlocked}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
                  >
                    <Send size={14} />
                    {isFailed ? 'Retry Payment' : 'Execute Payment'}
                  </button>
                  {/* gnocchi-92104: Mark queued — flips approved -> queued
                      (wire request sent, awaiting settlement). Click 1 = arm
                      confirm; click 2 = fire. Only on strictly-approved (not
                      failed) rows; admin-only. Amber to signal "money's
                      committed and moving" without claiming it's settled. */}
                  {payout.status === 'approved' && onMarkQueued && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!markQueuedConfirming) {
                          setMarkQueuedConfirming(true);
                          return;
                        }
                        setMarkQueuedError(null);
                        const err = await onMarkQueued();
                        setMarkQueuedConfirming(false);
                        if (typeof err === 'string' && err) {
                          setMarkQueuedError(err);
                        }
                      }}
                      disabled={busy || selfPayoutBlocked}
                      className={
                        markQueuedConfirming
                          ? 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium disabled:opacity-50'
                          : 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500/80 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50'
                      }
                      title={
                        markQueuedConfirming
                          ? 'Click again to confirm — signals the wire request has been sent but not settled yet'
                          : 'Mark queued — the wire request has been sent but not settled yet'
                      }
                    >
                      <Send size={14} />
                      {markQueuedConfirming ? 'Click again to confirm' : 'Mark queued'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowMarkPaidForm(true)}
                    disabled={busy || selfPayoutBlocked || swcBlocked}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
                  >
                    <DollarSign size={14} />
                    Mark paid (manual)
                  </button>
                </>
              )}
            </>
          )}
          {/* gnocchi-92104: queued payout cluster — wire request sent,
              awaiting settlement. Mark paid (manual) confirms settlement;
              Un-queue reverts back to approved. Admin-only — same gate as
              the approved-row primary actions. */}
          {isQueued && isAdminViewer && (
            <>
              {onUnmarkQueued && (
                <button
                  type="button"
                  onClick={async () => {
                    setUnmarkQueuedError(null);
                    const err = await onUnmarkQueued();
                    if (typeof err === 'string' && err) {
                      setUnmarkQueuedError(err);
                    }
                  }}
                  disabled={busy || selfPayoutBlocked}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-amber-500/50 text-amber-300 hover:bg-amber-500/10 text-sm font-medium disabled:opacity-50"
                  title="Move this payout back to approved (cancels the queued state)"
                >
                  <Undo2 size={14} />
                  Un-queue
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowMarkPaidForm(true)}
                disabled={busy || selfPayoutBlocked}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
                title="Confirm the wire settled and flip to paid"
              >
                <DollarSign size={14} />
                Mark paid (settled)
              </button>
            </>
          )}
          {isClosed && onReopen && (
            <button
              type="button"
              onClick={() => onReopen()}
              disabled={busy || selfPayoutBlocked}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-theme-surface-hover hover:bg-theme-stroke text-theme-text text-sm font-medium disabled:opacity-50"
            >
              <RefreshCw size={14} />
              Re-open
            </button>
          )}
          {/* culatello-92103: revert paid -> approved. Surfaced for ANY
              payout method (USDC, wire, mercury_card, external,
              off-platform) — previously the only "undo" affordance lived on
              `approved` rows. Click 1 = arm confirm; click 2 = fire.
              Confirms are unusual on reversible actions per project
              convention, but this one drops the historical mark-paid record
              (paidAt + tx metadata cleared) so a misclick is undesirable.
              Audit trail is preserved either way. Admin-only — gated on
              isAdminViewer to match mark-paid's own permission. */}
          {isPaid && isAdminViewer && onRevertPaid && (
            <button
              type="button"
              onClick={async () => {
                if (!revertPaidConfirming) {
                  setRevertPaidConfirming(true);
                  return;
                }
                setRevertPaidError(null);
                const err = await onRevertPaid();
                setRevertPaidConfirming(false);
                if (typeof err === 'string' && err) {
                  setRevertPaidError(err);
                }
              }}
              disabled={busy || selfPayoutBlocked}
              className={
                revertPaidConfirming
                  ? 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium disabled:opacity-50'
                  : 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-amber-500/50 text-amber-300 hover:bg-amber-500/10 text-sm font-medium disabled:opacity-50'
              }
              title={
                revertPaidConfirming
                  ? 'Click again to confirm — clears paidAt + tx metadata'
                  : 'Move this paid payout back to approved (clears paidAt + tx metadata)'
              }
            >
              <Undo2 size={14} />
              {revertPaidConfirming ? 'Click again to confirm' : 'Revert to Approved'}
            </button>
          )}
          {/* tiramisu-49102: Pay-again button. Surfaced only when status is
              paid AND we have enough to pre-fill the CreatePrepaymentModal —
              i.e. a method is set, and (for USDC) a wallet, or (for wire) a
              bank email. Mercury-card replays only need the host + party.
              Parent handler builds a synthetic PrepayQueueRow and opens the
              modal. */}
          {isPaid && onPayAgain && payout.host?.id && payout.host?.email && payout.payoutMethod && (() => {
            const m = payout.payoutMethod;
            const eligible =
              (m === 'usdc_base' && !!payout.payoutWalletAddress) ||
              (m === 'wire' &&
                payout.payoutBankDetails &&
                typeof (payout.payoutBankDetails as any).email === 'string' &&
                ((payout.payoutBankDetails as any).email as string).trim().length > 0) ||
              m === 'mercury_card';
            if (!eligible) return null;
            const label =
              m === 'usdc_base'
                ? 'Pay again to this wallet'
                : 'Send another payment';
            return (
              <button
                type="button"
                onClick={() => onPayAgain(payout)}
                // parmigiana-92104: Pay-again issues a new reimbursement to the
                // same wallet — gate behind the SWC Hub ack like every other
                // outbound reimbursement action.
                disabled={busy || selfPayoutBlocked || swcBlocked}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
              >
                <Repeat2 size={14} />
                {label}
              </button>
            );
          })()}
          {/* argentina-92103: Flag ready for payment. Visible for both UB
              and admin (admins can pre-flag a row so the payments-team
              channel surfaces it as a to-do). Hidden once the row is in
              a terminal state (paid / rejected / withdrawn / completed) —
              the backend would 400 in that case anyway. Renders sticky-
              green "Flagged" pill instead when already flagged so the actor
              doesn't double-fire notifications. */}
          {onFlagReady &&
            !isPaid &&
            !isClosed &&
            payout.status !== 'withdrawn' &&
            payout.status !== 'completed' &&
            // gnocchi-92104: don't surface flag-ready on queued rows — the
            // payments team has already taken visible action (wire sent), so
            // re-flagging is a stale signal. Backend also 400s in this case.
            payout.status !== 'queued' && (
            payout.flaggedReady ? (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-sm font-medium"
                title={
                  `Flagged ready` +
                  (payout.flaggedReadyBy ? ` by ${payout.flaggedReadyBy}` : '') +
                  (payout.flaggedReadyAt
                    ? ` on ${new Date(payout.flaggedReadyAt).toLocaleString()}`
                    : '')
                }
              >
                <Flag size={14} />
                Flagged ready
              </span>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  setFlagReadyError(null);
                  const err = await onFlagReady();
                  if (typeof err === 'string' && err) {
                    setFlagReadyError(err);
                  }
                }}
                disabled={busy || selfPayoutBlocked}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
                title="Notify the payments team that this payout is ready to be paid"
              >
                <Flag size={14} />
                Flag ready for payment
              </button>
            )
          )}
          {/* panettone-92103: party-level "Mark party paid" — flips every
              in-flight payout on this payout's party to paid in one
              transaction. Less-prominent (border + dim text) so it sits
              behind the per-row primary actions; admin-only. The modal
              fetches its own preview (count + total) on open. */}
          {isAdminViewer && onMarkPartyPaid && (
            <button
              type="button"
              onClick={onMarkPartyPaid}
              // parmigiana-92104: party-level mark-paid bulk-flips every
              // in-flight reimbursement on the city to paid — also gate behind
              // the SWC Hub ack.
              disabled={busy || selfPayoutBlocked || swcBlocked}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10 text-sm font-medium disabled:opacity-50"
              title={`Mark every in-flight payout on ${stripGppPrefix(payout.party.name)} paid (out-of-band reconciliation)`}
            >
              <Coins size={14} />
              Mark all paid for {stripGppPrefix(payout.party.name)}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-4 py-2 rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover text-sm"
          >
            Close
          </button>
          {/* caprino-92103: inline error for Revert. Takes full row width
              below the buttons via w-full on the wrapping flex container's
              flex-wrap. Surfaces backend NOT_APPROVED + any network failure. */}
          {unapproveError && (
            <div className="w-full mt-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/40 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{unapproveError}</span>
            </div>
          )}
          {/* culatello-92103: inline error for Revert-paid. Surfaces backend
              NOT_PAID + network failure. */}
          {revertPaidError && (
            <div className="w-full mt-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/40 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{revertPaidError}</span>
            </div>
          )}
          {/* gnocchi-92104: inline errors for Mark queued + Un-queue. Same
              red-500 pattern as unapprove/revert-paid above. */}
          {markQueuedError && (
            <div className="w-full mt-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/40 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{markQueuedError}</span>
            </div>
          )}
          {unmarkQueuedError && (
            <div className="w-full mt-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/40 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{unmarkQueuedError}</span>
            </div>
          )}
          {/* argentina-92103: inline error for Flag-ready. Same pattern
              as unapproveError above. */}
          {flagReadyError && (
            <div className="w-full mt-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/40 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{flagReadyError}</span>
            </div>
          )}
        </div>
      </div>

      {/* bresaola-89172: shared ReceiptLightbox renders into document.body
          via createPortal, so it isn't clipped by the modal's overflow. It
          owns its own Esc + arrow-key handlers and the HEIC fallback.
          focaccia-92104: `allPhotos` order is pizzas (Payment proof) →
          receipts → pizzaPhotos → eventPhotos so arrow-key nav crosses
          sections in the same order they're rendered.
          pesto-92104: when admin opens a RECEIPT thumbnail the lightbox
          renders a 2-pane layout — photo on the left, ReceiptEditor on
          the right — so amount / currency / line items / duplicate can be
          edited without leaving the photo view. Event/pizza photos and
          non-admin viewers get the plain photo-only lightbox. */}
      <ReceiptLightbox
        isOpen={lightboxIndex != null}
        images={allPhotos}
        initialIndex={lightboxIndex ?? 0}
        onClose={() => {
          setLightboxIndex(null);
          setLightboxCurrentIndex(null);
        }}
        onIndexChange={setLightboxCurrentIndex}
        editorPane={lightboxEditorPane}
        onBeforeNavigate={lightboxOnBeforeNavigate}
        onDuplicateShortcut={lightboxOnDuplicateShortcut}
        /* coppa-92105: paint the lightbox photo pane with a DUPLICATE banner +
            diagonal-stripe overlay when the focused image is an admin-marked
            duplicate. Only fires for the receipt bucket because lightboxReceipt
            is null when navigating pizza/event photos. */
        isDuplicate={lightboxReceipt?.isDuplicate === true}
      />
    </div>
  );
};

const AuditEntry: React.FC<{ entry: PayoutAuditEntry }> = ({ entry }) => {
  const when = new Date(entry.createdAt).toLocaleString();
  return (
    <li className="flex items-start gap-2 text-theme-text-secondary">
      <span className="text-theme-text-faint w-32 flex-shrink-0">{when}</span>
      <span className="flex-1">
        <span className="font-medium text-theme-text">{entry.action}</span>
        {entry.oldStatus && entry.newStatus && (
          <> · {entry.oldStatus} → {entry.newStatus}</>
        )}
        {entry.oldAmount != null && entry.newAmount != null && (
          <> · ${entry.oldAmount} → ${entry.newAmount}</>
        )}
        <> by <span className="text-theme-text">{entry.actorEmail}</span></>
        {entry.note && <div className="text-theme-text-muted text-xs">{entry.note}</div>}
      </span>
    </li>
  );
};
