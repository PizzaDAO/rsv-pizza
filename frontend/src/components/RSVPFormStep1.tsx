import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Square, CheckSquare2, User, Mail, Wallet, Info, X } from 'lucide-react';
import { TURTLES } from '../constants/options';
import { IconInput } from './IconInput';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('rsvp');
  const { t: tCommon } = useTranslation('common');

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

      {/* Role selection */}
      <div>
        <label className="block text-sm font-medium text-theme-text mb-2">
          {t('step1.roleQuestion')}
        </label>
        <div className="grid grid-cols-2 gap-2">
          {TURTLES.map((turtle) => {
            const selected = form.roles.includes(turtle.id);
            return (
              <button
                key={turtle.id}
                type="button"
                onClick={() => form.toggleRole(turtle.id)}
                className={`flex items-center gap-1.5 sm:gap-3 px-1.5 sm:px-3 py-2.5 rounded-xl text-left transition-colors border-2 ${
                  selected
                    ? 'border-[#ff393a] bg-theme-surface-hover text-theme-text'
                    : 'border-theme-stroke bg-theme-surface-hover text-theme-text-secondary hover:bg-theme-surface-hover/80'
                }`}
              >
                <img src={turtle.image} alt={turtle.label} className="w-6 h-6 sm:w-10 sm:h-10 object-contain flex-shrink-0" />
                <div className="min-w-0">
                  <div className="font-bold text-sm leading-tight">{turtle.label}</div>
                  <div className={`text-xs leading-tight ${selected ? 'text-theme-text-secondary' : 'opacity-60'}`}>{t(`roles.${turtle.role}`)}</div>
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
          {t('step1.mailingList')}
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
                {t('step1.swcJoin')}
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
                <h3 className="text-lg font-bold text-theme-text mb-3">{t('swcModal.title')}</h3>
                <p className="text-sm text-theme-text-secondary leading-relaxed">
                  {t('swcModal.description')}{' '}
                  <a
                    href="https://www.standwithcrypto.org/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    {t('swcModal.privacyPolicy')}
                  </a> and{' '}
                  <a
                    href="https://www.standwithcrypto.org/terms-of-service"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    {t('swcModal.termsConditions')}
                  </a>.
                </p>
              </div>
            </div>,
            document.body
          )}
        </>
      )}

      {/* SWC Canada checkbox + info modal */}
      {form.isSwcCaEvent && (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => form.setSwcCaOptIn(!form.swcCaOptIn)}
              className="flex items-center gap-3 p-4 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors cursor-pointer flex-1"
            >
              {form.swcCaOptIn ? (
                <CheckSquare2 size={20} className="text-purple-500 flex-shrink-0" />
              ) : (
                <Square size={20} className="text-theme-text-muted flex-shrink-0" />
              )}
              <span className="text-sm text-theme-text">
                {t('step1.swcNotify')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => form.setShowSwcCaInfoModal(true)}
              className="p-3 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text"
            >
              <Info size={18} />
            </button>
          </div>

          {/* SWC Canada Info Modal */}
          {form.showSwcCaInfoModal && createPortal(
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => form.setShowSwcCaInfoModal(false)}
            >
              <div
                className="card p-6 max-w-md w-full relative"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => form.setShowSwcCaInfoModal(false)}
                  className="absolute top-3 right-3 text-theme-text-muted hover:text-theme-text transition-colors"
                >
                  <X size={20} />
                </button>
                <h3 className="text-lg font-bold text-theme-text mb-3">{t('swcCaModal.title')}</h3>
                <p className="text-sm text-theme-text-secondary leading-relaxed">
                  {t('swcCaModal.description')}{' '}
                  <a
                    href="https://www.standwithcrypto.org/ca/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    {t('swcCaModal.privacyPolicy')}
                  </a> and{' '}
                  <a
                    href="https://www.standwithcrypto.org/ca/terms-of-service"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    {t('swcCaModal.termsOfService')}
                  </a>.
                </p>
              </div>
            </div>,
            document.body
          )}
        </>
      )}

      {/* SWC Australia checkbox + info modal */}
      {form.isSwcAuEvent && (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => form.setSwcAuOptIn(!form.swcAuOptIn)}
              className="flex items-center gap-3 p-4 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors cursor-pointer flex-1"
            >
              {form.swcAuOptIn ? (
                <CheckSquare2 size={20} className="text-purple-500 flex-shrink-0" />
              ) : (
                <Square size={20} className="text-theme-text-muted flex-shrink-0" />
              )}
              <span className="text-sm text-theme-text">
                {t('step1.swcNotify')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => form.setShowSwcAuInfoModal(true)}
              className="p-3 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text"
            >
              <Info size={18} />
            </button>
          </div>

          {/* SWC Australia Info Modal */}
          {form.showSwcAuInfoModal && createPortal(
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => form.setShowSwcAuInfoModal(false)}
            >
              <div
                className="card p-6 max-w-md w-full relative"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => form.setShowSwcAuInfoModal(false)}
                  className="absolute top-3 right-3 text-theme-text-muted hover:text-theme-text transition-colors"
                >
                  <X size={20} />
                </button>
                <h3 className="text-lg font-bold text-theme-text mb-3">{t('swcAuModal.title')}</h3>
                <p className="text-sm text-theme-text-secondary leading-relaxed">
                  {t('swcAuModal.description')}{' '}
                  <a
                    href="https://www.standwithcrypto.org/au/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    {t('swcAuModal.privacyPolicy')}
                  </a> and{' '}
                  <a
                    href="https://www.standwithcrypto.org/au/terms-of-service"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    {t('swcAuModal.termsOfService')}
                  </a>.
                </p>
              </div>
            </div>,
            document.body
          )}
        </>
      )}

      {/* SWC EU checkbox + info modal */}
      {form.isSwcEuEvent && (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => form.setSwcEuOptIn(!form.swcEuOptIn)}
              className="flex items-center gap-3 p-4 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors cursor-pointer flex-1"
            >
              {form.swcEuOptIn ? (
                <CheckSquare2 size={20} className="text-purple-500 flex-shrink-0" />
              ) : (
                <Square size={20} className="text-theme-text-muted flex-shrink-0" />
              )}
              <span className="text-sm text-theme-text">
                {t('step1.swcNotify')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => form.setShowSwcEuInfoModal(true)}
              className="p-3 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text"
            >
              <Info size={18} />
            </button>
          </div>

          {/* SWC EU Info Modal */}
          {form.showSwcEuInfoModal && createPortal(
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => form.setShowSwcEuInfoModal(false)}
            >
              <div
                className="card p-6 max-w-md w-full relative"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => form.setShowSwcEuInfoModal(false)}
                  className="absolute top-3 right-3 text-theme-text-muted hover:text-theme-text transition-colors"
                >
                  <X size={20} />
                </button>
                <h3 className="text-lg font-bold text-theme-text mb-3">{t('swcEuModal.title')}</h3>
                <p className="text-sm text-theme-text-secondary leading-relaxed">
                  {t('swcEuModal.description')}{' '}
                  <a
                    href="https://www.standwithcrypto.org/eu/en/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    {t('swcEuModal.privacyPolicy')}
                  </a> and{' '}
                  <a
                    href="https://www.standwithcrypto.org/eu/en/terms-of-service"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    {t('swcEuModal.termsOfService')}
                  </a>.
                </p>
              </div>
            </div>,
            document.body
          )}
        </>
      )}

      {/* SWC UK checkbox + info modal */}
      {form.isSwcUkEvent && (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => form.setSwcUkOptIn(!form.swcUkOptIn)}
              className="flex items-center gap-3 p-4 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors cursor-pointer flex-1"
            >
              {form.swcUkOptIn ? (
                <CheckSquare2 size={20} className="text-purple-500 flex-shrink-0" />
              ) : (
                <Square size={20} className="text-theme-text-muted flex-shrink-0" />
              )}
              <span className="text-sm text-theme-text">
                {t('step1.swcNotify')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => form.setShowSwcUkInfoModal(true)}
              className="p-3 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors text-theme-text-muted hover:text-theme-text"
            >
              <Info size={18} />
            </button>
          </div>

          {/* SWC UK Info Modal */}
          {form.showSwcUkInfoModal && createPortal(
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => form.setShowSwcUkInfoModal(false)}
            >
              <div
                className="card p-6 max-w-md w-full relative"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => form.setShowSwcUkInfoModal(false)}
                  className="absolute top-3 right-3 text-theme-text-muted hover:text-theme-text transition-colors"
                >
                  <X size={20} />
                </button>
                <h3 className="text-lg font-bold text-theme-text mb-3">{t('swcUkModal.title')}</h3>
                <p className="text-sm text-theme-text-secondary leading-relaxed">
                  {t('swcUkModal.description')}{' '}
                  <a
                    href="https://www.standwithcrypto.org/gb/en/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    {t('swcUkModal.privacyPolicy')}
                  </a> and{' '}
                  <a
                    href="https://www.standwithcrypto.org/gb/en/terms-of-service"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    {t('swcUkModal.termsOfService')}
                  </a>.
                </p>
              </div>
            </div>,
            document.body
          )}
        </>
      )}

      {/* ETHConf discount opt-in */}
      {form.isEthconfEvent && (
        <button
          type="button"
          onClick={() => form.setEthconfOptIn(!form.ethconfOptIn)}
          className="flex items-center gap-3 p-4 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors cursor-pointer w-full"
        >
          {form.ethconfOptIn ? (
            <CheckSquare2 size={20} className="text-purple-500 flex-shrink-0" />
          ) : (
            <Square size={20} className="text-theme-text-muted flex-shrink-0" />
          )}
          <span className="text-sm text-theme-text">
            {t('step1.ethconfDiscount')}
          </span>
        </button>
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
