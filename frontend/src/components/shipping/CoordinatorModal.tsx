import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, User, Mail } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { GPP_REGIONS } from '../../types';
import type { ShippingCoordinator } from '../../types';

interface CoordinatorModalProps {
  coordinator?: ShippingCoordinator | null;
  onClose: () => void;
  onSave: (data: { name: string; email: string; regions: string[]; notes?: string }) => Promise<void>;
}

export function CoordinatorModal({ coordinator, onClose, onSave }: CoordinatorModalProps) {
  const [name, setName] = useState(coordinator?.name || '');
  const [email, setEmail] = useState(coordinator?.email || '');
  const [regions, setRegions] = useState<string[]>(coordinator?.regions || []);
  const [notes, setNotes] = useState(coordinator?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!coordinator;

  const toggleRegion = (regionId: string) => {
    setRegions((prev) =>
      prev.includes(regionId)
        ? prev.filter((r) => r !== regionId)
        : [...prev, regionId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regions.length === 0) {
      setError('Please select at least one region.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({ name, email, regions, notes: notes || undefined });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save coordinator');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-theme-card border border-theme-stroke rounded-2xl p-6 w-full max-w-md mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-theme-text">
            {isEdit ? 'Edit Coordinator' : 'Add Shipping Coordinator'}
          </h3>
          <button onClick={onClose} className="text-theme-text-faint hover:text-theme-text-secondary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <IconInput
            icon={User}
            placeholder="Name"
            value={name}
            onChange={(e) => setName((e.target as HTMLInputElement).value)}
            required
          />

          <IconInput
            icon={Mail}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
            required
          />

          <div>
            <p className="text-sm text-theme-text-secondary mb-2">Regions</p>
            <div className="grid grid-cols-2 gap-2">
              {GPP_REGIONS.map((r) => (
                <Checkbox
                  key={r.id}
                  checked={regions.includes(r.id)}
                  onChange={() => toggleRegion(r.id)}
                  label={r.label}
                  size={16}
                />
              ))}
            </div>
          </div>

          <IconInput
            icon={X}
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes((e.target as HTMLInputElement).value)}
            multiline
            rows={2}
          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={saving || regions.length === 0}
            className="w-full bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            {saving ? 'Saving...' : isEdit ? 'Update Coordinator' : 'Create Coordinator'}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}
