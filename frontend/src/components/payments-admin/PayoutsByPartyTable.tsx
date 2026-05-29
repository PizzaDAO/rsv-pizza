import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Paperclip,
  Flag,
  Check,
  CheckCircle2,
  X,
  Pencil,
  Eye,
  DollarSign,
  Send,
  Undo2,
  Coins,
} from 'lucide-react';
import type { AdminPayout, PartyPayoutsRow, PayoutStatus } from '../../types';
import { PayoutRow } from '../payments-shared';

/**
 * etruria-92103: group-by-city view of /payments. Top-level rows show one
 * party with status aggregates + receipt count + last activity. Click the
 * chevron (or the row) to expand and render the underlying payouts using the
 * shared `PayoutRow` primitive — same actions, same review-modal handlers as
 * the per-payment view.
 *
 * Row selection (Bulk Send / Mark Paid / Export Safe JSON) lives on the
 * INNER payouts inside the expansion — selecting a whole party doesn't make
 * sense as a bulk action and would surprise admins.
 */

interface PayoutsByPartyTableProps {
  rows: PartyPayoutsRow[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  /** Opens the per-payout review modal (same shape as PayoutsTable). */
  onRowClick: (payout: AdminPayout) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (payout: AdminPayout) => void;
  onMarkPaid: (payout: AdminPayout) => void;
  onExecute: (payout: AdminPayout) => void;
  onUnapprove?: (id: string) => void;
  onHostClick?: (userId: string) => void;
  onCapUpdated?: (partyId: string) => void;
  /**
   * bocconcini-92103: open MarkPartyPaidModal for the row's party so the
   * admin can flip every in-flight (pending + approved) payout for the city
   * paid in one go. Same handler used by PrepayQueueTable and the
   * PayoutReviewModal footer. Hidden for underbosses (funds-team-only).
   */
  onMarkPartyPaid?: (partyId: string) => void;
  /**
   * bocconcini-92103: viewer role. Defaults to `'admin'` so existing callers
   * keep the full action set. `'underboss'` hides the per-row "Mark paid"
   * button — flipping payouts to paid is a funds-acknowledgement action
   * reserved for admins.
   */
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

/** Status-dependent action menu rendered in the expanded inner row's trailing cell. */
function InnerActionsCell({
  payout,
  busy,
  onApprove,
  onReject,
  onEdit,
  onMarkPaid,
  onExecute,
  onUnapprove,
}: {
  payout: AdminPayout;
  busy: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (payout: AdminPayout) => void;
  onMarkPaid: (payout: AdminPayout) => void;
  onExecute: (payout: AdminPayout) => void;
  onUnapprove?: (id: string) => void;
}) {
  const status: PayoutStatus = payout.status;
  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => onEdit(payout)}
        className="p-1.5 rounded-md hover:bg-theme-surface-hover text-theme-text-secondary"
        title="View / Edit"
        disabled={busy}
      >
        <Eye size={15} />
      </button>

      {status === 'pending' && (
        <>
          <button
            type="button"
            onClick={() => onApprove(payout.id)}
            disabled={busy}
            className="p-1.5 rounded-md hover:bg-emerald-50 text-emerald-600 disabled:opacity-50"
            title="Approve"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          </button>
          <button
            type="button"
            onClick={() => onReject(payout.id)}
            disabled={busy}
            className="p-1.5 rounded-md hover:bg-red-50 text-red-600 disabled:opacity-50"
            title="Reject"
          >
            <X size={15} />
          </button>
          <button
            type="button"
            onClick={() => onEdit(payout)}
            className="p-1.5 rounded-md hover:bg-theme-surface-hover text-theme-text-secondary"
            title="Edit amount"
            disabled={busy}
          >
            <Pencil size={15} />
          </button>
        </>
      )}

      {(status === 'approved' || status === 'failed') && (
        <>
          <button
            type="button"
            onClick={() => onExecute(payout)}
            disabled={busy}
            className="p-1.5 rounded-md hover:bg-emerald-50 text-emerald-600 disabled:opacity-50"
            title={status === 'failed' ? 'Retry Payment' : 'Execute Payment'}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
          {status === 'approved' && onUnapprove && (
            <button
              type="button"
              onClick={() => onUnapprove(payout.id)}
              disabled={busy}
              className="p-1.5 rounded-md hover:bg-amber-50 text-amber-600 disabled:opacity-50"
              title="Revert to Pending"
            >
              <Undo2 size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onMarkPaid(payout)}
            disabled={busy}
            className="p-1.5 rounded-md hover:bg-blue-50 text-blue-600 disabled:opacity-50"
            title="Mark paid (manual)"
          >
            <DollarSign size={15} />
          </button>
        </>
      )}
    </div>
  );
}

export const PayoutsByPartyTable: React.FC<PayoutsByPartyTableProps> = ({
  rows,
  selectedIds,
  onToggleSelect,
  onRowClick,
  onApprove,
  onReject,
  onEdit,
  onMarkPaid,
  onExecute,
  onUnapprove,
  onHostClick,
  onCapUpdated,
  onMarkPartyPaid,
  viewerRole = 'admin',
  busyRowId,
  loading,
}) => {
  // Default state: all collapsed. Tracks `party.id`s the admin has expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // bocconcini-92103: funds-acknowledgement action — admin-only. Underbosses
  // see the by-city table read-only for this column.
  const canMarkPartyPaid = viewerRole === 'admin' && !!onMarkPartyPaid;

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
              <th className="px-3 py-3 font-medium">Pending</th>
              <th className="px-3 py-3 font-medium">Approved</th>
              <th className="px-3 py-3 font-medium">Paid</th>
              <th className="px-3 py-3 font-medium">Receipts</th>
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
              // bocconcini-92103: surface a per-row "Mark paid" button on
              // cities with any in-flight (pending OR approved) payouts so
              // admins can flip everything to paid in one click without
              // expanding the row first. Hidden when there's nothing to do
              // (no pending/approved rows) and for underboss viewers.
              const hasInFlight =
                row.aggregates.pendingCount + row.aggregates.approvedCount > 0;
              // pinsa-92103: ALSO show the button when the city has paid
              // payouts but hasn't been closed yet (Ekiti, Tangier) so the
              // admin can stamp the close timestamp. Cities with NO payouts
              // at all stay hidden — there's nothing to close.
              const closedAt = row.party.paymentsClosedAt ?? null;
              const isClosed = !!closedAt;
              const canCloseOut =
                !hasInFlight && !isClosed && row.aggregates.paidCount > 0;
              const showMarkPartyPaid =
                canMarkPartyPaid && !isClosed && (hasInFlight || canCloseOut);
              const markPaidTooltip = hasInFlight
                ? 'Mark all pending + approved payments paid for this city'
                : 'Close out this city — no pending payments to action';
              return (
                <React.Fragment key={row.party.id}>
                  {/* Outer party row */}
                  <tr
                    className="border-b border-theme-stroke transition-colors cursor-pointer hover:bg-theme-surface-hover"
                    onClick={() => toggleExpanded(row.party.id)}
                  >
                    <td className="px-3 py-3 w-10 text-theme-text-muted">
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </td>
                    <td className="px-3 py-3 text-sm min-w-[12rem]">
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
                        <div className="text-xs text-theme-text-muted">{row.party.country}</div>
                      )}
                      {row.aggregates.flaggedReadyCount > 0 && (
                        <div
                          className="inline-flex items-center gap-1 text-[11px] text-emerald-500 mt-0.5"
                          title={`${row.aggregates.flaggedReadyCount} payment${row.aggregates.flaggedReadyCount === 1 ? '' : 's'} flagged ready for payment`}
                        >
                          <Flag size={11} />
                          {row.aggregates.flaggedReadyCount} flagged ready
                        </div>
                      )}
                      {/* pinsa-92103: ✓ Closed pill — admin marked this
                          city's payouts fully closed-out. Renders next to
                          the city name so it's the first thing the admin
                          sees on the row. Tooltip surfaces the close
                          timestamp for audit traceability. */}
                      {isClosed && (
                        <div
                          className="inline-flex items-center gap-1 text-[11px] text-emerald-500 mt-0.5 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30"
                          title={`Closed out ${new Date(closedAt!).toLocaleString()}`}
                        >
                          <CheckCircle2 size={11} />
                          Closed
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-3 py-3 text-sm ${
                        row.aggregates.pendingCount > 0 ? 'text-amber-500 font-medium' : 'text-theme-text-faint'
                      }`}
                    >
                      {row.aggregates.pendingCount > 0
                        ? `${row.aggregates.pendingCount} · $${row.aggregates.pendingUsd.toFixed(2)}`
                        : '—'}
                    </td>
                    <td
                      className={`px-3 py-3 text-sm ${
                        row.aggregates.approvedCount > 0 ? 'text-sky-500 font-medium' : 'text-theme-text-faint'
                      }`}
                    >
                      {row.aggregates.approvedCount > 0
                        ? `${row.aggregates.approvedCount} · $${row.aggregates.approvedUsd.toFixed(2)}`
                        : '—'}
                    </td>
                    <td
                      className={`px-3 py-3 text-sm ${
                        row.aggregates.paidCount > 0 ? 'text-emerald-500 font-medium' : 'text-theme-text-faint'
                      }`}
                    >
                      {row.aggregates.paidCount > 0
                        ? `${row.aggregates.paidCount} · $${row.aggregates.paidUsd.toFixed(2)}`
                        : '—'}
                    </td>
                    <td className="px-3 py-3 text-sm text-theme-text-secondary">
                      {row.aggregates.totalReceiptCount > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip size={12} className="text-theme-text-muted" />
                          {row.aggregates.totalReceiptCount}
                        </span>
                      ) : (
                        <span className="text-theme-text-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-sm text-theme-text-secondary">
                      <div className="flex items-center justify-between gap-2">
                        <div title={new Date(row.aggregates.lastActivityAt).toLocaleString()}>
                          {relativeTime(new Date(row.aggregates.lastActivityAt))}
                        </div>
                        {/* bocconcini-92103: per-row "Mark paid" — bridges
                            the panettone modal into the by-city default view.
                            Click stops propagation so it doesn't toggle the
                            row's expansion.
                            pinsa-92103: also shown when the city has only
                            paid payouts (no pending/approved) and hasn't
                            been closed yet — admin clicks to stamp the
                            close timestamp (Ekiti / Tangier). Hidden when
                            the city is already closed. */}
                        {showMarkPartyPaid && onMarkPartyPaid && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onMarkPartyPaid(row.party.id);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-red-500/40 text-red-300 hover:bg-red-500/10 text-xs font-medium"
                            title={markPaidTooltip}
                          >
                            <Coins size={12} />
                            Mark paid
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded inner payouts — same PayoutRow primitive as the
                      per-payment view, indented with a left border. */}
                  {isOpen && row.payouts.length > 0 && (
                    <tr>
                      <td colSpan={7} className="p-0 bg-theme-surface/40">
                        <div className="border-l-4 border-theme-stroke ml-3 pl-2">
                          <table className="w-full min-w-[600px] text-sm">
                            <thead>
                              <tr className="border-b border-theme-stroke text-theme-text-muted text-left">
                                <th className="px-3 py-2 w-10"></th>
                                <th className="px-3 py-2 w-14"></th>
                                <th className="px-3 py-2 font-medium">Host</th>
                                <th className="px-3 py-2 font-medium">Party</th>
                                <th className="px-3 py-2 font-medium">Submitted</th>
                                <th className="px-3 py-2 font-medium">Amount</th>
                                <th className="px-3 py-2 font-medium">Method</th>
                                <th className="px-3 py-2 font-medium">Status</th>
                                <th className="px-3 py-2 font-medium text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.payouts.map((p) => (
                                <PayoutRow
                                  key={p.id}
                                  payout={p}
                                  showAdminColumns
                                  selectable
                                  selected={selectedIds.has(p.id)}
                                  onSelectToggle={() => onToggleSelect(p.id)}
                                  onClick={() => onRowClick(p)}
                                  onHostClick={onHostClick}
                                  onCapUpdated={onCapUpdated}
                                  actions={
                                    <InnerActionsCell
                                      payout={p}
                                      busy={busyRowId === p.id}
                                      onApprove={onApprove}
                                      onReject={onReject}
                                      onEdit={onEdit}
                                      onMarkPaid={onMarkPaid}
                                      onExecute={onExecute}
                                      onUnapprove={onUnapprove}
                                    />
                                  }
                                />
                              ))}
                            </tbody>
                          </table>
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
