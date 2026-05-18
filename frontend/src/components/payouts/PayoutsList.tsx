import React from 'react';
import { Plus, Receipt as ReceiptIcon } from 'lucide-react';
import { Payout } from '../../types';
import { PayoutListRow } from './PayoutListRow';

interface PayoutsListProps {
  payouts: Payout[];
  partyId: string;
  onOpenDetail: (payoutId: string) => void;
  onCancelled: (payoutId: string) => void;
  onStartNew: () => void;
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
}) => {
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
  );
};
