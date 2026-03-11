import React, { useState } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { X, Send } from 'lucide-react';

interface InviteGuestsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InviteGuestsModal: React.FC<InviteGuestsModalProps> = ({ isOpen, onClose }) => {
  const { party } = usePizza();
  const [step, setStep] = useState(1);
  const [emailInput, setEmailInput] = useState('');
  const [emails, setEmails] = useState<string[]>([]);
  const [customMessage, setCustomMessage] = useState('');

  if (!isOpen) return null;

  const handleAddEmail = () => {
    const newEmails = emailInput
      .split(/[\s,;]+/)
      .map(e => e.trim())
      .filter(e => e && e.includes('@'));

    if (newEmails.length > 0) {
      setEmails(prev => [...prev, ...newEmails]);
      setEmailInput('');
    }
  };

  const handleRemoveEmail = (emailToRemove: string) => {
    setEmails(prev => prev.filter(e => e !== emailToRemove));
  };

  const handleNext = () => {
    if (emails.length > 0) {
      setStep(2);
    }
  };

  const handleBack = () => {
    setStep(1);
  };

  const handleSendInvites = () => {
    // TODO: Implement send invites API call
    console.log('Sending invites to:', emails);
    console.log('Custom message:', customMessage);

    // Reset and close
    setStep(1);
    setEmails([]);
    setEmailInput('');
    setCustomMessage('');
    onClose();
  };

  const handleClose = () => {
    setStep(1);
    setEmails([]);
    setEmailInput('');
    setCustomMessage('');
    onClose();
  };

  const inviteLink = party ? `${window.location.origin}/rsvp/${party.inviteCode}` : '';
  const hostName = party?.hostName || 'PizzaDAO';
  const eventName = party?.name || 'the event';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-theme-card rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-theme-stroke">
          <h2 className="text-2xl font-bold text-theme-text">
            {step === 1 ? 'Add Emails' : 'Invite Guests'}
          </h2>
          <button
            onClick={handleClose}
            className="text-theme-text-secondary hover:text-theme-text transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 ? (
            /* Step 1: Add Emails */
            <div className="space-y-3">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddEmail();
                    }
                  }}
                  placeholder="Paste or enter emails here"
                  className="flex-1"
                />
                <button
                  onClick={handleAddEmail}
                  className="btn-secondary px-6"
                >
                  Add
                </button>
              </div>

              {/* Email List */}
              {emails.length > 0 && (
                <div className="mt-6 space-y-2">
                  <h3 className="text-sm font-medium text-theme-text-secondary mb-3">
                    Added Emails ({emails.length})
                  </h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {emails.map((email, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between bg-theme-surface border border-theme-stroke rounded-lg p-3"
                      >
                        <span className="text-theme-text text-sm">{email}</span>
                        <button
                          onClick={() => handleRemoveEmail(email)}
                          className="text-theme-text-muted hover:text-[#ff393a] transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Step 2: Send Invites */
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Left Sidebar - Email List */}
              <div className="md:col-span-1">
                <h3 className="text-sm font-medium text-theme-text-secondary mb-3">
                  Inviting {emails.length} {emails.length === 1 ? 'Person' : 'People'}
                </h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {emails.map((email, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 bg-theme-surface border border-theme-stroke rounded-lg p-3"
                    >
                      <div className="w-8 h-8 rounded-full bg-theme-surface-hover flex items-center justify-center text-theme-text-secondary text-xs font-medium">
                        {email.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-theme-text text-sm truncate">{email}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Side - Message Preview */}
              <div className="md:col-span-2 space-y-3">
                <div className="bg-theme-surface border border-theme-stroke rounded-xl p-6 space-y-3">
                  <p className="text-theme-text text-lg">
                    Hi, {hostName} invites you to join {eventName}.
                  </p>

                  <textarea
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    placeholder="Add a custom message here..."
                    className="w-full min-h-[120px] resize-none"
                  />

                  <div className="bg-theme-surface-hover border border-theme-stroke-hover rounded-lg p-4">
                    <p className="text-theme-text text-sm font-medium mb-1">RSVP:</p>
                    <p className="text-theme-text-secondary text-sm break-all font-mono">{inviteLink}</p>
                  </div>

                  <div className="flex gap-3">
                    <div className="w-10 h-10 bg-theme-surface-hover rounded flex items-center justify-center flex-shrink-0">
                      <Send size={18} className="text-theme-text-secondary" />
                    </div>
                    <div>
                      <p className="text-theme-text text-sm mb-1">
                        We will send them an invite link to register for the event.
                      </p>
                      <p className="text-theme-text-secondary text-xs">
                        Guests will be automatically approved when they complete their registration.
                      </p>
                    </div>
                  </div>

                  <p className="text-theme-text-muted text-xs">
                    You can bypass registration and payment by adding guests directly to the guest list.{' '}
                    <button
                      onClick={handleClose}
                      className="text-[#ff393a] hover:underline"
                    >
                      Add Guests Directly
                    </button>
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-6 border-t border-theme-stroke">
          {step === 2 ? (
            <>
              <button
                onClick={handleBack}
                className="btn-secondary flex items-center gap-2"
              >
                Back
              </button>
              <button
                onClick={handleSendInvites}
                className="btn-primary flex items-center gap-2"
              >
                <Send size={18} />
                Send Invites
              </button>
            </>
          ) : (
            <>
              <div></div>
              <button
                onClick={handleNext}
                disabled={emails.length === 0}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
