import React, { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Raffle } from '../../types';

interface RaffleFormProps {
  raffle?: Raffle | null;
  onSubmit: (data: { name: string; description?: string; entriesPerGuest?: number }) => void;
  onClose: () => void;
  isLoading?: boolean;
}

export function RaffleForm({ raffle, onSubmit, onClose, isLoading }: RaffleFormProps) {
  const [name, setName] = useState(raffle?.name || '');
  const [description, setDescription] = useState(raffle?.description || '');
  const [entriesPerGuest, setEntriesPerGuest] = useState(raffle?.entriesPerGuest || 1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      entriesPerGuest,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">
            {raffle ? 'Edit Raffle' : 'Create Raffle'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Raffle Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Door Prize Drawing"
              className="w-full"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description for guests..."
              className="w-full h-24 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Entries per Guest
            </label>
            <select
              value={entriesPerGuest}
              onChange={(e) => setEntriesPerGuest(parseInt(e.target.value, 10))}
              className="w-full"
            >
              <option value={1}>1 entry per guest</option>
              <option value={2}>2 entries per guest</option>
              <option value={3}>3 entries per guest</option>
              <option value={5}>5 entries per guest</option>
            </select>
            <p className="text-xs text-white/50 mt-1">
              Currently only single entry is supported
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex-1 flex items-center justify-center gap-2"
              disabled={isLoading || !name.trim()}
            >
              {isLoading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Saving...
                </>
              ) : (
                raffle ? 'Update Raffle' : 'Create Raffle'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
