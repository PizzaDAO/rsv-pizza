import React from 'react';
import { Check, X, DollarSign, Loader2, FileJson, Send } from 'lucide-react';

interface BulkActionsBarProps {
  selectedCount: number;
  /**
   * etruria-92103: when the page is in by-city view, also pass the number of
   * distinct cities (parties) the current selection spans so the label reads
   * "N payments across M cities selected". Omitted (or 0) reverts to the
   * existing "N selected" label.
   */
  selectedCityCount?: number;
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
  /**
   * argentina-92103: viewer role drives which buttons render. Underbosses
   * see Approve / Reject only — Bulk Send, Mark Paid, Export Safe JSON are
   * funds-adjacent operations that stay admin-only.
   */
  viewerRole?: 'admin' | 'underboss';
  busy?: boolean;
}

export const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
  selectedCount,
  selectedCityCount,
  onApprove,
  onReject,
  onMarkPaid,
  onClear,
  onExportSafeJson,
  onBulkSend,
  eligibleBulkSendCount = 0,
  viewerRole = 'admin',
  busy = false,
}) => {
  if (selectedCount === 0) return null;
  // argentina-92103: underbosses can't send funds — hide Mark Paid, Bulk
  // Send, Export Safe JSON. Approve / Reject stay visible.
  const showFundsActions = viewerRole === 'admin';
  // etruria-92103: in by-city view, surface "N payments across M cities
  // selected" so admins understand that their selection lives at the
  // payment level (not the party level).
  const label =
    selectedCityCount && selectedCityCount > 0
      ? `${selectedCount} payment${selectedCount === 1 ? '' : 's'} across ${selectedCityCount} cit${selectedCityCount === 1 ? 'y' : 'ies'} selected`
      : `${selectedCount} selected`;
  return (
    <div className="bg-theme-text/95 text-white rounded-xl px-3 py-2 sm:px-4 sm:py-3 mb-3 shadow-lg flex items-center gap-2 sm:gap-3 flex-wrap">
      <span className="text-sm font-medium">{label}</span>
      <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1 px-4 min-h-11 sm:min-h-0 sm:px-3 sm:py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Approve
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1 px-4 min-h-11 sm:min-h-0 sm:px-3 sm:py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium disabled:opacity-50"
        >
          <X size={14} />
          Reject
        </button>
        {showFundsActions && (
          <button
            type="button"
            onClick={onMarkPaid}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1 px-4 min-h-11 sm:min-h-0 sm:px-3 sm:py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
          >
            <DollarSign size={14} />
            Mark paid
          </button>
        )}
        {showFundsActions && onBulkSend && (
          <button
            type="button"
            onClick={onBulkSend}
            disabled={busy || eligibleBulkSendCount === 0}
            className="inline-flex items-center justify-center gap-1 px-4 min-h-11 sm:min-h-0 sm:px-3 sm:py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
        {showFundsActions && onExportSafeJson && (
          <button
            type="button"
            onClick={onExportSafeJson}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1 px-4 min-h-11 sm:min-h-0 sm:px-3 sm:py-1.5 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-sm font-medium disabled:opacity-50"
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
