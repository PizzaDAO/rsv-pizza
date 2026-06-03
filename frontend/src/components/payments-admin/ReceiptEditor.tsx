import React from 'react';
import { Loader2, Plus, Trash2, Copy, DollarSign, AlertTriangle, RefreshCw, Receipt } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { CurrencyPicker } from './CurrencyPicker';
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

/**
 * caprino-92104: per-receipt draft. The editor now exposes the receipt's
 * original-currency amount + the currency picker (the inputs admins type
 * into) plus a derived USD value that's recomputed server-side via FX on
 * save. The deprecated single-`amount` field (USD-only) has been replaced
 * by `originalAmount`; `manualUsdAmount` is an optional opt-in for the
 * "FX rate unavailable — set USD manually" fallback path.
 *
 * The field name `originalAmount` here matches the server-side column
 * name (`payout_documents.original_amount`).
 */
export type ReceiptDraft = {
  /** Receipt's local-currency value (what's printed on the paper). */
  originalAmount: string;
  /** ISO 4217 code, uppercase. */
  currency: string;
  /**
   * Optional manual USD value. Only set when the admin has opted into the
   * "Set USD manually" fallback after an FX_RATE_UNAVAILABLE error — the
   * default save path leaves this undefined and lets the backend derive USD
   * from `originalAmount` + `currency`.
   */
  manualUsdAmount?: string;
};
export type LineItemDraft = {
  name: string;
  qty: string;
  unitPrice: string;
  subtotal: string;
  category: ReceiptLineItemCategory;
  // provola-92106: per-line "ineligible for reimbursement" flag. When true
  // the row strikes through + tints amber + is excluded from the live line
  // sum + the "Use line sum" button output. Optional so admins who never
  // touched the flag don't carry `false` through every line.
  ineligible?: boolean;
};

interface ReceiptEditorProps {
  doc: PayoutDocument;
  /** Amount/currency draft for this receipt. */
  draft: ReceiptDraft;
  onDraftChange: (next: ReceiptDraft) => void;
  saving: boolean;
  saveError?: string;
  /**
   * caprino-92104: backend error code surfaced from a failed save (e.g.
   * `FX_RATE_UNAVAILABLE`). Drives the "Set USD manually" fallback toggle.
   */
  saveErrorCode?: string;
  onSave: () => void;

  /** Mark-duplicate state. */
  isDuplicate: boolean;
  dupSaving: boolean;
  dupError?: string;
  onToggleDuplicate: () => void;

  /**
   * provola-92106: Mark-ineligible state. Mirrors the duplicate toggle —
   * reversible, optimistic-friendly, errors surfaced inline. Distinct from
   * duplicate (legitimate purchase but doesn't qualify for reimbursement
   * — alcohol, tips, personal items). Both flags can be true on the same
   * row; the UI prefers duplicate as the primary visual signal when both
   * are set.
   */
  isIneligible: boolean;
  ineligibleSaving: boolean;
  ineligibleError?: string;
  onToggleIneligible: () => void;

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
    // provola-92106: skip lines the admin marked ineligible (alcohol, tips,
    // personal items). The live sum + "Use line sum" button both rely on
    // this helper so the receipt total reflects only reimbursable items.
    if (d.ineligible === true) continue;
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
  saveErrorCode,
  onSave,
  isDuplicate,
  dupSaving,
  dupError,
  onToggleDuplicate,
  isIneligible,
  ineligibleSaving,
  ineligibleError,
  onToggleIneligible,
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

  // caprino-92104: legacy-row hint. When the receipt has no persisted
  // `originalAmount` column (pre-mortadella row that's never been edited via
  // the new editor), we surface a small note telling the admin the seeded
  // value comes from `ocrAmount` — they should sanity-check before saving in
  // case the OCR'd value was actually USD-converted.
  const isLegacyRow = doc.originalAmount == null;
  // Hide the rate line when the receipt is already USD (rate=1 is noise).
  const rateAvailable =
    doc.exchangeRate != null
    && doc.exchangeRate !== 1
    && doc.originalCurrency
    && doc.originalCurrency !== 'USD'
    && doc.ocrAmount != null;
  const fxRateUnavailable = saveErrorCode === 'FX_RATE_UNAVAILABLE';
  const manualUsdMode = draft.manualUsdAmount !== undefined;

  return (
    /* coppa-92105: when this receipt is admin-marked as a duplicate, paint
        the entire editor pane with a red left border + faint red background
        + DUPLICATE banner across the top so the admin can't miss that the
        edits they're making are on an excluded row. The dim is intentionally
        lighter than the thumbnail/right-row treatment (opacity-95 + tint)
        because the editor is interactive — admins still need to read the
        inputs to un-mark.

        provola-92106: same treatment for the ineligible flag but in amber
        (visually distinct from duplicate's red). When BOTH flags are set,
        the duplicate styling wins as the primary signal — admins can still
        un-toggle the ineligible flag from the checkbox below.
    */
    <div
      className={`relative p-4 space-y-4 text-theme-text ${
        isDuplicate
          ? 'border-l-4 border-red-500/60 bg-red-500/5'
          : isIneligible
            ? 'border-l-4 border-amber-500/60 bg-amber-500/5'
            : ''
      }`}
    >
      {/* provola-92106: 135° amber diagonal stripes overlay when the
          receipt is admin-marked ineligible. Distinct from duplicate's
          45° red stripes (the by-city + modal thumbnails use 45° / red);
          the angle difference is intentional so admins can tell the two
          flags apart at a glance even in dense grids. Pointer-events-none
          + low opacity so admins can still interact with the inputs below.
          Only renders when ineligible AND NOT duplicate so the two
          patterns don't fight each other when both flags are on. */}
      {isIneligible && !isDuplicate && (
        <span
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              'repeating-linear-gradient(135deg, rgba(245,158,11,0.08) 0 6px, transparent 6px 14px)',
          }}
          aria-hidden="true"
        />
      )}
      {/* coppa-92105: DUPLICATE banner across the top of the editor when
          marked. Heavier than the per-row pill so it can't be missed even on
          a quick scan. */}
      {isDuplicate && (
        <div className="-mx-4 -mt-4 mb-2 px-4 py-2 bg-red-500/15 border-b border-red-500/40 text-red-300 text-xs font-bold uppercase tracking-wide flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
          Duplicate — excluded from all USD totals
        </div>
      )}
      {/* provola-92106: INELIGIBLE banner — amber, distinct from duplicate's
          red. Only shown when the receipt is NOT also marked duplicate
          (duplicate wins as the primary signal so the banner area doesn't
          get crowded; the admin can still see + un-toggle the ineligible
          checkbox below). */}
      {isIneligible && !isDuplicate && (
        <div className="-mx-4 -mt-4 mb-2 px-4 py-2 bg-amber-500/15 border-b border-amber-500/40 text-amber-300 text-xs font-bold uppercase tracking-wide flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
          Ineligible — legitimate purchase, does not qualify for reimbursement
        </div>
      )}
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

      {/* caprino-92104: Amount + currency split into two visible rows.
          Top row = "Original amount" (the local-currency value the admin
          types) + the searchable currency picker. Bottom row = derived USD
          value, read-only display unless the admin opts into "Set USD
          manually" after an FX_RATE_UNAVAILABLE error.

          Save sends both `originalAmount` + `ocrCurrency` together; backend
          re-runs convertToUSD and persists the recomputed ocr_amount +
          exchange_rate. */}
      <div className="space-y-3">
        {/* Original amount row */}
        <div className="space-y-1">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-2 items-start">
            <IconInput
              icon={Receipt}
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="Original amount (as printed)"
              value={draft.originalAmount}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onDraftChange({ ...draft, originalAmount: e.target.value })
              }
            />
            <CurrencyPicker
              value={draft.currency}
              onChange={(code) => onDraftChange({ ...draft, currency: code })}
              disabled={saving}
            />
          </div>
          <p className="text-xs text-white/40">
            The receipt's local-currency total. USD is derived via FX on save.
          </p>
          {isLegacyRow && !manualUsdMode && (
            <p className="text-xs text-amber-400">
              Legacy receipt — original amount inferred from stored value. Verify before saving.
            </p>
          )}
        </div>

        {/* USD value (derived, read-only) — or manual-USD mode after FX failure */}
        {!manualUsdMode ? (
          <div className="space-y-1">
            <div className="px-3 py-2 rounded-lg border border-theme-stroke bg-theme-bg text-theme-text text-sm flex items-baseline gap-2">
              <DollarSign size={14} className="text-theme-text-muted self-center" />
              <span className="font-medium">
                {doc.ocrAmount == null ? '—' : doc.ocrAmount.toFixed(2)}
              </span>
              {rateAvailable && (
                <span className="text-xs text-theme-text-muted">
                  at rate 1 {doc.originalCurrency} = ${(doc.exchangeRate ?? 0).toFixed(4)}
                </span>
              )}
              <span className="ml-auto text-xs text-white/40">USD (auto)</span>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-amber-400">
              Set USD manually — FX rate unavailable for {draft.currency || 'this currency'}.
            </p>
            <IconInput
              icon={DollarSign}
              type="number"
              step="0.01"
              min="0"
              placeholder="USD value"
              value={draft.manualUsdAmount ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onDraftChange({ ...draft, manualUsdAmount: e.target.value })
              }
            />
            <button
              type="button"
              onClick={() => {
                const { manualUsdAmount: _, ...rest } = draft;
                onDraftChange(rest);
              }}
              className="text-xs text-theme-text-muted underline hover:text-theme-text"
            >
              Cancel manual USD — try FX again
            </button>
          </div>
        )}

        {saveError && (
          <div className="text-xs text-red-300 flex items-start gap-1.5">
            <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
            <span>{saveError}</span>
          </div>
        )}
        {fxRateUnavailable && !manualUsdMode && (
          <button
            type="button"
            onClick={() =>
              onDraftChange({
                ...draft,
                manualUsdAmount: doc.ocrAmount == null ? '' : String(doc.ocrAmount),
              })
            }
            className="text-xs text-amber-400 underline hover:text-amber-300"
          >
            Set USD manually instead
          </button>
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

      {/* provola-92106: Mark-ineligible row. Distinct from the duplicate
          checkbox above — duplicates are bookkeeping deduplication;
          ineligibles are legitimate purchases that don't qualify under the
          reimbursement policy (alcohol, tips, personal items). Same
          exclusion math, different visual + semantic. Helper text spells
          out the difference inline so admins picking between the two flags
          don't have to guess. */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox
            checked={isIneligible}
            onChange={onToggleIneligible}
            label={
              isIneligible
                ? 'Marked as ineligible for reimbursement'
                : 'Mark as ineligible for reimbursement'
            }
            disabled={ineligibleSaving}
          />
          {ineligibleSaving && (
            <Loader2 size={12} className="animate-spin text-theme-text-muted" />
          )}
        </div>
        <p className="text-xs text-white/40 mt-1">
          Not a duplicate — this receipt is legitimate but doesn't qualify
          (e.g. alcohol, tips, personal items). Excluded from all USD totals.
        </p>
        {ineligibleError && (
          <div className="text-xs text-amber-300 flex items-start gap-1.5 mt-1">
            <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
            <span>{ineligibleError}</span>
          </div>
        )}
      </div>

      {/* OCR error notice — only the amber message when the doc errored. The
          re-run trigger itself lives next to the Line items header below
          (crescenza-92110) so there's a single always-available button. */}
      {hasOcrError && onRetryOcr && (
        <div className="rounded-lg border border-theme-stroke p-3 bg-theme-bg">
          <div className="text-xs text-amber-500 flex items-start gap-1.5">
            <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
            <span>{doc.ocrError || 'OCR failed for this receipt.'}</span>
          </div>
        </div>
      )}

      {/* Line items */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">
            Line items ({lineItemDrafts?.length ?? 0})
          </h4>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              {/* crescenza-92110: always-available full re-read (amount +
                  currency + line items). Triggers analyzeReceipt fresh even on
                  a successfully-OCR'd receipt that came back with 0 line
                  items. */}
              {onRetryOcr && (
                <button
                  type="button"
                  onClick={onRetryOcr}
                  disabled={retrying}
                  className="px-2.5 py-1 rounded border border-theme-stroke text-theme-text text-xs disabled:opacity-40 inline-flex items-center gap-1.5 flex-shrink-0"
                >
                  {retrying ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <RefreshCw size={12} />
                  )}
                  Re-run OCR
                </button>
              )}
              <span className="text-xs text-theme-text-muted">
                Sum: {sumCurrency} {lineSum.toFixed(2)}
                {/* provola-92106: when ineligible lines exist, note how many
                    were excluded from the live sum so admins see the math is
                    doing what they expect. */}
                {(() => {
                  const ineligibleCount = (lineItemDrafts ?? []).filter(
                    (li) => li.ineligible === true,
                  ).length;
                  return ineligibleCount > 0 ? (
                    <span className="ml-1 text-amber-400">
                      ({ineligibleCount} ineligible excluded)
                    </span>
                  ) : null;
                })()}
              </span>
            </div>
            {onRetryOcr && retryError && (
              <div className="text-xs text-red-300 text-right max-w-[240px]">
                {retryError}
              </div>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-theme-stroke bg-theme-bg p-2 space-y-1.5 max-h-80 overflow-y-auto">
          {/* Column headers. Widths mirror the input row below so each label
              sits over its column. Hidden on mobile where rows wrap (flex-wrap
              / sm:flex-nowrap) and the alignment would break. Only shown when
              there are rows to label. */}
          {(lineItemDrafts ?? []).length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-theme-text-faint sticky top-0 bg-theme-bg">
              <span className="flex-1 min-w-[120px]">Item</span>
              <span className="w-14 text-right pr-2">Qty</span>
              <span className="w-20 text-right pr-2">Unit</span>
              <span className="w-20 text-right pr-2">Subtotal</span>
              <span className="w-24">Category</span>
              <span className="w-[72px]">Eligible</span>
              <span className="w-[20px]" aria-hidden="true" />
            </div>
          )}
          {(lineItemDrafts ?? []).length === 0 && (
            <p className="text-xs text-theme-text-faint p-2">
              No line items yet. Click <span className="font-semibold">Add line</span> to start.
            </p>
          )}
          {(lineItemDrafts ?? []).map((d, idx) => {
            // provola-92106: when admin unchecks the Eligible box for this
            // line, strike through the row + tint amber so it's visually
            // distinct from active lines. Reuses the same amber palette the
            // receipt-level ineligible flag uses for consistency. The live
            // sum + "Use line sum" both already exclude ineligible lines via
            // `draftSubtotalSum`.
            const lineIneligible = d.ineligible === true;
            return (
              <div
                key={idx}
                className={`flex flex-wrap items-center gap-1.5 sm:flex-nowrap rounded ${
                  lineIneligible
                    ? 'bg-amber-500/10 line-through text-theme-text-muted'
                    : ''
                }`}
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
                  className="w-24 shrink-0 px-1 py-1 rounded border border-theme-stroke bg-theme-surface text-theme-text text-xs"
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
                {/* provola-92106: per-line Eligible checkbox. Inverted
                    semantics from the persisted `ineligible` flag — admin
                    sees "Eligible (checked = included)" instead of "mark
                    ineligible". Checked by default for existing items so the
                    UI matches the historical behavior (everything counts
                    until admin says otherwise). Tooltip clarifies what
                    unchecking does. */}
                <label
                  className="inline-flex items-center gap-1 text-[10px] text-theme-text-muted px-1 w-[72px] shrink-0"
                  title="Uncheck to exclude this line from reimbursement (alcohol, tip, personal item, etc.)"
                >
                  <input
                    type="checkbox"
                    checked={!lineIneligible}
                    onChange={(e) =>
                      onLineItemDraftChange(idx, {
                        ineligible: !e.target.checked,
                      })
                    }
                    className="rounded border-theme-stroke-hover"
                    aria-label="Eligible for reimbursement"
                  />
                  Eligible
                </label>
                <button
                  type="button"
                  onClick={() => onRemoveLineItem(idx)}
                  className="p-1 rounded text-theme-text-muted hover:text-red-500 hover:bg-red-50"
                  title="Remove this line"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
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
    // provola-92106: carry through the per-line ineligible flag (jsonb
    // additive field — older items + items the admin never touched just
    // omit it, which maps to "eligible").
    ineligible: item.ineligible === true ? true : undefined,
  };
}

export function emptyLineItemDraft(): LineItemDraft {
  return { name: '', qty: '1', unitPrice: '0', subtotal: '0', category: 'other' };
}
