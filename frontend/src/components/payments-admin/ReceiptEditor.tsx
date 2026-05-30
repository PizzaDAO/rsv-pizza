import React from 'react';
import { Loader2, Plus, Trash2, Copy, DollarSign, AlertTriangle, RefreshCw } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import type { PayoutDocument, ReceiptLineItem, ReceiptLineItemCategory } from '../../types';

/**
 * pesto-92104: shared receipt-editor surface. Today this is rendered inside
 * the ReceiptLightbox's right pane when the lightbox is showing a receipt
 * thumbnail in admin mode. State (drafts, save errors, in-flight flags)
 * lives in the parent (PayoutReviewModal) so a single source of truth
 * survives lightbox open/close + arrow navigation; this component is
 * presentational and accepts the current values + callbacks.
 *
 * Layout choices match the spacious lightbox real estate (full-width
 * IconInput for amount/currency, vertical line-item rows that read more
 * like a form than the tight data-grid the right-pane of the modal uses).
 * The right-pane row in PayoutReviewModal stays as-is (compact inline
 * data-grid) so the existing flow isn't regressed.
 */

export type ReceiptDraft = { amount: string; currency: string };
export type LineItemDraft = {
  name: string;
  qty: string;
  unitPrice: string;
  subtotal: string;
  category: ReceiptLineItemCategory;
};

interface ReceiptEditorProps {
  doc: PayoutDocument;
  /** Amount/currency draft for this receipt. */
  draft: ReceiptDraft;
  onDraftChange: (next: ReceiptDraft) => void;
  saving: boolean;
  saveError?: string;
  onSave: () => void;

  /** Mark-duplicate state. */
  isDuplicate: boolean;
  dupSaving: boolean;
  dupError?: string;
  onToggleDuplicate: () => void;

  /** Line items editor. */
  lineItemDrafts: LineItemDraft[] | undefined;
  lineItemsSaving: boolean;
  lineItemsSaveError?: string;
  onLineItemDraftChange: (idx: number, patch: Partial<LineItemDraft>) => void;
  onAddLineItem: () => void;
  onRemoveLineItem: (idx: number) => void;
  onSaveLineItems: () => void;
  /** Copy the line-sum into the amount draft. */
  onUseLineSumForAmount: () => void;

  /** Optional retry-OCR affordance for failed rows. */
  hasOcrError?: boolean;
  retrying?: boolean;
  retryError?: string;
  onRetryOcr?: () => void;

  /** Whether the draft differs from persisted values (drives Save button). */
  isDirty: boolean;
}

function draftSubtotalSum(drafts: LineItemDraft[] | undefined): number {
  if (!drafts) return 0;
  let sum = 0;
  for (const d of drafts) {
    const n = Number(d.subtotal);
    if (Number.isFinite(n) && n >= 0) sum += n;
  }
  return sum;
}

export const ReceiptEditor: React.FC<ReceiptEditorProps> = ({
  doc,
  draft,
  onDraftChange,
  saving,
  saveError,
  onSave,
  isDuplicate,
  dupSaving,
  dupError,
  onToggleDuplicate,
  lineItemDrafts,
  lineItemsSaving,
  lineItemsSaveError,
  onLineItemDraftChange,
  onAddLineItem,
  onRemoveLineItem,
  onSaveLineItems,
  onUseLineSumForAmount,
  hasOcrError,
  retrying,
  retryError,
  onRetryOcr,
  isDirty,
}) => {
  const conf = doc.ocrConfidence ?? 0;
  const lowConf = conf > 0 && conf < 0.8;
  const lineSum = draftSubtotalSum(lineItemDrafts);
  // The "Sum" label uses the receipt's original currency if known so it
  // matches what admins are typing into the per-line subtotals.
  const sumCurrency = doc.originalCurrency ?? doc.ocrCurrency ?? 'USD';

  return (
    <div className="p-4 space-y-4 text-theme-text">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold truncate">
            Receipt {doc.id.slice(0, 8)}
          </h3>
          <p className="text-xs text-theme-text-muted truncate" title={doc.fileName}>
            {doc.fileName}
          </p>
        </div>
        {conf > 0 && (
          <span
            className={`text-xs whitespace-nowrap ${
              lowConf ? 'text-amber-500' : 'text-theme-text-faint'
            }`}
            title="OCR confidence"
          >
            {(conf * 100).toFixed(0)}% confidence
          </span>
        )}
      </div>

      {/* Amount + currency */}
      <div className="space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-2">
          <IconInput
            icon={DollarSign}
            type="number"
            step="0.01"
            min="0"
            placeholder="Amount"
            value={draft.amount}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onDraftChange({ ...draft, amount: e.target.value })
            }
          />
          {/*
            Currency is short (3-letter ISO usually). IconInput's full-width
            layout would crowd the row, so a compact uppercase input cell
            keeps the field reasonable — same precedent as the per-row
            data-grid currency input in PayoutReviewModal. */}
          <input
            type="text"
            maxLength={8}
            value={draft.currency}
            placeholder={doc.ocrCurrency || 'CUR'}
            onChange={(e) => onDraftChange({ ...draft, currency: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-theme-stroke bg-theme-surface text-theme-text text-sm uppercase"
          />
        </div>
        <p className="text-xs text-white/40">
          Amount is the USD-converted total stored on this receipt. Changing the
          currency re-runs FX automatically against the receipt's original
          amount on save.
        </p>
        {saveError && (
          <div className="text-xs text-red-300 flex items-start gap-1.5">
            <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
            <span>{saveError}</span>
          </div>
        )}
      </div>

      {/* Mark duplicate + Save row */}
      <div className="flex flex-wrap items-center gap-3">
        <Checkbox
          checked={isDuplicate}
          onChange={onToggleDuplicate}
          label={isDuplicate ? 'Marked as duplicate' : 'Mark as duplicate'}
          disabled={dupSaving}
        />
        {dupSaving && <Loader2 size={12} className="animate-spin text-theme-text-muted" />}
        <span className="text-xs text-white/40 hidden sm:inline">
          (press <span className="font-mono">D</span>)
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || saving}
          className="px-3 py-2 rounded-lg bg-[#E52828] text-white text-sm disabled:opacity-40 inline-flex items-center gap-1.5"
          title="Save amount + currency for this receipt"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
        </button>
      </div>
      {dupError && (
        <div className="text-xs text-red-300 flex items-start gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <span>{dupError}</span>
        </div>
      )}

      {/* OCR retry — only visible when the doc errored. Keeps parity with
          the right-pane row's per-row retry affordance (pancetta-92104). */}
      {hasOcrError && onRetryOcr && (
        <div className="rounded-lg border border-theme-stroke p-3 bg-theme-bg space-y-2">
          <div className="text-xs text-amber-500 flex items-start gap-1.5">
            <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
            <span>{doc.ocrError || 'OCR failed for this receipt.'}</span>
          </div>
          <button
            type="button"
            onClick={onRetryOcr}
            disabled={retrying}
            className="px-3 py-1.5 rounded border border-theme-stroke text-theme-text text-xs disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {retrying ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Retry OCR
          </button>
          {retryError && (
            <div className="text-xs text-red-300">{retryError}</div>
          )}
        </div>
      )}

      {/* Line items */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">
            Line items ({lineItemDrafts?.length ?? 0})
          </h4>
          <span className="text-xs text-theme-text-muted">
            Sum: {sumCurrency} {lineSum.toFixed(2)}
          </span>
        </div>
        <div className="rounded-lg border border-theme-stroke bg-theme-bg p-2 space-y-1.5">
          {(lineItemDrafts ?? []).length === 0 && (
            <p className="text-xs text-theme-text-faint p-2">
              No line items yet. Click <span className="font-semibold">Add line</span> to start.
            </p>
          )}
          {(lineItemDrafts ?? []).map((d, idx) => (
            <div
              key={idx}
              className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap"
            >
              {/*
                taralli-92104 precedent: line-item rows are data-grid cells,
                not form fields. Raw inputs keep the layout tight enough to
                show all 5 columns + remove on one row. */}
              <input
                type="text"
                value={d.name}
                placeholder="name"
                onChange={(e) =>
                  onLineItemDraftChange(idx, { name: e.target.value })
                }
                className="flex-1 min-w-[120px] px-2 py-1 rounded border border-theme-stroke bg-theme-surface text-theme-text text-xs"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={d.qty}
                placeholder="qty"
                onChange={(e) =>
                  onLineItemDraftChange(idx, { qty: e.target.value })
                }
                className="w-14 px-2 py-1 rounded border border-theme-stroke bg-theme-surface text-theme-text text-xs text-right"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={d.unitPrice}
                placeholder="unit"
                onChange={(e) =>
                  onLineItemDraftChange(idx, { unitPrice: e.target.value })
                }
                className="w-20 px-2 py-1 rounded border border-theme-stroke bg-theme-surface text-theme-text text-xs text-right"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={d.subtotal}
                placeholder="subtotal"
                onChange={(e) =>
                  onLineItemDraftChange(idx, { subtotal: e.target.value })
                }
                className="w-20 px-2 py-1 rounded border border-theme-stroke bg-theme-surface text-theme-text text-xs text-right"
              />
              <select
                value={d.category}
                onChange={(e) =>
                  onLineItemDraftChange(idx, {
                    category: e.target.value as ReceiptLineItemCategory,
                  })
                }
                className="px-1 py-1 rounded border border-theme-stroke bg-theme-surface text-theme-text text-xs"
                title="Category — pizza-prices analytics filters on 'pizza'"
              >
                <option value="pizza">pizza</option>
                <option value="beverage">beverage</option>
                <option value="topping">topping</option>
                <option value="side">side</option>
                <option value="dessert">dessert</option>
                <option value="tax">tax</option>
                <option value="tip">tip</option>
                <option value="fee">fee</option>
                <option value="other">other</option>
              </select>
              <button
                type="button"
                onClick={() => onRemoveLineItem(idx)}
                className="p-1 rounded text-theme-text-muted hover:text-red-500 hover:bg-red-50"
                title="Remove this line"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onAddLineItem}
              className="px-2 py-1 rounded border border-theme-stroke text-theme-text text-xs inline-flex items-center gap-1 hover:bg-theme-surface"
              title="Append a new line"
            >
              <Plus size={12} />
              Add line
            </button>
            <button
              type="button"
              onClick={onUseLineSumForAmount}
              className="px-2 py-1 rounded border border-theme-stroke text-theme-text text-xs inline-flex items-center gap-1 hover:bg-theme-surface"
              title="Copy the line sum into the receipt total above"
              disabled={(lineItemDrafts ?? []).length === 0}
            >
              <Copy size={12} />
              Use line sum
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onSaveLineItems}
              disabled={lineItemsSaving}
              className="px-3 py-1.5 rounded bg-[#E52828] text-white text-xs disabled:opacity-40 inline-flex items-center gap-1.5"
              title="Save line items"
            >
              {lineItemsSaving ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                'Save line items'
              )}
            </button>
          </div>
          {lineItemsSaveError && (
            <div className="text-xs text-red-300">{lineItemsSaveError}</div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Helpers exported for parents that need to seed drafts from the canonical
 * persisted shape. Mirrors the lineItemToDraft helper in PayoutReviewModal.
 */
export function lineItemToDraft(item: ReceiptLineItem): LineItemDraft {
  return {
    name: item.name ?? '',
    qty: String(item.qty ?? 0),
    unitPrice: String(item.unitPrice ?? 0),
    subtotal: String(item.subtotal ?? 0),
    category: item.category ?? 'other',
  };
}

export function emptyLineItemDraft(): LineItemDraft {
  return { name: '', qty: '1', unitPrice: '0', subtotal: '0', category: 'other' };
}
