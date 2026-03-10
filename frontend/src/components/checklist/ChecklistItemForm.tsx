import React, { useState } from 'react';
import { X, Loader2, ListChecks, Calendar } from 'lucide-react';
import { IconInput } from '../IconInput';

interface ChecklistItemFormProps {
  onSave: (data: { name: string; dueDate?: string | null }) => Promise<void>;
  onClose: () => void;
  saving?: boolean;
}

export const ChecklistItemForm: React.FC<ChecklistItemFormProps> = ({
  onSave,
  onClose,
  saving = false,
}) => {
  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Task name is required');
      return;
    }

    await onSave({
      name: name.trim(),
      dueDate: dueDate || null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center pt-20 p-4 z-50" onClick={onClose}>
      <div className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-theme-text">Add Task</h2>
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
            icon={ListChecks}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Task name"
            required
            autoFocus
          />

          {/* Due date */}
          <div>
            <div className="relative">
              <Calendar
                size={20}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none"
              />
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-theme-surface border border-theme-stroke rounded-xl pl-10 pr-3 py-3 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] [color-scheme:dark]"
              />
            </div>
            <p className="text-xs text-theme-text-muted mt-1">Optional due date</p>
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
              className="flex-1 bg-theme-surface-hover hover:bg-theme-surface-hover disabled:opacity-50 text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm"
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
                  Adding...
                </>
              ) : (
                'Add Task'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
