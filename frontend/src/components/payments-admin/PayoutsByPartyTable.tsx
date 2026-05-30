import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Paperclip,
  Flag,
  CheckCircle2,
  MoreHorizontal,
  Coins,
  XCircle,
  Plus,
  ExternalLink,
  Tag,
  User as UserIcon,
  Play,
} from 'lucide-react';
import type {
  AdminPayout,
  AdminPayoutEventPhoto,
  PartyPayoutsRow,
  PayoutDocument,
  PayoutStatus,
  ReceiptLineItem,
} from '../../types';
import {
  PayoutStatusPill,
  PayoutMethodIcon,
  ReceiptLightbox,
  type ReceiptLightboxImage,
  formatUsd,
} from '../payments-shared';
import { ClickableEmail } from '../ClickableEmail';
import { isSwcHubParty } from '../../utils/swcHub';
import { isVideoFile } from '../../lib/mediaUtils';
import {
  updatePayoutDocument,
  markReceiptDuplicate,
  retryPayoutDocumentOcr,
} from '../../lib/api';
import {
  ReceiptEditor,
  lineItemToDraft,
  emptyLineItemDraft,
  type ReceiptDraft,
  type LineItemDraft,
} from './ReceiptEditor';

/**
 * ricotta-92104: split party.photos into "Pizza photos" (tag === 'Pizza' —
 * the default-tag value — or 'pizza-selfie' — the EventPage selfie tag) and
 * "Event photos" (everything else). Mirrors the focaccia-92104 split in
 * PayoutReviewModal so the by-city expansion matches the per-payout modal.
 */
function isPizzaPhoto(p: AdminPayoutEventPhoto): boolean {
  return (p.tags ?? []).some((t) => {
    const tl = t.toLowerCase();
    return tl === 'pizza' || tl === 'pizza-selfie';
  });
}

/** Max thumbnails rendered inline before the user has to hit "See all". */
const PHOTO_PREVIEW_LIMIT = 4;

/**
 * mostarda-92103: rework of the /payments by-city expanded row. Each city
 * (party) now renders as a single rolled-up panel — Receipt total + Approved
 * + Paid + Outstanding — instead of enumerating per-host claim splits. The
 * underlying per-host Payout rows still exist in the DB (audit trail, cap
 * math, salame/fontina overrides, etc. unchanged); this is a presentation
 * rework only.
 *
 * Expanded panel layout:
 *   - Hosts row (avatars + emails) — top
 *   - Tags chip strip
 *   - 4-number rollup: Receipts collected · Approved · Paid · Outstanding
 *   - Pending claims summary pill (single sum, click-to-expand)
 *   - Merged receipt grid: every receipt from every payout, sorted by date
 *     desc, click → ReceiptLightbox
 *   - Payment ledger: one row per paid/completed payout (date, USD amount,
 *     method, recipient, tx hash). Click → PayoutReviewModal for that row.
 *   - ricotta-92104: Event photos + Pizza photos preview strips (up to 4
 *     thumbs per bucket, "See all" expands inline). Click any thumb → opens
 *     the bucket's own lightbox carousel. Mirrors the focaccia-92104 split
 *     in the per-payout PayoutReviewModal.
 *   - City-level action menu: Mark city paid (or Close city) + Add external
 *     payment.
 *
 * Multi-host parties merge receipts/payments into one pot. Per-row deep-dive
 * still happens via the PayoutReviewModal (opened by clicking a ledger row
 * or a pending-claim row).
 */

interface PayoutsByPartyTableProps {
  rows: PartyPayoutsRow[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  /** Opens the per-payout review modal (same shape as PayoutsTable). */
  onRowClick: (payout: AdminPayout) => void;
  /** Per-row handlers — still wired so PayoutReviewModal stays functional. */
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (payout: AdminPayout) => void;
  onMarkPaid: (payout: AdminPayout) => void;
  onExecute: (payout: AdminPayout) => void;
  onUnapprove?: (id: string) => void;
  onHostClick?: (userId: string) => void;
  onCapUpdated?: (partyId: string) => void;
  /**
   * bocconcini-92103 / pinsa-92103: open MarkPartyPaidModal for the row's
   * party. The modal itself decides whether to flip in-flight payouts to
   * paid, close out a fully-paid city, etc. Hidden for underbosses.
   */
  onMarkPartyPaid?: (partyId: string) => void;
  /**
   * mostarda-92103: opens the Add External Payment modal pre-targeted at
   * this city. Hidden for underbosses (admins only).
   */
  onAddExternalPayment?: (partyId: string, partyName: string) => void;
  viewerRole?: 'admin' | 'underboss';
  busyRowId?: string | null;
  loading?: boolean;
}

function stripGppPrefix(name: string): string {
  return name.replace(/^Global Pizza Party\s+/i, '');
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function formatLedgerDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

function truncateMiddle(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * Returns true for payouts that "count toward Approved" — i.e. the funds are
 * committed regardless of whether the rail has settled yet. Mirrors the
 * fontina-92103 committed-cap semantics referenced in the brief.
 */
function isCommittedStatus(s: PayoutStatus): boolean {
  return s === 'approved' || s === 'paid' || s === 'completed';
}

function isPaidStatus(s: PayoutStatus): boolean {
  return s === 'paid' || s === 'completed';
}

/**
 * Builds an explorer URL for a USDC-on-Base transaction hash. Other rails
 * return null and the ledger renders a plain dash.
 */
function explorerUrlFor(method: string | null, txHash: string | null): string | null {
  if (!txHash) return null;
  if (method === 'usdc_base') {
    return `https://basescan.org/tx/${txHash}`;
  }
  return null;
}

/**
 * Pulls every receipt off the party's payouts (kind === 'receipt'), tags
 * each with the source payout's host so the merged grid can attribute
 * uploads, and sorts by createdAt desc. Multi-host parties merge here.
 */
function collectReceipts(payouts: AdminPayout[]): Array<{
  doc: PayoutDocument;
  payout: AdminPayout;
}> {
  const out: Array<{ doc: PayoutDocument; payout: AdminPayout }> = [];
  for (const p of payouts) {
    for (const d of p.documents || []) {
      if (d.kind !== 'receipt') continue;
      out.push({ doc: d, payout: p });
    }
  }
  // sortOrder is mostly per-payout, so we fall back to the parent payout's
  // createdAt + the doc's sortOrder as a deterministic tiebreaker.
  out.sort((a, b) => {
    const at = new Date(a.payout.createdAt).getTime();
    const bt = new Date(b.payout.createdAt).getTime();
    if (bt !== at) return bt - at;
    return (a.doc.sortOrder ?? 0) - (b.doc.sortOrder ?? 0);
  });
  return out;
}

/** City-row action menu — Mark paid/closed + Add external payment. */
function CityActionsMenu({
  onMarkPartyPaid,
  onAddExternalPayment,
  canMarkPaid,
  canAddExternal,
  markPaidLabel,
}: {
  onMarkPartyPaid?: () => void;
  onAddExternalPayment?: () => void;
  canMarkPaid: boolean;
  canAddExternal: boolean;
  markPaidLabel: string;
}) {
  const [open, setOpen] = useState(false);
  // No actions to show? Render nothing.
  if (!canMarkPaid && !canAddExternal) return null;

  return (
    <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-theme-stroke text-theme-text-secondary hover:bg-theme-surface-hover text-xs font-medium"
        title="City actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={14} />
        Actions
      </button>
      {open && (
        <>
          {/* click-out overlay */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute right-0 mt-1 w-56 z-50 rounded-lg border border-theme-stroke bg-theme-surface shadow-lg py-1"
            role="menu"
          >
            {canMarkPaid && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onMarkPartyPaid?.();
                }}
                className="w-full text-left px-3 py-2 text-sm text-theme-text hover:bg-theme-surface-hover flex items-center gap-2"
              >
                <Coins size={14} className="text-emerald-500" />
                {markPaidLabel}
              </button>
            )}
            {canAddExternal && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onAddExternalPayment?.();
                }}
                className="w-full text-left px-3 py-2 text-sm text-theme-text hover:bg-theme-surface-hover flex items-center gap-2"
              >
                <Plus size={14} className="text-sky-500" />
                Add external payment
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Expanded panel — rendered inside a single full-width cell under the city
 * row. Owns its own local state for the lightbox + the "show pending claim
 * list" toggle.
 *
 * pesto-92105: when the viewer is an admin AND a receipt thumbnail is opened
 * in the lightbox, the lightbox renders the shared ReceiptEditor in its right
 * pane so amount / currency / line items / duplicate can be edited without
 * leaving the photo view. Mirrors the pesto-92104 wiring in
 * PayoutReviewModal but using receipt-edit state local to this expansion —
 * the save handlers PATCH the same `/api/admin/payouts/documents/:docId`
 * endpoint, and a per-doc `receiptOverrides` map mirrors the saved values so
 * the merged receipt grid + USD rollup update immediately without a full
 * by-party refetch.
 */
function CityExpansion({
  row,
  selectedIds,
  onToggleSelect,
  onRowClick,
  busyRowId,
  canEditReceipts,
}: {
  row: PartyPayoutsRow;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onRowClick: (payout: AdminPayout) => void;
  busyRowId?: string | null;
  /**
   * pesto-92105: gates the in-lightbox receipt editor. True for admin /
   * super_admin / payment_admin (`viewerRole === 'admin'`); underbosses get
   * the plain photo-only lightbox.
   */
  canEditReceipts: boolean;
}) {
  // Hooks-above-early-returns: all useState / useMemo / useCallback live up
  // front so adding a conditional return below can't change hook order.
  // Hooks first — never below a conditional return. (feedback_hooks_above_early_returns)
  //
  // ricotta-92104: the lightbox now serves three distinct buckets (receipts,
  // event photos, pizza photos) instead of just receipts. The state tracks
  // which bucket is active alongside the index so opening a thumbnail in one
  // section doesn't bleed images from another into the carousel.
  const [lightbox, setLightbox] = useState<{
    bucket: 'receipt' | 'event' | 'pizza';
    index: number;
  } | null>(null);
  const [showPendingClaims, setShowPendingClaims] = useState(false);

  // pesto-92105: per-receipt edit state. Mirrors the agnolotti-58291 /
  // taralli-92104 / culatello-92104 state on PayoutReviewModal but local to
  // this expansion. `receiptOverrides` is applied on top of the docs pulled
  // off `row.payouts` so the merged receipt grid + USD rollup reflect a save
  // immediately without re-fetching `/admin/payouts/by-party`. The lightbox
  // tracks which receipt is currently displayed via `lightboxCurrentIndex`
  // (index into the receipt-bucket carousel; we derive the doc from it in a
  // memo below).
  type ReceiptOverride = {
    ocrAmount: number | null;
    ocrCurrency: string | null;
    ocrLineItems?: ReceiptLineItem[] | null;
    isDuplicate?: boolean;
  };
  const [receiptOverrides, setReceiptOverrides] = useState<Record<string, ReceiptOverride>>({});
  // Amount/currency drafts (string-typed so admins can type freely).
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, ReceiptDraft>>({});
  const [receiptSavingId, setReceiptSavingId] = useState<string | null>(null);
  const [receiptSaveErrors, setReceiptSaveErrors] = useState<Record<string, string>>({});
  // Mark-duplicate state.
  const [duplicateSavingId, setDuplicateSavingId] = useState<string | null>(null);
  const [duplicateSaveErrors, setDuplicateSaveErrors] = useState<Record<string, string>>({});
  // Line-item editor state.
  const [lineItemDrafts, setLineItemDrafts] = useState<Record<string, LineItemDraft[]>>({});
  const [lineItemsSavingId, setLineItemsSavingId] = useState<string | null>(null);
  const [lineItemsSaveErrors, setLineItemsSaveErrors] = useState<Record<string, string>>({});
  // OCR retry state.
  const [retryingDocId, setRetryingDocId] = useState<string | null>(null);
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  const [retryClearedErrors, setRetryClearedErrors] = useState<Record<string, boolean>>({});
  // Tracks which receipt index in the bucket carousel is currently displayed
  // so we can rebuild the editor pane for the right doc on arrow-key nav.
  const [lightboxCurrentIndex, setLightboxCurrentIndex] = useState<number | null>(null);

  // Merge receipts across all payouts on the party — multi-host pot. Layers
  // `receiptOverrides` (pesto-92105) on top so saves reflect immediately.
  const receiptEntries = useMemo(() => {
    const raw = collectReceipts(row.payouts);
    if (Object.keys(receiptOverrides).length === 0) return raw;
    return raw.map((e) => {
      const ov = receiptOverrides[e.doc.id];
      if (!ov) return e;
      return {
        ...e,
        doc: {
          ...e.doc,
          ocrAmount: ov.ocrAmount,
          ocrCurrency: ov.ocrCurrency,
          ocrLineItems:
            ov.ocrLineItems !== undefined ? ov.ocrLineItems : e.doc.ocrLineItems,
          isDuplicate:
            ov.isDuplicate !== undefined ? ov.isDuplicate : e.doc.isDuplicate,
        },
      };
    });
  }, [row.payouts, receiptOverrides]);

  // ricotta-92104: party-level photos for the Event/Pizza preview sections.
  // Backend now ships these on the by-party row (mirrors the per-payout
  // serializer's `eventPhotos`). Older cached payloads may be missing the
  // field — fall back to empty array so the sections just hide.
  const allEventPhotos = useMemo<AdminPayoutEventPhoto[]>(
    () => row.eventPhotos ?? [],
    [row.eventPhotos],
  );
  const pizzaPhotos = useMemo(
    () => allEventPhotos.filter(isPizzaPhoto),
    [allEventPhotos],
  );
  const eventPhotos = useMemo(
    () => allEventPhotos.filter((p) => !isPizzaPhoto(p)),
    [allEventPhotos],
  );

  // Unified-rollup totals computed client-side from the payouts already on
  // the wire. NB: the by-party endpoint already exposes pending/approved/
  // paid/completed aggregates, but we re-derive client-side off the same
  // payouts array so the rollup stays consistent with whatever's actually
  // shown in the panel (and we can hand-pick committed-cap semantics).
  const rollup = useMemo(() => {
    const payouts = row.payouts;
    const receiptUsdTotal = receiptEntries.reduce(
      (s, e) => s + (Number(e.doc.ocrAmount) || 0),
      0,
    );
    const receiptCount = receiptEntries.length;

    let approvedUsd = 0;
    let paidUsd = 0;
    let pendingUsd = 0;
    let pendingCount = 0;
    const pendingPayouts: AdminPayout[] = [];
    const paidPayouts: AdminPayout[] = [];

    for (const p of payouts) {
      const usd = Number(p.finalAmountUsd) || 0;
      if (isCommittedStatus(p.status)) approvedUsd += usd;
      if (isPaidStatus(p.status)) {
        paidUsd += usd;
        paidPayouts.push(p);
      }
      if (p.status === 'pending') {
        pendingUsd += usd;
        pendingCount += 1;
        pendingPayouts.push(p);
      }
    }
    // approved-but-not-yet-paid is what's typically classified as "in flight";
    // surface those alongside pending so the admin can drill into either.
    const approvedNotPaid = payouts.filter((p) => p.status === 'approved');

    return {
      receiptUsdTotal,
      receiptCount,
      approvedUsd,
      paidUsd,
      outstandingUsd: Math.max(0, approvedUsd - paidUsd),
      pendingUsd,
      pendingCount,
      pendingPayouts,
      approvedNotPaidPayouts: approvedNotPaid,
      paidPayouts,
    };
  }, [row.payouts, receiptEntries]);

  // Hosts — derived from the underlying payouts. Multi-host parties merge
  // into a deduplicated list keyed on the host user-id.
  const hosts = useMemo(() => {
    const seen = new Map<string, { id: string; name: string | null; email: string | null }>();
    for (const p of row.payouts) {
      const h = p.host;
      if (!h?.id) continue;
      if (seen.has(h.id)) continue;
      seen.set(h.id, { id: h.id, name: h.name, email: h.email });
    }
    return Array.from(seen.values());
  }, [row.payouts]);

  const receiptLightboxImages: ReceiptLightboxImage[] = useMemo(
    () =>
      receiptEntries.map((e) => ({
        url: e.doc.url,
        fileName: e.doc.fileName,
        mimeType: e.doc.mimeType,
      })),
    [receiptEntries],
  );
  // ricotta-92104: separate lightbox carousels per photo bucket so navigation
  // stays inside the section the admin clicked into (matches the
  // focaccia-92104 pattern where each section is its own grouping).
  const eventLightboxImages: ReceiptLightboxImage[] = useMemo(
    () =>
      eventPhotos.map((p) => ({
        url: p.url,
        fileName: p.fileName,
        mimeType: p.mimeType,
      })),
    [eventPhotos],
  );
  const pizzaLightboxImages: ReceiptLightboxImage[] = useMemo(
    () =>
      pizzaPhotos.map((p) => ({
        url: p.url,
        fileName: p.fileName,
        mimeType: p.mimeType,
      })),
    [pizzaPhotos],
  );

  const activeLightboxImages: ReceiptLightboxImage[] =
    lightbox?.bucket === 'event'
      ? eventLightboxImages
      : lightbox?.bucket === 'pizza'
        ? pizzaLightboxImages
        : receiptLightboxImages;

  const tags = row.party.eventTags ?? [];

  // Combined "in-flight" list (pending + approved-not-paid) — what the
  // "review claims" expansion shows when the admin toggles it open. Sorted
  // newest-first.
  const inflightPayouts = useMemo(() => {
    const combined = [
      ...rollup.pendingPayouts,
      ...rollup.approvedNotPaidPayouts,
    ];
    combined.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return combined;
  }, [rollup.pendingPayouts, rollup.approvedNotPaidPayouts]);

  // pesto-92105: receipt currently displayed in the lightbox (if the active
  // bucket is `receipt`). Drives the editor pane below.
  const lightboxReceipt = useMemo<PayoutDocument | null>(() => {
    if (lightbox?.bucket !== 'receipt') return null;
    if (lightboxCurrentIndex == null) return null;
    const e = receiptEntries[lightboxCurrentIndex];
    return e ? e.doc : null;
  }, [lightbox?.bucket, lightboxCurrentIndex, receiptEntries]);

  /* ---------------------------------------------------------------------- *
   * pesto-92105: receipt-edit handlers. Mirror PayoutReviewModal's save     *
   * paths. PATCH /admin/payouts/documents/:docId is the single endpoint —  *
   * server is authoritative, we layer the response into `receiptOverrides` *
   * so the visible row + sums update immediately.                          *
   * ---------------------------------------------------------------------- */

  const saveReceiptEdit = useCallback(async (docId: string) => {
    const draft = receiptDrafts[docId];
    if (!draft) return;
    setReceiptSavingId(docId);
    setReceiptSaveErrors((m) => {
      const next = { ...m };
      delete next[docId];
      return next;
    });
    try {
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
          ocrLineItems: updated.ocrLineItems,
          isDuplicate: updated.isDuplicate,
        },
      }));
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
  }, [receiptDrafts]);

  const toggleDuplicate = useCallback(async (docId: string, nextValue: boolean) => {
    setDuplicateSavingId(docId);
    setDuplicateSaveErrors((m) => {
      const next = { ...m };
      delete next[docId];
      return next;
    });
    // Capture the prior doc so we can roll back on PATCH failure.
    const prior = receiptEntries.find((e) => e.doc.id === docId)?.doc;
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
            ocrAmount: updated.ocrAmount,
            ocrCurrency: updated.ocrCurrency,
            ocrLineItems: updated.ocrLineItems,
            isDuplicate: updated.isDuplicate,
          },
        };
      });
    } catch (err: any) {
      // Roll back the optimistic flag.
      setReceiptOverrides((m) => {
        const cur = m[docId];
        if (!cur) return m;
        return {
          ...m,
          [docId]: { ...cur, isDuplicate: prior?.isDuplicate === true },
        };
      });
      setDuplicateSaveErrors((m) => ({
        ...m,
        [docId]: err?.message || 'Failed to mark duplicate',
      }));
    } finally {
      setDuplicateSavingId(null);
    }
  }, [receiptEntries]);

  const updateLineItemDraft = useCallback((
    docId: string,
    idx: number,
    patch: Partial<LineItemDraft>,
  ) => {
    setLineItemDrafts((m) => {
      const cur = m[docId] ?? [];
      const next = cur.slice();
      next[idx] = { ...next[idx], ...patch };
      return { ...m, [docId]: next };
    });
  }, []);

  const addLineItem = useCallback((docId: string) => {
    setLineItemDrafts((m) => {
      const cur = m[docId] ?? [];
      return { ...m, [docId]: [...cur, emptyLineItemDraft()] };
    });
  }, []);

  const removeLineItem = useCallback((docId: string, idx: number) => {
    setLineItemDrafts((m) => {
      const cur = m[docId] ?? [];
      const next = cur.slice();
      next.splice(idx, 1);
      return { ...m, [docId]: next };
    });
  }, []);

  const useLineSumForAmount = useCallback((docId: string) => {
    const drafts = lineItemDrafts[docId] ?? [];
    let sum = 0;
    for (const d of drafts) {
      const n = Number(d.subtotal);
      if (Number.isFinite(n) && n >= 0) sum += n;
    }
    setReceiptDrafts((m) => {
      const prev = m[docId];
      return {
        ...m,
        [docId]: {
          amount: sum.toFixed(2),
          currency: prev?.currency ?? '',
        },
      };
    });
  }, [lineItemDrafts]);

  const saveLineItemsEdit = useCallback(async (docId: string) => {
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
          isDuplicate: updated.isDuplicate,
        },
      }));
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
  }, [lineItemDrafts]);

  const retryOcr = useCallback(async (docId: string) => {
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
  }, []);

  // pesto-92105: "is the editor dirty?" for the currently-shown receipt.
  // Drives the navigation-confirm prompt on arrow-key nav so admins don't
  // lose in-flight edits when cycling through receipts.
  const receiptHasUnsavedEdits = useCallback((docId: string): boolean => {
    const r = receiptEntries.find((e) => e.doc.id === docId)?.doc;
    if (!r) return false;
    const draft = receiptDrafts[docId];
    if (draft) {
      const persistedAmt = r.ocrAmount == null ? '' : String(r.ocrAmount);
      const persistedCur = r.ocrCurrency ?? '';
      if (draft.amount !== persistedAmt || draft.currency !== persistedCur) {
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
  }, [receiptEntries, receiptDrafts, lineItemDrafts]);

  const lightboxOnBeforeNavigate = useCallback(async (): Promise<boolean> => {
    if (!lightboxReceipt) return true;
    if (!receiptHasUnsavedEdits(lightboxReceipt.id)) return true;
    return window.confirm(
      'This receipt has unsaved edits. Discard them and navigate?',
    );
  }, [lightboxReceipt, receiptHasUnsavedEdits]);

  const lightboxOnDuplicateShortcut = useCallback(() => {
    if (!lightboxReceipt) return;
    toggleDuplicate(lightboxReceipt.id, !(lightboxReceipt.isDuplicate === true));
  }, [lightboxReceipt, toggleDuplicate]);

  // pesto-92105: build the editor pane for the lightbox. Gated to receipt
  // bucket + admin viewer; null for event/pizza photos and underbosses (the
  // lightbox then renders its plain photo-only layout).
  const lightboxEditorPane = useMemo(() => {
    if (!canEditReceipts) return null;
    if (lightbox?.bucket !== 'receipt') return null;
    if (!lightboxReceipt) return null;
    const r = lightboxReceipt;
    const draft: ReceiptDraft = receiptDrafts[r.id] ?? {
      amount: r.ocrAmount == null ? '' : String(r.ocrAmount),
      currency: r.ocrCurrency ?? '',
    };
    const persistedAmt = r.ocrAmount == null ? '' : String(r.ocrAmount);
    const persistedCur = r.ocrCurrency ?? '';
    const isDirty =
      draft.amount !== persistedAmt || draft.currency !== persistedCur;
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
          // Seed the persistent draft on first edit so subsequent renders
          // pick up in-flight edits (mirrors the lazy-seed pattern in
          // PayoutReviewModal).
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
    // The save callbacks are stable across renders (declared with
    // useCallback); they read fresh state internally via the dep arrays
    // above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canEditReceipts,
    lightbox?.bucket,
    lightboxReceipt,
    receiptDrafts,
    receiptSavingId,
    receiptSaveErrors,
    duplicateSavingId,
    duplicateSaveErrors,
    lineItemDrafts,
    lineItemsSavingId,
    lineItemsSaveErrors,
    retryingDocId,
    retryErrors,
    retryClearedErrors,
  ]);

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Hosts + tags strip */}
      {(hosts.length > 0 || tags.length > 0) && (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
          {hosts.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1 text-theme-text-muted text-xs uppercase tracking-wide">
                <UserIcon size={12} />
                Hosts
              </span>
              {hosts.map((h) => (
                <span
                  key={h.id}
                  className="inline-flex items-center gap-2 text-theme-text"
                >
                  <span className="font-medium">{h.name || 'Unnamed'}</span>
                  {h.email && (
                    <span className="text-xs text-theme-text-muted">
                      <ClickableEmail email={h.email} />
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-theme-text-muted text-xs uppercase tracking-wide">
                <Tag size={12} />
                Tags
              </span>
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center px-2 py-0.5 rounded-full bg-theme-surface-hover text-xs text-theme-text-secondary border border-theme-stroke"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Four-number rollup */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <RollupTile
          label="Receipts collected"
          value={formatUsd(rollup.receiptUsdTotal)}
          sub={`${rollup.receiptCount} receipt${rollup.receiptCount === 1 ? '' : 's'}`}
          accent="text-theme-text"
        />
        <RollupTile
          label="Approved"
          value={formatUsd(rollup.approvedUsd)}
          accent="text-sky-500"
        />
        <RollupTile
          label="Paid"
          value={formatUsd(rollup.paidUsd)}
          accent="text-emerald-500"
        />
        <RollupTile
          label="Outstanding"
          value={formatUsd(rollup.outstandingUsd)}
          accent={rollup.outstandingUsd > 0 ? 'text-amber-500' : 'text-theme-text-faint'}
        />
      </div>

      {/* Pending claims summary — single sum, click-to-expand */}
      {(rollup.pendingCount > 0 || inflightPayouts.length > 0) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <button
            type="button"
            onClick={() => setShowPendingClaims((v) => !v)}
            className="w-full flex items-center justify-between text-left"
          >
            <span className="text-sm text-amber-300">
              {rollup.pendingUsd > 0 ? (
                <>
                  <span className="font-medium">{formatUsd(rollup.pendingUsd)}</span>
                  {' '}in pending claims awaiting review
                  {rollup.pendingCount > 0 && (
                    <span className="text-xs text-amber-300/70 ml-2">
                      ({rollup.pendingCount} claim{rollup.pendingCount === 1 ? '' : 's'})
                    </span>
                  )}
                </>
              ) : (
                <span>
                  {inflightPayouts.length} approved claim
                  {inflightPayouts.length === 1 ? '' : 's'} awaiting payout
                </span>
              )}
            </span>
            <span className="text-xs text-amber-300/80 inline-flex items-center gap-1">
              {showPendingClaims ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
              {showPendingClaims ? 'Hide' : 'Review'}
            </span>
          </button>

          {showPendingClaims && inflightPayouts.length > 0 && (
            <div className="mt-2 border-t border-amber-500/20 pt-2 space-y-1">
              {inflightPayouts.map((p) => {
                const isSelected = selectedIds.has(p.id);
                const isBusy = busyRowId === p.id;
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-theme-surface-hover text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        onToggleSelect(p.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-theme-stroke-hover bg-theme-surface"
                      aria-label="Select payment"
                    />
                    <button
                      type="button"
                      onClick={() => onRowClick(p)}
                      className="flex-1 flex items-center gap-3 text-left"
                    >
                      <PayoutStatusPill status={p.status} />
                      <span className="text-theme-text-secondary text-xs min-w-[5.5rem]">
                        {formatLedgerDate(p.createdAt)}
                      </span>
                      <span className="font-medium text-theme-text">
                        {formatUsd(Number(p.finalAmountUsd))}
                      </span>
                      <span className="text-xs text-theme-text-muted truncate">
                        {p.host?.name || p.host?.email || 'Unknown host'}
                      </span>
                      {isBusy && (
                        <Loader2
                          size={12}
                          className="animate-spin text-theme-text-muted"
                        />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Merged receipt grid */}
      {receiptEntries.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">
            Receipts ({receiptEntries.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {receiptEntries.map((e, idx) => (
              <button
                key={e.doc.id}
                type="button"
                onClick={() => setLightbox({ bucket: 'receipt', index: idx })}
                className="group relative w-16 h-16 rounded-md overflow-hidden border border-theme-stroke hover:border-theme-stroke-hover"
                title={`${e.doc.fileName}${
                  e.doc.uploadedByName || e.doc.uploadedByEmail
                    ? ` — uploaded by ${e.doc.uploadedByName || e.doc.uploadedByEmail}`
                    : ''
                }${
                  e.doc.ocrAmount != null
                    ? ` · ${formatUsd(Number(e.doc.ocrAmount))}`
                    : ''
                }`}
              >
                <img
                  src={e.doc.url}
                  alt={e.doc.fileName}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {e.doc.ocrAmount != null && (
                  <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] font-medium text-center py-0.5">
                    {formatUsd(Number(e.doc.ocrAmount))}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Payment ledger — one row per paid/completed payout */}
      {rollup.paidPayouts.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">
            Payment ledger
          </div>
          <div className="rounded-lg border border-theme-stroke overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-theme-surface/40 text-theme-text-muted text-xs">
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-left font-medium">Method</th>
                  <th className="px-3 py-2 text-left font-medium">Recipient</th>
                  <th className="px-3 py-2 text-left font-medium">Tx</th>
                </tr>
              </thead>
              <tbody>
                {[...rollup.paidPayouts]
                  .sort((a, b) => {
                    const at = new Date(a.paidAt || a.updatedAt).getTime();
                    const bt = new Date(b.paidAt || b.updatedAt).getTime();
                    return bt - at;
                  })
                  .map((p) => {
                    const url = explorerUrlFor(p.payoutMethod, p.transactionHash);
                    const recipientLabel =
                      p.host?.name || p.host?.email || 'Unknown';
                    const recipientHandle =
                      p.payoutMethod === 'usdc_base' && p.payoutWalletAddress
                        ? truncateMiddle(p.payoutWalletAddress, 6, 4)
                        : p.host?.email
                          ? p.host.email
                          : null;
                    return (
                      <tr
                        key={p.id}
                        className="border-t border-theme-stroke hover:bg-theme-surface-hover cursor-pointer"
                        onClick={() => onRowClick(p)}
                      >
                        <td className="px-3 py-2 text-theme-text-secondary whitespace-nowrap">
                          {formatLedgerDate(p.paidAt || p.updatedAt)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-theme-text whitespace-nowrap">
                          {formatUsd(Number(p.finalAmountUsd))}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <PayoutMethodIcon
                            method={p.payoutMethod}
                            size={14}
                            showLabel
                          />
                        </td>
                        <td className="px-3 py-2 text-theme-text-secondary">
                          <div className="flex flex-col">
                            <span className="text-theme-text">{recipientLabel}</span>
                            {recipientHandle && (
                              <span className="text-xs text-theme-text-muted truncate max-w-[14rem]">
                                {recipientHandle}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-theme-text-muted">
                          {p.transactionHash ? (
                            url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-sky-400 hover:underline"
                              >
                                {truncateMiddle(p.transactionHash)}
                                <ExternalLink size={11} />
                              </a>
                            ) : (
                              <span className="font-mono">
                                {truncateMiddle(p.transactionHash)}
                              </span>
                            )
                          ) : p.wireReference ? (
                            <span title={p.wireReference}>
                              {truncateMiddle(p.wireReference)}
                            </span>
                          ) : (
                            <span>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ricotta-92104: party-level Event + Pizza photo previews. Sits below
          the payment ledger so the financial rollup is the admin's first
          read; photos give visual context when drilling in. Empty buckets
          hide entirely via PhotoPreviewSection. Mirrors the focaccia-92104
          split in PayoutReviewModal. */}
      <PhotoPreviewSection
        label="Event photos"
        photos={eventPhotos}
        onThumbClick={(idx) => setLightbox({ bucket: 'event', index: idx })}
      />
      <PhotoPreviewSection
        label="Pizza photos"
        photos={pizzaPhotos}
        onThumbClick={(idx) => setLightbox({ bucket: 'pizza', index: idx })}
      />

      {receiptEntries.length === 0
        && rollup.paidPayouts.length === 0
        && inflightPayouts.length === 0
        && eventPhotos.length === 0
        && pizzaPhotos.length === 0 && (
        <div className="text-sm text-theme-text-faint italic">
          No payouts on this city match the current filters.
        </div>
      )}

      {/* pesto-92105: same shared lightbox the modal uses. When the active
          bucket is `receipt` AND the viewer is admin, pass `editorPane` so
          the lightbox switches to the 2-pane photo + ReceiptEditor layout.
          Event/pizza buckets and underbosses get the plain photo-only
          lightbox (editorPane stays null). */}
      <ReceiptLightbox
        isOpen={lightbox != null}
        images={activeLightboxImages}
        initialIndex={lightbox?.index ?? 0}
        onClose={() => {
          setLightbox(null);
          setLightboxCurrentIndex(null);
        }}
        onIndexChange={setLightboxCurrentIndex}
        editorPane={lightboxEditorPane}
        onBeforeNavigate={
          lightbox?.bucket === 'receipt' ? lightboxOnBeforeNavigate : undefined
        }
        onDuplicateShortcut={
          lightbox?.bucket === 'receipt' && canEditReceipts
            ? lightboxOnDuplicateShortcut
            : undefined
        }
      />
    </div>
  );
}

/**
 * ricotta-92104: thumbnail grid for one photo bucket (Event or Pizza). Shows
 * up to PHOTO_PREVIEW_LIMIT thumbs inline; a "See all" button reveals the
 * full set in the same row. Click any thumb to open the section's lightbox
 * carousel starting at the clicked index. Mirrors the per-payout
 * PayoutReviewModal photo grids (focaccia-92104) but trimmed to a horizontal
 * preview strip for the city-level rollup.
 */
function PhotoPreviewSection({
  label,
  photos,
  onThumbClick,
}: {
  label: string;
  photos: AdminPayoutEventPhoto[];
  onThumbClick: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (photos.length === 0) return null;

  const visible = expanded ? photos : photos.slice(0, PHOTO_PREVIEW_LIMIT);
  const hasMore = photos.length > PHOTO_PREVIEW_LIMIT;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wide text-theme-text-muted">
          {label} ({photos.length})
        </div>
        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-sky-400 hover:text-sky-300 hover:underline"
          >
            {expanded
              ? 'Show less'
              : `See all (${photos.length})`}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {visible.map((p, idx) => {
          const isHidden = p.status !== 'approved';
          const isVideo = isVideoFile(p);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onThumbClick(idx)}
              className="relative w-16 h-16 rounded-md overflow-hidden border border-theme-stroke hover:border-theme-stroke-hover group"
              title={p.caption || p.fileName}
            >
              {/* melanzane-92103 / focaccia-92104: video photos render as
                  <video preload=metadata> so the browser pulls the first
                  frame for the poster, with a play-icon overlay. */}
              {isVideo ? (
                <>
                  <video
                    src={p.url}
                    preload="metadata"
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-black/50 rounded-full p-1">
                      <Play className="text-white" size={12} fill="white" />
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
              {/* margherita-43821 / focaccia-92104: Hidden pill when the
                  photo isn't approved for public display. */}
              {isHidden && (
                <span
                  className="absolute top-0.5 left-0.5 text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-red-500 text-white"
                  title={`Photo status: ${p.status} — not visible to the public`}
                >
                  Hidden
                </span>
              )}
              {p.starred && (
                <span className="absolute top-0.5 right-0.5 text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-amber-400 text-black">
                  ★
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Single tile in the 4-number rollup grid. */
function RollupTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-theme-stroke bg-theme-surface/40 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-theme-text-muted">
        {label}
      </div>
      <div className={`text-lg font-semibold ${accent}`}>{value}</div>
      {sub && (
        <div className="text-xs text-theme-text-muted mt-0.5">{sub}</div>
      )}

      {/* gnocchi-92104: queued row gets a single Mark paid (settled) button.
          Approved -> queued / queued -> approved transitions live in the
          modal so the admin can leave a confirmation note. */}
      {status === 'queued' && (
        <button
          type="button"
          onClick={() => onMarkPaid(payout)}
          disabled={busy}
          className="p-1.5 rounded-md hover:bg-blue-50 text-blue-600 disabled:opacity-50"
          title="Mark paid (wire settled)"
        >
          <DollarSign size={15} />
        </button>
      )}
    </div>
  );
}

export const PayoutsByPartyTable: React.FC<PayoutsByPartyTableProps> = ({
  rows,
  selectedIds,
  onToggleSelect,
  onRowClick,
  onMarkPartyPaid,
  onAddExternalPayment,
  viewerRole = 'admin',
  busyRowId,
  loading,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const canMarkPartyPaid = viewerRole === 'admin' && !!onMarkPartyPaid;
  const canAddExternal = viewerRole === 'admin' && !!onAddExternalPayment;
  // pesto-92105: same gate the per-payout PayoutReviewModal applies for
  // `canEditReceipts` (admin / super_admin / payment_admin). Underbosses get
  // the plain photo-only lightbox.
  const canEditReceipts = viewerRole === 'admin';

  function toggleExpanded(partyId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(partyId)) next.delete(partyId);
      else next.add(partyId);
      return next;
    });
  }

  return (
    <div className="bg-theme-surface border border-theme-stroke rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-theme-stroke text-theme-text-muted text-left">
              <th className="px-3 py-3 w-10"></th>
              <th className="px-3 py-3 font-medium">Event</th>
              <th className="px-3 py-3 font-medium">Receipt total</th>
              <th className="px-3 py-3 font-medium">Approved</th>
              <th className="px-3 py-3 font-medium">Paid</th>
              <th className="px-3 py-3 font-medium">Outstanding</th>
              <th className="px-3 py-3 font-medium">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-theme-text-muted">
                  <Loader2 size={20} className="inline-block animate-spin mr-2" />
                  Loading payments…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-theme-text-faint">
                  No events match these filters.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const isOpen = expanded.has(row.party.id);
              const partySlug = row.party.customUrl ?? row.party.inviteCode ?? '';
              const closedAt = row.party.paymentsClosedAt ?? null;
              const isClosed = !!closedAt;
              const hasInFlight =
                row.aggregates.pendingCount + row.aggregates.approvedCount > 0;
              // pinsa-92103: ALSO show the button when the city has paid
              // payouts but hasn't been closed yet (Ekiti, Tangier) so the
              // admin can stamp the close timestamp.
              const canCloseOut =
                !hasInFlight && !isClosed && row.aggregates.paidCount > 0;
              const showMarkPartyPaid =
                canMarkPartyPaid && !isClosed && (hasInFlight || canCloseOut);
              // Label flips between "Mark city paid" (in-flight rows present)
              // and "Close city" (only paid rows, no in-flight).
              const markPaidLabel = hasInFlight ? 'Mark city paid' : 'Close city';

              // Compute Receipt total + Outstanding for the OUTER row from
              // the payouts already on the wire (mostarda-92103 unified
              // rollup — keep the outer cells in sync with the panel).
              const payouts = row.payouts;
              let receiptUsdTotal = 0;
              let receiptCount = 0;
              for (const p of payouts) {
                for (const d of p.documents || []) {
                  if (d.kind !== 'receipt') continue;
                  receiptCount += 1;
                  receiptUsdTotal += Number(d.ocrAmount) || 0;
                }
              }
              const approvedSumUsd =
                row.aggregates.approvedUsd
                + row.aggregates.paidUsd
                + (row.aggregates.completedUsd ?? 0);
              const paidSumUsd =
                row.aggregates.paidUsd + (row.aggregates.completedUsd ?? 0);
              const outstandingUsd = Math.max(0, approvedSumUsd - paidSumUsd);

              return (
                <React.Fragment key={row.party.id}>
                  {/* Outer city summary row */}
                  <tr
                    className="border-b border-theme-stroke transition-colors cursor-pointer hover:bg-theme-surface-hover"
                    onClick={() => toggleExpanded(row.party.id)}
                  >
                    <td className="px-3 py-3 w-10 text-theme-text-muted">
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </td>
                    <td className="px-3 py-3 text-sm min-w-[14rem]">
                      {partySlug ? (
                        <Link
                          to={`/host/${partySlug}/details`}
                          className="font-medium text-theme-text hover:text-[#E52828] hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {stripGppPrefix(row.party.name)}
                        </Link>
                      ) : (
                        <span className="font-medium text-theme-text">
                          {stripGppPrefix(row.party.name)}
                        </span>
                      )}
                      {row.party.country && (
                        <div className="text-xs text-theme-text-muted">
                          {row.party.country}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {/* parmigiana-92104: tiny SWC Hub pill so admins notice
                            before they expand the row + click into a modal. The
                            table-level actions aren't disabled here — the per-
                            action modals (PayoutReviewModal, MarkPartyPaidModal)
                            are the canonical gate point. */}
                        {isSwcHubParty(row.party) && (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] text-amber-300 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30"
                            title="SWC Hub party — reimbursement should be processed via SWC, not rsv.pizza"
                          >
                            SWC Hub
                          </span>
                        )}
                        {row.aggregates.flaggedReadyCount > 0 && (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] text-emerald-500"
                            title={`${row.aggregates.flaggedReadyCount} payment${row.aggregates.flaggedReadyCount === 1 ? '' : 's'} flagged ready for payment`}
                          >
                            <Flag size={11} />
                            {row.aggregates.flaggedReadyCount} flagged ready
                          </span>
                        )}
                        {isClosed && (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] text-emerald-500 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30"
                            title={`Closed out ${new Date(closedAt!).toLocaleString()}`}
                          >
                            <CheckCircle2 size={11} />
                            Closed
                          </span>
                        )}
                        {row.aggregates.pendingCount > 0 && (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] text-amber-400"
                            title={`${row.aggregates.pendingCount} pending claim${row.aggregates.pendingCount === 1 ? '' : 's'}`}
                          >
                            <XCircle size={11} />
                            {row.aggregates.pendingCount} pending
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm text-theme-text">
                      <div className="font-medium">{formatUsd(receiptUsdTotal)}</div>
                      <div className="text-xs text-theme-text-muted inline-flex items-center gap-1">
                        <Paperclip size={11} />
                        {receiptCount} receipt{receiptCount === 1 ? '' : 's'}
                      </div>
                    </td>
                    <td
                      className={`px-3 py-3 text-sm ${
                        approvedSumUsd > 0
                          ? 'text-sky-500 font-medium'
                          : 'text-theme-text-faint'
                      }`}
                    >
                      {approvedSumUsd > 0 ? formatUsd(approvedSumUsd) : '—'}
                    </td>
                    <td
                      className={`px-3 py-3 text-sm ${
                        paidSumUsd > 0
                          ? 'text-emerald-500 font-medium'
                          : 'text-theme-text-faint'
                      }`}
                    >
                      {paidSumUsd > 0 ? formatUsd(paidSumUsd) : '—'}
                    </td>
                    <td
                      className={`px-3 py-3 text-sm ${
                        outstandingUsd > 0
                          ? 'text-amber-500 font-medium'
                          : 'text-theme-text-faint'
                      }`}
                    >
                      {outstandingUsd > 0 ? formatUsd(outstandingUsd) : '—'}
                    </td>
                    <td className="px-3 py-3 text-sm text-theme-text-secondary">
                      <div className="flex items-center justify-between gap-2">
                        <div title={new Date(row.aggregates.lastActivityAt).toLocaleString()}>
                          {relativeTime(new Date(row.aggregates.lastActivityAt))}
                        </div>
                        <CityActionsMenu
                          canMarkPaid={showMarkPartyPaid}
                          canAddExternal={canAddExternal}
                          markPaidLabel={markPaidLabel}
                          onMarkPartyPaid={
                            showMarkPartyPaid && onMarkPartyPaid
                              ? () => onMarkPartyPaid(row.party.id)
                              : undefined
                          }
                          onAddExternalPayment={
                            canAddExternal && onAddExternalPayment
                              ? () =>
                                  onAddExternalPayment(
                                    row.party.id,
                                    row.party.name,
                                  )
                              : undefined
                          }
                        />
                      </div>
                    </td>
                  </tr>

                  {/* Expanded panel — single rolled-up view, not per-host
                      enumeration. */}
                  {isOpen && (
                    <tr>
                      <td colSpan={7} className="p-0 bg-theme-surface/40">
                        <div className="border-l-4 border-theme-stroke">
                          <CityExpansion
                            row={row}
                            selectedIds={selectedIds}
                            onToggleSelect={onToggleSelect}
                            onRowClick={onRowClick}
                            busyRowId={busyRowId}
                            canEditReceipts={canEditReceipts}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
