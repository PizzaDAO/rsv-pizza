import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, AlertTriangle } from 'lucide-react';
import type { AdminPayout } from '../../types';
import {
  buildSafeBatch,
  downloadSafeBatch,
  type SafeBatchLabel,
} from '../../lib/safeTransactionBuilder';

interface ExportSafeJsonModalProps {
  /** All currently-selected payouts on the dashboard. */
  selected: AdminPayout[];
  onClose: () => void;
  /**
   * Fired after the download is triggered so the parent can flash a toast.
   * The modal closes itself separately.
   */
  onExported?: (summary: { included: number; skipped: number; label: SafeBatchLabel }) => void;
}

const LABEL_OPTIONS: { value: SafeBatchLabel; label: string }[] = [
  { value: 'prepayment_50', label: '50% Prepayment' },
  { value: 'final', label: 'Final Payment' },
  { value: 'custom', label: 'Custom' },
];

/**
 * siciliana-69183: small modal that previews the Safe-batch export before the
 * admin downloads it. Counts how many of the selected payouts are eligible
 * (USDC + valid 0x wallet + positive amount) vs skipped, and lets the admin
 * pick a label (50% Prepayment / Final / Custom) that controls the JSON's
 * meta.name + meta.description + filename. Does NOT recalculate amounts —
 * each transaction uses the payout's `finalAmountUsd` as-is.
 */
export const ExportSafeJsonModal: React.FC<ExportSafeJsonModalProps> = ({
  selected,
  onClose,
  onExported,
}) => {
  const [label, setLabel] = useState<SafeBatchLabel>('prepayment_50');

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Preview-only build — cheap and pure, so we re-derive on every render to
  // keep `included` / `skipped` in sync with the selection.
  const preview = useMemo(() => buildSafeBatch(selected, label), [selected, label]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (preview.included === 0) return;
    downloadSafeBatch(preview);
    onExported?.({ included: preview.included, skipped: preview.skipped, label });
    onClose();
  }

  const body = (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-theme-surface rounded-2xl shadow-2xl border border-theme-stroke w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-theme-stroke">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-theme-text">Export Safe JSON</h2>
            <p className="text-xs text-theme-text-muted mt-0.5">
              Downloads a Gnosis Safe Transaction Builder v1.0 batch — drag the file into the
              Safe app to execute.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-theme-surface-hover text-theme-text-muted"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Label picker */}
          <div>
            <p className="text-xs uppercase tracking-wide text-theme-text-muted mb-1.5">
              Transaction type
            </p>
            <select
              value={label}
              onChange={(e) => setLabel(e.target.value as SafeBatchLabel)}
              className="w-full px-3 py-2 rounded-lg bg-theme-surface-hover border border-theme-stroke text-sm text-theme-text focus:outline-none focus:border-theme-stroke-hover"
            >
              {LABEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-theme-text-muted mt-1.5">
              Affects the batch label + filename only. Amounts come from each payout's
              <code className="mx-1 px-1 py-0.5 rounded bg-theme-surface text-[11px]">finalAmountUsd</code>
              as-is.
            </p>
          </div>

          {/* Summary */}
          <div className="px-3 py-3 rounded-lg bg-theme-surface-hover border border-theme-stroke text-sm">
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-theme-text">{selected.length}</span>
              <span className="text-theme-text-muted">selected</span>
              <span className="text-theme-text-muted">•</span>
              <span className="font-medium text-emerald-500">{preview.included}</span>
              <span className="text-theme-text-muted">USDC eligible</span>
              {preview.skipped > 0 && (
                <>
                  <span className="text-theme-text-muted">•</span>
                  <span className="font-medium text-amber-500">{preview.skipped}</span>
                  <span className="text-theme-text-muted">skipped</span>
                </>
              )}
            </div>
            {preview.skipped > 0 && (
              <div className="flex items-start gap-1.5 mt-2 text-xs text-amber-500/90">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>
                  Skipped rows are non-USDC, have a malformed wallet, or have an amount of $0.
                  Only USDC-on-Base payouts with a valid 0x recipient can be batched.
                </span>
              </div>
            )}
          </div>

          {preview.included === 0 && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                No eligible payouts in the current selection — pick at least one USDC payout
                with a valid 0x recipient.
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-theme-stroke">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm text-theme-text-muted hover:text-theme-text"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={preview.included === 0}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={14} />
            Download safe-batch.json
          </button>
        </div>
      </form>
    </div>
  );

  return createPortal(body, document.body);
};
