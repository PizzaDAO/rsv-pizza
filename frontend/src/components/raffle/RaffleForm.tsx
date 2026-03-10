import React, { useState } from 'react';
import { X, Loader2, Type, AlignLeft, Users } from 'lucide-react';
import { IconInput } from '../IconInput';
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-theme-stroke">
          <h2 className="text-lg font-semibold text-theme-text">
            {raffle ? 'Edit Raffle' : 'Create Raffle'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-theme-surface-hover rounded-lg transition-colors text-theme-text-secondary hover:text-theme-text"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <IconInput
            icon={Type}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Raffle name"
            required
            autoFocus
          />

          <IconInput
            icon={AlignLeft}
            multiline
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description for guests"
          />

          <div>
            <select
              value={entriesPerGuest}
              onChange={(e) => setEntriesPerGuest(parseInt(e.target.value, 10))}
              className="w-full bg-theme-surface border border-theme-stroke rounded-xl px-4 py-3 text-theme-text text-sm focus:outline-none focus:border-[#ff393a]/50"
            >
              <option value={1} className="bg-theme-header text-theme-text">1 entry per guest</option>
              <option value={2} className="bg-theme-header text-theme-text">2 entries per guest</option>
              <option value={3} className="bg-theme-header text-theme-text">3 entries per guest</option>
              <option value={5} className="bg-theme-header text-theme-text">5 entries per guest</option>
            </select>
          </div>

          <div className="flex gap-3 pt-1">
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
