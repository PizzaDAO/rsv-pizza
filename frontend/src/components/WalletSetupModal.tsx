import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface WalletSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectWallet?: () => void;
}

export function WalletSetupModal({ isOpen, onClose, onConnectWallet }: WalletSetupModalProps) {
  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card p-6 max-w-md w-full relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-theme-text-muted hover:text-theme-text transition-colors"
        >
          <X size={20} />
        </button>

        <h3 className="text-lg font-bold text-theme-text mb-4">Set Up Your Wallet</h3>

        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-theme-text mb-1">What is a wallet address?</h4>
            <p className="text-sm text-theme-text-secondary leading-relaxed">
              Your crypto account address, like a digital ID. You'll need one to receive your proof-of-attendance NFT.
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-theme-text mb-1">Get MetaMask</h4>
            <p className="text-sm text-theme-text-secondary leading-relaxed">
              Download the free MetaMask wallet at{' '}
              <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#ff393a] hover:text-[#ff6b6b] underline"
              >
                metamask.io/download
              </a>
              . Available as a browser extension and mobile app.
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-theme-text mb-1">Find Your Address</h4>
            <p className="text-sm text-theme-text-secondary leading-relaxed">
              Open MetaMask, click your account name at the top, and your address (starting with 0x...) is copied to clipboard. Paste it in the wallet field.
            </p>
          </div>
        </div>

        {onConnectWallet && (
          <div className="mt-5">
            <button
              type="button"
              onClick={() => {
                onConnectWallet();
                onClose();
              }}
              className="w-full btn-primary"
            >
              Connect Wallet
            </button>
            <p className="text-xs text-white/40 text-center mt-2">
              If you already have MetaMask installed, click Connect Wallet to auto-fill your address.
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
