import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, ChevronDown, Square, CheckSquare2, User, Mail, Wallet, Info, X } from 'lucide-react';
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
  const [turtleDropdownOpen, setTurtleDropdownOpen] = useState(false);
  const turtleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (turtleRef.current && !turtleRef.current.contains(event.target as Node)) {
        setTurtleDropdownOpen(false);
      }
    }
    if (turtleDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [turtleDropdownOpen]);

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

      {/* Role selection - compact dropdown */}
      <div className="relative" ref={turtleRef}>
        <button
          type="button"
          onClick={() => setTurtleDropdownOpen(prev => !prev)}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-theme-stroke bg-theme-surface-hover hover:bg-theme-surface-hover/80 transition-colors"
        >
          <div className="flex items-center gap-1 flex-1">
            {TURTLES.map((t) => (
              <img
                key={t.id}
                src={t.image}
                alt={t.label}
                className={`w-5 h-5 object-contain transition-opacity ${
                  form.roles.includes(t.id) ? 'opacity-100' : 'opacity-30'
                }`}
              />
            ))}
            {form.roles.length === 0 && (
              <span className="text-sm text-theme-text-muted ml-1">Select your turtle(s)...</span>
            )}
          </div>
          <ChevronDown size={16} className={`text-theme-text-muted transition-transform ${turtleDropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {turtleDropdownOpen && (
          <div className="absolute z-20 left-0 right-0 mt-1 card shadow-lg overflow-hidden !p-0">
            {TURTLES.map((t) => {
              const selected = form.roles.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => form.toggleRole(t.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                    selected
                      ? 'bg-[#ff393a]/10 text-theme-text'
                      : 'text-theme-text-secondary hover:bg-theme-surface-hover'
                  }`}
                >
                  <img src={t.image} alt={t.label} className="w-8 h-8 object-contain flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm leading-tight">{t.label}</div>
                    <div className="text-xs text-theme-text-muted leading-tight">{t.role}</div>
                  </div>
                  {selected && (
                    <CheckSquare2 size={16} className="text-[#ff393a] flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Consolidated mailing list + partner opt-in */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const newVal = !form.mailingListOptIn;
            form.setMailingListOptIn(newVal);
            // Also set the relevant SWC opt-in for this event's region
            if (form.isSwcEvent) form.setSwcOptIn(newVal);
            if (form.isSwcCaEvent) form.setSwcCaOptIn(newVal);
            if (form.isSwcAuEvent) form.setSwcAuOptIn(newVal);
            if (form.isSwcEuEvent) form.setSwcEuOptIn(newVal);
            if (form.isSwcUkEvent) form.setSwcUkOptIn(newVal);
          }}
          className="flex items-center gap-3 p-4 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors cursor-pointer flex-1"
        >
          {form.mailingListOptIn ? (
            <CheckSquare2 size={20} className="text-[#ff393a] flex-shrink-0" />
          ) : (
            <Square size={20} className="text-theme-text-muted flex-shrink-0" />
          )}
          <span className="text-sm text-theme-text">
            Hear from PizzaDAO + our partners
          </span>
        </button>
        {(form.isSwcEvent || form.isSwcCaEvent || form.isSwcAuEvent || form.isSwcEuEvent || form.isSwcUkEvent) && (
          <button
            type="button"
            onClick={() => form.setShowSwcInfoModal(true)}
            className="p-3 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text"
          >
            <Info size={18} />
          </button>
        )}
      </div>

      {/* Partner info modal (SWC) */}
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
            <h3 className="text-lg font-bold text-theme-text mb-3">Our Partners</h3>
            <p className="text-sm text-theme-text-secondary leading-relaxed">
              By opting in, you consent to receive communications from PizzaDAO and our partners, including Stand with Crypto Alliance, Inc. — a grassroots movement empowering crypto consumers, builders, and supporters. SWC and its vendors may collect and use your personal information. To learn more, visit{' '}
              <a
                href="https://www.standwithcrypto.org/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 underline"
              >
                SWC Privacy Policy
              </a> and{' '}
              <a
                href="https://www.standwithcrypto.org/terms-of-service"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 underline"
              >
                Terms &amp; Conditions
              </a>.
            </p>
          </div>
        </div>,
        document.body
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
