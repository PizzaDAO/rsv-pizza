import React from 'react';
import { Plus, Receipt as ReceiptIcon, BadgeDollarSign } from 'lucide-react';
import { Payout } from '../../types';
import { PayoutListRow } from './PayoutListRow';

interface PayoutsListProps {
  payouts: Payout[];
  partyId: string;
  onOpenDetail: (payoutId: string) => void;
  onCancelled: (payoutId: string) => void;
  onStartNew: () => void;
  /**
   * Sum of finalAmountUsd for paid payouts on this party (arugula-38633 v2
   * follow-up). Renders a stat header above the list.
   */
  totalPaidUsd?: number;
  /** Reimbursement cap, if any. Combined with totalPaidUsd in the stat header. */
  reimbursementCapUsd?: number | null;
}

/**
 * Table of existing payouts for the current party. Empty-state CTA when none.
 * Layout mirrors `BudgetTab` so the host experience feels consistent.
 */
export const PayoutsList: React.FC<PayoutsListProps> = ({
  payouts,
  partyId,
  onOpenDetail,
  onCancelled,
  onStartNew,
  totalPaidUsd = 0,
  reimbursementCapUsd,
}) => {
  // Stat block: render whenever there's a paid total OR a cap is set. Empty
  // state otherwise (matches v2 follow-up plan).
  const hasCap = typeof reimbursementCapUsd === 'number' && reimbursementCapUsd > 0;
  const showStatHeader = totalPaidUsd > 0 || hasCap;

  if (payouts.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-theme-surface-hover flex items-center justify-center">
          <ReceiptIcon className="w-7 h-7 text-theme-text-muted" />
        </div>
        <h3 className="text-base font-semibold text-theme-text mb-1">No payouts yet</h3>
        <p className="text-sm text-theme-text-muted mb-6">
          Submit your first reimbursement to get paid back for pizza or venue costs.
        </p>
        <button
          onClick={onStartNew}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <Plus size={16} />
          Submit your first reimbursement
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showStatHeader && (
        <div className="card p-4 sm:p-5 flex items-center gap-3">
          <BadgeDollarSign size={20} className="text-emerald-500 flex-shrink-0" />
          <div className="text-sm font-medium text-theme-text">
            Total paid to date: ${totalPaidUsd.toFixed(2)}
            {hasCap && (
              <span className="text-theme-text-muted"> / ${reimbursementCapUsd!.toFixed(2)}</span>
            )}
          </div>
        </div>
      )}

      <div className="card p-4 sm:p-6">
        <div className="space-y-2">
          {payouts.map(p => (
            <PayoutListRow
              key={p.id}
              payout={p}
              partyId={partyId}
              onOpen={() => onOpenDetail(p.id)}
              onCancelled={onCancelled}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
