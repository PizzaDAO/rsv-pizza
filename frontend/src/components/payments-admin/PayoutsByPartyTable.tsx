import React, { useMemo, useState } from 'react';
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
} from 'lucide-react';
import type {
  AdminPayout,
  PartyPayoutsRow,
  PayoutDocument,
  PayoutStatus,
} from '../../types';
import {
  PayoutStatusPill,
  PayoutMethodIcon,
  ReceiptLightbox,
  type ReceiptLightboxImage,
  formatUsd,
} from '../payments-shared';
import { ClickableEmail } from '../ClickableEmail';

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
 */
function CityExpansion({
  row,
  selectedIds,
  onToggleSelect,
  onRowClick,
  busyRowId,
}: {
  row: PartyPayoutsRow;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onRowClick: (payout: AdminPayout) => void;
  busyRowId?: string | null;
}) {
  // Hooks first — never below a conditional return. (feedback_hooks_above_early_returns)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showPendingClaims, setShowPendingClaims] = useState(false);

  // Merge receipts across all payouts on the party — multi-host pot.
  const receiptEntries = useMemo(() => collectReceipts(row.payouts), [row.payouts]);

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

  const lightboxImages: ReceiptLightboxImage[] = useMemo(
    () =>
      receiptEntries.map((e) => ({
        url: e.doc.url,
        fileName: e.doc.fileName,
        mimeType: e.doc.mimeType,
      })),
    [receiptEntries],
  );

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
                onClick={() => setLightboxIndex(idx)}
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

      {receiptEntries.length === 0 && rollup.paidPayouts.length === 0 && inflightPayouts.length === 0 && (
        <div className="text-sm text-theme-text-faint italic">
          No payouts on this city match the current filters.
        </div>
      )}

      <ReceiptLightbox
        isOpen={lightboxIndex != null}
        images={lightboxImages}
        initialIndex={lightboxIndex ?? 0}
        onClose={() => setLightboxIndex(null)}
      />
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
