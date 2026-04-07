import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, Upload, FileText, DollarSign, User, Link, StickyNote } from 'lucide-react';
import { BudgetItem, BudgetCategory, BudgetStatus, BUDGET_CATEGORIES } from '../../types';
import { IconInput } from '../IconInput';
import { uploadReceipt } from '../../lib/supabase';

interface BudgetItemFormProps {
  item?: BudgetItem | null;
  partyId: string;
  onSave: (data: {
    name: string;
    category: BudgetCategory;
    cost: number;
    status?: BudgetStatus;
    pointPerson?: string;
    notes?: string;
    receiptUrl?: string;
  }) => Promise<void>;
  onClose: () => void;
  saving?: boolean;
}

export const BudgetItemForm: React.FC<BudgetItemFormProps> = ({
  item,
  partyId,
  onSave,
  onClose,
  saving = false,
}) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<BudgetCategory>('other');
  const [cost, setCost] = useState('');
  const [status, setStatus] = useState<BudgetStatus>('pending');
  const [pointPerson, setPointPerson] = useState('');
  const [notes, setNotes] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (item) {
      setName(item.name);
      setCategory(item.category);
      setCost(item.cost.toString());
      setStatus(item.status);
      setPointPerson(item.pointPerson || '');
      setNotes(item.notes || '');
      setReceiptUrl(item.receiptUrl || '');
      if (item.receiptUrl) {
        setReceiptPreview(item.receiptUrl);
      }
    }
  }, [item]);

  const isImageUrl = (url: string) => {
    return /\.(jpe?g|png|webp)(\?.*)?$/i.test(url);
  };

  const handleReceiptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      setError('Please select an image (JPEG, PNG, WebP) or PDF file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('File must be less than 10MB');
      return;
    }

    setReceiptFile(file);
    setError(null);

    if (file.type.startsWith('image/')) {
      const objectUrl = URL.createObjectURL(file);
      setReceiptPreview(objectUrl);
    } else {
      setReceiptPreview('pdf');
    }
  };

  const removeReceipt = () => {
    if (receiptPreview && receiptPreview.startsWith('blob:')) {
      URL.revokeObjectURL(receiptPreview);
    }
    setReceiptFile(null);
    setReceiptPreview(null);
    setReceiptUrl('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    const costValue = parseFloat(cost);
    if (isNaN(costValue) || costValue < 0) {
      setError('Please enter a valid cost');
      return;
    }

    try {
      let finalReceiptUrl = receiptUrl.trim() || undefined;

      // Upload receipt file if one was selected
      if (receiptFile) {
        setUploadingReceipt(true);
        const uploadedUrl = await uploadReceipt(receiptFile, partyId);
        if (uploadedUrl) {
          finalReceiptUrl = uploadedUrl;
        } else {
          setError('Failed to upload receipt. Please try again.');
          setUploadingReceipt(false);
          return;
        }
        setUploadingReceipt(false);
      }

      await onSave({
        name: name.trim(),
        category,
        cost: costValue,
        status,
        pointPerson: pointPerson.trim() || undefined,
        notes: notes.trim() || undefined,
        receiptUrl: finalReceiptUrl,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center pt-20 p-4 z-50" onClick={onClose}>
      <div className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-theme-text">
            {item ? 'Edit Expense' : 'Add Expense'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <IconInput
            icon={FileText}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Description (e.g., Pizza from Joe's)"
            required
            autoFocus
          />

          {/* Category and Cost */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as BudgetCategory)}
                className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              >
                {BUDGET_CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id} className="bg-theme-header">
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
            <IconInput
              icon={DollarSign}
              type="number"
              step="0.01"
              min="0"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="Cost"
              required
            />
          </div>

          {/* Status */}
          <div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStatus('pending')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  status === 'pending'
                    ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                    : 'bg-theme-surface text-theme-text-secondary border border-theme-stroke hover:bg-theme-surface-hover'
                }`}
              >
                Pending
              </button>
              <button
                type="button"
                onClick={() => setStatus('paid')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  status === 'paid'
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'bg-theme-surface text-theme-text-secondary border border-theme-stroke hover:bg-theme-surface-hover'
                }`}
              >
                Paid
              </button>
            </div>
          </div>

          {/* Point Person */}
          <IconInput
            icon={User}
            type="text"
            value={pointPerson}
            onChange={(e) => setPointPerson(e.target.value)}
            placeholder="Point person (who's handling this?)"
          />

          {/* Notes */}
          <IconInput
            icon={StickyNote}
            multiline
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional details..."
          />

          {/* Receipt Upload */}
          <div className="space-y-2">
            <p className="text-xs text-theme-text-muted">Receipt</p>
            {receiptPreview ? (
              <div className="flex items-center gap-3 p-3 bg-theme-surface rounded-lg border border-theme-stroke">
                {receiptPreview === 'pdf' ? (
                  <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20">
                    <FileText size={24} className="text-red-400" />
                  </div>
                ) : (
                  <img
                    src={receiptPreview}
                    alt="Receipt preview"
                    className="w-12 h-12 object-cover rounded-lg border border-theme-stroke"
                  />
                )}
                <div className="flex-1 min-w-0">
                  {receiptFile ? (
                    <p className="text-sm text-theme-text truncate">{receiptFile.name}</p>
                  ) : receiptUrl ? (
                    <a
                      href={receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-400 hover:text-blue-300 truncate block"
                    >
                      View receipt
                    </a>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={removeReceipt}
                  className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="flex gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={handleReceiptChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 bg-theme-surface border border-theme-stroke rounded-lg text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover transition-colors text-sm"
                >
                  <Upload size={16} />
                  Upload
                </button>
                <div className="flex-1">
                  <IconInput
                    icon={Link}
                    type="url"
                    value={receiptUrl}
                    onChange={(e) => {
                      setReceiptUrl(e.target.value);
                      if (e.target.value.trim()) {
                        if (isImageUrl(e.target.value.trim())) {
                          setReceiptPreview(e.target.value.trim());
                        }
                      }
                    }}
                    placeholder="Or paste URL"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || uploadingReceipt}
              className="flex-1 bg-theme-surface-hover hover:bg-theme-surface-hover disabled:opacity-50 text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || uploadingReceipt}
              className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {saving || uploadingReceipt ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {uploadingReceipt ? 'Uploading...' : 'Saving...'}
                </>
              ) : item ? (
                'Save Changes'
              ) : (
                'Add Expense'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
