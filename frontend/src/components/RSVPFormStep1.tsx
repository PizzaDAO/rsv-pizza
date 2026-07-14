import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, ChevronDown, Square, CheckSquare2, User, Mail, Wallet, Info, X } from 'lucide-react';
import { IconInput } from './IconInput';
import { useTranslation } from 'react-i18next';
import { TURTLES } from '../constants/options';
import type { useRSVPForm } from '../hooks/useRSVPForm';
// lasagna-49278: DB-driven opt-in checkbox renderer + config fetch hook.
import { RsvpCheckboxList } from './RsvpCheckboxList';
import { useRsvpCheckboxConfig } from '../hooks/useRsvpCheckboxConfig';

interface RSVPFormStep1Props {
  form: ReturnType<typeof useRSVPForm>;
  eventName: string;
  isEditing?: boolean;
  walletFieldSlot?: React.ReactNode; // For ConnectKit button in modal
  showWallet?: boolean; // Whether to show wallet field at all
  showTurtleRoles?: boolean; // Whether to show turtle role selection
}

export function RSVPFormStep1({
  form,
  walletFieldSlot,
  showWallet,
  showTurtleRoles,
}: RSVPFormStep1Props) {
  const { t, i18n } = useTranslation('rsvp');
  const { t: tCommon } = useTranslation('common');
  const [turtleDropdownOpen, setTurtleDropdownOpen] = useState(false);
  const turtleRef = useRef<HTMLDivElement>(null);
  // lasagna-49278: DB-driven config for the opt-in checkboxes. Replaces the
  // 9 hardcoded blocks below the turtle dropdown. While `loading`, no
  // checkboxes render (intentionally conservative — see plan §"Loading state").
  const { config: rsvpCheckboxConfig } = useRsvpCheckboxConfig(form.eventId);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (turtleRef.current && !turtleRef.current.contains(e.target as Node)) {
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
        placeholder={t('step1.namePlaceholder')}
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
        placeholder={t('step1.emailPlaceholder')}
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
              placeholder={t('step1.walletPlaceholder')}
              className={
                form.walletValidation === 'valid'
                  ? 'border-[#39d98a]/50'
                  : form.walletValidation === 'invalid'
                    ? 'border-[#ff393a]/50'
                    : ''
              }
            />
            {form.walletValidation === 'invalid' && form.ethereumAddress.trim() && (
              <span className="text-xs text-[#ff393a] mt-1 block">{tCommon('errors.invalidWallet')}</span>
            )}
          </div>
        )
      )}

      {/* Turtle role selection (host-configurable) */}
      {showTurtleRoles && (
        <div className="relative" ref={turtleRef}>
          <button
            type="button"
            onClick={() => setTurtleDropdownOpen(prev => !prev)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-theme-stroke bg-theme-surface-hover hover:bg-theme-surface-hover/80 transition-colors"
          >
            <div className="flex items-center gap-1 flex-1">
              {TURTLES.map((turtle) => (
                <img
                  key={turtle.id}
                  src={turtle.image}
                  alt={turtle.label}
                  className={`w-5 h-5 object-contain transition-opacity ${
                    form.roles.includes(turtle.id) ? 'opacity-100' : 'opacity-30'
                  }`}
                />
              ))}
              {form.roles.length === 0 && (
                <span className="text-sm text-theme-text-muted ml-1">{t('step1.selectTurtles')}</span>
              )}
            </div>
            <ChevronDown size={16} className={`text-theme-text-muted transition-transform ${turtleDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {turtleDropdownOpen && (
            <div className="absolute z-20 left-0 right-0 mt-1 card shadow-lg overflow-hidden !p-0">
              {TURTLES.map((turtle) => {
                const selected = form.roles.includes(turtle.id);
                return (
                  <button
                    key={turtle.id}
                    type="button"
                    onClick={() => form.toggleRole(turtle.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      selected
                        ? 'bg-[#ff393a]/10 text-theme-text'
                        : 'text-theme-text-secondary hover:bg-theme-surface-hover'
                    }`}
                  >
                    <img src={turtle.image} alt={turtle.label} className="w-8 h-8 object-contain flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm leading-tight">{turtle.label}</div>
                      <div className="text-xs text-theme-text-muted leading-tight">{t(`roles.${turtle.role}`)}</div>
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
      )}

      {/*
        lasagna-49278: opt-in checkbox section. Two paths:

          1. PRESERVATION BRANCH — re-submits by existing guests previously
             bucketed into optin_ab_variant='control' still see the old
             two-checkbox layout (mailing list + matching regional SWC).
             This branch shrinks over time as 'control' churns out.

          2. CONFIG-DRIVEN — everyone else (new RSVPs, variant re-submits,
             non-SWC events) gets the DB-driven RsvpCheckboxList renderer.
      */}
      {form.activeRegionConfig && form.optinAbVariant === 'control' ? (
        <>
          {/* PizzaDAO Newsletter opt-in (preservation) */}
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
              {t('step1.mailingList')}
            </span>
          </button>

          {/* Matching regional SWC checkbox + info modal (preservation) */}
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
                  <span className="text-sm text-theme-text">{t('step1.swcJoin')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => form.setShowSwcInfoModal(true)}
                  className="p-3 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text"
                >
                  <Info size={18} />
                </button>
              </div>
              {form.showSwcInfoModal && createPortal(
                <div
                  className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                  onClick={() => form.setShowSwcInfoModal(false)}
                >
                  <div className="card p-6 max-w-md w-full relative" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => form.setShowSwcInfoModal(false)}
                      className="absolute top-3 right-3 text-theme-text-muted hover:text-theme-text transition-colors"
                    >
                      <X size={20} />
                    </button>
                    <h3 className="text-lg font-bold text-theme-text mb-3">{t('swcModal.title')}</h3>
                    <p className="text-sm text-theme-text-secondary leading-relaxed">
                      {t('swcModal.description')}{' '}
                      <a href="https://www.standwithcrypto.org/privacy" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 underline">
                        {t('swcModal.privacyPolicy')}
                      </a> and{' '}
                      <a href="https://www.standwithcrypto.org/terms-of-service" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 underline">
                        {t('swcModal.termsConditions')}
                      </a>.
                    </p>
                  </div>
                </div>,
                document.body
              )}
            </>
          )}
        </>
      ) : (
        <RsvpCheckboxList
          config={rsvpCheckboxConfig}
          form={form}
          eventTags={form.eventTags}
          currentLocale={i18n.language}
        />
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
        {t('step1.next')}
        <ChevronRight size={18} />
      </button>
    </form>
  );
}
