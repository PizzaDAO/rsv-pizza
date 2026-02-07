import React, { useState } from 'react';
import { X, Loader2, Gift, AlignLeft, Link, Hash } from 'lucide-react';
import { IconInput } from '../IconInput';
import { RafflePrize } from '../../types';

interface PrizeFormProps {
  prize?: RafflePrize | null;
  onSubmit: (data: { name: string; description?: string; imageUrl?: string; quantity?: number }) => void;
  onClose: () => void;
  isLoading?: boolean;
}

export function PrizeForm({ prize, onSubmit, onClose, isLoading }: PrizeFormProps) {
  const [name, setName] = useState(prize?.name || '');
  const [description, setDescription] = useState(prize?.description || '');
  const [imageUrl, setImageUrl] = useState(prize?.imageUrl || '');
  const [quantity, setQuantity] = useState(prize?.quantity || 1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      imageUrl: imageUrl.trim() || undefined,
      quantity,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">
            {prize ? 'Edit Prize' : 'Add Prize'}
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
            icon={Gift}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Prize name (e.g., Pizza for a Year)"
            required
            autoFocus
          />

          <IconInput
            icon={AlignLeft}
            multiline
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Prize description"
          />

          <div className="flex gap-2">
            <div className="flex-1">
              <IconInput
                icon={Link}
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="Image URL (https://...)"
              />
            </div>
            {imageUrl && (
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
                <img
                  src={imageUrl}
                  alt="Preview"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            )}
          </div>

          <IconInput
            icon={Hash}
            type="number"
            min={1}
            max={100}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
            placeholder="Quantity"
          />
          <p className="text-xs text-white/40 -mt-2 pl-1">Number of this prize to give away</p>

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
                prize ? 'Update Prize' : 'Add Prize'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
