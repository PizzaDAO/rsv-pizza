import React, { useEffect, useState } from 'react';
import { X, RotateCcw, Loader2, Ban } from 'lucide-react';
import { Guest, Party } from '../types';
import { ClickableEmail } from './ClickableEmail';

interface RejectedGuestsModalProps {
  isOpen: boolean;
  onClose: () => void;
  rejectedGuests: Guest[];
  onRestore: (id: string) => Promise<void>;
  // `party` is accepted for parity with sibling modals and to allow future
  // approval-vs-confirm wording differentiation. The Restore button label
  // stays "Restore" either way.
  party?: Party | null;
}

export function RejectedGuestsModal({ isOpen, onClose, rejectedGuests, onRestore }: RejectedGuestsModalProps) {
  const [restoringId, setRestoringId] = useState<string | null>(null);

  // Auto-close when the rejected list is exhausted while the modal is open.
  useEffect(() => {
    if (isOpen && rejectedGuests.length === 0) {
      onClose();
    }
  }, [isOpen, rejectedGuests.length, onClose]);

  if (!isOpen) return null;

  const handleRestore = async (id: string) => {
    if (restoringId) return;
    setRestoringId(id);
    try {
      await onRestore(id);
    } catch (err) {
      console.error('Failed to restore guest:', err);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-theme-header rounded-2xl border border-theme-stroke w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-theme-stroke">
          <div className="flex items-center gap-2">
            <Ban size={18} className="text-red-400" />
            <h2 className="text-lg font-bold text-theme-text">Rejected Guests</h2>
            <span className="text-xs text-theme-text-muted">({rejectedGuests.length})</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {rejectedGuests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Ban size={36} className="text-theme-text-faint mb-3" />
              <p className="text-theme-text-muted text-sm">No rejected guests.</p>
            </div>
          ) : (
            <div className="divide-y divide-theme-stroke">
              {rejectedGuests.map((guest) => {
                const isRestoring = restoringId === guest.id;
                return (
                  <div
                    key={guest.id}
                    className="flex items-center gap-3 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-theme-text text-sm truncate">{guest.name}</div>
                      {guest.email && (
                        <ClickableEmail
                          email={guest.email}
                          className="text-theme-text-muted text-xs truncate"
                        />
                      )}
                    </div>
                    <button
                      onClick={() => guest.id && handleRestore(guest.id)}
                      disabled={isRestoring || !guest.id}
                      className="flex items-center gap-1.5 text-[#39d98a] hover:bg-[#39d98a]/10 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium flex-shrink-0 disabled:opacity-50"
                      title="Restore guest"
                    >
                      {isRestoring ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <RotateCcw size={14} />
                      )}
                      <span>Restore</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
