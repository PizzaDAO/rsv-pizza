import React from 'react';
import { Check, X, DollarSign, Loader2, FileJson, Send } from 'lucide-react';

interface BulkActionsBarProps {
  selectedCount: number;
  onApprove: () => void;
  onReject: () => void;
  onMarkPaid: () => void;
  onClear: () => void;
  /**
   * siciliana-69183: open the ExportSafeJsonModal for the current selection.
   * The modal itself filters non-USDC / missing-wallet rows.
   */
  onExportSafeJson?: () => void;
  /**
   * salsiccia-49102: open the BulkSendModal for the current selection.
   * Button only enabled when `eligibleBulkSendCount > 0` (USDC + approved).
   */
  onBulkSend?: () => void;
  /**
   * Number of selected rows that are eligible for bulk USDC send
   * (usdc_base + approved + valid 0x wallet). When 0, the "Bulk Send" button
   * is grayed out + tooltip explains why.
   */
  eligibleBulkSendCount?: number;
  busy?: boolean;
}

export const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
  selectedCount,
  onApprove,
  onReject,
  onMarkPaid,
  onClear,
  onExportSafeJson,
  onBulkSend,
  eligibleBulkSendCount = 0,
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
        {onBulkSend && (
          <button
            type="button"
            onClick={onBulkSend}
            disabled={busy || eligibleBulkSendCount === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              eligibleBulkSendCount === 0
                ? 'No eligible USDC payouts selected (need approved or failed + valid 0x wallet)'
                : `Send USDC from the hot wallet to ${eligibleBulkSendCount} recipient${eligibleBulkSendCount === 1 ? '' : 's'}`
            }
          >
            <Send size={14} />
            Bulk Send{eligibleBulkSendCount > 0 ? ` (${eligibleBulkSendCount})` : ''}
          </button>
        )}
        {onExportSafeJson && (
          <button
            type="button"
            onClick={onExportSafeJson}
            disabled={busy}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-sm font-medium disabled:opacity-50"
            title="Bundle selected USDC payouts as a Gnosis Safe Transaction Builder batch"
          >
            <FileJson size={14} />
            Export Safe JSON
          </button>
        )}
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
