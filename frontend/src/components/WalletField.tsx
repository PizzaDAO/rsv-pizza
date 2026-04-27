import React, { useState, useEffect } from 'react';
import { Wallet, Check, X, Info } from 'lucide-react';
import { IconInput } from './IconInput';
import { WalletSetupModal } from './WalletSetupModal';
import { useAccount } from 'wagmi';
import { ConnectKitButton } from 'connectkit';

interface WalletFieldProps {
  value: string;
  onChange: (value: string) => void;
  validation: 'idle' | 'valid' | 'invalid';
  onValidate: (value: string) => void;
  required?: boolean;
}

export function WalletField({ value, onChange, validation, onValidate, required }: WalletFieldProps) {
  const [showInfoModal, setShowInfoModal] = useState(false);
  const { address: connectedAddress, isConnected: walletConnected } = useAccount();

  // Auto-fill wallet address when user connects via ConnectKit
  useEffect(() => {
    if (walletConnected && connectedAddress) {
      onChange(connectedAddress);
      onValidate(connectedAddress);
    }
  }, [walletConnected, connectedAddress]);

  return (
    <div>
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <IconInput
            icon={Wallet}
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              onValidate(e.target.value);
            }}
            placeholder={required ? 'Wallet Address or ENS (e.g. vitalik.eth) *' : 'Wallet Address or ENS (e.g. vitalik.eth)'}
            className={
              validation === 'valid'
                ? 'border-[#39d98a]/50'
                : validation === 'invalid'
                  ? 'border-[#ff393a]/50'
                  : ''
            }
          />
          {validation === 'valid' && (
            <Check size={14} className="absolute left-[2.35rem] top-1/2 -translate-y-1/2 text-[#39d98a]" />
          )}
        </div>
        {value.trim() ? (
          <button
            type="button"
            onClick={() => { onChange(''); onValidate(''); }}
            className="px-3 py-2.5 rounded-xl bg-theme-surface border border-theme-stroke hover:bg-theme-surface-hover text-theme-text-secondary hover:text-theme-text text-sm whitespace-nowrap transition-colors flex items-center gap-1.5 flex-shrink-0"
          >
            <X size={14} />
            <span className="hidden sm:inline">Clear</span>
          </button>
        ) : (
          <ConnectKitButton.Custom>
            {({ show }) => (
              <button
                type="button"
                onClick={show}
                className="px-3 py-2.5 rounded-xl bg-theme-surface border border-theme-stroke hover:bg-theme-surface-hover text-theme-text-secondary hover:text-theme-text text-sm whitespace-nowrap transition-colors flex items-center gap-1.5 flex-shrink-0"
              >
                <Wallet size={14} />
                <span className="hidden sm:inline">Connect</span>
              </button>
            )}
          </ConnectKitButton.Custom>
        )}
        <button
          type="button"
          onClick={() => setShowInfoModal(true)}
          className="p-2.5 rounded-xl bg-theme-surface border border-theme-stroke hover:bg-theme-surface-hover text-theme-text-muted hover:text-theme-text transition-colors flex-shrink-0"
        >
          <Info size={16} />
        </button>
      </div>
      {validation === 'invalid' && value.trim() && (
        <span className="text-xs text-[#ff393a] mt-1 block">Enter a valid address (0x...) or ENS name (.eth)</span>
      )}

      <ConnectKitButton.Custom>
        {({ show }) => (
          <WalletSetupModal
            isOpen={showInfoModal}
            onClose={() => setShowInfoModal(false)}
            onConnectWallet={show}
          />
        )}
      </ConnectKitButton.Custom>
    </div>
  );
}
