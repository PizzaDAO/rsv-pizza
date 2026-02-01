import React, { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { BudgetItem, BudgetCategory, BudgetStatus, BUDGET_CATEGORIES } from '../../types';

interface BudgetItemFormProps {
  item?: BudgetItem | null;
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

  useEffect(() => {
    if (item) {
      setName(item.name);
      setCategory(item.category);
      setCost(item.cost.toString());
      setStatus(item.status);
      setPointPerson(item.pointPerson || '');
      setNotes(item.notes || '');
      setReceiptUrl(item.receiptUrl || '');
    }
  }, [item]);

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

    await onSave({
      name: name.trim(),
      category,
      cost: costValue,
      status,
      pointPerson: pointPerson.trim() || undefined,
      notes: notes.trim() || undefined,
      receiptUrl: receiptUrl.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center pt-20 p-4 z-50" onClick={onClose}>
      <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            {item ? 'Edit Expense' : 'Add Expense'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">
              Description *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Pizza from Joe's"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              autoFocus
            />
          </div>

          {/* Category and Cost */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as BudgetCategory)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              >
                {BUDGET_CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id} className="bg-[#1a1a2e]">
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-white/80 mb-1">
                Cost *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
              </div>
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">
              Status
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStatus('pending')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  status === 'pending'
                    ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                    : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
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
                    : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
                }`}
              >
                Paid
              </button>
            </div>
          </div>

          {/* Point Person */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">
              Point Person
            </label>
            <input
              type="text"
              value={pointPerson}
              onChange={(e) => setPointPerson(e.target.value)}
              placeholder="Who's handling this?"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional details..."
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] resize-none"
            />
          </div>

          {/* Receipt URL */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">
              Receipt URL
            </label>
            <input
              type="url"
              value={receiptUrl}
              onChange={(e) => setReceiptUrl(e.target.value)}
              placeholder="https://..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            />
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
              disabled={saving}
              className="flex-1 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
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
