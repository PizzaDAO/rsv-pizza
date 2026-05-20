import React from 'react';
import { Check, X, Pencil, Eye, DollarSign, Send, Loader2 } from 'lucide-react';
import type { AdminPayout, PayoutStatus } from '../../types';
import { PayoutRow } from '../payments-shared';

interface PayoutsTableProps {
  payouts: AdminPayout[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onRowClick: (payout: AdminPayout) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (payout: AdminPayout) => void;
  onMarkPaid: (payout: AdminPayout) => void;
  /** Opens the modal so the admin can execute via the method-specific confirmation form. */
  onExecute: (payout: AdminPayout) => void;
  busyRowId?: string | null;
  loading?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

/** Status-dependent action menu rendered in the trailing cell. */
function ActionsCell({
  payout,
  busy,
  onApprove,
  onReject,
  onEdit,
  onMarkPaid,
  onExecute,
}: {
  payout: AdminPayout;
  busy: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (payout: AdminPayout) => void;
  onMarkPaid: (payout: AdminPayout) => void;
  onExecute: (payout: AdminPayout) => void;
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

      {status === 'approved' && (
        <>
          <button
            type="button"
            onClick={() => onExecute(payout)}
            disabled={busy}
            className="p-1.5 rounded-md hover:bg-emerald-50 text-emerald-600 disabled:opacity-50"
            title="Execute Payment"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
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

export const PayoutsTable: React.FC<PayoutsTableProps> = ({
  payouts,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRowClick,
  onApprove,
  onReject,
  onEdit,
  onMarkPaid,
  onExecute,
  busyRowId,
  loading,
  loadingMore,
  onLoadMore,
  hasMore,
}) => {
  const allSelected = payouts.length > 0 && payouts.every((p) => selectedIds.has(p.id));

  return (
    <div className="bg-theme-surface border border-theme-stroke rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-theme-stroke text-theme-text-muted text-left">
              <th className="px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  aria-label="Select all"
                  className="rounded border-theme-stroke-hover bg-theme-surface"
                />
              </th>
              <th className="px-3 py-3 w-14"></th>
              <th className="px-3 py-3 font-medium">Host</th>
              <th className="px-3 py-3 font-medium">Party</th>
              <th className="px-3 py-3 font-medium">Submitted</th>
              <th className="px-3 py-3 font-medium">Amount</th>
              <th className="px-3 py-3 font-medium">Method</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && payouts.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center text-theme-text-muted">
                  <Loader2 size={20} className="inline-block animate-spin mr-2" />
                  Loading payments…
                </td>
              </tr>
            )}
            {!loading && payouts.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center text-theme-text-faint">
                  No payments match these filters.
                </td>
              </tr>
            )}
            {payouts.map((p) => (
              <PayoutRow
                key={p.id}
                payout={p}
                showAdminColumns
                selectable
                selected={selectedIds.has(p.id)}
                onSelectToggle={() => onToggleSelect(p.id)}
                onClick={() => onRowClick(p)}
                actions={
                  <ActionsCell
                    payout={p}
                    busy={busyRowId === p.id}
                    onApprove={onApprove}
                    onReject={onReject}
                    onEdit={onEdit}
                    onMarkPaid={onMarkPaid}
                    onExecute={onExecute}
                  />
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="border-t border-theme-stroke p-3 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-theme-surface-hover hover:bg-theme-stroke text-sm font-medium text-theme-text disabled:opacity-50"
          >
            {loadingMore && <Loader2 size={14} className="animate-spin" />}
            Load more
          </button>
        </div>
      )}
    </div>
  );
};
