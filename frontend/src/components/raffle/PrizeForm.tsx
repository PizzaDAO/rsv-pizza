import React, { useState } from 'react';
import { X, Loader2, Image } from 'lucide-react';
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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl w-full max-w-md">
        {/* Header */}
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Prize Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Pizza for a Year"
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
              placeholder="Optional prize description..."
              className="w-full h-20 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Image URL
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://example.com/prize-image.jpg"
                className="flex-1"
              />
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
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Quantity
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-24"
            />
            <p className="text-xs text-white/50 mt-1">
              Number of this prize to give away
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
                prize ? 'Update Prize' : 'Add Prize'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
