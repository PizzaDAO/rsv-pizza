import React, { useRef, useState } from 'react';
import { Loader2, X, Upload, Receipt as ReceiptIcon, AlertCircle, CheckCircle2, FileText, DollarSign, GitMerge, Layers } from 'lucide-react';
import { uploadPayoutPhoto } from '../../lib/supabase';
import { previewReceiptOCR } from '../../lib/api';
import { OcrPreviewResult, OcrReceiptPreview } from '../../types';
import { CurrencyOverrideSelect } from './CurrencyOverrideSelect';
import { IconInput } from '../IconInput';
import { isPdfFile, derivePdfThumbnailUrl } from '../../lib/pdfUtils';

export interface ReceiptItem {
  /** Stable client-side id for React keys. */
  id: string;
  status: 'uploading' | 'ocring' | 'done' | 'error';
  url?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  // stracciatella-92114: a single uploaded photo can contain MULTIPLE receipts.
  // We keep ONE ReceiptItem per file, but hold an array of detected receipts.
  // The single-receipt case (length <= 1) renders exactly as before.
  receipts?: OcrReceiptPreview[];
  error?: string;
}

/**
 * stracciatella-92114: normalize an ocr-preview response into an
 * `OcrReceiptPreview[]`. New backends return `receipts`; old/cached backends
 * only return the legacy top-level single-receipt fields — wrap those as a
 * one-element array so the UI is uniform.
 */
function toReceiptArray(ocr: OcrPreviewResult): OcrReceiptPreview[] {
  if (Array.isArray(ocr.receipts)) {
    // scamorza-58296: a transient OCR/FX failure comes back as receipts:[] with
    // a top-level ocrError='OCR_FAILED'. Surface it as a single synthetic
    // receipt carrying that flag so the host gets the manual USD-amount entry
    // instead of the "no receipt found — remove or re-upload" dead-end (which
    // is reserved for a genuinely empty NO_RECEIPT_DETECTED response).
    if (ocr.receipts.length === 0 && ocr.ocrError === 'OCR_FAILED') {
      return [
        {
          index: 0,
          amount: 0,
          currency: 'USD',
          originalAmount: 0,
          originalCurrency: '',
          exchangeRate: 0,
          confidence: 0,
          items: undefined,
          lineItems: null,
          ocrRaw: null,
          merchant: null,
          boundingHint: null,
          fxSource: 'unresolved',
          conversionNote: undefined,
          ocrError: 'OCR_FAILED',
        },
      ];
    }
    // NO_RECEIPT_DETECTED comes back as an empty array; preserve it.
    return ocr.receipts;
  }
  return [
    {
      index: 0,
      amount: ocr.amount,
      currency: 'USD',
      originalAmount: ocr.originalAmount,
      originalCurrency: ocr.originalCurrency,
      exchangeRate: ocr.exchangeRate,
      confidence: ocr.confidence,
      items: ocr.items,
      lineItems: ocr.lineItems,
      ocrRaw: ocr.ocrRaw,
      merchant: null,
      boundingHint: null,
      fxSource: ocr.fxSource,
      conversionNote: ocr.conversionNote,
      ocrError: ocr.ocrError,
    },
  ];
}

interface ReceiptUploadProps {
  partyId: string;
  payoutTempId: string;
  items: ReceiptItem[];
  onChange: (items: ReceiptItem[]) => void;
  maxItems?: number;
}

/**
 * Multi-image dropzone for receipts. As each receipt finishes uploading,
 * it fires `previewReceiptOCR` and shows the extracted amount + currency
 * + confidence indicator. Max 10.
 */
export const ReceiptUpload: React.FC<ReceiptUploadProps> = ({
  partyId,
  payoutTempId,
  items,
  onChange,
  maxItems = 10,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const remaining = maxItems - items.length;

  const handleFiles = async (files: FileList | File[]) => {
    const fileArr = Array.from(files).slice(0, remaining);
    if (fileArr.length === 0) return;

    // Add placeholder rows immediately for optimistic UI
    const newItems: ReceiptItem[] = fileArr.map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      status: 'uploading' as const,
      fileName: f.name,
      fileSize: f.size,
      mimeType: f.type,
    }));
    let nextItems = [...items, ...newItems];
    onChange(nextItems);

    // Upload each file in parallel, then run OCR.
    await Promise.all(fileArr.map(async (file, i) => {
      const itemId = newItems[i].id;
      let uploaded: Awaited<ReturnType<typeof uploadPayoutPhoto>>;
      try {
        uploaded = await uploadPayoutPhoto(file, partyId, payoutTempId, 'receipt');
      } catch (err) {
        nextItems = updateItem(nextItems, itemId, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Upload failed',
        });
        onChange(nextItems);
        return;
      }
      nextItems = updateItem(nextItems, itemId, {
        status: 'ocring',
        url: uploaded.url,
        fileName: uploaded.fileName,
        fileSize: uploaded.fileSize,
        mimeType: uploaded.mimeType,
      });
      onChange(nextItems);

      try {
        // bocconcino-92104: PDFs can't be OCR'd directly by gpt-4o vision
        // (image-only). Hand the OCR pipeline the convention-derived
        // `.thumb.png` rendered at upload time instead. The backend uses the
        // same derivation in its ocr-preview / POST /payouts handlers.
        const ocrUrl = uploaded.mimeType === 'application/pdf'
          ? derivePdfThumbnailUrl(uploaded.url)
          : uploaded.url;
        const ocr = await previewReceiptOCR(partyId, ocrUrl);
        nextItems = updateItem(nextItems, itemId, {
          status: 'done',
          receipts: toReceiptArray(ocr),
        });
        onChange(nextItems);
      } catch (err: any) {
        nextItems = updateItem(nextItems, itemId, {
          status: 'error',
          error: err?.message || 'OCR failed',
        });
        onChange(nextItems);
      }
    }));
  };

  const handleRemove = (id: string) => {
    onChange(items.filter(i => i.id !== id));
  };

  return (
    <div className="space-y-3">
      <div
        onClick={() => remaining > 0 && inputRef.current?.click()}
        onDragOver={e => {
          e.preventDefault();
          if (remaining > 0) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          if (remaining > 0 && e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
          }
        }}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
          remaining === 0
            ? 'border-theme-stroke bg-theme-surface opacity-50 cursor-not-allowed'
            : dragging
            ? 'border-[#ff393a] bg-[#ff393a]/5'
            : 'border-theme-stroke hover:border-[#ff393a]/40 bg-theme-surface'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
          multiple
          className="hidden"
          onChange={e => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <Upload className="mx-auto mb-2 text-theme-text-muted" size={28} />
        <p className="text-sm text-theme-text">
          {remaining === 0
            ? `Maximum ${maxItems} receipts uploaded`
            : 'Drop receipts here, or click to choose files'}
        </p>
        <p className="text-xs text-theme-text-muted mt-1">
          {remaining > 0 && `Up to ${remaining} more — JPEG, PNG, WebP, HEIC, PDF.`}
        </p>
      </div>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map(item => {
            const receiptCount = item.receipts?.length ?? 0;
            const isMulti = receiptCount > 1;
            // stracciatella-92114: 0 detected receipts (NO_RECEIPT_DETECTED) —
            // surface the same kind of inline warning as an OCR error so the
            // host removes or re-uploads. We never silently keep a $0 receipt.
            const noReceiptDetected =
              item.status === 'done' && item.receipts != null && receiptCount === 0;
            const head = item.receipts?.[0];

            return (
              <li
                key={item.id}
                className="flex items-start gap-3 p-3 rounded-xl bg-theme-surface-hover"
              >
                <ReceiptThumb item={item} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm text-theme-text truncate">{item.fileName}</p>
                    {isMulti && (
                      <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-[#ff393a]/10 text-[#ff393a]">
                        <Layers size={11} /> {receiptCount} receipts detected in this photo
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-theme-text-muted mt-0.5">
                    {item.status === 'uploading' && (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin" /> Uploading…
                      </span>
                    )}
                    {item.status === 'ocring' && (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin" /> Reading receipt…
                      </span>
                    )}
                    {noReceiptDetected && (
                      <span className="inline-flex items-center gap-1 text-amber-400">
                        <AlertCircle size={12} /> No receipt found — remove or re-upload
                      </span>
                    )}

                    {/* scamorza-58296: automatic read failed (transient OCR
                        error) — arrives as a 200 with ocrError='OCR_FAILED'
                        (surfaced by toReceiptArray as a single synthetic
                        receipt). Drop the host into a manual USD-amount entry
                        instead of dead-ending. */}
                    {item.status === 'done' && !isMulti && head && head.ocrError === 'OCR_FAILED' && (
                      <ManualAmountEntry
                        amount={head.amount}
                        onAmount={amount => {
                          const valid = Number.isFinite(amount) && amount > 0;
                          onChange(items.map(it => {
                            if (it.id !== item.id || !it.receipts) return it;
                            const receipts = it.receipts.map((r, j) => j === 0 ? {
                              ...r,
                              amount,
                              originalAmount: amount,
                              originalCurrency: 'USD',
                              exchangeRate: 1,
                              confidence: 1,
                              fxSource: 'usd-passthrough' as OcrReceiptPreview['fxSource'],
                              // clear the failure flag once a valid amount is
                              // entered so submit treats this as a normal USD
                              // receipt rather than excluding it.
                              ocrError: valid ? null : 'OCR_FAILED',
                            } : r);
                            return { ...it, receipts };
                          }));
                        }}
                      />
                    )}

                    {/* Single-receipt case: identical to the pre-stracciatella UI. */}
                    {item.status === 'done' && !isMulti && head && head.ocrError !== 'OCR_FAILED' && (
                      <ReceiptDetailRow
                        partyId={partyId}
                        receipt={head}
                        onConverted={result => {
                          onChange(updateReceipt(items, item.id, 0, result));
                        }}
                      />
                    )}

                    {item.status === 'error' && (
                      <span className="inline-flex items-center gap-1 text-red-400">
                        <AlertCircle size={12} /> {item.error || 'Failed'}
                      </span>
                    )}
                  </div>

                  {/* Multi-receipt case: nested per-receipt list. */}
                  {item.status === 'done' && isMulti && item.receipts && (
                    <ul className="mt-2 space-y-2">
                      {item.receipts.map((r, k) => (
                        <li
                          key={k}
                          className="rounded-lg border border-theme-stroke bg-theme-surface px-2.5 py-2"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs font-medium text-theme-text">
                              Receipt {k + 1} of {receiptCount}
                              {r.boundingHint ? ` — ${r.boundingHint}` : ''}
                              {r.merchant ? ` · ${r.merchant}` : ''}
                            </span>
                            <div className="flex items-center gap-1">
                              {/* Secondary: merge this receipt into the previous one. */}
                              {k > 0 && (
                                <button
                                  type="button"
                                  onClick={() => onChange(mergeReceiptIntoPrevious(items, item.id, k))}
                                  className="inline-flex items-center gap-1 p-1 rounded text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover transition-colors"
                                  aria-label={`Merge receipt ${k + 1} into receipt ${k}`}
                                  title="Merge into previous receipt"
                                >
                                  <GitMerge size={13} />
                                </button>
                              )}
                              {/* Primary: remove this detected receipt. */}
                              <button
                                type="button"
                                onClick={() => onChange(removeReceipt(items, item.id, k))}
                                className="p-1 rounded text-theme-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                aria-label={`Remove receipt ${k + 1}`}
                                title="Remove this receipt"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                          <ReceiptDetailRow
                            partyId={partyId}
                            receipt={r}
                            onConverted={result => {
                              onChange(updateReceipt(items, item.id, k, result));
                            }}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => handleRemove(item.id)}
                  className="p-1.5 rounded-md text-theme-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  aria-label="Remove receipt"
                >
                  <X size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

function updateItem(items: ReceiptItem[], id: string, patch: Partial<ReceiptItem>): ReceiptItem[] {
  return items.map(it => (it.id === id ? { ...it, ...patch } : it));
}

/**
 * scamorza-58296: manual USD-amount entry shown when the automatic OCR read
 * failed (transient error). The host types the receipt total themselves and we
 * persist it through the normal submit-forwarding path as a USD-passthrough
 * amount. Local text state so partial input ("12.") doesn't fight the parsed
 * number on every keystroke.
 */
const ManualAmountEntry: React.FC<{
  amount: number;
  onAmount: (amount: number) => void;
}> = ({ amount, onAmount }) => {
  const [raw, setRaw] = useState(amount > 0 ? String(amount) : '');

  return (
    <span className="block w-full">
      <div className="max-w-[12rem]">
        <IconInput
          icon={DollarSign}
          type="text"
          inputMode="decimal"
          value={raw}
          placeholder="Enter amount in USD"
          onChange={e => {
            const v = e.target.value;
            // Allow only a number with an optional single decimal point.
            if (v !== '' && !/^\d*\.?\d*$/.test(v)) return;
            setRaw(v);
            onAmount(parseFloat(v));
          }}
          className="py-1.5 text-sm"
        />
      </div>
      <span className="block mt-1 text-xs text-theme-text-muted">
        Couldn't read this receipt automatically — enter the amount in USD.
      </span>
    </span>
  );
};

/**
 * stracciatella-92114: apply a convert-fx result to receipt `k` of item `id`.
 */
function updateReceipt(
  items: ReceiptItem[],
  id: string,
  k: number,
  result: { usdAmount: number; originalAmount: number; originalCurrency: string; exchangeRate: number; conversionNote?: string; source: string },
): ReceiptItem[] {
  return items.map(it => {
    if (it.id !== id || !it.receipts) return it;
    const receipts = it.receipts.map((r, j) =>
      j === k
        ? {
            ...r,
            amount: result.usdAmount,
            originalAmount: result.originalAmount,
            originalCurrency: result.originalCurrency,
            exchangeRate: result.exchangeRate,
            conversionNote: result.conversionNote,
            fxSource: (result.source as OcrReceiptPreview['fxSource']) || r.fxSource,
            // A successful override resolves a previously-unresolved currency.
            ocrError: result.usdAmount > 0 ? null : r.ocrError,
          }
        : r,
    );
    return { ...it, receipts };
  });
}

/**
 * stracciatella-92114: remove detected receipt `k` from item `id`. If it was
 * the last detected receipt the whole item is dropped (the photo no longer
 * contributes any receipt). Indexes are re-derived at submit time, so we don't
 * renumber here.
 */
function removeReceipt(items: ReceiptItem[], id: string, k: number): ReceiptItem[] {
  return items.flatMap(it => {
    if (it.id !== id || !it.receipts) return [it];
    const receipts = it.receipts.filter((_, j) => j !== k);
    if (receipts.length === 0) return [];
    return [{ ...it, receipts }];
  });
}

/**
 * stracciatella-92114: merge detected receipt `k` into receipt `k-1` (over-split
 * correction). Sums the USD + original amounts and concatenates line items; the
 * previous receipt's currency/rate wins. Drops receipt `k`.
 */
function mergeReceiptIntoPrevious(items: ReceiptItem[], id: string, k: number): ReceiptItem[] {
  return items.map(it => {
    if (it.id !== id || !it.receipts || k <= 0 || k >= it.receipts.length) return it;
    const prev = it.receipts[k - 1];
    const cur = it.receipts[k];
    const merged: OcrReceiptPreview = {
      ...prev,
      amount: (prev.amount ?? 0) + (cur.amount ?? 0),
      // Only sum original amounts when both share a currency; otherwise keep
      // prev's original amount (USD sum above is still correct for the total).
      originalAmount:
        prev.originalCurrency && prev.originalCurrency === cur.originalCurrency
          ? (prev.originalAmount ?? 0) + (cur.originalAmount ?? 0)
          : prev.originalAmount,
      lineItems: [...(prev.lineItems ?? []), ...(cur.lineItems ?? [])],
      confidence: Math.min(prev.confidence ?? 0, cur.confidence ?? 0),
      // If either side was unresolved, the merged total should be reviewed.
      ocrError: prev.ocrError || cur.ocrError || null,
    };
    const receipts = it.receipts
      .map((r, j) => (j === k - 1 ? merged : r))
      .filter((_, j) => j !== k);
    return { ...it, receipts };
  });
}

/**
 * stracciatella-92114: the per-receipt details strip — amount/USD/confidence +
 * the currency override dropdown. Used identically for the single-receipt case
 * (rendered inline) and each row of the multi-receipt nested list.
 */
const ReceiptDetailRow: React.FC<{
  partyId: string;
  receipt: OcrReceiptPreview;
  onConverted: (result: { usdAmount: number; originalAmount: number; originalCurrency: string; exchangeRate: number; conversionNote?: string; source: string }) => void;
}> = ({ partyId, receipt, onConverted }) => {
  const unresolved = receipt.ocrError === 'CURRENCY_UNRESOLVED';
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center gap-1">
        {receipt.confidence >= 0.8
          ? <CheckCircle2 size={12} className="text-emerald-400" />
          : <AlertCircle size={12} className="text-amber-400" />}
        ${receipt.amount.toFixed(2)} USD
      </span>
      <span className="text-theme-text-muted">
        (from {receipt.originalAmount.toLocaleString()})
      </span>
      {/* focaccia-89172: native currency override dropdown. OCR misreads `₹`
          as `$` etc.; host picks the correct ISO code and we re-convert. */}
      <CurrencyOverrideSelect
        partyId={partyId}
        originalAmount={receipt.originalAmount}
        currentCurrency={receipt.originalCurrency}
        onConverted={onConverted}
      />
      <span className={receipt.confidence >= 0.8 ? 'text-emerald-300' : 'text-amber-300'}>
        {Math.round(receipt.confidence * 100)}% confidence
      </span>
      {unresolved && (
        <span className="text-amber-300">— pick a currency to convert</span>
      )}
    </span>
  );
};

/**
 * bocconcino-92104: small thumbnail component for an in-progress upload. PDFs
 * try the convention-derived `.thumb.png`; if that 404s (thumbnail upload
 * failed at upload time, or the bucket allowlist hasn't been extended yet),
 * we fall back to a generic PDF icon. Local error state so the icon only
 * appears after the <img> definitively fails.
 */
const ReceiptThumb: React.FC<{ item: ReceiptItem }> = ({ item }) => {
  const [thumbFailed, setThumbFailed] = useState(false);
  const isPdf = isPdfFile(item);

  return (
    <div className="relative w-12 h-12 rounded-md overflow-hidden bg-theme-surface flex-shrink-0 flex items-center justify-center">
      {!item.url ? (
        <ReceiptIcon size={20} className="text-theme-text-muted" />
      ) : isPdf ? (
        thumbFailed ? (
          <FileText size={20} className="text-theme-text-muted" aria-label="PDF receipt" />
        ) : (
          <img
            src={derivePdfThumbnailUrl(item.url)}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setThumbFailed(true)}
          />
        )
      ) : (
        <img src={item.url} alt="" className="w-full h-full object-cover" />
      )}
    </div>
  );
};
