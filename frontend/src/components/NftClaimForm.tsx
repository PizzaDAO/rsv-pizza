import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ExternalLink, Loader2, Wallet, X } from 'lucide-react';
import { useAccount } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { IconInput } from './IconInput';
import { OpenInWallet } from './OpenInWallet';
import { NftClaimError, type NftClaimResult } from '../lib/api';

interface NftClaimFormProps {
  /** `parties.nft_chain` ('base' | 'monad'). */
  chain: string;
  /** Posts the claim. Resolves with the mint result; rejects with NftClaimError. */
  onSubmit: (address: string) => Promise<NftClaimResult>;
  /** Hand-off URL for the mobile "open in wallet" panel (the claim page passes the plain URL: the token is the capability). */
  getHandoffUrl?: () => Promise<string>;
  /** Called once with the final result so the parent can refresh. */
  onClaimed?: (result: NftClaimResult) => void;
}

type Step = 'input' | 'confirm' | 'minting' | 'done';

const ERROR_KEYS: Record<string, string> = {
  paused: 'states.paused.body',
  cap_reached: 'states.capReached.body',
  invalid_address: 'errors.invalid',
  rate_limited: 'errors.rateLimited',
  conflict: 'errors.conflict',
  mint_failed: 'errors.mintFailed',
  not_eligible: 'errors.notEligible',
};

/** Address field + wallet connect + confirm step + mint progress, shared by the claim page and the event-page card. */
export function NftClaimForm({ chain, onSubmit, getHandoffUrl, onClaimed }: NftClaimFormProps) {
  const { t } = useTranslation('nft');
  const { t: tCommon } = useTranslation('common');
  const { address: connectedAddress } = useAccount();

  const [address, setAddress] = useState('');
  const [step, setStep] = useState<Step>('input');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [result, setResult] = useState<NftClaimResult | null>(null);

  // Auto-fill when a wallet connects, as in RSVPModal (never overwrites what the guest typed).
  useEffect(() => {
    if (connectedAddress) setAddress((current) => current || connectedAddress);
  }, [connectedAddress]);

  const trimmed = address.trim();
  const chainName = t(`chain.${chain === 'monad' ? 'monad' : 'base'}`);

  const submit = async () => {
    setStep('minting');
    setErrorKey(null);
    try {
      const r = await onSubmit(trimmed);
      setResult(r);
      setStep('done');
      onClaimed?.(r);
    } catch (e) {
      setErrorKey(e instanceof NftClaimError ? ERROR_KEYS[e.state] || 'errors.generic' : 'errors.generic');
      setStep('input');
    }
  };

  if (step === 'done' && result) {
    return (
      <div className="text-center space-y-3" data-testid="nft-claim-done">
        <Check className="w-10 h-10 text-[#39d98a] mx-auto" />
        <h3 className="text-lg font-semibold text-theme-text">{t('success.title')}</h3>
        <p className="text-sm text-theme-text-secondary">
          {t('success.body', { address: result.maskedRecipient || trimmed })}
        </p>
        {result.explorerUrl && (
          <a
            href={result.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-[#ff393a] hover:underline"
          >
            {t('success.view')}
            <ExternalLink size={14} />
          </a>
        )}
      </div>
    );
  }

  if (step === 'minting') {
    return (
      <div className="flex items-center justify-center gap-2 text-theme-text-secondary text-sm py-4" data-testid="nft-claim-minting">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('minting')}
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="space-y-3" data-testid="nft-claim-confirm">
        <h3 className="text-base font-semibold text-theme-text">{t('confirm.title')}</h3>
        <p className="text-sm text-theme-text break-all font-mono">{t('confirm.body', { address: trimmed, chain: chainName })}</p>
        <p className="text-xs text-theme-text-muted">{t('confirm.warning')}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={submit}
            className="flex-1 px-4 py-2.5 min-h-[40px] rounded-xl bg-[#ff393a] hover:bg-[#ff5a5b] text-white text-sm font-semibold transition-colors"
          >
            {t('confirm.yes')}
          </button>
          <button
            type="button"
            onClick={() => setStep('input')}
            className="px-4 py-2.5 min-h-[40px] rounded-xl bg-theme-surface border border-theme-stroke hover:bg-theme-surface-hover text-theme-text-secondary text-sm transition-colors"
          >
            {t('confirm.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <IconInput
            icon={Wallet}
            type="text"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setErrorKey(null);
            }}
            placeholder={t('walletPlaceholder')}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {trimmed ? (
          <button
            type="button"
            onClick={() => setAddress('')}
            className="px-3 py-2.5 min-h-[40px] rounded-xl bg-theme-surface border border-theme-stroke hover:bg-theme-surface-hover text-theme-text-secondary hover:text-theme-text text-sm whitespace-nowrap transition-colors flex items-center gap-1.5 flex-shrink-0"
          >
            <X size={14} />
            <span className="hidden sm:inline">{tCommon('buttons.clear')}</span>
          </button>
        ) : (
          <ConnectKitButton.Custom>
            {({ show }) => (
              <button
                type="button"
                onClick={show}
                className="px-3 py-2.5 min-h-[40px] rounded-xl bg-theme-surface border border-theme-stroke hover:bg-theme-surface-hover text-theme-text-secondary hover:text-theme-text text-sm whitespace-nowrap transition-colors flex items-center gap-1.5 flex-shrink-0"
              >
                <Wallet size={14} />
                <span className="hidden sm:inline">{t('connect')}</span>
              </button>
            )}
          </ConnectKitButton.Custom>
        )}
      </div>
      {!trimmed && <OpenInWallet getHandoffUrl={getHandoffUrl} />}
      <p className="text-xs text-white/40">{t('help')}</p>
      {errorKey && (
        <p className="text-xs text-[#ff393a]" role="alert">
          {t(errorKey)}
        </p>
      )}
      <button
        type="button"
        disabled={!trimmed}
        onClick={() => setStep('confirm')}
        className="w-full px-4 py-2.5 min-h-[40px] rounded-xl bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
      >
        {t('claim')}
      </button>
    </div>
  );
}
