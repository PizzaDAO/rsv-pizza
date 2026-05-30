import React, { useEffect, useMemo, useState } from 'react';
import { X, Check, AlertTriangle, ExternalLink, Loader2, Pencil, Send, DollarSign, RefreshCw, Repeat2, Tag, Undo2, Flag, Coins, Play } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { ClickableEmail } from '../ClickableEmail';
import { updatePartyApi, updatePayoutDocument } from '../../lib/api';
import { isVideoFile } from '../../lib/mediaUtils';
import { isPdfFile, derivePdfThumbnailUrl } from '../../lib/pdfUtils';
import type { AdminPayoutDetail, PayoutAuditEntry, WalletPaidTotal } from '../../types';
import {
  PayoutStatusPill,
  PayoutMethodIcon,
  PAYOUT_METHOD_LABELS,
  formatUsd,
  formatOriginalCurrency,
  ReceiptLightbox,
} from '../payments-shared';

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

  // taralli-58291: lightbox uses an index into `allPhotos` so ArrowLeft /
  // ArrowRight can cycle through receipts + pizza photos. Hooks must be
  // declared above any early return — see feedback_hooks_above_early_returns.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // agnolotti-58291: per-receipt OCR amount + currency edit state. The modal
  // ships an inline form per receipt row (gated to full admins + payment_admin)
  // so admins can correct OCR misreads without recomputing the parent payout.
  // `receiptOverrides` is a docId -> { ocrAmount, ocrCurrency } map applied on
  // top of `payout.documents` for rendering, so the row reflects the saved
  // value immediately without waiting for a parent refresh.
  type ReceiptOverride = { ocrAmount: number | null; ocrCurrency: string | null };
  const [receiptOverrides, setReceiptOverrides] = useState<Record<string, ReceiptOverride>>({});
  // Per-row save state.
  const [receiptSavingId, setReceiptSavingId] = useState<string | null>(null);
  const [receiptSaveErrors, setReceiptSaveErrors] = useState<Record<string, string>>({});
  // Per-row drafts so admins can edit without re-typing on re-render. Drafts
  // are seeded from the original OCR value on first edit and kept until the
  // row is saved or the modal closes.
  type ReceiptDraft = { amount: string; currency: string };
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, ReceiptDraft>>({});

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
          return ov ? { ...d, ocrAmount: ov.ocrAmount, ocrCurrency: ov.ocrCurrency } : d;
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
  const eventPhotos = useMemo(
    () => payout.eventPhotos ?? [],
    [payout.eventPhotos],
  );
  // Unified lightbox carousel: payment-app pizzas → payment-app receipts →
  // event-level photos. Order matters so `lightboxIndex` from each thumbnail
  // grid resolves to the right starting image.
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
      ...eventPhotos.map((p) => ({
        url: p.url,
        fileName: p.fileName,
        mimeType: p.mimeType,
      })),
    ],
    [pizzas, receipts, eventPhotos],
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
    try {
      // Empty string -> null (clear the field). Otherwise parse as number /
      // upper-case the currency.
      const trimmedAmt = draft.amount.trim();
      const trimmedCur = draft.currency.trim();
      const patch: { ocrAmount?: number | null; ocrCurrency?: string | null } = {};
      if (trimmedAmt === '') {
        patch.ocrAmount = null;
      } else {
        const n = Number(trimmedAmt);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error('Amount must be a non-negative number');
        }
        patch.ocrAmount = n;
      }
      if (trimmedCur === '') {
        patch.ocrCurrency = null;
      } else if (trimmedCur.length > 8) {
        throw new Error('Currency must be 8 characters or fewer');
      } else {
        patch.ocrCurrency = trimmedCur.toUpperCase();
      }
      const updated = await updatePayoutDocument(docId, patch);
      setReceiptOverrides((m) => ({
        ...m,
        [docId]: {
          ocrAmount: updated.ocrAmount,
          ocrCurrency: updated.ocrCurrency,
        },
      }));
      // Sync the draft text to the canonical saved value so the inputs match
      // the rendered row on the next render.
      setReceiptDrafts((m) => ({
        ...m,
        [docId]: {
          amount: updated.ocrAmount == null ? '' : String(updated.ocrAmount),
          currency: updated.ocrCurrency ?? '',
        },
      }));
    } catch (err: any) {
      setReceiptSaveErrors((m) => ({
        ...m,
        [docId]: err?.message || 'Failed to save',
      }));
    } finally {
      setReceiptSavingId(null);
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

  const ocrSum = receipts.reduce((sum, r) => sum + (Number(r.ocrAmount) || 0), 0);

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
              bottarga-92103: split into two sections — payment-app docs (the
              original "Photos" grid) and event-level photos uploaded via the
              host Photos tab. The lightbox carousel is one merged array
              (pizzas → receipts → eventPhotos) so arrow-key nav crosses both
              sections seamlessly. */}
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-theme-text mb-2">
                Payment-app photos ({pizzas.length + receipts.length})
              </h3>
              {pizzas.length + receipts.length === 0 && (
                <p className="text-sm text-theme-text-faint">No payment-app photos attached.</p>
              )}
              <div className="grid grid-cols-3 gap-2">
                {[...pizzas, ...receipts].map((doc, idx) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setLightboxIndex(idx)}
                    className="relative aspect-square rounded-lg overflow-hidden border border-theme-stroke group"
                    title={doc.fileName}
                  >
                    {/* melanzane-92103: per bottarga-92103, hosts can attach
                        videos to payment-app pizza photos. Browsers can't
                        render `.mp4`/`.mov` via <img>, so detect video by
                        mimeType (or extension fallback for missing MIMEs) and
                        render a <video> with `preload="metadata"` so the
                        browser fetches the first frame as a poster. */}
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
                    <span
                      className={`absolute top-1 left-1 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                        doc.kind === 'receipt' ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'
                      }`}
                    >
                      {doc.kind}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-theme-text mb-2">
                Event photos ({eventPhotos.length})
              </h3>
              {eventPhotos.length === 0 ? (
                <p className="text-sm text-theme-text-faint">No event photos yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {eventPhotos.map((p, idx) => {
                    // Carousel index: event photos sit after the payment-app
                    // pizzas + receipts in the merged `allPhotos` array.
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
          </section>

          {/* Right: details */}
          <section className="space-y-4">
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
                <ul className="space-y-1.5">
                  {receipts.map((r) => {
                    const conf = r.ocrConfidence ?? 0;
                    const lowConf = conf > 0 && conf < 0.8;
                    // agnolotti-58291: capture the OCR'd values as placeholders
                    // so admins can see what the model originally returned
                    // when they're correcting the field. `original*` reflects
                    // the saved-but-not-yet-overridden value.
                    const originalAmt = payout.documents.find((d) => d.id === r.id)?.ocrAmount;
                    const originalCur = payout.documents.find((d) => d.id === r.id)?.ocrCurrency;
                    const draft = receiptDrafts[r.id];
                    const draftAmt = draft?.amount ?? (r.ocrAmount == null ? '' : String(r.ocrAmount));
                    const draftCur = draft?.currency ?? (r.ocrCurrency ?? '');
                    const dirty =
                      draftAmt !== (r.ocrAmount == null ? '' : String(r.ocrAmount)) ||
                      draftCur !== (r.ocrCurrency ?? '');
                    const saving = receiptSavingId === r.id;
                    const saveError = receiptSaveErrors[r.id];
                    return (
                      <li key={r.id} className="text-sm">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              r.ocrError ? 'bg-red-500' :
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
                                placeholder={originalAmt == null ? 'amount' : String(originalAmt)}
                                onChange={(e) =>
                                  setReceiptDrafts((m) => ({
                                    ...m,
                                    [r.id]: { amount: e.target.value, currency: draftCur },
                                  }))
                                }
                                className="w-24 px-2 py-1 rounded border border-theme-stroke bg-theme-surface text-theme-text text-xs text-right"
                              />
                              <input
                                type="text"
                                maxLength={8}
                                value={draftCur}
                                placeholder={originalCur || 'CUR'}
                                onChange={(e) =>
                                  setReceiptDrafts((m) => ({
                                    ...m,
                                    [r.id]: { amount: draftAmt, currency: e.target.value },
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
                              {conf > 0 && (
                                <span className={`text-xs ${lowConf ? 'text-amber-600' : 'text-theme-text-faint'}`}>
                                  {(conf * 100).toFixed(0)}%
                                </span>
                              )}
                            </>
                          ) : r.ocrError ? (
                            <span className="text-xs text-red-600">{r.ocrError}</span>
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
                        {canEditReceipts && r.ocrError && (
                          <div className="text-xs text-red-600 mt-0.5 ml-4">{r.ocrError}</div>
                        )}
                        {saveError && (
                          <div className="text-xs text-red-600 mt-0.5 ml-4">{saveError}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="text-xs text-theme-text-muted mt-2 border-t border-theme-stroke pt-2">
                  {/* mortadella-92103: ocrAmount is now USD (post-fix). Old
                      rows uploaded pre-mortadella may have non-USD amounts
                      stamped as USD — the backfill script corrects those. */}
                  Sum of OCR amounts (USD): ${ocrSum.toFixed(2)}
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
                    disabled={busy || !rejectReason.trim()}
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
                      (partyWouldExceedCap && !overridePartyCap)
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
                    disabled={busy}
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
                disabled={busy || selfPayoutBlocked}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Approve
              </button>
              <button
                type="button"
                onClick={() => setShowRejectForm(true)}
                disabled={busy || selfPayoutBlocked}
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
                    disabled={busy || selfPayoutBlocked || showExecuteForm}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
                  >
                    <Send size={14} />
                    {isFailed ? 'Retry Payment' : 'Execute Payment'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMarkPaidForm(true)}
                    disabled={busy || selfPayoutBlocked}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
                  >
                    <DollarSign size={14} />
                    Mark paid (manual)
                  </button>
                </>
              )}
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
                disabled={busy || selfPayoutBlocked}
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
            payout.status !== 'completed' && (
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
              disabled={busy || selfPayoutBlocked}
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
          bottarga-92103: `allPhotos` is the unified carousel — pizzas →
          receipts → event-level photos — so arrow-key nav crosses sections. */}
      <ReceiptLightbox
        isOpen={lightboxIndex != null}
        images={allPhotos}
        initialIndex={lightboxIndex ?? 0}
        onClose={() => setLightboxIndex(null)}
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
