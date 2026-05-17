import React from 'react';
import { Check, X, DollarSign, Loader2 } from 'lucide-react';

interface BulkActionsBarProps {
  selectedCount: number;
  onApprove: () => void;
  onReject: () => void;
  onMarkPaid: () => void;
  onClear: () => void;
  busy?: boolean;
}

export const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
  selectedCount,
  onApprove,
  onReject,
  onMarkPaid,
  onClear,
  busy = false,
}) => {
  if (selectedCount === 0) return null;
  return (
    <div className="sticky top-[7rem] z-10 bg-theme-text/95 text-white rounded-xl px-4 py-3 mb-3 shadow-lg flex items-center gap-3 flex-wrap">
      <span className="text-sm font-medium">{selectedCount} selected</span>
      <div className="ml-auto flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Approve
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium disabled:opacity-50"
        >
          <X size={14} />
          Reject
        </button>
        <button
          type="button"
          onClick={onMarkPaid}
          disabled={busy}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
        >
          <DollarSign size={14} />
          Mark paid
        </button>
        <button
          type="button"
          onClick={onClear}
          className="text-sm text-white/60 hover:text-white px-2 py-1"
        >
          Clear
        </button>
      </div>
    </div>
  );
};
