import React, { useRef, useState } from 'react';
import { Loader2, X, Upload, Receipt as ReceiptIcon, AlertCircle, CheckCircle2 } from 'lucide-react';
import { uploadPayoutPhoto } from '../../lib/supabase';
import { previewReceiptOCR } from '../../lib/api';
import { OcrPreviewResult } from '../../types';

export interface ReceiptItem {
  /** Stable client-side id for React keys. */
  id: string;
  status: 'uploading' | 'ocring' | 'done' | 'error';
  url?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  ocr?: OcrPreviewResult;
  error?: string;
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
      const uploaded = await uploadPayoutPhoto(file, partyId, payoutTempId, 'receipt');
      if (!uploaded) {
        nextItems = updateItem(nextItems, itemId, { status: 'error', error: 'Upload failed' });
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
        const ocr = await previewReceiptOCR(partyId, uploaded.url);
        nextItems = updateItem(nextItems, itemId, { status: 'done', ocr });
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
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
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
          {remaining > 0 && `Up to ${remaining} more — JPEG, PNG, WebP, HEIC.`}
        </p>
      </div>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map(item => (
            <li
              key={item.id}
              className="flex items-center gap-3 p-3 rounded-xl bg-theme-surface-hover"
            >
              <div className="w-12 h-12 rounded-md overflow-hidden bg-theme-surface flex-shrink-0 flex items-center justify-center">
                {item.url ? (
                  <img src={item.url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ReceiptIcon size={20} className="text-theme-text-muted" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm text-theme-text truncate">{item.fileName}</p>
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
                  {item.status === 'done' && item.ocr && (
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-flex items-center gap-1">
                        {item.ocr.confidence >= 0.8
                          ? <CheckCircle2 size={12} className="text-emerald-400" />
                          : <AlertCircle size={12} className="text-amber-400" />}
                        ${item.ocr.amount.toFixed(2)} USD
                      </span>
                      {item.ocr.conversionNote && (
                        <span className="text-theme-text-muted">
                          (from {item.ocr.originalAmount.toLocaleString()} {item.ocr.originalCurrency})
                        </span>
                      )}
                      <span className={item.ocr.confidence >= 0.8 ? 'text-emerald-300' : 'text-amber-300'}>
                        {Math.round(item.ocr.confidence * 100)}% confidence
                      </span>
                    </span>
                  )}
                  {item.status === 'error' && (
                    <span className="inline-flex items-center gap-1 text-red-400">
                      <AlertCircle size={12} /> {item.error || 'Failed'}
                    </span>
                  )}
                </div>
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
          ))}
        </ul>
      )}
    </div>
  );
};

function updateItem(items: ReceiptItem[], id: string, patch: Partial<ReceiptItem>): ReceiptItem[] {
  return items.map(it => (it.id === id ? { ...it, ...patch } : it));
}
