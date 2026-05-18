import React from 'react';
import { X, MailQuestion } from 'lucide-react';
import { Guest } from '../types';
import { ClickableEmail } from './ClickableEmail';

interface InvitedGuestsModalProps {
  isOpen: boolean;
  onClose: () => void;
  invitedGuests: Guest[];
}

export function InvitedGuestsModal({ isOpen, onClose, invitedGuests }: InvitedGuestsModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-theme-header rounded-2xl border border-theme-stroke w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-theme-stroke">
          <div className="flex items-center gap-2">
            <MailQuestion size={18} className="text-amber-400" />
            <h2 className="text-lg font-bold text-theme-text">Invited Guests</h2>
            <span className="text-xs text-theme-text-muted">({invitedGuests.length})</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {invitedGuests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MailQuestion size={36} className="text-theme-text-faint mb-3" />
              <p className="text-theme-text-muted text-sm">No invited guests yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-theme-stroke">
              {invitedGuests.map((guest) => (
                <div key={guest.id} className="flex items-center gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-theme-text text-sm truncate">{guest.name}</div>
                    {guest.email && (
                      <ClickableEmail
                        email={guest.email}
                        className="text-theme-text-muted text-xs truncate"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
