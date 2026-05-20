import React, { useState } from 'react';
import { X, UserPlus, Mail, Loader2 } from 'lucide-react';
import { IconInput } from '../IconInput';
import { addWalkInGuest } from '../../lib/api';

interface WalkInModalProps {
  partyId: string;
  onClose: () => void;
  /** Called after a successful add. Caller may refresh the guest list. */
  onAdded?: (alreadyExisted: boolean) => void;
}

/**
 * Day-of walk-in capture. Name required, email optional. Backend creates
 * the guest with `submitted_via='host-checkin'`, `status='CONFIRMED'`,
 * `approved=true`, and a timestamped `checked_in_at`/`checked_in_by`.
 */
export const WalkInModal: React.FC<WalkInModalProps> = ({ partyId, onClose, onAdded }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await addWalkInGuest(partyId, {
        name: name.trim(),
        email: email.trim() || undefined,
      });
      onAdded?.(res.alreadyExisted === true);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to add walk-in');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card p-6 w-full max-w-md space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-theme-text">Add walk-in</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-theme-text-muted hover:text-theme-text"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <IconInput
            icon={UserPlus}
            placeholder="Guest name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
          <IconInput
            icon={Mail}
            type="email"
            placeholder="Email (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="w-full bg-[#ff393a] text-white rounded-lg py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Adding…
              </>
            ) : (
              'Add and check in'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
