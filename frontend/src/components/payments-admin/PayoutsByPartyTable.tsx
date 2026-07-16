import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
  Paperclip,
  Flag,
  CheckCircle2,
  MoreVertical,
  DollarSign,
  XCircle,
  Plus,
  Send,
  ExternalLink,
  Tag,
  User as UserIcon,
  Play,
  AlertTriangle,
  MessageCircle,
  Check,
  AlertCircle,
  StickyNote,
  ThumbsUp,
  RotateCcw,
  Wallet,
  Camera,
  Users,
} from 'lucide-react';
import { IconInput } from '../IconInput';
import type {
  AdminPayout,
  AdminPayoutEventPhoto,
  AdminPayoutFilters,
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
  computePartyTotals,
  CapInlineEditor,
  SubmittedForReviewBadge,
} from '../payments-shared';
import { ClickableEmail } from '../ClickableEmail';
import { AdminAddAttachment } from './AdminAddAttachment';
import { AdminAddPhotosModal } from './AdminAddPhotosModal';
import { isSwcHubParty } from '../../utils/swcHub';
import { isVideoFile } from '../../lib/mediaUtils';
import {
  updatePayoutDocument,
  markReceiptDuplicate,
  markReceiptIneligible,
  retryPayoutDocumentOcr,
  flagPartyAsScam,
  POSSIBLE_SCAM_TAG,
  addCustomTag,
  removeCustomTag,
  getCustomTagLabels,
  normalizeCustomTagLabel,
  CUSTOM_TAG_PREFIX,
  sendTgReceiptsReminder,
  sendTgWalletReminder,
  sendTgPhotoReminder,
  sendTgAttendanceReminder,
  setCityAdminNotes,
  approveCity,
  reopenParty,
  // culatello-92106: per-event tax-form gate toggle. Same PATCH backend uses
  // for tags + reimbursement cap; whitelisted with admin-only gating server-side.
  updatePartyApi,
} from '../../lib/api';
import {
  ReceiptEditor,
  computeLineSubtotal,
  lineItemToDraft,
  emptyLineItemDraft,
  type ReceiptDraft,
  type LineItemDraft,
} from './ReceiptEditor';
import { FakeDetectionBadge } from './FakeDetectionBadge';

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
 * nduja-58514: mirror the receipt "uploaded by {name|email} · {date}" surfacing
 * for event/pizza photos on /payments. Receipts already show uploader + date in
 * their thumbnail tooltip + lightbox; photos didn't. These two helpers produce
 * the tooltip suffix (appended to the thumbnail title) and the lightbox caption
 * line from a photo's uploader fields. Same date format as ReceiptsLibrary
 * (toLocaleDateString { year, month: 'short', day }). Guards invalid/missing
 * createdAt so we never render "Invalid Date" or "by undefined".
 */
function formatPhotoDate(createdAt: string | null | undefined): string | null {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface PhotoUploaderMeta {
  uploaderName?: string | null;
  uploaderEmail?: string | null;
  createdAt?: string | null;
}

/**
 * Tooltip suffix appended to a thumbnail `title`. Always includes the date when
 * present; prepends " — uploaded by {name|email}" only when a name or email
 * exists. Returns '' when there's no usable date (nothing to append).
 */
function photoUploaderTooltipSuffix(p: PhotoUploaderMeta): string {
  const date = formatPhotoDate(p.createdAt);
  if (!date) return '';
  const who = (p.uploaderName || p.uploaderEmail || '').trim();
  return who ? ` — uploaded by ${who} · ${date}` : ` · ${date}`;
}

/**
 * Lightbox caption line: "Uploaded {date}" plus " by {name|email}" when known.
 * Returns '' when there's no usable date (caption omitted).
 */
function photoUploaderCaption(p: PhotoUploaderMeta): string {
  const date = formatPhotoDate(p.createdAt);
  if (!date) return '';
  const who = (p.uploaderName || p.uploaderEmail || '').trim();
  return who ? `Uploaded ${date} by ${who}` : `Uploaded ${date}`;
}

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
  /**
   * stracci-58471: current sort order, used to render the asc/desc chevron on
   * the clickable column headers (Event / Receipt total / Approved / Paid /
   * Outstanding / Last activity). Sorts unrelated to a column leave every
   * header neutral.
   */
  sort?: AdminPayoutFilters['sort'];
  /**
   * stracci-58471: set the sort order from a header click. When omitted the
   * headers render as plain (non-clickable) labels.
   */
  onSortChange?: (next: NonNullable<AdminPayoutFilters['sort']>) => void;
  /**
   * stracci-58471: the order a column returns to on its third click (after
   * asc + desc). Defaults to `created_desc`.
   */
  defaultSort?: NonNullable<AdminPayoutFilters['sort']>;
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
   * schiacciata-58503: refresh hook called after an admin adds a receipt or
   * photo to the city's primary payout via the in-panel AdminAddAttachment
   * controls. Newly-added docs aren't covered by the `receiptOverrides`
   * local-merge trick (they don't exist on `row.payouts` yet), so the parent
   * does a real refetch of the by-party feed.
   */
  onDocumentsChanged?: (partyId: string) => void;
  /**
   * bocconcini-92103 / pinsa-92103: open MarkPartyPaidModal for the row's
   * party. The modal itself decides whether to flip in-flight payouts to
   * paid, close out a fully-paid city, etc. Hidden for underbosses.
   */
  onMarkPartyPaid?: (partyId: string) => void;
  /**
   * Refresh hook called after a closed city is reopened. The table owns the
   * `reopenParty` API call + busy spinner (mirrors the scam-flag pattern); the
   * parent uses this to re-fetch the by-party feed (statuses + close pill
   * change) and flash a toast. Admin-only via the viewerRole gate on the menu.
   */
  onReopened?: (partyId: string, reopenedCount: number) => void;
  /**
   * mostarda-92103: opens the Add External Payment modal pre-targeted at
   * this city. Hidden for underbosses (admins only).
   */
  onAddExternalPayment?: (partyId: string, partyName: string) => void;
  /**
   * salame-92106: opens the SendPaymentModal pre-targeted at this city so
   * the admin can actively SEND funds (USDC / wire / mercury). Distinct
   * from `onMarkPartyPaid` (records existing payouts as paid) and
   * `onAddExternalPayment` (logs an off-platform payment). Hidden for
   * underbosses (admins only) via the viewerRole gate on the menu.
   */
  onSendPayment?: (row: PartyPayoutsRow) => void;
  /**
   * bottarga-92104: parent-supplied refresh hook called after the
   * `possible-scam` tag is toggled. The toggle itself happens locally via
   * `flagPartyAsScam`; the parent uses this to re-fetch the by-party feed so
   * any downstream consumers (filters, counts) stay in sync. Admin-only via
   * the viewerRole gate on the menu.
   */
  onScamFlagChanged?: (partyId: string, nextTags: string[]) => void;
  /**
   * panuozzo-58217: parent-supplied refresh hook called after a custom tag is
   * added or removed. The add/remove happens locally via `addCustomTag` /
   * `removeCustomTag`; the parent patches its row state + flashes a toast.
   * Available to admins + underbosses (wider than the scam flag).
   */
  onTagsChanged?: (partyId: string, nextTags: string[]) => void;
  /**
   * crocchetta-92106: toast callback used by the Send receipts reminder
   * action. Called after the backend POST resolves; the menu owns the API
   * call so the parent only needs to render the message (mirrors the
   * gnocchi-92104 pattern). When omitted, the table falls back to a
   * `window.alert`-free silent success (the menu still closes).
   */
  onTgReminderResult?: (
    partyId: string,
    result: {
      hostDmSent: boolean;
      hostDmReason?: string;
      groupSent: boolean;
      groupReason?: string;
    } | { error: string },
  ) => void;
  /**
   * Toast callback for the Send wallet reminder action — same per-channel
   * success/skip shape as `onTgReminderResult`. The menu owns the API call.
   */
  onTgWalletReminderResult?: (
    partyId: string,
    result: {
      hostDmSent: boolean;
      hostDmReason?: string;
      groupSent: boolean;
      groupReason?: string;
    } | { error: string },
  ) => void;
  /**
   * Toast callback for the Send photo reminder action — same per-channel
   * success/skip shape as `onTgReminderResult`. The menu owns the API call.
   */
  onTgPhotoReminderResult?: (
    partyId: string,
    result: {
      hostDmSent: boolean;
      hostDmReason?: string;
      groupSent: boolean;
      groupReason?: string;
    } | { error: string },
  ) => void;
  /**
   * Toast callback for the Send attendance reminder action — same per-channel
   * success/skip shape as `onTgReminderResult`. The menu owns the API call.
   */
  onTgAttendanceReminderResult?: (
    partyId: string,
    result: {
      hostDmSent: boolean;
      hostDmReason?: string;
      groupSent: boolean;
      groupReason?: string;
    } | { error: string },
  ) => void;
  /**
   * bufalina-60733: fake-detection risk scores keyed by party id. Only
   * medium/high (≥30) parties are present; an absent key means "no badge".
   * Rendered as a caution pill in the city header strip.
   */
  fakeScores?: Record<string, { score: number; tier: string; topFlags: string[] }>;
  viewerRole?: 'admin' | 'underboss';
  busyRowId?: string | null;
  loading?: boolean;
}

function stripGppPrefix(name: string): string {
  return name.replace(/^Global Pizza Party\s+/i, '');
}

// Receipt overrides applied locally after an inline receipt edit, before the
// by-party feed is re-fetched. Keyed by docId within a party. Hoisted to
// module scope so the Send-payment merge helper and the in-component state can
// share one type.
type ParentReceiptOverride = {
  ocrAmount: number | null;
  isDuplicate?: boolean;
  ineligible?: boolean;
};

// mascarpone-49118: merge a party's in-memory receipt overrides into the row's
// receipt documents so the Send-payment modal's default amount reflects unsaved
// receipt edits without a full page refresh. Mirrors the by-city Receipt total
// cell's `ov?.x ?? d.x` precedence.
function applyReceiptOverridesToRow(
  row: PartyPayoutsRow,
  overrides: Record<string, ParentReceiptOverride> | undefined,
): PartyPayoutsRow {
  if (!overrides || Object.keys(overrides).length === 0) return row;
  return {
    ...row,
    payouts: row.payouts.map((p) => ({
      ...p,
      documents: (p.documents ?? []).map((d) => {
        const ov = overrides[d.id];
        if (!ov) return d;
        return {
          ...d,
          ocrAmount: ov.ocrAmount ?? d.ocrAmount,
          isDuplicate: ov.isDuplicate ?? d.isDuplicate,
          ineligible: ov.ineligible ?? d.ineligible,
        };
      }),
    })),
  };
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
 * prosciutto-92106: a paid payout is "proven" iff the per-method proof field
 * is set. Keep in sync with backend `paidRowHasProof` / `PAID_HAS_PROOF_WHERE`.
 *
 * bresaola-49340: 'completed' rows are NO LONGER auto-treated as proven. They
 * go through the same per-method proof check as 'paid'. Never-sent rows swept
 * to 'completed' by "Mark city paid" (provolone-92103 / mark_pending_complete)
 * were inflating the Paid total because they short-circuited here. Proofless
 * completed close-outs now fall out of the Paid $ figure (they still appear in
 * their own completed count via the API aggregates).
 */
function payoutHasProof(p: {
  status?: PayoutStatus | string | null;
  payoutMethod?: string | null;
  transactionHash?: string | null;
  wireReference?: string | null;
  mercuryCardLast4?: string | null;
  mercuryCardId?: string | null;
  externalProofUrl?: string | null;
}): boolean {
  if (p.externalProofUrl && String(p.externalProofUrl).trim()) return true;
  if (p.payoutMethod === 'usdc_base') {
    return !!(p.transactionHash && String(p.transactionHash).trim());
  }
  if (p.payoutMethod === 'wire') {
    return !!(p.wireReference && String(p.wireReference).trim());
  }
  if (p.payoutMethod === 'mercury_card') {
    return (
      !!(p.mercuryCardLast4 && String(p.mercuryCardLast4).trim()) ||
      !!(p.mercuryCardId && String(p.mercuryCardId).trim())
    );
  }
  return false;
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

/**
 * City-row action cluster — gnocchi-92105 restructure.
 *
 * Before: a single "[⋯ Actions]" dropdown holding all four city-level
 * actions (Mark paid · Add external · Flag scam · Send payment).
 *
 * After: the two most-used actions get promoted to inline buttons sitting
 * next to a much smaller "⋮" three-dots icon menu that holds only the
 * secondary record/flag actions:
 *
 *   [$ Mark paid] [💸 Send payment] [⋮]                                  →
 *                                       Add external payment
 *                                       Flag / Unflag possible scam
 *
 * All four handler props stay intact — we just slot them across two
 * surfaces (inline buttons + dropdown) instead of one.
 */
function CityActionsMenu({
  onMarkPartyPaid,
  onAddExternalPayment,
  onSendPayment,
  onToggleScamFlag,
  onSendTgReminder,
  onSendWalletReminder,
  onSendPhotoReminder,
  onSendAttendanceReminder,
  onApproveCity,
  onReopen,
  onAddCustomTag,
  onRemoveCustomTag,
  canMarkPaid,
  canAddExternal,
  canSendPayment,
  canToggleScamFlag,
  canSendTgReminder,
  canSendWalletReminder,
  canSendPhotoReminder,
  canSendAttendanceReminder,
  canApproveCity,
  canReopen,
  canManageTags,
  markPaidLabel,
  isFlaggedScam,
  scamFlagBusy,
  tgReminderBusy,
  walletReminderBusy,
  photoReminderBusy,
  attendanceReminderBusy,
  reopenBusy,
  approveBusy,
  customTags,
  tagBusy,
  receiptsReminderSentAt,
  walletReminderSentAt,
  photoReminderSentAt,
  attendanceReminderSentAt,
  paymentsApprovedUsd,
  receiptsTotalUsd,
  variant = 'menu',
}: {
  /**
   * stracciatella-58546: 'menu' (default) renders the desktop icon-button row +
   * portaled kebab dropdown. 'card' renders every available action as a
   * full-width, labeled button (>=44px touch target) for the mobile card view.
   * Both variants reuse the exact same onClick handlers + confirm state.
   */
  variant?: 'menu' | 'card';
  onMarkPartyPaid?: () => void;
  onAddExternalPayment?: () => void;
  onSendPayment?: () => void;
  onToggleScamFlag?: () => void;
  /**
   * crocchetta-92106: fires after the second click on the Send receipts
   * reminder menu item (two-click confirm pattern — DMs aren't reversible).
   * Parent runs the API call and surfaces the toast.
   */
  onSendTgReminder?: () => void;
  /**
   * Fires after the second click on the Send wallet reminder menu item (same
   * two-click confirm pattern as the receipts reminder).
   */
  onSendWalletReminder?: () => void;
  /**
   * Fires after the second click on the Send photo reminder menu item (same
   * two-click confirm pattern as the receipts reminder).
   */
  onSendPhotoReminder?: () => void;
  /**
   * Fires after the second click on the Send attendance reminder menu item (same
   * two-click confirm pattern as the receipts reminder).
   */
  onSendAttendanceReminder?: () => void;
  /** Approve city payment amount. Called with the amount to approve. */
  onApproveCity?: (amountUsd: number | null) => void;
  /** Reopen a closed city (undo the close). */
  onReopen?: () => void;
  /** panuozzo-58217: add a free-text custom tag (label only, no prefix). */
  onAddCustomTag?: (label: string) => void;
  /** panuozzo-58217: remove a custom tag by its display label. */
  onRemoveCustomTag?: (label: string) => void;
  canMarkPaid: boolean;
  canAddExternal: boolean;
  canSendPayment: boolean;
  canToggleScamFlag: boolean;
  canSendTgReminder: boolean;
  canSendWalletReminder: boolean;
  canSendPhotoReminder: boolean;
  canSendAttendanceReminder: boolean;
  canApproveCity: boolean;
  canReopen: boolean;
  /** panuozzo-58217: admins + underbosses may add/view/remove custom tags. */
  canManageTags: boolean;
  markPaidLabel: string;
  isFlaggedScam: boolean;
  scamFlagBusy: boolean;
  tgReminderBusy: boolean;
  walletReminderBusy: boolean;
  photoReminderBusy: boolean;
  attendanceReminderBusy: boolean;
  reopenBusy: boolean;
  approveBusy: boolean;
  /** panuozzo-58217: current custom-tag display labels (no `custom:` prefix). */
  customTags: string[];
  /** panuozzo-58217: an add/remove is in flight for this party. */
  tagBusy: boolean;
  receiptsReminderSentAt?: string | null;
  walletReminderSentAt?: string | null;
  photoReminderSentAt?: string | null;
  attendanceReminderSentAt?: string | null;
  paymentsApprovedUsd?: number | null;
  paymentsApprovedAt?: string | null;
  /** Receipts total for default approval amount. */
  receiptsTotalUsd?: number;
}) {
  // Hooks-above-early-returns: declare useState before the no-actions guard
  // so the conditional return can't reorder hooks on a re-render where the
  // capability props flip. (feedback_hooks_above_early_returns)
  const [menuOpen, setMenuOpen] = useState(false);
  // crocchetta-92106: two-click confirm for the TG reminder action. The
  // first click flips the label to "Click again to confirm"; a second click
  // within the open menu actually fires. Resetting whenever the menu closes
  // prevents a stale confirm state carrying over to the next open.
  const [confirmTgReminder, setConfirmTgReminder] = useState(false);
  // Same two-click confirm, separate state so the wallet + receipts items
  // don't share a confirm flag.
  const [confirmWalletReminder, setConfirmWalletReminder] = useState(false);
  // Same two-click confirm, separate state so the photo + wallet + receipts
  // items don't share a confirm flag.
  const [confirmPhotoReminder, setConfirmPhotoReminder] = useState(false);
  // Same two-click confirm, separate state so the attendance + photo + wallet +
  // receipts items don't share a confirm flag.
  const [confirmAttendanceReminder, setConfirmAttendanceReminder] = useState(false);
  // panuozzo-58217: the custom-tag add field. Declared above the no-actions
  // early return so the conditional return can't reorder hooks.
  const [tagDraft, setTagDraft] = useState('');
  // stracciatella-49112: the dropdown panel is portaled to <body> with fixed
  // positioning so the table's overflow-hidden / overflow-x-auto wrapper can't
  // clip it (single-row tables have no scroll room). We anchor off the kebab
  // button's bounding rect and flip the panel ABOVE the button when there
  // isn't enough room below.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    placement: 'above' | 'below';
  } | null>(null);
  const computeMenuPos = useCallback(() => {
    const MENU_W = 224; // matches w-56
    const MENU_MAX_H = 320; // estimate — used only to decide above/below
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placement: 'above' | 'below' =
      spaceBelow >= MENU_MAX_H || spaceBelow >= spaceAbove ? 'below' : 'above';
    let left = rect.right - MENU_W;
    left = Math.max(8, Math.min(left, window.innerWidth - MENU_W - 8));
    const top = placement === 'below' ? rect.bottom + 4 : rect.top - 4;
    setMenuPos({ top, left, placement });
  }, []);
  // Reposition (not close) the panel while it's open and an ancestor scrolls
  // or the window resizes. Capture phase so scrolling containers between the
  // button and <body> are caught too.
  useEffect(() => {
    if (!menuOpen) return;
    const reposition = () => computeMenuPos();
    window.addEventListener('scroll', reposition, { capture: true });
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', reposition);
    };
  }, [menuOpen, computeMenuPos]);
  const hasMenuItems =
    canAddExternal ||
    canToggleScamFlag ||
    canSendTgReminder ||
    canSendWalletReminder ||
    canSendPhotoReminder ||
    canSendAttendanceReminder ||
    canReopen ||
    canManageTags;
  // Nothing to show at all — render nothing.
  if (!canMarkPaid && !canSendPayment && !canApproveCity && !hasMenuItems) {
    return null;
  }

  const handleAddTag = () => {
    const v = tagDraft;
    setTagDraft('');
    onAddCustomTag?.(v);
  };

  const isApproved = paymentsApprovedUsd != null;

  // stracciatella-58546: mobile card variant — every available action as a
  // full-width labeled button (>=44px touch target). Reuses the same onClick
  // handlers + two-click confirm state as the desktop kebab menu; no portal.
  if (variant === 'card') {
    const cardBtn =
      'w-full min-h-11 inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50';
    return (
      <div
        className="flex flex-col gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {canApproveCity && (
          <button
            type="button"
            disabled={approveBusy}
            onClick={() => {
              if (isApproved) {
                onApproveCity?.(null);
              } else {
                onApproveCity?.(receiptsTotalUsd ?? 0);
              }
            }}
            className={`${cardBtn} ${
              isApproved
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-theme-surface-hover hover:bg-theme-surface text-theme-text-secondary border border-theme-stroke'
            }`}
          >
            {approveBusy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <ThumbsUp size={16} className={isApproved ? 'fill-current' : ''} />
            )}
            {isApproved
              ? `Approved: ${formatUsd(paymentsApprovedUsd)} (clear)`
              : 'Approve payment'}
          </button>
        )}
        {canSendPayment && (
          <button
            type="button"
            onClick={onSendPayment}
            className={`${cardBtn} bg-emerald-600 hover:bg-emerald-700 text-white`}
          >
            <Send size={16} />
            Send payment
          </button>
        )}
        {canMarkPaid && (
          <button
            type="button"
            onClick={onMarkPartyPaid}
            className={`${cardBtn} bg-blue-600 hover:bg-blue-700 text-white`}
          >
            <Check size={16} />
            {markPaidLabel}
          </button>
        )}
        {canReopen && (
          <button
            type="button"
            disabled={reopenBusy}
            onClick={onReopen}
            className={`${cardBtn} border border-theme-stroke text-theme-text hover:bg-theme-surface-hover`}
          >
            {reopenBusy ? (
              <Loader2 size={16} className="animate-spin text-theme-text-muted" />
            ) : (
              <RotateCcw size={16} className="text-amber-400" />
            )}
            Reopen city
          </button>
        )}
        {canAddExternal && (
          <button
            type="button"
            onClick={onAddExternalPayment}
            className={`${cardBtn} border border-theme-stroke text-theme-text hover:bg-theme-surface-hover`}
          >
            <Plus size={16} className="text-sky-500" />
            Add external payment
          </button>
        )}
        {canToggleScamFlag && (
          <button
            type="button"
            disabled={scamFlagBusy}
            onClick={onToggleScamFlag}
            className={`${cardBtn} border border-theme-stroke text-theme-text hover:bg-theme-surface-hover`}
          >
            {scamFlagBusy ? (
              <Loader2 size={16} className="animate-spin text-theme-text-muted" />
            ) : isFlaggedScam ? (
              <CheckCircle2 size={16} className="text-emerald-500" />
            ) : (
              <AlertTriangle size={16} className="text-red-500" />
            )}
            {isFlaggedScam ? 'Unflag possible scam' : 'Flag as possible scam'}
          </button>
        )}
        {canSendTgReminder && (
          <button
            type="button"
            disabled={tgReminderBusy}
            onClick={() => {
              if (!confirmTgReminder) {
                setConfirmTgReminder(true);
                return;
              }
              setConfirmTgReminder(false);
              onSendTgReminder?.();
            }}
            className={`${cardBtn} border border-theme-stroke text-theme-text hover:bg-theme-surface-hover`}
          >
            {tgReminderBusy ? (
              <Loader2 size={16} className="animate-spin text-theme-text-muted" />
            ) : (
              <MessageCircle
                size={16}
                className={confirmTgReminder ? 'text-amber-400' : 'text-sky-400'}
              />
            )}
            {confirmTgReminder
              ? 'Click again to confirm'
              : 'Send receipts reminder'}
          </button>
        )}
        {canSendWalletReminder && (
          <button
            type="button"
            disabled={walletReminderBusy}
            onClick={() => {
              if (!confirmWalletReminder) {
                setConfirmWalletReminder(true);
                return;
              }
              setConfirmWalletReminder(false);
              onSendWalletReminder?.();
            }}
            className={`${cardBtn} border border-theme-stroke text-theme-text hover:bg-theme-surface-hover`}
          >
            {walletReminderBusy ? (
              <Loader2 size={16} className="animate-spin text-theme-text-muted" />
            ) : (
              <Wallet
                size={16}
                className={confirmWalletReminder ? 'text-amber-400' : 'text-sky-400'}
              />
            )}
            {confirmWalletReminder
              ? 'Click again to confirm'
              : 'Send wallet reminder'}
          </button>
        )}
        {canSendPhotoReminder && (
          <button
            type="button"
            disabled={photoReminderBusy}
            onClick={() => {
              if (!confirmPhotoReminder) {
                setConfirmPhotoReminder(true);
                return;
              }
              setConfirmPhotoReminder(false);
              onSendPhotoReminder?.();
            }}
            className={`${cardBtn} border border-theme-stroke text-theme-text hover:bg-theme-surface-hover`}
          >
            {photoReminderBusy ? (
              <Loader2 size={16} className="animate-spin text-theme-text-muted" />
            ) : (
              <Camera
                size={16}
                className={confirmPhotoReminder ? 'text-amber-400' : 'text-sky-400'}
              />
            )}
            {confirmPhotoReminder
              ? 'Click again to confirm'
              : 'Send photo reminder'}
          </button>
        )}
        {canSendAttendanceReminder && (
          <button
            type="button"
            disabled={attendanceReminderBusy}
            onClick={() => {
              if (!confirmAttendanceReminder) {
                setConfirmAttendanceReminder(true);
                return;
              }
              setConfirmAttendanceReminder(false);
              onSendAttendanceReminder?.();
            }}
            className={`${cardBtn} border border-theme-stroke text-theme-text hover:bg-theme-surface-hover`}
          >
            {attendanceReminderBusy ? (
              <Loader2 size={16} className="animate-spin text-theme-text-muted" />
            ) : (
              <Users
                size={16}
                className={
                  confirmAttendanceReminder ? 'text-amber-400' : 'text-sky-400'
                }
              />
            )}
            {confirmAttendanceReminder
              ? 'Click again to confirm'
              : 'Send attendance reminder'}
          </button>
        )}
        {canManageTags && (
          <div className="border-t border-theme-stroke pt-2">
            <div className="flex items-center gap-1 text-xs text-theme-text-muted pb-1.5">
              <Tag size={12} />
              <span>Custom tags</span>
              {tagBusy && <Loader2 size={12} className="animate-spin ml-1" />}
            </div>
            {customTags.length > 0 && (
              <div className="flex flex-wrap gap-1 pb-2">
                {customTags.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-300"
                  >
                    {label}
                    <button
                      type="button"
                      aria-label={`Remove tag ${label}`}
                      disabled={tagBusy}
                      onClick={() => onRemoveCustomTag?.(label)}
                      className="text-indigo-300/70 hover:text-indigo-200 disabled:opacity-50"
                    >
                      <XCircle size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1">
              <div className="flex-1">
                <IconInput
                  icon={Plus}
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  placeholder="Add a tag"
                  maxLength={40}
                  disabled={tagBusy}
                />
              </div>
              <button
                type="button"
                disabled={tagBusy || !tagDraft.trim()}
                onClick={handleAddTag}
                className="px-3 min-h-11 text-sm rounded-md border border-theme-stroke text-theme-text hover:bg-theme-surface-hover disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Approve city — thumbs up button to the left of send. Filled when approved. */}
      {canApproveCity && (
        <button
          type="button"
          disabled={approveBusy}
          onClick={() => {
            if (isApproved) {
              // Already approved — clicking clears the approval
              onApproveCity?.(null);
            } else {
              // Not approved — approve with receipts total as default
              onApproveCity?.(receiptsTotalUsd ?? 0);
            }
          }}
          className={`p-1.5 rounded-md ${
            isApproved
              ? 'bg-amber-500 hover:bg-amber-600 text-white'
              : 'bg-theme-surface-hover hover:bg-theme-surface text-theme-text-secondary border border-theme-stroke'
          } disabled:opacity-50`}
          title={
            isApproved
              ? `Approved: ${formatUsd(paymentsApprovedUsd)} (click to clear)`
              : 'Approve payment amount'
          }
          aria-label={isApproved ? 'Clear approval' : 'Approve payment'}
        >
          {approveBusy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ThumbsUp size={14} className={isApproved ? 'fill-current' : ''} />
          )}
        </button>
      )}
      {/* Primary: Send payment — actively sends via Privy / wire / Mercury.
          Icon-only button with tooltip for the action. */}
      {canSendPayment && (
        <button
          type="button"
          onClick={onSendPayment}
          className="p-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white"
          title="Send payment"
          aria-label="Send payment"
        >
          <Send size={14} />
        </button>
      )}
      {/* Secondary: Mark city paid (or Close city, depending on label).
          Icon-only button with tooltip. */}
      {canMarkPaid && (
        <button
          type="button"
          onClick={onMarkPartyPaid}
          className="p-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white"
          title={markPaidLabel}
          aria-label={markPaidLabel}
        >
          <Check size={14} />
        </button>
      )}
      {/* "⋮" three-dots — icon only, no "Actions" text. Holds the two
          remaining secondary actions: Add external (record an off-platform
          payment) and Flag/Unflag possible scam. Hidden entirely when
          neither is available. */}
      {hasMenuItems && (
        <div>
          <button
            ref={buttonRef}
            type="button"
            onClick={() => {
              setMenuOpen((v) => {
                const next = !v;
                // crocchetta-92106: closing the menu resets the TG-reminder
                // confirm state so a stale "Click again to confirm" doesn't
                // carry over to the next open.
                if (next) {
                  // stracciatella-49112: compute the fixed-position anchor as
                  // we open so the portaled panel lands on the button.
                  computeMenuPos();
                } else {
                  setConfirmTgReminder(false);
                  setConfirmWalletReminder(false);
                  setConfirmPhotoReminder(false);
                  setConfirmAttendanceReminder(false);
                  setMenuPos(null);
                }
                return next;
              });
            }}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-theme-stroke text-theme-text-secondary hover:bg-theme-surface-hover"
            title="More actions"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && menuPos && createPortal(
            <>
              {/* click-out overlay */}
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 50 }}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmTgReminder(false);
                  setConfirmWalletReminder(false);
                  setConfirmPhotoReminder(false);
                  setConfirmAttendanceReminder(false);
                  setMenuPos(null);
                }}
              />
              <div
                className="w-56 rounded-lg border border-theme-stroke bg-[#1a1a2e] shadow-xl py-1"
                role="menu"
                style={{
                  position: 'fixed',
                  top: menuPos.top,
                  left: menuPos.left,
                  zIndex: 60,
                  ...(menuPos.placement === 'above'
                    ? { transform: 'translateY(-100%)' }
                    : null),
                }}
              >
                {/* Reopen a city that was closed by mistake. Reverts the
                    payouts the close flipped to completed + clears the close
                    flag. Reversible (re-close) — no confirm. Listed first
                    since it's the relevant action on a closed row. */}
                {canReopen && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={reopenBusy}
                    onClick={() => {
                      setMenuOpen(false);
                      onReopen?.();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-theme-text hover:bg-theme-surface-hover flex items-center gap-2 disabled:opacity-50"
                  >
                    {reopenBusy ? (
                      <Loader2 size={14} className="animate-spin text-theme-text-muted" />
                    ) : (
                      <RotateCcw size={14} className="text-amber-400" />
                    )}
                    Reopen city
                  </button>
                )}
                {canAddExternal && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onAddExternalPayment?.();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-theme-text hover:bg-theme-surface-hover flex items-center gap-2"
                  >
                    <Plus size={14} className="text-sky-500" />
                    Add external payment
                  </button>
                )}
                {/* bottarga-92104: flip the `possible-scam` tag on/off.
                    Reversible — no confirm modal
                    (feedback_reversible_actions_no_confirm). Label flips
                    with the current tag state. */}
                {canToggleScamFlag && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={scamFlagBusy}
                    onClick={() => {
                      setMenuOpen(false);
                      onToggleScamFlag?.();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-theme-text hover:bg-theme-surface-hover flex items-center gap-2 disabled:opacity-50"
                  >
                    {scamFlagBusy ? (
                      <Loader2
                        size={14}
                        className="animate-spin text-theme-text-muted"
                      />
                    ) : isFlaggedScam ? (
                      <CheckCircle2 size={14} className="text-emerald-500" />
                    ) : (
                      <AlertTriangle size={14} className="text-red-500" />
                    )}
                    {isFlaggedScam
                      ? 'Unflag possible scam'
                      : 'Flag as possible scam'}
                  </button>
                )}
                {/* crocchetta-92106: Send receipts reminder via Molto Benny
                    Telegram bot. DMs the primary host (when their TG is
                    linked) and posts to the shared GPP group chat. Two-click
                    confirm — first click flips the label to "Click again to
                    confirm" because a DM can't be unsent (reversible-action
                    convention DOESN'T apply here per
                    feedback_reversible_actions_no_confirm). */}
                {canSendTgReminder && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={tgReminderBusy}
                    onClick={() => {
                      if (!confirmTgReminder) {
                        setConfirmTgReminder(true);
                        return;
                      }
                      setMenuOpen(false);
                      setConfirmTgReminder(false);
                      onSendTgReminder?.();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-theme-text hover:bg-theme-surface-hover flex items-center gap-2 disabled:opacity-50"
                  >
                    {tgReminderBusy ? (
                      <Loader2
                        size={14}
                        className="animate-spin text-theme-text-muted"
                      />
                    ) : (
                      <MessageCircle
                        size={14}
                        className={
                          confirmTgReminder ? 'text-amber-400' : 'text-sky-400'
                        }
                      />
                    )}
                    <span className="flex flex-col items-start">
                      <span>
                        {confirmTgReminder
                          ? 'Click again to confirm'
                          : 'Send receipts reminder'}
                      </span>
                      {receiptsReminderSentAt && !confirmTgReminder && (
                        <span className="text-xs text-theme-text-muted">
                          Sent {new Date(receiptsReminderSentAt).toLocaleDateString()}
                        </span>
                      )}
                    </span>
                  </button>
                )}
                {/* Send wallet reminder — sibling of the receipts reminder.
                    DMs the host + posts to the city group telling them to
                    submit their payout wallet address. Same two-click confirm
                    (DMs can't be unsent). Shows a last-sent sub-label from
                    `walletReminderSentAt`, mirroring the receipts reminder. */}
                {canSendWalletReminder && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={walletReminderBusy}
                    onClick={() => {
                      if (!confirmWalletReminder) {
                        setConfirmWalletReminder(true);
                        return;
                      }
                      setMenuOpen(false);
                      setConfirmWalletReminder(false);
                      onSendWalletReminder?.();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-theme-text hover:bg-theme-surface-hover flex items-center gap-2 disabled:opacity-50"
                  >
                    {walletReminderBusy ? (
                      <Loader2
                        size={14}
                        className="animate-spin text-theme-text-muted"
                      />
                    ) : (
                      <Wallet
                        size={14}
                        className={
                          confirmWalletReminder ? 'text-amber-400' : 'text-sky-400'
                        }
                      />
                    )}
                    <span className="flex flex-col items-start">
                      <span>
                        {confirmWalletReminder
                          ? 'Click again to confirm'
                          : 'Send wallet reminder'}
                      </span>
                      {walletReminderSentAt && !confirmWalletReminder && (
                        <span className="text-xs text-theme-text-muted">
                          Sent {new Date(walletReminderSentAt).toLocaleDateString()}
                        </span>
                      )}
                    </span>
                  </button>
                )}
                {/* Send photo reminder — sibling of the receipts reminder.
                    DMs the host + posts to the city group telling them to
                    upload their event photos. Same two-click confirm
                    (DMs can't be unsent). Shows a last-sent sub-label from
                    `photoReminderSentAt`, mirroring the receipts reminder. */}
                {canSendPhotoReminder && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={photoReminderBusy}
                    onClick={() => {
                      if (!confirmPhotoReminder) {
                        setConfirmPhotoReminder(true);
                        return;
                      }
                      setMenuOpen(false);
                      setConfirmPhotoReminder(false);
                      onSendPhotoReminder?.();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-theme-text hover:bg-theme-surface-hover flex items-center gap-2 disabled:opacity-50"
                  >
                    {photoReminderBusy ? (
                      <Loader2
                        size={14}
                        className="animate-spin text-theme-text-muted"
                      />
                    ) : (
                      <Camera
                        size={14}
                        className={
                          confirmPhotoReminder ? 'text-amber-400' : 'text-sky-400'
                        }
                      />
                    )}
                    <span className="flex flex-col items-start">
                      <span>
                        {confirmPhotoReminder
                          ? 'Click again to confirm'
                          : 'Send photo reminder'}
                      </span>
                      {photoReminderSentAt && !confirmPhotoReminder && (
                        <span className="text-xs text-theme-text-muted">
                          Sent {new Date(photoReminderSentAt).toLocaleDateString()}
                        </span>
                      )}
                    </span>
                  </button>
                )}
                {/* Send attendance reminder — sibling of the photo reminder.
                    DMs the host + posts to the city group telling them to
                    submit their event's estimated attendance. Same two-click
                    confirm (DMs can't be unsent). Shows a last-sent sub-label
                    from `attendanceReminderSentAt`, mirroring the photo reminder. */}
                {canSendAttendanceReminder && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={attendanceReminderBusy}
                    onClick={() => {
                      if (!confirmAttendanceReminder) {
                        setConfirmAttendanceReminder(true);
                        return;
                      }
                      setMenuOpen(false);
                      setConfirmAttendanceReminder(false);
                      onSendAttendanceReminder?.();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-theme-text hover:bg-theme-surface-hover flex items-center gap-2 disabled:opacity-50"
                  >
                    {attendanceReminderBusy ? (
                      <Loader2
                        size={14}
                        className="animate-spin text-theme-text-muted"
                      />
                    ) : (
                      <Users
                        size={14}
                        className={
                          confirmAttendanceReminder ? 'text-amber-400' : 'text-sky-400'
                        }
                      />
                    )}
                    <span className="flex flex-col items-start">
                      <span>
                        {confirmAttendanceReminder
                          ? 'Click again to confirm'
                          : 'Send attendance reminder'}
                      </span>
                      {attendanceReminderSentAt && !confirmAttendanceReminder && (
                        <span className="text-xs text-theme-text-muted">
                          Sent {new Date(attendanceReminderSentAt).toLocaleDateString()}
                        </span>
                      )}
                    </span>
                  </button>
                )}
                {/* panuozzo-58217: free-text custom tags. Admins + underbosses
                    may add/view/remove. Stored `custom:`-prefixed in
                    event_tags. Reversible → no confirm; keep the menu open on
                    add/remove. stopPropagation so clicks on the input/chips
                    don't reach the click-out overlay. */}
                {canManageTags && (
                  <div
                    className="border-t border-theme-stroke mt-1 pt-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-1 text-xs text-theme-text-muted px-3 pt-2">
                      <Tag size={12} />
                      <span>Custom tags</span>
                      {tagBusy && (
                        <Loader2 size={12} className="animate-spin ml-1" />
                      )}
                    </div>
                    {customTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 px-3 pt-1.5">
                        {customTags.map((label) => (
                          <span
                            key={label}
                            className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-300"
                          >
                            {label}
                            <button
                              type="button"
                              aria-label={`Remove tag ${label}`}
                              disabled={tagBusy}
                              onClick={() => onRemoveCustomTag?.(label)}
                              className="text-indigo-300/70 hover:text-indigo-200 [.gpp-theme_&]:text-indigo-700 [.gpp-theme_&]:hover:text-indigo-900 disabled:opacity-50"
                            >
                              <XCircle size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-1 px-3 py-2">
                      <div className="flex-1">
                        <IconInput
                          icon={Plus}
                          value={tagDraft}
                          onChange={(e) => setTagDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddTag();
                            }
                          }}
                          placeholder="Add a tag"
                          maxLength={40}
                          disabled={tagBusy}
                        />
                      </div>
                      <button
                        type="button"
                        disabled={tagBusy || !tagDraft.trim()}
                        onClick={handleAddTag}
                        className="px-2 py-1.5 text-xs rounded-md border border-theme-stroke text-theme-text hover:bg-theme-surface-hover disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>,
            document.body,
          )}
        </div>
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
  canManagePhotos,
  canEditAdminNotes,
  onApprove,
  onExecute,
  onMarkPaid,
  onReceiptOverride,
  onDocumentsChanged,
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
  /**
   * provolone-58531: gates the "+ Add photo" button (admin OR underboss).
   * Unlike `canEditReceipts` (admin-only), underbosses can add event photos.
   */
  canManagePhotos: boolean;
  /**
   * mortadella-92106: gates the city-level admin notes textarea (read AND
   * write). True for admin / super_admin / payment_admin. Underbosses don't
   * see the input at all — they also receive `row.party.adminNotes === null`
   * from the server, so this is belt-and-braces.
   */
  canEditAdminNotes: boolean;
  /** Per-payout approve handler (pending -> approved). */
  onApprove?: (id: string) => void;
  /** Per-payout execute handler (approved/failed -> send payment). */
  onExecute?: (payout: AdminPayout) => void;
  /** Per-payout mark-paid handler (approved -> paid manually). */
  onMarkPaid?: (payout: AdminPayout) => void;
  /** Callback to propagate receipt overrides to parent for row update. */
  onReceiptOverride?: (
    docId: string,
    override: { ocrAmount: number | null; isDuplicate?: boolean; ineligible?: boolean },
  ) => void;
  /**
   * schiacciata-58503: refetch the by-party feed after an admin adds a
   * receipt / photo via the in-panel AdminAddAttachment controls.
   */
  onDocumentsChanged?: (partyId: string) => void;
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
  // provolone-58531: admin/underboss "Add photo" modal (host-style role slots).
  const [showAddPhotos, setShowAddPhotos] = useState(false);
  // provolone-58531: stable refetch callback for the photos modal so passing it
  // into EventPhotosCard's onPhotosChange doesn't churn its load effect.
  const handlePhotosAdded = useCallback(() => {
    onDocumentsChanged?.(row.party.id);
  }, [onDocumentsChanged, row.party.id]);

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
    // provola-92106: per-receipt ineligible flag override. Independent of
    // `isDuplicate` — both can be true on the same row.
    ineligible?: boolean;
    // caprino-92104: persist the FX recompute details so the lightbox
    // editor's "USD value @ rate" line refreshes immediately on save.
    originalAmount?: number | null;
    originalCurrency?: string | null;
    exchangeRate?: number | null;
  };
  const [receiptOverrides, setReceiptOverrides] = useState<Record<string, ReceiptOverride>>({});
  // Amount/currency drafts (string-typed so admins can type freely).
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, ReceiptDraft>>({});
  const [receiptSavingId, setReceiptSavingId] = useState<string | null>(null);
  const [receiptSaveErrors, setReceiptSaveErrors] = useState<Record<string, string>>({});
  // caprino-92104: per-row backend error code (e.g. FX_RATE_UNAVAILABLE) so
  // the editor can render the "Set USD manually" fallback toggle.
  const [receiptSaveErrorCodes, setReceiptSaveErrorCodes] = useState<Record<string, string>>({});
  // Mark-duplicate state.
  const [duplicateSavingId, setDuplicateSavingId] = useState<string | null>(null);
  const [duplicateSaveErrors, setDuplicateSaveErrors] = useState<Record<string, string>>({});
  // provola-92106: Mark-ineligible state. Mirrors duplicate's scoping —
  // separate buckets so a toggle failure on one doesn't clobber the other.
  const [ineligibleSavingId, setIneligibleSavingId] = useState<string | null>(null);
  const [ineligibleSaveErrors, setIneligibleSaveErrors] = useState<Record<string, string>>({});
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

  // mortadella-92106: city-level admin notes state. `noteDraft` is the
  // working value the textarea binds to so the admin can type freely before
  // the autosave-on-blur fires. Initial value comes from `row.party.adminNotes`
  // (server-supplied; null for underbosses). `noteSaveStatus` drives the
  // inline "Saved" / "Saving…" / "Save failed" indicator and is intentionally
  // unionized like PaymentDetailsCard so the same render branches work.
  const [noteDraft, setNoteDraft] = useState<string>(row.party.adminNotes ?? '');
  const [noteSaveStatus, setNoteSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [noteSaveError, setNoteSaveError] = useState<string | null>(null);
  // Last value that was successfully persisted — used to detect "no-op on
  // blur" so we don't fire a PATCH when the admin tabs away without editing.
  const [noteSaved, setNoteSaved] = useState<string>(row.party.adminNotes ?? '');

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
          // provola-92106: layer in the ineligible override too.
          ineligible:
            ov.ineligible !== undefined ? ov.ineligible : e.doc.ineligible,
          // caprino-92104: layer the FX recompute fields so the lightbox
          // editor's "USD value @ rate" row refreshes without a refetch.
          originalAmount:
            ov.originalAmount !== undefined ? ov.originalAmount : e.doc.originalAmount,
          originalCurrency:
            ov.originalCurrency !== undefined ? ov.originalCurrency : e.doc.originalCurrency,
          exchangeRate:
            ov.exchangeRate !== undefined ? ov.exchangeRate : e.doc.exchangeRate,
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

  // schiacciata-58503: the panel merges receipts/photos across `row.payouts`
  // (multi-host pot), so there's no single payout. AdminAddAttachment needs
  // one `payoutId` to attach to — pick the most-recently-created payout as the
  // target for newly-added docs. Must stay in the hook block (above any
  // conditional return) per the hooks-above-early-returns rule.
  const primaryPayout = useMemo(
    () => [...row.payouts].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0] ?? null,
    [row.payouts],
  );

  // Unified-rollup totals computed client-side from the payouts already on
  // the wire. NB: the by-party endpoint already exposes pending/approved/
  // paid/completed aggregates, but we re-derive client-side off the same
  // payouts array so the rollup stays consistent with whatever's actually
  // shown in the panel (and we can hand-pick committed-cap semantics).
  const rollup = useMemo(() => {
    const payouts = row.payouts;
    // coppa-92105: admin-marked duplicates are evidence-only — exclude their
    // OCR amounts from the "Receipts collected" rollup so the by-city tile
    // matches the per-payout modal's `ocrSum` semantics (which already
    // filters duplicates) and the host PATCH `survivingOcrSum` recompute.
    // provola-92106: same exclusion for the ineligible flag — both filters
    // share the same math.
    const receiptUsdTotal = receiptEntries.reduce(
      (s, e) =>
        s
        + (e.doc.isDuplicate || e.doc.ineligible
          ? 0
          : (Number(e.doc.ocrAmount) || 0)),
      0,
    );
    const receiptCount = receiptEntries.length;
    // coppa-92105: surface the duplicate count on the rollup so the tile can
    // render "$X (N receipts, M duplicates excluded)" when M > 0. Visible
    // proof the exclusion happened.
    const duplicateCount = receiptEntries.reduce(
      (n, e) => n + (e.doc.isDuplicate ? 1 : 0),
      0,
    );
    // provola-92106: ineligible-but-not-also-duplicate count. The thumbnail
    // pill + the rollup subtitle prefer duplicate as the primary signal
    // when both flags are set, so this stays exclusive of the duplicate
    // bucket to avoid double-counting in the "M dup + K ineligible" string.
    const ineligibleCount = receiptEntries.reduce(
      (n, e) => n + (!e.doc.isDuplicate && e.doc.ineligible ? 1 : 0),
      0,
    );

    let approvedUsd = 0;
    let paidUsd = 0;
    // prosciutto-92106: paid rows lacking proof — surfaced separately so the
    // rollup tile shows only proven sends while the ledger can still render
    // the zombie row with a "no proof" chip.
    let paidNoProofUsd = 0;
    let paidNoProofCount = 0;
    let pendingUsd = 0;
    let pendingCount = 0;
    const pendingPayouts: AdminPayout[] = [];
    const paidPayouts: AdminPayout[] = [];

    for (const p of payouts) {
      const usd = Number(p.finalAmountUsd) || 0;
      // prosciutto-92106: zombie status='paid' rows (no proof) DON'T count
      // toward Approved either — they neither moved money nor represent a
      // commitment that will move money. Without this they'd inflate the
      // Outstanding number too.
      if (isCommittedStatus(p.status) && payoutHasProof(p)) approvedUsd += usd;
      else if (p.status === 'approved') approvedUsd += usd; // approved always counts
      if (isPaidStatus(p.status)) {
        if (payoutHasProof(p)) {
          paidUsd += usd;
        } else {
          paidNoProofUsd += usd;
          paidNoProofCount += 1;
        }
        paidPayouts.push(p);
      }
      if (p.status === 'pending') {
        pendingUsd += usd;
        pendingCount += 1;
        pendingPayouts.push(p);
      }
    }
    // approved-but-not-yet-paid + queued (wire awaiting settlement) are "in flight";
    // surface those alongside pending so the admin can drill into either.
    const approvedNotPaid = payouts.filter(
      (p) => p.status === 'approved' || p.status === 'queued'
    );

    return {
      receiptUsdTotal,
      receiptCount,
      duplicateCount,
      ineligibleCount,
      approvedUsd,
      paidUsd,
      paidNoProofUsd,
      paidNoProofCount,
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
  // ziti-58300: also capture the most-recent `submittedForReviewAt` across the
  // host's active (non-terminal) rolling records so the chip can show which
  // co-hosts have signalled "ready for review" vs still rolling.
  const TERMINAL_STATUSES = ['paid', 'completed', 'withdrawn', 'rejected'];
  const hosts = useMemo(() => {
    const seen = new Map<
      string,
      {
        id: string;
        name: string | null;
        email: string | null;
        submittedForReviewAt: string | null;
        // cannelloni-58543: most-recent photo waiver across active records.
        photosWaivedAt: string | null;
      }
    >();
    for (const p of row.payouts) {
      const h = p.host;
      if (!h?.id) continue;
      // Only an active (non-terminal) rolling record counts as host-ready.
      const submitted =
        !TERMINAL_STATUSES.includes(p.status) && p.submittedForReviewAt
          ? p.submittedForReviewAt
          : null;
      // cannelloni-58543: track the waiver on the same active-record basis.
      const waived =
        !TERMINAL_STATUSES.includes(p.status) && p.photosWaivedAt
          ? p.photosWaivedAt
          : null;
      const existing = seen.get(h.id);
      if (existing) {
        // Keep the latest submitted timestamp if more than one active record.
        if (submitted && (!existing.submittedForReviewAt || submitted > existing.submittedForReviewAt)) {
          existing.submittedForReviewAt = submitted;
          existing.photosWaivedAt = waived;
        }
        continue;
      }
      seen.set(h.id, {
        id: h.id,
        name: h.name,
        email: h.email,
        submittedForReviewAt: submitted,
        photosWaivedAt: waived,
      });
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
        // nduja-58514: surface uploader + timestamp in the lightbox footer.
        caption: photoUploaderCaption(p),
      })),
    [eventPhotos],
  );
  const pizzaLightboxImages: ReceiptLightboxImage[] = useMemo(
    () =>
      pizzaPhotos.map((p) => ({
        url: p.url,
        fileName: p.fileName,
        mimeType: p.mimeType,
        // nduja-58514: surface uploader + timestamp in the lightbox footer.
        caption: photoUploaderCaption(p),
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
    setReceiptSaveErrorCodes((m) => {
      const next = { ...m };
      delete next[docId];
      return next;
    });
    try {
      // caprino-92104: send originalAmount + ocrCurrency; backend re-runs FX
      // and returns the canonical USD value + exchange rate. Manual-USD mode
      // bypasses FX and sends ocrAmount + ocrCurrency verbatim.
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
          ocrLineItems: updated.ocrLineItems,
          isDuplicate: updated.isDuplicate,
          // provola-92106: carry through the server-authoritative ineligible
          // flag so a prior toggle isn't lost when amount/currency is also
          // edited.
          ineligible: updated.ineligible,
          originalAmount: updated.originalAmount,
          originalCurrency: updated.originalCurrency,
          exchangeRate: updated.exchangeRate,
        },
      }));
      // Propagate to parent so collapsed row updates
      onReceiptOverride?.(docId, {
        ocrAmount: updated.ocrAmount,
        isDuplicate: updated.isDuplicate,
        ineligible: updated.ineligible,
      });
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
            // provola-92106: server is authoritative on both flags.
            ineligible: updated.ineligible,
          },
        };
      });
      // Propagate to parent so collapsed row updates
      onReceiptOverride?.(docId, {
        ocrAmount: updated.ocrAmount,
        isDuplicate: updated.isDuplicate,
        ineligible: updated.ineligible,
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

  // provola-92106: toggle the per-receipt ineligible flag via the same
  // PATCH /documents/:docId endpoint. Mirrors `toggleDuplicate` above —
  // optimistic override, roll back on failure. Independent of the duplicate
  // flag.
  const toggleIneligible = useCallback(async (docId: string, nextValue: boolean) => {
    setIneligibleSavingId(docId);
    setIneligibleSaveErrors((m) => {
      const next = { ...m };
      delete next[docId];
      return next;
    });
    const prior = receiptEntries.find((e) => e.doc.id === docId)?.doc;
    setReceiptOverrides((m) => {
      const cur = m[docId] ?? {
        ocrAmount: prior?.ocrAmount ?? null,
        ocrCurrency: prior?.ocrCurrency ?? null,
      };
      return { ...m, [docId]: { ...cur, ineligible: nextValue } };
    });
    try {
      const updated = await markReceiptIneligible(docId, nextValue);
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
            ineligible: updated.ineligible,
          },
        };
      });
      // Propagate to parent so collapsed row updates
      onReceiptOverride?.(docId, {
        ocrAmount: updated.ocrAmount,
        isDuplicate: updated.isDuplicate,
        ineligible: updated.ineligible,
      });
    } catch (err: any) {
      setReceiptOverrides((m) => {
        const cur = m[docId];
        if (!cur) return m;
        return {
          ...m,
          [docId]: { ...cur, ineligible: prior?.ineligible === true },
        };
      });
      setIneligibleSaveErrors((m) => ({
        ...m,
        [docId]: err?.message || 'Failed to mark ineligible',
      }));
    } finally {
      setIneligibleSavingId(null);
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

  const applyLineSumToAmount = useCallback((docId: string) => {
    const drafts = lineItemDrafts[docId] ?? [];
    let sum = 0;
    for (const d of drafts) {
      // provola-92106: ineligible lines stay out of the rolled-up amount.
      if (d.ineligible === true) continue;
      sum += computeLineSubtotal(d);
    }
    // caprino-92104: line items are in the receipt's ORIGINAL currency, so
    // the line sum maps to the originalAmount draft, not USD.
    setReceiptDrafts((m) => {
      const prev = m[docId];
      return {
        ...m,
        [docId]: {
          originalAmount: sum.toFixed(2),
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
        if (!Number.isFinite(qty) || qty < 0) {
          throw new Error(`Line ${idx + 1}: qty must be a non-negative number`);
        }
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new Error(`Line ${idx + 1}: unit price must be a non-negative number`);
        }
        // crescenza-92112: subtotal is calculated, not entered.
        const subtotal = computeLineSubtotal(d);
        // provola-92106: persist per-line ineligible only when true.
        const out: ReceiptLineItem = {
          name: d.name,
          qty,
          unitPrice,
          subtotal,
          category: d.category,
        };
        if (d.ineligible === true) out.ineligible = true;
        return out;
      });
      const updated = await updatePayoutDocument(docId, { ocrLineItems: items });
      setReceiptOverrides((m) => ({
        ...m,
        [docId]: {
          ocrAmount: updated.ocrAmount,
          ocrCurrency: updated.ocrCurrency,
          ocrLineItems: updated.ocrLineItems,
          isDuplicate: updated.isDuplicate,
          // provola-92106: carry through the ineligible flag too.
          ineligible: updated.ineligible,
        },
      }));
      // Propagate to parent so collapsed row updates
      onReceiptOverride?.(docId, {
        ocrAmount: updated.ocrAmount,
        isDuplicate: updated.isDuplicate,
        ineligible: updated.ineligible,
      });
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
      // caprino-92104: compare against the seed (originalAmount column,
      // falling back to ocrAmount for legacy rows) and originalCurrency.
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
          a.category !== b.category ||
          // provola-92106: per-line ineligible flag is dirty-trackable too.
          // Normalize both sides to boolean so undefined === false comparisons
          // don't false-positive.
          (a.ineligible === true) !== (b.ineligible === true)
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

  // mortadella-92106: autosave-on-blur for the city-level admin notes.
  // Optimistic — the textarea binds to `noteDraft` and the typed value is
  // visible immediately. On blur we PATCH only when the draft differs from
  // the last-saved value; on failure we surface an inline error and roll the
  // local "saved" anchor back to `noteSaved` (no rollback of the textarea
  // contents — the admin can fix and re-blur to retry).
  const handleSaveAdminNotes = useCallback(async () => {
    if (!canEditAdminNotes) return;
    const trimmed = noteDraft.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    const prev = noteSaved.trim().length === 0 ? null : noteSaved;
    if (next === prev) {
      // No-op blur (admin tabbed away without editing) — don't fire a PATCH.
      return;
    }
    setNoteSaveStatus('saving');
    setNoteSaveError(null);
    try {
      const result = await setCityAdminNotes(row.party.id, next);
      setNoteSaved(result.adminNotes ?? '');
      setNoteSaveStatus('saved');
      // Clear the "Saved" badge after a moment so it doesn't stick.
      window.setTimeout(() => {
        setNoteSaveStatus((s) => (s === 'saved' ? 'idle' : s));
      }, 1800);
    } catch (err: any) {
      setNoteSaveStatus('error');
      setNoteSaveError(err?.message || 'Failed to save city notes');
    }
  }, [canEditAdminNotes, noteDraft, noteSaved, row.party.id]);

  // pesto-92105: build the editor pane for the lightbox. Gated to receipt
  // bucket + admin viewer; null for event/pizza photos and underbosses (the
  // lightbox then renders its plain photo-only layout).
  const lightboxEditorPane = useMemo(() => {
    if (!canEditReceipts) return null;
    if (lightbox?.bucket !== 'receipt') return null;
    if (!lightboxReceipt) return null;
    const r = lightboxReceipt;
    // caprino-92104: seed from the canonical persisted shape — prefer the
    // `originalAmount` column, fall back to `ocrAmount` for legacy rows
    // (matches the backend's legacy fallback for FX recompute).
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
        isIneligible={r.ineligible === true}
        ineligibleSaving={ineligibleSavingId === r.id}
        ineligibleError={ineligibleSaveErrors[r.id]}
        onToggleIneligible={() => toggleIneligible(r.id, !(r.ineligible === true))}
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
        onUseLineSumForAmount={() => applyLineSumToAmount(r.id)}
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
    receiptSaveErrorCodes,
    duplicateSavingId,
    duplicateSaveErrors,
    ineligibleSavingId,
    ineligibleSaveErrors,
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
                  {/* ziti-58300: amber pill on the co-host chip when they've
                      flipped their rolling reimbursement's "Submit for review"
                      toggle — distinguishes host-ready co-hosts from those
                      still rolling. */}
                  <SubmittedForReviewBadge
                    submittedForReviewAt={h.submittedForReviewAt}
                    photosWaivedAt={h.photosWaivedAt}
                    compact
                  />
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

      {/*
        mortadella-92106: city-level admin notes (admin-only). Free-text
        scratchpad for context that doesn't fit per-payout notes:
        "host unresponsive", "follow up with city org", "claim disputed",
        "needs translator", etc. Autosave on blur, optimistic UI, surfaced
        only for admin viewers (underbosses also receive `adminNotes = null`
        from the server so this is belt-and-braces).
      */}
      {canEditAdminNotes && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1 text-theme-text-muted text-xs uppercase tracking-wide">
              <StickyNote size={12} />
              City notes (admin only)
            </span>
            <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
              {noteSaveStatus === 'saving' && (
                <>
                  <Loader2 size={12} className="animate-spin text-theme-text-muted" />
                  <span className="text-theme-text-muted">Saving…</span>
                </>
              )}
              {noteSaveStatus === 'saved' && (
                <>
                  <Check size={12} className="text-emerald-500" />
                  <span className="text-emerald-500">Saved</span>
                </>
              )}
              {noteSaveStatus === 'error' && (
                <>
                  <AlertCircle size={12} className="text-[#ff393a]" />
                  <span className="text-[#ff393a]">{noteSaveError || 'Save failed'}</span>
                </>
              )}
            </div>
          </div>
          <IconInput
            multiline
            rows={3}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={handleSaveAdminNotes}
            placeholder="Internal notes about this city... (admin only)"
            className="input"
            maxLength={4000}
          />
        </div>
      )}

      {/* Four-number rollup */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <RollupTile
          label="Receipts collected"
          value={formatUsd(rollup.receiptUsdTotal)}
          /* coppa-92105: when duplicates exist, append "M duplicate(s) excluded"
              so admins see at a glance that the USD total skipped them. The
              culatello-92104 modal does the same on its "Sum of OCR amounts"
              footer; this is the city-level mirror.
              provola-92106: parallel "K ineligible excluded" hint. Both
              counts can appear in the same string when the city has a mix. */
          sub={(() => {
            const base = `${rollup.receiptCount} receipt${rollup.receiptCount === 1 ? '' : 's'}`;
            const parts: string[] = [base];
            if (rollup.duplicateCount > 0) {
              parts.push(`${rollup.duplicateCount} duplicate${rollup.duplicateCount === 1 ? '' : 's'} excluded`);
            }
            if (rollup.ineligibleCount > 0) {
              parts.push(`${rollup.ineligibleCount} ineligible excluded`);
            }
            return parts.join(', ');
          })()}
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
          sub={
            rollup.paidNoProofCount > 0
              ? `+ ${formatUsd(rollup.paidNoProofUsd)} unverified (${rollup.paidNoProofCount} row${rollup.paidNoProofCount === 1 ? '' : 's'} no proof)`
              : undefined
          }
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
            <div className="mt-2 border-t border-amber-500/20 pt-2 space-y-1 max-h-64 overflow-y-auto">
              {inflightPayouts.map((p) => {
                const isSelected = selectedIds.has(p.id);
                const isBusy = busyRowId === p.id;
                // Wallet/ENS display: show ENS name -> 0x if ENS was used, else just 0x
                const walletDisplay =
                  p.payoutMethod === 'usdc_base' && p.payoutWalletAddress
                    ? p.payoutWalletInput &&
                      p.payoutWalletInput !== p.payoutWalletAddress
                      ? `${p.payoutWalletInput} → ${truncateMiddle(p.payoutWalletAddress, 6, 4)}`
                      : truncateMiddle(p.payoutWalletAddress, 6, 4)
                    : null;
                const isPending = p.status === 'pending';
                const isApprovedOrFailed =
                  p.status === 'approved' || p.status === 'failed';
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
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                    >
                      <PayoutStatusPill status={p.status} />
                      {/* ziti-58300: host-signaled "ready for review" pill on
                          the per-payout ledger row inside the expansion. */}
                      <SubmittedForReviewBadge
                        submittedForReviewAt={p.submittedForReviewAt}
                        photosWaivedAt={p.photosWaivedAt}
                        compact
                      />
                      <span className="text-theme-text-secondary text-xs min-w-[5.5rem] shrink-0">
                        {formatLedgerDate(p.createdAt)}
                      </span>
                      <span className="font-medium text-theme-text shrink-0">
                        {formatUsd(Number(p.finalAmountUsd))}
                      </span>
                      <span className="text-xs text-theme-text-muted truncate">
                        {p.host?.name || p.host?.email || 'Unknown host'}
                      </span>
                      {/* Wallet/ENS display */}
                      {walletDisplay && (
                        <span
                          className="text-xs text-theme-text-faint font-mono truncate"
                          title={p.payoutWalletAddress || undefined}
                        >
                          {walletDisplay}
                        </span>
                      )}
                    </button>
                    {/* Action buttons — icon-only */}
                    <div
                      className="flex items-center gap-1 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isBusy ? (
                        <Loader2
                          size={14}
                          className="animate-spin text-theme-text-muted"
                        />
                      ) : (
                        <>
                          {/* Approve (pending only) */}
                          {isPending && onApprove && (
                            <button
                              type="button"
                              onClick={() => onApprove(p.id)}
                              className="p-1.5 rounded-md hover:bg-emerald-500/20 text-emerald-500"
                              title="Approve"
                            >
                              <ThumbsUp size={14} />
                            </button>
                          )}
                          {/* Send payment (approved/failed) */}
                          {isApprovedOrFailed && onExecute && (
                            <button
                              type="button"
                              onClick={() => onExecute(p)}
                              className="p-1.5 rounded-md hover:bg-emerald-500/20 text-emerald-500"
                              title={
                                p.status === 'failed'
                                  ? 'Retry payment'
                                  : 'Send payment'
                              }
                            >
                              <Send size={14} />
                            </button>
                          )}
                          {/* Mark paid (approved/failed) */}
                          {isApprovedOrFailed && onMarkPaid && (
                            <button
                              type="button"
                              onClick={() => onMarkPaid(p)}
                              className="p-1.5 rounded-md hover:bg-blue-500/20 text-blue-500"
                              title="Mark paid (manual)"
                            >
                              <DollarSign size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Merged receipt grid. schiacciata-58503: the header (with the admin
          "Add receipt" control) renders whenever the viewer can edit receipts
          and there's a target payout — even on an empty city, so the FIRST
          receipt can be added. Only the thumbnail grid stays gated on count. */}
      {(receiptEntries.length > 0 || (canEditReceipts && primaryPayout) || canManagePhotos) && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs uppercase tracking-wide text-theme-text-muted">
              Receipts ({receiptEntries.length})
            </div>
            <div className="flex items-center gap-2">
              {/* provolone-58531: admin/underboss "Add photo" → host-style modal
                  (3 role slots + additional photos). Available even with no
                  payout, since it operates on the party gallery. */}
              {canManagePhotos && (
                <button
                  type="button"
                  onClick={() => setShowAddPhotos(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-theme-surface border border-theme-stroke text-theme-text hover:border-[#ff393a]/40 transition-colors"
                >
                  <Plus size={13} /> Add photo
                </button>
              )}
              {canEditReceipts && primaryPayout && (
                <AdminAddAttachment
                  payoutId={primaryPayout.id}
                  partyId={row.party.id}
                  mode="receipt"
                  onAdded={() => onDocumentsChanged?.(row.party.id)}
                />
              )}
            </div>
          </div>
          {receiptEntries.length === 0 ? (
            <div className="text-sm text-theme-text-faint">
              No receipts attached.
            </div>
          ) : (
          <div className="flex flex-wrap gap-2">
            {receiptEntries.map((e, idx) => {
              // coppa-92105: dim + diagonal-stripe overlay + DUPLICATE pill on
              // duplicate thumbnails so the by-city grid matches the per-
              // payout modal's left-pane grid (culatello-92104) and admins
              // can't miss that the receipt is excluded from the rollup.
              // provola-92106: amber variant for ineligible (135° stripes +
              // INELIGIBLE pill, but duplicate wins when both are on).
              const isDup = e.doc.isDuplicate === true;
              const isIne = e.doc.ineligible === true && !isDup;
              return (
                <button
                  key={e.doc.id}
                  type="button"
                  onClick={() => setLightbox({ bucket: 'receipt', index: idx })}
                  className={`group relative w-16 h-16 rounded-md overflow-hidden border hover:border-theme-stroke-hover ${
                    isDup
                      ? 'opacity-50 border-red-500/60'
                      : isIne
                        ? 'opacity-60 border-amber-500/60'
                        : 'border-theme-stroke'
                  }`}
                  title={`${isDup ? '[DUPLICATE — excluded from totals] ' : isIne ? '[INELIGIBLE — excluded from totals] ' : ''}${e.doc.fileName}${
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
                  {/* coppa-92105: 8px alternating dark/transparent diagonal
                      stripes laid over the thumbnail. Reinforces "do not
                      count this" beyond the opacity-50 dim which alone reads
                      as merely "inactive" rather than "excluded". */}
                  {isDup && (
                    <span
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        backgroundImage:
                          'repeating-linear-gradient(45deg, rgba(0,0,0,0.35) 0 4px, transparent 4px 8px)',
                      }}
                    />
                  )}
                  {isDup && (
                    <span className="absolute top-1 right-1 text-[8px] uppercase font-bold px-1 py-0.5 rounded bg-red-500 text-white">
                      dup
                    </span>
                  )}
                  {/* provola-92106: 135° amber stripes (opposite angle from
                      duplicate's 45°) + INE pill so admins can scan the grid
                      and tell at a glance which flag is on each excluded
                      thumbnail. */}
                  {isIne && (
                    <span
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        backgroundImage:
                          'repeating-linear-gradient(135deg, rgba(245,158,11,0.35) 0 4px, transparent 4px 8px)',
                      }}
                    />
                  )}
                  {isIne && (
                    <span className="absolute top-1 right-1 text-[8px] uppercase font-bold px-1 py-0.5 rounded bg-amber-500 text-white">
                      ine
                    </span>
                  )}
                  {e.doc.ocrAmount != null && (
                    <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] font-medium text-center py-0.5">
                      {formatUsd(Number(e.doc.ocrAmount))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          )}
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
                    // prosciutto-92106: render an amber "no proof" chip next
                    // to zombie status='paid' rows (no tx_hash / wire_reference
                    // / mercury card / external proof). Helps admins spot
                    // rows that inflated Paid totals until the cleanup script
                    // runs. 'completed' rows are excluded from this gate
                    // because mark_pending_complete is bookkeeping by design.
                    const noProof = !payoutHasProof(p);
                    return (
                      <tr
                        key={p.id}
                        className={`border-t border-theme-stroke hover:bg-theme-surface-hover cursor-pointer${noProof ? ' bg-amber-500/5' : ''}`}
                        onClick={() => onRowClick(p)}
                      >
                        <td className="px-3 py-2 text-theme-text-secondary whitespace-nowrap">
                          {formatLedgerDate(p.paidAt || p.updatedAt)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-theme-text whitespace-nowrap">
                          {formatUsd(Number(p.finalAmountUsd))}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <PayoutMethodIcon
                              method={p.payoutMethod}
                              size={14}
                              showLabel
                            />
                            {noProof && (
                              <span
                                title="status=paid but no proof of send (no transaction hash / wire reference / mercury card / external proof). Inflates the Paid total — will be transitioned to 'withdrawn' by the prosciutto-92106 cleanup script."
                                className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400 border border-amber-500/30"
                              >
                                <AlertTriangle size={10} />
                                no proof
                              </span>
                            )}
                          </div>
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
                          ) : p.mercuryCardLast4 ? (
                            <span title={`Mercury card …${p.mercuryCardLast4}`}>
                              …{p.mercuryCardLast4}
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
      {/* provolone-58531: the old per-section "+ Add photo" (pizza/event kind)
          controls were removed. Admins/underbosses now add photos via the
          single "+ Add photo" button next to Add receipt, which opens the
          host-style role modal (AdminAddPhotosModal). */}
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
        /* coppa-92105: paint the lightbox photo pane with a DUPLICATE banner +
            diagonal-stripe overlay when the focused receipt is an admin-marked
            duplicate. Scoped to the receipt bucket (event/pizza photo lightboxes
            never have an isDuplicate concept). */
        isDuplicate={
          lightbox?.bucket === 'receipt'
          && lightboxReceipt?.isDuplicate === true
        }
        /* provola-92106: amber INELIGIBLE banner — gated to NOT-also-duplicate
            so the two banners don't fight. Same bucket scoping as isDuplicate. */
        isIneligible={
          lightbox?.bucket === 'receipt'
          && lightboxReceipt?.ineligible === true
          && lightboxReceipt?.isDuplicate !== true
        }
      />

      {/* provolone-58531: admin/underboss "Add photo" modal (host-style role
          slots + additional photos). malfatti-58532: pass the event start so the
          role-picker applies the same post-event-start cutoff hosts get. */}
      {showAddPhotos && (
        <AdminAddPhotosModal
          partyId={row.party.id}
          eventStart={row.party.date ?? null}
          partyName={row.party.name}
          onClose={() => setShowAddPhotos(false)}
          onAdded={handlePhotosAdded}
        />
      )}
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
  headerAction,
}: {
  label: string;
  photos: AdminPayoutEventPhoto[];
  onThumbClick: (index: number) => void;
  /**
   * schiacciata-58503: optional admin control (AdminAddAttachment) rendered on
   * the right of the section header. When supplied, the section header renders
   * even for an empty bucket so the admin can add the FIRST photo; with no
   * photos and no action we keep returning null to stay hidden.
   */
  headerAction?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (photos.length === 0 && !headerAction) return null;

  const visible = expanded ? photos : photos.slice(0, PHOTO_PREVIEW_LIMIT);
  const hasMore = photos.length > PHOTO_PREVIEW_LIMIT;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wide text-theme-text-muted">
          {label} ({photos.length})
        </div>
        <div className="flex items-center gap-2">
          {hasMore && photos.length > 0 && (
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
          {headerAction}
        </div>
      </div>
      {photos.length === 0 ? null : (
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
              title={`${p.caption || p.fileName}${photoUploaderTooltipSuffix(p)}`}
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
      )}
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
    </div>
  );
}

/**
 * stracci-58471: a clickable column header for the by-city table. Clicking
 * cycles the column through its two directions then back to `defaultSort`:
 *   • `firstDir='asc'`  → off → asc → desc → off   (used for the name column)
 *   • `firstDir='desc'` → off → desc → asc → off   (used for amount/time columns,
 *     where "biggest / most recent first" is the more useful opening click)
 * Renders a plain label when `onSortChange` is absent.
 */
const SortHeader: React.FC<{
  label: string;
  asc: NonNullable<AdminPayoutFilters['sort']>;
  desc: NonNullable<AdminPayoutFilters['sort']>;
  firstDir: 'asc' | 'desc';
  current?: AdminPayoutFilters['sort'];
  defaultSort: NonNullable<AdminPayoutFilters['sort']>;
  onSortChange?: (next: NonNullable<AdminPayoutFilters['sort']>) => void;
  className?: string;
}> = ({ label, asc, desc, firstDir, current, defaultSort, onSortChange, className }) => {
  const thClass = `px-3 py-3 font-medium${className ? ` ${className}` : ''}`;
  if (!onSortChange) {
    return <th className={thClass}>{label}</th>;
  }
  const isAsc = current === asc;
  const isDesc = current === desc;
  const handleClick = () => {
    if (firstDir === 'asc') {
      onSortChange(isAsc ? desc : isDesc ? defaultSort : asc);
    } else {
      onSortChange(isDesc ? asc : isAsc ? defaultSort : desc);
    }
  };
  return (
    <th className={thClass}>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1 font-medium hover:text-theme-text transition-colors"
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        {isAsc ? (
          <ChevronUp size={14} />
        ) : isDesc ? (
          <ChevronDown size={14} />
        ) : (
          <ChevronDown size={14} className="opacity-30" />
        )}
      </button>
    </th>
  );
};

export const PayoutsByPartyTable: React.FC<PayoutsByPartyTableProps> = ({
  rows,
  sort,
  onSortChange,
  defaultSort = 'created_desc',
  selectedIds,
  onToggleSelect,
  onRowClick,
  onApprove,
  onExecute,
  onMarkPaid,
  onMarkPartyPaid,
  onReopened,
  onAddExternalPayment,
  onSendPayment,
  onScamFlagChanged,
  onCapUpdated,
  onDocumentsChanged,
  onTagsChanged,
  onTgReminderResult,
  onTgWalletReminderResult,
  onTgPhotoReminderResult,
  onTgAttendanceReminderResult,
  fakeScores,
  viewerRole = 'admin',
  busyRowId,
  loading,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // bottarga-92104: optimistic-override map for the `possible-scam` tag so the
  // pill + menu label flip immediately on click without waiting for a parent
  // refetch. Keyed on partyId; value is the next eventTags array (mirrors the
  // pesto-92105 receiptOverrides pattern). Cleared when the parent re-renders
  // with the persisted value (the override is consulted ONLY for rendering;
  // the row's own eventTags are still the source of truth).
  const [tagOverrides, setTagOverrides] = useState<Record<string, string[]>>({});
  // Receipt overrides state lifted to parent so both the collapsed row and
  // expanded panel see the same data. Keyed by partyId then docId.
  // (`ParentReceiptOverride` is declared at module scope.)
  const [receiptOverridesByParty, setReceiptOverridesByParty] = useState<
    Record<string, Record<string, ParentReceiptOverride>>
  >({});
  // Per-row busy spinner state for the scam-flag toggle. Avoids double-clicks
  // during the PATCH round-trip.
  const [scamBusyPartyId, setScamBusyPartyId] = useState<string | null>(null);
  // panuozzo-58217: per-row busy spinner for custom-tag add/remove. Mirrors
  // scamBusyPartyId. tagOverrides (above) is reused for optimistic rendering.
  const [tagBusyPartyId, setTagBusyPartyId] = useState<string | null>(null);
  // culatello-92106: optimistic-override map for `taxFormRequired` so the pill
  // flips immediately on click without waiting for a parent refetch. Keyed on
  // partyId; mirrors the `tagOverrides` pattern. Cleared on a parent refresh.
  const [taxFormRequiredOverrides, setTaxFormRequiredOverrides] = useState<
    Record<string, boolean>
  >({});
  // Per-row busy spinner so we don't double-click the pill mid-PATCH.
  const [taxFormRequiredBusyPartyId, setTaxFormRequiredBusyPartyId] = useState<
    string | null
  >(null);
  // crocchetta-92106: per-row busy spinner for the Send receipts reminder
  // action. Avoids double-firing the POST while the bot is dispatching.
  const [tgReminderBusyPartyId, setTgReminderBusyPartyId] = useState<string | null>(null);
  // Per-row busy spinner for the Send wallet reminder action.
  const [walletReminderBusyPartyId, setWalletReminderBusyPartyId] = useState<
    string | null
  >(null);
  // Per-row busy spinner for the Send photo reminder action.
  const [photoReminderBusyPartyId, setPhotoReminderBusyPartyId] = useState<
    string | null
  >(null);
  const [attendanceReminderBusyPartyId, setAttendanceReminderBusyPartyId] = useState<
    string | null
  >(null);
  // City-level approval busy spinner.
  const [approveBusyPartyId, setApproveBusyPartyId] = useState<string | null>(null);
  // Per-row busy spinner for the Reopen city action.
  const [reopenBusyPartyId, setReopenBusyPartyId] = useState<string | null>(null);

  const canMarkPartyPaid = viewerRole === 'admin' && !!onMarkPartyPaid;
  const canAddExternal = viewerRole === 'admin' && !!onAddExternalPayment;
  // salame-92106: actively-send is admin-only. Underbosses can flag-ready
  // but never push funds. Mirrors the other handler-gated admin caps.
  const canSendPayment = viewerRole === 'admin' && !!onSendPayment;
  // bottarga-92104: same admin gate as the other two menu items. Underbosses
  // never see the scam-flag action.
  const canToggleScamFlag = viewerRole === 'admin';
  // panuozzo-58217: custom tags are intentionally WIDER than the admin-only
  // scam flag — both admins and (scoped) underbosses may add/view/remove them.
  // The PATCH endpoint already grants the same set via canUserEditParty.
  const canManageTags = viewerRole === 'admin' || viewerRole === 'underboss';
  // crocchetta-92106: TG reminder is admin-only. The endpoint itself enforces
  // requireAnyAdminOrPaymentAdmin server-side; the UI gate just hides the
  // menu item for underbosses so they don't see a button that 403s.
  const canSendTgReminder = viewerRole === 'admin';
  // culatello-92106: tax-form gate toggle — admin-only. Backend gate is
  // payment_admin / admin / super_admin (isPaymentAdmin); UI mirrors the same
  // "admin" viewer role used by the rest of this table for underboss hiding.
  const canToggleTaxFormRequired = viewerRole === 'admin';
  // Wallet reminder shares the same admin-only gate as the receipts reminder.
  const canSendWalletReminder = viewerRole === 'admin';
  // Photo reminder shares the same admin-only gate as the receipts reminder.
  const canSendPhotoReminder = viewerRole === 'admin';
  // Attendance reminder shares the same admin-only gate as the photo reminder.
  const canSendAttendanceReminder = viewerRole === 'admin';
  // City-level approval is admin-only.
  const canApproveCity = viewerRole === 'admin';
  // Reopen (undo a close) is admin-only — the endpoint enforces
  // requireAnyAdminOrPaymentAdmin server-side; the per-row gate also requires
  // the city to be closed (computed in the row render).
  const canReopenCap = viewerRole === 'admin';
  // pesto-92105: same gate the per-payout PayoutReviewModal applies for
  // `canEditReceipts` (admin / super_admin / payment_admin). Underbosses get
  // the plain photo-only lightbox.
  const canEditReceipts = viewerRole === 'admin';
  // mortadella-92106: same admin-only gate for the city-level notes textarea.
  // Backend strips `adminNotes` to null for underbosses; this hides the input
  // wholesale so they don't even see the section heading.
  const canEditAdminNotes = viewerRole === 'admin';

  function toggleExpanded(partyId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(partyId)) next.delete(partyId);
      else next.add(partyId);
      return next;
    });
  }

  /**
   * bottarga-92104: toggle the `possible-scam` tag for a city. Optimistic —
   * patches `tagOverrides` immediately so the pill + menu label flip without
   * waiting for the PATCH. On error, roll back the override and let the
   * caller surface the failure (we keep it inline-silent for now; a future
   * pass can wire this into the page-level pushToast).
   */
  async function handleToggleScamFlag(row: PartyPayoutsRow) {
    const partyId = row.party.id;
    const currentTags =
      tagOverrides[partyId] ?? row.party.eventTags ?? [];
    const wasFlagged = currentTags.includes(POSSIBLE_SCAM_TAG);
    const nextFlag = !wasFlagged;
    // Optimistic write — derived next tags computed in the API helper but
    // mirror it here so we don't await before showing the flip.
    const optimisticSet = new Set(currentTags);
    if (nextFlag) optimisticSet.add(POSSIBLE_SCAM_TAG);
    else optimisticSet.delete(POSSIBLE_SCAM_TAG);
    const optimisticTags = Array.from(optimisticSet);
    setTagOverrides((m) => ({ ...m, [partyId]: optimisticTags }));
    setScamBusyPartyId(partyId);
    try {
      const { eventTags } = await flagPartyAsScam(partyId, currentTags, nextFlag);
      // Server is authoritative — replace the optimistic value with what came
      // back so any tag-set drift (e.g. another admin removed a tag in
      // parallel) is reconciled.
      setTagOverrides((m) => ({ ...m, [partyId]: eventTags }));
      onScamFlagChanged?.(partyId, eventTags);
    } catch (err) {
      // Roll back the optimistic flip so the UI reflects the persisted state.
      setTagOverrides((m) => {
        const next = { ...m };
        delete next[partyId];
        return next;
      });
      // Minimal user feedback — the menu silently fails. The next refresh
      // would surface the real state; for now, an alert keeps it visible.
      // eslint-disable-next-line no-alert
      window.alert(
        `Could not ${nextFlag ? 'flag' : 'unflag'} this city as possible scam: ${
          (err as Error)?.message ?? 'unknown error'
        }`,
      );
    } finally {
      setScamBusyPartyId((id) => (id === partyId ? null : id));
    }
  }

  /**
   * panuozzo-58217: add a free-text custom tag to a city. Optimistic — patches
   * `tagOverrides` so the chip appears immediately; reconciles with the server
   * `eventTags` on success and rolls back on error. Reversible → no confirm.
   */
  async function handleAddCustomTag(row: PartyPayoutsRow, rawLabel: string) {
    const partyId = row.party.id;
    const currentTags = tagOverrides[partyId] ?? row.party.eventTags ?? [];
    const label = normalizeCustomTagLabel(rawLabel);
    if (!label) return;
    const alreadyHas = getCustomTagLabels(currentTags)
      .map((l) => l.toLowerCase())
      .includes(label.toLowerCase());
    const optimisticTags = alreadyHas
      ? [...currentTags]
      : [...currentTags, `${CUSTOM_TAG_PREFIX}${label}`];
    setTagOverrides((m) => ({ ...m, [partyId]: optimisticTags }));
    setTagBusyPartyId(partyId);
    try {
      const { eventTags } = await addCustomTag(partyId, currentTags, rawLabel);
      setTagOverrides((m) => ({ ...m, [partyId]: eventTags }));
      onTagsChanged?.(partyId, eventTags);
    } catch (err) {
      setTagOverrides((m) => {
        const next = { ...m };
        delete next[partyId];
        return next;
      });
      // eslint-disable-next-line no-alert
      window.alert(
        `Could not add tag "${label}": ${(err as Error)?.message ?? 'unknown error'}`,
      );
    } finally {
      setTagBusyPartyId((id) => (id === partyId ? null : id));
    }
  }

  /**
   * panuozzo-58217: remove a custom tag from a city by its display label.
   * Optimistic + reconcile, mirroring the add path. Reversible → no confirm.
   */
  async function handleRemoveCustomTag(row: PartyPayoutsRow, label: string) {
    const partyId = row.party.id;
    const currentTags = tagOverrides[partyId] ?? row.party.eventTags ?? [];
    const full = `${CUSTOM_TAG_PREFIX}${label}`;
    const optimisticTags = currentTags.filter((t) => t !== full);
    setTagOverrides((m) => ({ ...m, [partyId]: optimisticTags }));
    setTagBusyPartyId(partyId);
    try {
      const { eventTags } = await removeCustomTag(partyId, currentTags, label);
      setTagOverrides((m) => ({ ...m, [partyId]: eventTags }));
      onTagsChanged?.(partyId, eventTags);
    } catch (err) {
      setTagOverrides((m) => {
        const next = { ...m };
        delete next[partyId];
        return next;
      });
      // eslint-disable-next-line no-alert
      window.alert(
        `Could not remove tag "${label}": ${(err as Error)?.message ?? 'unknown error'}`,
      );
    } finally {
      setTagBusyPartyId((id) => (id === partyId ? null : id));
    }
  }

  /**
   * culatello-92106: toggle `parties.tax_form_required` for a city.
   * Optimistic — flips the override map immediately so the pill state updates
   * without waiting for the PATCH. Reversible (one click flips back) so no
   * confirm step per project convention. Failures roll the override back and
   * surface via a minimal alert, matching the scam-flag path.
   */
  async function handleToggleTaxFormRequired(row: PartyPayoutsRow) {
    if (!canToggleTaxFormRequired) return;
    const partyId = row.party.id;
    const current =
      taxFormRequiredOverrides[partyId] !== undefined
        ? taxFormRequiredOverrides[partyId]
        : row.party.taxFormRequired === true;
    const next = !current;
    setTaxFormRequiredOverrides((m) => ({ ...m, [partyId]: next }));
    setTaxFormRequiredBusyPartyId(partyId);
    try {
      await updatePartyApi(partyId, { taxFormRequired: next });
    } catch (err) {
      // Roll back the optimistic flip.
      setTaxFormRequiredOverrides((m) => {
        const nextMap = { ...m };
        delete nextMap[partyId];
        return nextMap;
      });
      // eslint-disable-next-line no-alert
      window.alert(
        `Could not ${next ? 'require' : 'un-require'} tax forms for this city: ${
          (err as Error)?.message ?? 'unknown error'
        }`,
      );
    } finally {
      setTaxFormRequiredBusyPartyId((id) => (id === partyId ? null : id));
    }
  }

  /**
   * Undo an accidental city close. Calls the reopen endpoint (clears the close
   * flag + reverts the payouts the close flipped to `completed`) and asks the
   * parent to refresh + toast. Reversible — no confirm step per project
   * convention (feedback_reversible_actions_no_confirm). Errors surface via a
   * minimal alert, matching the scam-flag path.
   */
  async function handleReopen(row: PartyPayoutsRow) {
    const partyId = row.party.id;
    setReopenBusyPartyId(partyId);
    try {
      const { reopenedCount } = await reopenParty(partyId);
      onReopened?.(partyId, reopenedCount);
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(
        `Could not reopen this city: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    } finally {
      setReopenBusyPartyId((id) => (id === partyId ? null : id));
    }
  }

  /**
   * crocchetta-92106 + crocchetta-92107: dispatch the Send-receipts-reminder
   * POST and surface the per-channel outcome to the parent via
   * `onTgReminderResult` so the page-level toast stack renders the right
   * message. tonda-58293: the per-city Telegram group chat_id is now resolved
   * server-side from `city_telegram_groups` (the backend derives the city from
   * the party name); the client no longer passes a groupChatId. Errors are
   * caught and forwarded with an `error` shape so the parent can flash a
   * failure toast without the table needing its own alert path.
   */
  async function handleSendTgReminder(row: PartyPayoutsRow) {
    const partyId = row.party.id;
    setTgReminderBusyPartyId(partyId);
    try {
      const result = await sendTgReceiptsReminder(partyId);
      onTgReminderResult?.(partyId, result);
    } catch (err) {
      onTgReminderResult?.(partyId, {
        error: (err as Error)?.message ?? 'Could not send reminder',
      });
    } finally {
      setTgReminderBusyPartyId((id) => (id === partyId ? null : id));
    }
  }

  /**
   * Sibling of {@link handleSendTgReminder}: dispatch the wallet reminder POST
   * and forward the per-channel outcome via `onTgWalletReminderResult`. Group
   * chat_id resolved server-side (tonda-58293) — no client groupChatId.
   */
  async function handleSendWalletReminder(row: PartyPayoutsRow) {
    const partyId = row.party.id;
    setWalletReminderBusyPartyId(partyId);
    try {
      const result = await sendTgWalletReminder(partyId);
      onTgWalletReminderResult?.(partyId, result);
    } catch (err) {
      onTgWalletReminderResult?.(partyId, {
        error: (err as Error)?.message ?? 'Could not send reminder',
      });
    } finally {
      setWalletReminderBusyPartyId((id) => (id === partyId ? null : id));
    }
  }

  /**
   * Sibling of {@link handleSendTgReminder}: dispatch the photo reminder POST
   * and forward the per-channel outcome via `onTgPhotoReminderResult`. Group
   * chat_id resolved server-side (tonda-58293) — no client groupChatId.
   */
  async function handleSendPhotoReminder(row: PartyPayoutsRow) {
    const partyId = row.party.id;
    setPhotoReminderBusyPartyId(partyId);
    try {
      const result = await sendTgPhotoReminder(partyId);
      onTgPhotoReminderResult?.(partyId, result);
    } catch (err) {
      onTgPhotoReminderResult?.(partyId, {
        error: (err as Error)?.message ?? 'Could not send reminder',
      });
    } finally {
      setPhotoReminderBusyPartyId((id) => (id === partyId ? null : id));
    }
  }

  /**
   * Sibling of {@link handleSendPhotoReminder}: dispatch the attendance reminder
   * POST and forward the per-channel outcome via `onTgAttendanceReminderResult`.
   * Group chat_id resolved server-side (tonda-58293) — no client groupChatId.
   */
  async function handleSendAttendanceReminder(row: PartyPayoutsRow) {
    const partyId = row.party.id;
    setAttendanceReminderBusyPartyId(partyId);
    try {
      const result = await sendTgAttendanceReminder(partyId);
      onTgAttendanceReminderResult?.(partyId, result);
    } catch (err) {
      onTgAttendanceReminderResult?.(partyId, {
        error: (err as Error)?.message ?? 'Could not send reminder',
      });
    } finally {
      setAttendanceReminderBusyPartyId((id) => (id === partyId ? null : id));
    }
  }

  /**
   * City-level payment approval. Approves the receipts total as the payment
   * amount (or clears approval when amountUsd is null).
   */
  async function handleApproveCity(row: PartyPayoutsRow, amountUsd: number | null) {
    const partyId = row.party.id;
    setApproveBusyPartyId(partyId);
    try {
      const result = await approveCity(partyId, amountUsd);
      // Update the row's party data with the new approval state.
      // The parent will need to refresh data to see the change persist,
      // but we can optimistically update the local row for immediate feedback.
      row.party.paymentsApprovedUsd = result.paymentsApprovedUsd;
      row.party.paymentsApprovedAt = result.paymentsApprovedAt;
    } catch (err) {
      console.error('Failed to approve city:', err);
    } finally {
      setApproveBusyPartyId((id) => (id === partyId ? null : id));
    }
  }

  return (
    <div className="bg-theme-surface border border-theme-stroke rounded-xl overflow-hidden">
      {/* stracciatella-58546: desktop table view. Hidden below md: where the
          card list (further down) takes over so the 7-col table doesn't force
          horizontal scrolling on phones. */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-theme-stroke text-theme-text-muted text-left">
              <th className="px-3 py-3 w-10"></th>
              {/* stracci-58471: every data column is sortable via its header.
                  Names open A–Z; money + time columns open with the biggest /
                  most-recent first. */}
              <SortHeader
                label="Event"
                asc="name_asc"
                desc="name_desc"
                firstDir="asc"
                current={sort}
                defaultSort={defaultSort}
                onSortChange={onSortChange}
              />
              <SortHeader
                label="Receipt total"
                asc="amount_asc"
                desc="amount_desc"
                firstDir="desc"
                current={sort}
                defaultSort={defaultSort}
                onSortChange={onSortChange}
              />
              <SortHeader
                label="Approved"
                asc="approved_asc"
                desc="approved_desc"
                firstDir="desc"
                current={sort}
                defaultSort={defaultSort}
                onSortChange={onSortChange}
              />
              <SortHeader
                label="Paid"
                asc="paid_asc"
                desc="paid_desc"
                firstDir="desc"
                current={sort}
                defaultSort={defaultSort}
                onSortChange={onSortChange}
              />
              <SortHeader
                label="Outstanding"
                asc="outstanding_asc"
                desc="outstanding_desc"
                firstDir="desc"
                current={sort}
                defaultSort={defaultSort}
                onSortChange={onSortChange}
              />
              <SortHeader
                label="Last activity"
                asc="activity_asc"
                desc="activity_desc"
                firstDir="desc"
                current={sort}
                defaultSort={defaultSort}
                onSortChange={onSortChange}
              />
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
              // bottarga-92104: prefer the local override when present so the
              // pill + menu label reflect the optimistic toggle while the
              // PATCH is in flight (and after, until the parent reloads the
              // by-party rows).
              const effectiveTags =
                tagOverrides[row.party.id] ?? row.party.eventTags ?? [];
              const isFlaggedScam = effectiveTags.includes(POSSIBLE_SCAM_TAG);
              const scamFlagBusy = scamBusyPartyId === row.party.id;
              // panuozzo-58217: custom-tag display labels derived from the same
              // (optimistic-aware) effective tag list.
              const customTags = getCustomTagLabels(effectiveTags);
              const tagBusy = tagBusyPartyId === row.party.id;
              // culatello-92106: same optimistic-override pattern as the scam
              // tag — when present the override wins so the pill reflects the
              // user's last click without waiting for the parent to refetch.
              const effectiveTaxFormRequired =
                taxFormRequiredOverrides[row.party.id] !== undefined
                  ? taxFormRequiredOverrides[row.party.id]
                  : row.party.taxFormRequired === true;
              const taxFormRequiredBusy =
                taxFormRequiredBusyPartyId === row.party.id;
              const tgReminderBusy = tgReminderBusyPartyId === row.party.id;
              const walletReminderBusy =
                walletReminderBusyPartyId === row.party.id;
              const photoReminderBusy =
                photoReminderBusyPartyId === row.party.id;
              const attendanceReminderBusy =
                attendanceReminderBusyPartyId === row.party.id;
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
              // coppa-92105: admin-marked duplicates are evidence-only —
              // exclude their OCR amounts from the outer cell's USD total so
              // it matches the in-panel "Receipts collected" rollup tile
              // (which is itself the city-level mirror of the per-payout
              // modal's `ocrSum`). We still count the duplicate row toward
              // the receipt-attachment count so admins know the file exists;
              // a "M duplicate(s) excluded" subtitle surfaces the exclusion.
              const payouts = row.payouts;
              const partyOverrides = receiptOverridesByParty[row.party.id] ?? {};
              let receiptUsdTotal = 0;
              let receiptCount = 0;
              let receiptDuplicateCount = 0;
              // provola-92106: parallel "K ineligible excluded" counter for
              // the outer cell subtitle. Counts ineligibles that aren't ALSO
              // duplicate so the dup + ine counts don't overlap (duplicate
              // wins as the primary signal — same convention used in the
              // rollup tile + the per-payout modal sum line).
              let receiptIneligibleCount = 0;
              for (const p of payouts) {
                for (const d of p.documents || []) {
                  if (d.kind !== 'receipt') continue;
                  receiptCount += 1;
                  // Apply local overrides so row updates without reload
                  const ov = partyOverrides[d.id];
                  const isDup = ov?.isDuplicate ?? d.isDuplicate;
                  const isIne = ov?.ineligible ?? d.ineligible;
                  const amt = ov?.ocrAmount ?? d.ocrAmount;
                  if (isDup === true) {
                    receiptDuplicateCount += 1;
                    continue;
                  }
                  if (isIne === true) {
                    receiptIneligibleCount += 1;
                    continue;
                  }
                  receiptUsdTotal += Number(amt) || 0;
                }
              }
              // stracci-58471: Approved / Paid / Outstanding money math now lives
              // in the shared computePartyTotals helper so the cells below and the
              // page-level column-header sorts can't drift. (bresaola-49340: the
              // completed contribution is proof-gated inside the helper.)
              const {
                approvedUsd: approvedSumUsd,
                paidUsd: paidSumUsd,
                outstandingUsd,
              } = computePartyTotals(row);

              // tortellini-58542: most recent Molto Benny (Telegram) reminder
              // sent for this city = max of the four reminder timestamps.
              const reminders = [
                { label: 'Receipts', at: row.party.receiptsReminderSentAt },
                { label: 'Wallet', at: row.party.walletReminderSentAt },
                { label: 'Photo', at: row.party.photoReminderSentAt },
                { label: 'Attendance', at: row.party.attendanceReminderSentAt },
              ].filter((r) => r.at);
              const lastReminder = reminders.reduce(
                (best, r) =>
                  !best || new Date(r.at!) > new Date(best.at!) ? r : best,
                null as null | { label: string; at: string },
              );

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
                      {/* cappelletti-58525: est. attendance + RSVP + check-in
                          counts as a compact sub-line on each city row. */}
                      <div className="text-xs text-theme-text-muted mt-0.5 flex flex-wrap items-center gap-x-2">
                        <span title="Host-estimated attendance">Est. {row.party.estimatedAttendance ?? '—'}</span>
                        <span aria-hidden>·</span>
                        <span title="RSVPs (non-invited guests)">{row.party.rsvpCount ?? 0} RSVP{(row.party.rsvpCount ?? 0) === 1 ? '' : 's'}</span>
                        <span aria-hidden>·</span>
                        <span title="Checked-in guests">{row.party.checkInCount ?? 0} check-in{(row.party.checkInCount ?? 0) === 1 ? '' : 's'}</span>
                      </div>
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
                        {/* bufalina-60733: fake-detection risk badge. Self-hides
                            unless the party scored medium (amber ≥30) or high
                            (red ≥60). Tooltip lists the top fired flags. */}
                        <FakeDetectionBadge
                          {...(fakeScores?.[row.party.id] ?? {
                            score: 0,
                            tier: 'clean' as const,
                            topFlags: [],
                          })}
                          customUrl={row.party.customUrl}
                        />
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
                        {/* culatello-92106: tax-form gate pill. Visible
                            whenever the gate is ON for the city; admins can
                            also see + click an off-state pill via the same
                            optimistic toggle pattern as the scam flag. Hidden
                            entirely for non-admin viewers when the gate is
                            off (no useful info). */}
                        {(effectiveTaxFormRequired || canToggleTaxFormRequired) && (
                          <button
                            type="button"
                            disabled={taxFormRequiredBusy || !canToggleTaxFormRequired}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!canToggleTaxFormRequired) return;
                              handleToggleTaxFormRequired(row);
                            }}
                            className={
                              effectiveTaxFormRequired
                                ? 'inline-flex items-center gap-1 text-[11px] text-sky-300 px-1.5 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/40 hover:bg-sky-500/20 disabled:opacity-60 disabled:cursor-not-allowed'
                                : 'inline-flex items-center gap-1 text-[11px] text-theme-text-muted px-1.5 py-0.5 rounded-full border border-theme-stroke hover:bg-theme-surface-hover disabled:opacity-60 disabled:cursor-not-allowed'
                            }
                            title={
                              !canToggleTaxFormRequired
                                ? 'Tax forms required for this event'
                                : effectiveTaxFormRequired
                                ? 'Click to stop requiring tax forms for this event'
                                : 'Click to require tax forms for this event'
                            }
                          >
                            {taxFormRequiredBusy ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : null}
                            {effectiveTaxFormRequired
                              ? 'Tax forms required'
                              : 'Tax forms: off'}
                          </button>
                        )}
                        {/* calzone-58293: inline reimbursement-cap editor in the By-city header so
                            admins can raise/clear the party's cap without leaving /payments. Saves to
                            parties.reimbursement_cap_usd (admin + underboss, scope-checked server-side).
                            stopPropagation so editing doesn't toggle the row expand. */}
                        <span
                          className="inline-flex items-center gap-1 text-[11px] text-theme-text-muted"
                          onClick={(e) => e.stopPropagation()}
                          title="Reimbursement cap (validated value or max numeric event_tag)"
                        >
                          <CapInlineEditor
                            partyId={row.party.id}
                            currentCapUsd={row.party.effectiveReimbursementCapUsd ?? null}
                            onUpdated={() => onCapUpdated?.(row.party.id)}
                          />
                          <span>cap</span>
                        </span>
                        {/* bottarga-92104: red "Possible scam" pill — visible
                            in the city header next to other status pills when
                            the `possible-scam` tag is present on the party.
                            Click toggles the flag via the same handler the
                            Actions menu uses (reversible — no confirm). */}
                        {isFlaggedScam && (
                          <button
                            type="button"
                            disabled={scamFlagBusy || !canToggleScamFlag}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!canToggleScamFlag) return;
                              handleToggleScamFlag(row);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] text-red-500 px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/40 hover:bg-red-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                            title={
                              canToggleScamFlag
                                ? 'Click to unflag this city as possible scam'
                                : 'Flagged as possible scam'
                            }
                          >
                            {scamFlagBusy ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <AlertTriangle size={11} />
                            )}
                            Possible scam
                          </button>
                        )}
                        {/* panuozzo-58217: read-only custom-tag pills. Add /
                            remove happens only in the ⋮ menu; here they're
                            purely informational. */}
                        {customTags.map((label) => (
                          <span
                            key={`custom-${label}`}
                            className="inline-flex items-center gap-1 text-[11px] text-indigo-300 px-1.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30"
                            title={`Custom tag: ${label}`}
                          >
                            <Tag size={11} />
                            {label}
                          </span>
                        ))}
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
                        {/* coppa-92105: surface duplicate exclusion on the
                            outer city row so admins reading the table without
                            expanding can see the USD total skipped some
                            receipts. Mirrors the in-panel "Receipts collected"
                            tile subtitle. */}
                        {receiptDuplicateCount > 0 && (
                          <span className="ml-1 text-theme-text-faint">
                            ({receiptDuplicateCount} dup excluded)
                          </span>
                        )}
                        {/* provola-92106: parallel hint for ineligible
                            exclusions. Amber so admins reading the outer row
                            can tell which type of exclusion happened without
                            expanding. */}
                        {receiptIneligibleCount > 0 && (
                          <span className="ml-1 text-amber-400">
                            ({receiptIneligibleCount} ine excluded)
                          </span>
                        )}
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
                        {/* tigella-58512: synthetic TBD rows have no payout
                            activity (lastActivityAt=null) → show an em dash
                            instead of a 1969 epoch date. */}
                        <div className="flex flex-col min-w-0">
                          {row.aggregates.lastActivityAt ? (
                            <div title={new Date(row.aggregates.lastActivityAt).toLocaleString()}>
                              {relativeTime(new Date(row.aggregates.lastActivityAt))}
                            </div>
                          ) : (
                            <div className="text-theme-text-faint">—</div>
                          )}
                          {/* tortellini-58542: last Molto Benny reminder sent */}
                          {lastReminder && (
                            <div
                              className="text-xs text-theme-text-faint truncate"
                              title={new Date(lastReminder.at!).toLocaleString()}
                            >
                              🔔 {lastReminder.label} reminder ·{' '}
                              {relativeTime(new Date(lastReminder.at!))}
                            </div>
                          )}
                        </div>
                        <CityActionsMenu
                          canMarkPaid={showMarkPartyPaid}
                          canAddExternal={canAddExternal}
                          canSendPayment={canSendPayment}
                          canToggleScamFlag={canToggleScamFlag}
                          canSendTgReminder={canSendTgReminder}
                          canSendWalletReminder={canSendWalletReminder}
                          canSendPhotoReminder={canSendPhotoReminder}
                          canSendAttendanceReminder={canSendAttendanceReminder}
                          canApproveCity={canApproveCity}
                          canReopen={isClosed && canReopenCap}
                          canManageTags={canManageTags}
                          customTags={customTags}
                          tagBusy={tagBusy}
                          markPaidLabel={markPaidLabel}
                          isFlaggedScam={isFlaggedScam}
                          scamFlagBusy={scamFlagBusy}
                          tgReminderBusy={tgReminderBusy}
                          walletReminderBusy={walletReminderBusy}
                          photoReminderBusy={photoReminderBusy}
                          attendanceReminderBusy={attendanceReminderBusy}
                          reopenBusy={reopenBusyPartyId === row.party.id}
                          approveBusy={approveBusyPartyId === row.party.id}
                          receiptsReminderSentAt={row.party.receiptsReminderSentAt}
                          walletReminderSentAt={row.party.walletReminderSentAt}
                          photoReminderSentAt={row.party.photoReminderSentAt}
                          attendanceReminderSentAt={row.party.attendanceReminderSentAt}
                          paymentsApprovedUsd={row.party.paymentsApprovedUsd}
                          paymentsApprovedAt={row.party.paymentsApprovedAt}
                          receiptsTotalUsd={receiptUsdTotal}
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
                          onSendPayment={
                            canSendPayment && onSendPayment
                              ? () =>
                                  onSendPayment(
                                    applyReceiptOverridesToRow(
                                      row,
                                      partyOverrides,
                                    ),
                                  )
                              : undefined
                          }
                          onToggleScamFlag={
                            canToggleScamFlag
                              ? () => handleToggleScamFlag(row)
                              : undefined
                          }
                          onApproveCity={
                            canApproveCity
                              ? (amountUsd) => handleApproveCity(row, amountUsd)
                              : undefined
                          }
                          onSendTgReminder={
                            canSendTgReminder
                              ? () => handleSendTgReminder(row)
                              : undefined
                          }
                          onSendWalletReminder={
                            canSendWalletReminder
                              ? () => handleSendWalletReminder(row)
                              : undefined
                          }
                          onSendPhotoReminder={
                            canSendPhotoReminder
                              ? () => handleSendPhotoReminder(row)
                              : undefined
                          }
                          onSendAttendanceReminder={
                            canSendAttendanceReminder
                              ? () => handleSendAttendanceReminder(row)
                              : undefined
                          }
                          onReopen={
                            isClosed && canReopenCap
                              ? () => handleReopen(row)
                              : undefined
                          }
                          onAddCustomTag={
                            canManageTags
                              ? (label) => handleAddCustomTag(row, label)
                              : undefined
                          }
                          onRemoveCustomTag={
                            canManageTags
                              ? (label) => handleRemoveCustomTag(row, label)
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
                            canManagePhotos={viewerRole === 'admin' || viewerRole === 'underboss'}
                            canEditAdminNotes={canEditAdminNotes}
                            onDocumentsChanged={onDocumentsChanged}
                            onApprove={viewerRole === 'admin' ? onApprove : undefined}
                            onExecute={viewerRole === 'admin' ? onExecute : undefined}
                            onMarkPaid={viewerRole === 'admin' ? onMarkPaid : undefined}
                            onReceiptOverride={(docId, override) => {
                              setReceiptOverridesByParty((prev) => ({
                                ...prev,
                                [row.party.id]: {
                                  ...(prev[row.party.id] ?? {}),
                                  [docId]: override,
                                },
                              }));
                            }}
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

      {/* stracciatella-58546: mobile card list (md:hidden). Maps over the SAME
          `rows` + reuses the SAME handlers/state (toggleExpanded, CityExpansion,
          CityActionsMenu variant="card"). No new data fetching — the per-card
          money math mirrors the desktop row's receipt loop + computePartyTotals. */}
      <div className="md:hidden p-3 space-y-3">
        {loading && rows.length === 0 && (
          <div className="px-3 py-12 text-center text-theme-text-muted">
            <Loader2 size={20} className="inline-block animate-spin mr-2" />
            Loading payments…
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div className="px-3 py-12 text-center text-theme-text-faint">
            No events match these filters.
          </div>
        )}
        {rows.map((row) => {
          const isOpen = expanded.has(row.party.id);
          const partySlug = row.party.customUrl ?? row.party.inviteCode ?? '';
          const closedAt = row.party.paymentsClosedAt ?? null;
          const isClosed = !!closedAt;
          const effectiveTags =
            tagOverrides[row.party.id] ?? row.party.eventTags ?? [];
          const isFlaggedScam = effectiveTags.includes(POSSIBLE_SCAM_TAG);
          const scamFlagBusy = scamBusyPartyId === row.party.id;
          const customTags = getCustomTagLabels(effectiveTags);
          const tagBusy = tagBusyPartyId === row.party.id;
          const tgReminderBusy = tgReminderBusyPartyId === row.party.id;
          const walletReminderBusy = walletReminderBusyPartyId === row.party.id;
          const photoReminderBusy = photoReminderBusyPartyId === row.party.id;
          const attendanceReminderBusy =
            attendanceReminderBusyPartyId === row.party.id;
          const hasInFlight =
            row.aggregates.pendingCount + row.aggregates.approvedCount > 0;
          const canCloseOut =
            !hasInFlight && !isClosed && row.aggregates.paidCount > 0;
          const showMarkPartyPaid =
            canMarkPartyPaid && !isClosed && (hasInFlight || canCloseOut);
          const markPaidLabel = hasInFlight ? 'Mark city paid' : 'Close city';

          const payouts = row.payouts;
          const partyOverrides = receiptOverridesByParty[row.party.id] ?? {};
          let receiptUsdTotal = 0;
          let receiptCount = 0;
          for (const p of payouts) {
            for (const d of p.documents || []) {
              if (d.kind !== 'receipt') continue;
              receiptCount += 1;
              const ov = partyOverrides[d.id];
              const isDup = ov?.isDuplicate ?? d.isDuplicate;
              const isIne = ov?.ineligible ?? d.ineligible;
              const amt = ov?.ocrAmount ?? d.ocrAmount;
              if (isDup === true) continue;
              if (isIne === true) continue;
              receiptUsdTotal += Number(amt) || 0;
            }
          }
          const {
            approvedUsd: approvedSumUsd,
            paidUsd: paidSumUsd,
            outstandingUsd,
          } = computePartyTotals(row);

          // stracciatella-58546: replicate the desktop "last Molto Benny
          // reminder" computation (tortellini-58542) so the card can surface
          // the same line that's hover-only / absent on mobile.
          const reminders = [
            { label: 'Receipts', at: row.party.receiptsReminderSentAt },
            { label: 'Wallet', at: row.party.walletReminderSentAt },
            { label: 'Photo', at: row.party.photoReminderSentAt },
            { label: 'Attendance', at: row.party.attendanceReminderSentAt },
          ].filter((r) => r.at);
          const lastReminder = reminders.reduce(
            (best, r) =>
              !best || new Date(r.at!) > new Date(best.at!) ? r : best,
            null as null | { label: string; at: string },
          );

          return (
            <div
              key={row.party.id}
              className="rounded-xl border border-theme-stroke bg-theme-surface p-3"
            >
              {/* Header: chevron + name/country + status pills */}
              <button
                type="button"
                onClick={() => toggleExpanded(row.party.id)}
                className="w-full flex items-start gap-2 text-left"
              >
                <span className="mt-0.5 text-theme-text-muted shrink-0">
                  {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-theme-text">
                    {stripGppPrefix(row.party.name)}
                  </span>
                  {row.party.country && (
                    <span className="block text-xs text-theme-text-muted">
                      {row.party.country}
                    </span>
                  )}
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    {isClosed && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                        <CheckCircle2 size={11} />
                        Closed
                      </span>
                    )}
                    {isFlaggedScam && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-red-500 px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/40">
                        <AlertTriangle size={11} />
                        Possible scam
                      </span>
                    )}
                    {customTags.map((label) => (
                      <span
                        key={`m-custom-${label}`}
                        className="inline-flex items-center gap-1 text-[11px] text-indigo-300 px-1.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30"
                      >
                        <Tag size={11} />
                        {label}
                      </span>
                    ))}
                    {row.aggregates.pendingCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
                        <XCircle size={11} />
                        {row.aggregates.pendingCount} pending
                      </span>
                    )}
                  </span>
                  {/* stracciatella-58546: surface the Closed pill's hover-only
                      reason (desktop `title="Closed out …"`) inline on the card.
                      Same toLocaleString() value as the desktop title=. */}
                  {isClosed && (
                    <span className="block mt-1 text-xs text-theme-text-secondary break-words">
                      Closed out {new Date(closedAt!).toLocaleString()}
                    </span>
                  )}
                </span>
              </button>

              {/* Money mini-grid */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-theme-stroke bg-theme-surface-hover/40 px-2.5 py-2">
                  <div className="text-[11px] text-theme-text-muted">Receipt total</div>
                  <div className="text-sm font-medium text-theme-text">
                    {formatUsd(receiptUsdTotal)}
                  </div>
                  <div className="text-[11px] text-theme-text-muted inline-flex items-center gap-1">
                    <Paperclip size={10} />
                    {receiptCount} receipt{receiptCount === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="rounded-lg border border-theme-stroke bg-theme-surface-hover/40 px-2.5 py-2">
                  <div className="text-[11px] text-theme-text-muted">Approved</div>
                  <div
                    className={`text-sm ${
                      approvedSumUsd > 0
                        ? 'text-sky-500 font-medium'
                        : 'text-theme-text-faint'
                    }`}
                  >
                    {approvedSumUsd > 0 ? formatUsd(approvedSumUsd) : '—'}
                  </div>
                </div>
                <div className="rounded-lg border border-theme-stroke bg-theme-surface-hover/40 px-2.5 py-2">
                  <div className="text-[11px] text-theme-text-muted">Paid</div>
                  <div
                    className={`text-sm ${
                      paidSumUsd > 0
                        ? 'text-emerald-500 font-medium'
                        : 'text-theme-text-faint'
                    }`}
                  >
                    {paidSumUsd > 0 ? formatUsd(paidSumUsd) : '—'}
                  </div>
                </div>
                <div className="rounded-lg border border-theme-stroke bg-theme-surface-hover/40 px-2.5 py-2">
                  <div className="text-[11px] text-theme-text-muted">Outstanding</div>
                  <div
                    className={`text-sm ${
                      outstandingUsd > 0
                        ? 'text-amber-500 font-medium'
                        : 'text-theme-text-faint'
                    }`}
                  >
                    {outstandingUsd > 0 ? formatUsd(outstandingUsd) : '—'}
                  </div>
                </div>
              </div>

              {/* stracciatella-58546: Last activity — absent from the card in
                  Phase 1. Desktop shows relativeTime() with the precise
                  localized timestamp in title= (hover-only). Surface BOTH the
                  relative time and the precise timestamp inline, plus the last
                  Molto Benny reminder line. Reuses the exact same expressions
                  as the desktop cell (relativeTime + toLocaleString). */}
              <div className="mt-3 text-xs text-theme-text-secondary break-words">
                {row.aggregates.lastActivityAt ? (
                  <span>
                    Last activity{' '}
                    {relativeTime(new Date(row.aggregates.lastActivityAt))} ·{' '}
                    {new Date(row.aggregates.lastActivityAt).toLocaleString()}
                  </span>
                ) : (
                  <span className="text-theme-text-faint">No activity yet</span>
                )}
                {lastReminder && (
                  <div className="mt-0.5 text-theme-text-faint break-words">
                    🔔 {lastReminder.label} reminder ·{' '}
                    {relativeTime(new Date(lastReminder.at!))} ·{' '}
                    {new Date(lastReminder.at!).toLocaleString()}
                  </div>
                )}
              </div>

              {partySlug && (
                <Link
                  to={`/host/${partySlug}/details`}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-theme-text-secondary hover:text-[#E52828] hover:underline"
                >
                  <ExternalLink size={12} />
                  View host page
                </Link>
              )}

              {/* Actions — full-width labeled buttons */}
              <div className="mt-3">
                <CityActionsMenu
                  variant="card"
                  canMarkPaid={showMarkPartyPaid}
                  canAddExternal={canAddExternal}
                  canSendPayment={canSendPayment}
                  canToggleScamFlag={canToggleScamFlag}
                  canSendTgReminder={canSendTgReminder}
                  canSendWalletReminder={canSendWalletReminder}
                  canSendPhotoReminder={canSendPhotoReminder}
                  canSendAttendanceReminder={canSendAttendanceReminder}
                  canApproveCity={canApproveCity}
                  canReopen={isClosed && canReopenCap}
                  canManageTags={canManageTags}
                  customTags={customTags}
                  tagBusy={tagBusy}
                  markPaidLabel={markPaidLabel}
                  isFlaggedScam={isFlaggedScam}
                  scamFlagBusy={scamFlagBusy}
                  tgReminderBusy={tgReminderBusy}
                  walletReminderBusy={walletReminderBusy}
                  photoReminderBusy={photoReminderBusy}
                  attendanceReminderBusy={attendanceReminderBusy}
                  reopenBusy={reopenBusyPartyId === row.party.id}
                  approveBusy={approveBusyPartyId === row.party.id}
                  receiptsReminderSentAt={row.party.receiptsReminderSentAt}
                  walletReminderSentAt={row.party.walletReminderSentAt}
                  photoReminderSentAt={row.party.photoReminderSentAt}
                  attendanceReminderSentAt={row.party.attendanceReminderSentAt}
                  paymentsApprovedUsd={row.party.paymentsApprovedUsd}
                  paymentsApprovedAt={row.party.paymentsApprovedAt}
                  receiptsTotalUsd={receiptUsdTotal}
                  onMarkPartyPaid={
                    showMarkPartyPaid && onMarkPartyPaid
                      ? () => onMarkPartyPaid(row.party.id)
                      : undefined
                  }
                  onAddExternalPayment={
                    canAddExternal && onAddExternalPayment
                      ? () => onAddExternalPayment(row.party.id, row.party.name)
                      : undefined
                  }
                  onSendPayment={
                    canSendPayment && onSendPayment
                      ? () =>
                          onSendPayment(
                            applyReceiptOverridesToRow(row, partyOverrides),
                          )
                      : undefined
                  }
                  onToggleScamFlag={
                    canToggleScamFlag ? () => handleToggleScamFlag(row) : undefined
                  }
                  onApproveCity={
                    canApproveCity
                      ? (amountUsd) => handleApproveCity(row, amountUsd)
                      : undefined
                  }
                  onSendTgReminder={
                    canSendTgReminder ? () => handleSendTgReminder(row) : undefined
                  }
                  onSendWalletReminder={
                    canSendWalletReminder
                      ? () => handleSendWalletReminder(row)
                      : undefined
                  }
                  onSendPhotoReminder={
                    canSendPhotoReminder
                      ? () => handleSendPhotoReminder(row)
                      : undefined
                  }
                  onSendAttendanceReminder={
                    canSendAttendanceReminder
                      ? () => handleSendAttendanceReminder(row)
                      : undefined
                  }
                  onReopen={
                    isClosed && canReopenCap ? () => handleReopen(row) : undefined
                  }
                  onAddCustomTag={
                    canManageTags
                      ? (label) => handleAddCustomTag(row, label)
                      : undefined
                  }
                  onRemoveCustomTag={
                    canManageTags
                      ? (label) => handleRemoveCustomTag(row, label)
                      : undefined
                  }
                />
              </div>

              {/* Expanded detail — reuse the SAME CityExpansion component,
                  stacked vertically inside the card. */}
              {isOpen && (
                <div className="mt-3 border-t border-theme-stroke pt-3">
                  <CityExpansion
                    row={row}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                    onRowClick={onRowClick}
                    busyRowId={busyRowId}
                    canEditReceipts={canEditReceipts}
                    canManagePhotos={
                      viewerRole === 'admin' || viewerRole === 'underboss'
                    }
                    canEditAdminNotes={canEditAdminNotes}
                    onDocumentsChanged={onDocumentsChanged}
                    onApprove={viewerRole === 'admin' ? onApprove : undefined}
                    onExecute={viewerRole === 'admin' ? onExecute : undefined}
                    onMarkPaid={viewerRole === 'admin' ? onMarkPaid : undefined}
                    onReceiptOverride={(docId, override) => {
                      setReceiptOverridesByParty((prev) => ({
                        ...prev,
                        [row.party.id]: {
                          ...(prev[row.party.id] ?? {}),
                          [docId]: override,
                        },
                      }));
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
