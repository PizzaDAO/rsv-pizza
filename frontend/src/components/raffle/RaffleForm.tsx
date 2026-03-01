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
      <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
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
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[#ff393a]/50"
            >
              <option value={1} className="bg-[#1a1a2e] text-white">1 entry per guest</option>
              <option value={2} className="bg-[#1a1a2e] text-white">2 entries per guest</option>
              <option value={3} className="bg-[#1a1a2e] text-white">3 entries per guest</option>
              <option value={5} className="bg-[#1a1a2e] text-white">5 entries per guest</option>
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
