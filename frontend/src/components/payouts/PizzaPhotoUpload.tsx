import React, { useRef, useState } from 'react';
import { Loader2, X, Upload, AlertCircle } from 'lucide-react';
import { uploadPayoutPhoto } from '../../lib/supabase';

export interface PizzaPhotoItem {
  id: string;
  status: 'uploading' | 'done' | 'error';
  url?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  error?: string;
}

interface PizzaPhotoUploadProps {
  partyId: string;
  payoutTempId: string;
  items: PizzaPhotoItem[];
  onChange: (items: PizzaPhotoItem[]) => void;
  maxItems?: number;
}

/**
 * Multi-image dropzone for pizza/event photos (no OCR). Max 10 by default.
 */
export const PizzaPhotoUpload: React.FC<PizzaPhotoUploadProps> = ({
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

    const newItems: PizzaPhotoItem[] = fileArr.map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      status: 'uploading',
      fileName: f.name,
      fileSize: f.size,
      mimeType: f.type,
    }));
    let nextItems = [...items, ...newItems];
    onChange(nextItems);

    await Promise.all(fileArr.map(async (file, i) => {
      const itemId = newItems[i].id;
      const uploaded = await uploadPayoutPhoto(file, partyId, payoutTempId, 'pizza');
      if (!uploaded) {
        nextItems = nextItems.map(it => it.id === itemId
          ? { ...it, status: 'error' as const, error: 'Upload failed' } : it);
      } else {
        nextItems = nextItems.map(it => it.id === itemId
          ? { ...it, status: 'done' as const, url: uploaded.url,
              fileName: uploaded.fileName, fileSize: uploaded.fileSize, mimeType: uploaded.mimeType }
          : it);
      }
      onChange(nextItems);
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
            ? `Maximum ${maxItems} photos uploaded`
            : 'Drop pizza / event photos here, or click to choose files'}
        </p>
        <p className="text-xs text-theme-text-muted mt-1">
          {remaining > 0 && `Up to ${remaining} more.`}
        </p>
      </div>

      {items.length > 0 && (
        <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {items.map(item => (
            <li
              key={item.id}
              className="relative aspect-square rounded-lg overflow-hidden bg-theme-surface group"
            >
              {item.url ? (
                <img src={item.url} alt="" className="w-full h-full object-cover" />
              ) : item.status === 'error' ? (
                <div className="w-full h-full flex items-center justify-center text-red-400">
                  <AlertCircle size={20} />
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-theme-text-muted">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              )}
              {item.status === 'uploading' && item.url == null && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <Loader2 size={18} className="animate-spin text-white" />
                </div>
              )}
              <button
                type="button"
                onClick={() => handleRemove(item.id)}
                className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

