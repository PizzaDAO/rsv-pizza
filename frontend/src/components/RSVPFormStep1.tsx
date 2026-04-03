import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Square, CheckSquare2, User, Mail, Wallet, Info, X } from 'lucide-react';
import { TURTLES } from '../constants/options';
import { IconInput } from './IconInput';
import type { useRSVPForm } from '../hooks/useRSVPForm';

interface RSVPFormStep1Props {
  form: ReturnType<typeof useRSVPForm>;
  eventName: string;
  isEditing?: boolean;
  walletFieldSlot?: React.ReactNode; // For ConnectKit button in modal
  showWallet?: boolean; // Whether to show wallet field at all
}

export function RSVPFormStep1({
  form,
  eventName,
  isEditing,
  walletFieldSlot,
  showWallet,
}: RSVPFormStep1Props) {
  return (
    <form onSubmit={form.handleStep1Continue} className="space-y-3">
      {/* Name */}
      <IconInput
        icon={User}
        type="text"
        value={form.name}
        onChange={(e) => form.setName(e.target.value)}
        placeholder="Name"
        required
        autoFocus
        data-testid="rsvp-name"
      />

      {/* Email */}
      <IconInput
        icon={Mail}
        type="email"
        value={form.email}
        onChange={(e) => form.setEmail(e.target.value)}
        placeholder="Email"
        required
        data-testid="rsvp-email"
      />

      {/* Wallet field */}
      {showWallet && (
        walletFieldSlot ? (
          walletFieldSlot
        ) : (
          <div>
            <IconInput
              icon={Wallet}
              type="text"
              value={form.ethereumAddress}
              onChange={(e) => {
                form.setEthereumAddress(e.target.value);
                form.validateWalletAddress(e.target.value);
              }}
              placeholder="Wallet Address or ENS (e.g. vitalik.eth)"
              className={
                form.walletValidation === 'valid'
                  ? 'border-[#39d98a]/50'
                  : form.walletValidation === 'invalid'
                    ? 'border-[#ff393a]/50'
                    : ''
              }
            />
            {form.walletValidation === 'invalid' && form.ethereumAddress.trim() && (
              <span className="text-xs text-[#ff393a] mt-1 block">Enter a valid address (0x...) or ENS name (.eth)</span>
            )}
          </div>
        )
      )}

      {/* Role selection */}
      <div>
        <label className="block text-sm font-medium text-theme-text mb-2">
          What role(s) do you play?
        </label>
        <div className="grid grid-cols-2 gap-2">
          {TURTLES.map((t) => {
            const selected = form.roles.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => form.toggleRole(t.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors border-2 ${
                  selected
                    ? 'border-[#ff393a] bg-theme-surface-hover text-theme-text'
                    : 'border-transparent bg-theme-surface-hover text-theme-text-secondary hover:bg-theme-surface-hover/80'
                }`}
              >
                <img src={t.image} alt={t.label} className="w-10 h-10 object-contain flex-shrink-0" />
                <div className="min-w-0">
                  <div className="font-bold text-sm leading-tight">{t.label}</div>
                  <div className={`text-xs leading-tight ${selected ? 'text-theme-text-secondary' : 'opacity-60'}`}>{t.role}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mailing list checkbox */}
      <button
        type="button"
        onClick={() => form.setMailingListOptIn(!form.mailingListOptIn)}
        className="flex items-center gap-3 p-4 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors cursor-pointer w-full"
      >
        {form.mailingListOptIn ? (
          <CheckSquare2 size={20} className="text-[#ff393a] flex-shrink-0" />
        ) : (
          <Square size={20} className="text-theme-text-muted flex-shrink-0" />
        )}
        <span className="text-sm text-theme-text">
          Want to join the mailing list?
        </span>
      </button>

      {/* SWC checkbox + info modal */}
      {form.isSwcEvent && (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => form.setSwcOptIn(!form.swcOptIn)}
              className="flex items-center gap-3 p-4 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors cursor-pointer flex-1"
            >
              {form.swcOptIn ? (
                <CheckSquare2 size={20} className="text-purple-500 flex-shrink-0" />
              ) : (
                <Square size={20} className="text-theme-text-muted flex-shrink-0" />
              )}
              <span className="text-sm text-theme-text">
                Join Stand with Crypto
              </span>
            </button>
            <button
              type="button"
              onClick={() => form.setShowSwcInfoModal(true)}
              className="p-3 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text"
            >
              <Info size={18} />
            </button>
          </div>

          {/* SWC Info Modal */}
          {form.showSwcInfoModal && createPortal(
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => form.setShowSwcInfoModal(false)}
            >
              <div
                className="card p-6 max-w-md w-full relative"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => form.setShowSwcInfoModal(false)}
                  className="absolute top-3 right-3 text-theme-text-muted hover:text-theme-text transition-colors"
                >
                  <X size={20} />
                </button>
                <h3 className="text-lg font-bold text-theme-text mb-3">Stand with Crypto</h3>
                <p className="text-sm text-theme-text-secondary leading-relaxed">
                  By checking the box, you consent to become a member of Stand with Crypto Alliance, Inc., a grassroots movement to empower crypto consumers, builders, and supporters to make themselves heard. By checking the box and agreeing to become a member, you understand that SWC and its vendors may collect and use your personal information. To learn more, visit{' '}
                  <a
                    href="https://www.standwithcrypto.org/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    SWC Privacy
                  </a>.
                </p>
              </div>
            </div>,
            document.body
          )}
        </>
      )}

      {/* Error display */}
      {form.error && (
        <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
          {form.error}
        </div>
      )}

      {/* Next button */}
      <button
        type="submit"
        className="w-full btn-primary flex items-center justify-center gap-2"
        data-testid="rsvp-next"
      >
        Next
        <ChevronRight size={18} />
      </button>
    </form>
  );
}
