import React from 'react';
import { DollarSign, AlertCircle } from 'lucide-react';
import { IconInput } from '../IconInput';
import { ReceiptItem } from './ReceiptUpload';

interface PayoutAmountSummaryProps {
  receipts: ReceiptItem[];
  overrideAmount: number | null;
  onOverrideChange: (value: number | null) => void;
}

/**
 * Shows the auto-summed USD total from OCR'd receipts, with a manual override
 * `IconInput`. Once the host edits the override, we treat that as authoritative
 * and stop pinning to the OCR sum.
 */
export const PayoutAmountSummary: React.FC<PayoutAmountSummaryProps> = ({
  receipts,
  overrideAmount,
  onOverrideChange,
}) => {
  const ocrSum = receipts
    .filter(r => r.status === 'done' && r.ocr)
    .reduce((sum, r) => sum + (r.ocr?.amount ?? 0), 0);

  const lowConfidenceCount = receipts.filter(
    r => r.status === 'done' && r.ocr && r.ocr.confidence < 0.8
  ).length;
  const ocringCount = receipts.filter(r => r.status === 'ocring' || r.status === 'uploading').length;

  const displayAmount = overrideAmount != null ? overrideAmount : ocrSum;

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <p className="text-xs text-theme-text-muted mb-1">Auto-summed from receipts</p>
          <p className="text-2xl font-bold text-theme-text">
            ${ocrSum.toFixed(2)} <span className="text-sm text-theme-text-muted font-normal">USD</span>
          </p>
        </div>
        <div className="flex-1">
          <IconInput
            icon={DollarSign}
            type="number"
            step="0.01"
            min="0"
            placeholder={`Override amount (USD) — leave blank to use $${ocrSum.toFixed(2)}`}
            value={overrideAmount == null ? '' : String(overrideAmount)}
            onChange={e => {
              const v = e.target.value.trim();
              if (v === '') {
                onOverrideChange(null);
              } else {
                const n = Number(v);
                onOverrideChange(Number.isFinite(n) ? n : null);
              }
            }}
          />
        </div>
      </div>

      <p className="text-xs text-theme-text-muted">
        Final amount requested:{' '}
        <span className="text-theme-text font-semibold">${displayAmount.toFixed(2)} USD</span>
        {overrideAmount != null && overrideAmount !== ocrSum && (
          <span className="ml-1 text-amber-300">(manual override)</span>
        )}
      </p>

      {ocringCount > 0 && (
        <p className="text-xs text-theme-text-muted inline-flex items-center gap-1">
          <AlertCircle size={12} /> {ocringCount} receipt(s) still processing — amount may change.
        </p>
      )}

      {lowConfidenceCount > 0 && (
        <p className="text-xs text-amber-300 inline-flex items-center gap-1">
          <AlertCircle size={12} /> {lowConfidenceCount} receipt(s) had low OCR confidence. Double-check the total above.
        </p>
      )}
    </div>
  );
};
