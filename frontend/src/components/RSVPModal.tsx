import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, AlertCircle, Loader2, X, Wallet, Heart } from 'lucide-react';
import { ExistingGuestData } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { IconInput } from './IconInput';
import { PublicEvent } from '../lib/api';
import { DonationStep } from './DonationStep';
import { useRSVPForm, publicEventToRSVPData, RSVPSubmitResult } from '../hooks/useRSVPForm';
import { RSVPFormStep1 } from './RSVPFormStep1';
import { RSVPFormStep2 } from './RSVPFormStep2';
import { useMintNFT, MintStatus, MintResult } from '../hooks/useMintNFT';
import { getNFTViewUrl, getChainConfig, NFTChain } from '../lib/nftContract';
import { useAccount } from 'wagmi';
import { ConnectKitButton } from 'connectkit';

interface RSVPModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: PublicEvent;
  existingGuest?: ExistingGuestData | null;
  onRSVPSuccess?: () => void;
}

export function RSVPModal({ isOpen, onClose, event, existingGuest, onRSVPSuccess }: RSVPModalProps) {
  const { user } = useAuth();

  // NFT minting state (stays in modal — not shared)
  const [mintStatus, setMintStatus] = useState<MintStatus>('idle');
  const [mintResult, setMintResult] = useState<MintResult>({});
  const { mint: mintNFT } = useMintNFT();

  // Donation state (stays in modal success screen)
  const [showDonation, setShowDonation] = useState(false);
  const [donationComplete, setDonationComplete] = useState(false);

  // Track closed->open transition for reset
  const wasOpenRef = useRef(false);

  // Wallet connection via ConnectKit/wagmi
  const { address: connectedAddress, isConnected: walletConnected } = useAccount();

  const eventData = publicEventToRSVPData(event);

  // Success handler: NFT minting + notify parent
  const handleSuccess = async (result: RSVPSubmitResult) => {
    onRSVPSuccess?.();

    // Auto-mint NFT if enabled, wallet address provided, and event has an image
    if (event.nftEnabled && form.ethereumAddress.trim() && event.eventImageUrl && result.guest?.id) {
      setMintStatus('minting');
      try {
        const mintRes = await mintNFT({
          recipient: form.ethereumAddress.trim(),
          partyId: event.id,
          guestId: result.guest.id,
          guestName: form.name.trim(),
          partyName: event.name,
          partyDate: event.date ? new Date(event.date).toISOString().split('T')[0] : null,
          partyVenue: event.venueName || null,
          partyAddress: event.address || null,
          imageUrl: event.eventImageUrl,
          inviteCode: event.customUrl || event.inviteCode,
          chain: event.nftChain || 'base',
        });
        setMintResult({ txHash: mintRes.txHash, tokenId: mintRes.tokenId, alreadyMinted: mintRes.alreadyMinted });
        setMintStatus('success');

        // Save NFT data to backend
        if (mintRes.txHash && mintRes.tokenId && form.email.trim()) {
          const API_URL = import.meta.env.VITE_API_URL || '';
          try {
            const saveResponse = await fetch(`${API_URL}/api/nft/guest/${result.guest.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tokenId: parseInt(mintRes.tokenId),
                transactionHash: mintRes.txHash,
                email: form.email.trim().toLowerCase(),
              }),
            });
            if (!saveResponse.ok) {
              const errorData = await saveResponse.json().catch(() => ({}));
              console.error('Failed to save NFT data:', errorData.error || saveResponse.statusText);
            }
          } catch (saveError) {
            console.error('Failed to save NFT data to database:', saveError);
          }
        }
      } catch (err) {
        setMintResult({ error: err instanceof Error ? err.message : 'Minting failed' });
        setMintStatus('error');
      }
    }
  };

  const form = useRSVPForm({
    eventData,
    user,
    existingGuest,
    isOpen,
    onSuccess: handleSuccess,
  });

  // Reset state when modal opens and lock body scroll
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      // Modal just opened: reset all form state
      form.resetForm();
      setMintStatus('idle');
      setMintResult({});
      setShowDonation(false);
      setDonationComplete(false);

      // Lock body scroll
      document.body.classList.add('modal-open');
    } else if (!isOpen) {
      document.body.classList.remove('modal-open');
    }
    wasOpenRef.current = isOpen;
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isOpen, existingGuest]);

  // Auto-fill wallet address when user connects via ConnectKit
  useEffect(() => {
    if (walletConnected && connectedAddress) {
      form.setEthereumAddress(connectedAddress);
      form.validateWalletAddress(connectedAddress);
    }
  }, [walletConnected, connectedAddress]);

  const handleClose = () => {
    onClose();
  };

  if (!isOpen) return null;

  const isEditing = !!existingGuest;

  // ---- Wallet field slot with ConnectKit ----
  const walletFieldSlot = (
    <div>
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
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
          {form.walletValidation === 'valid' && (
            <Check size={14} className="absolute left-[2.35rem] top-1/2 -translate-y-1/2 text-[#39d98a]" />
          )}
        </div>
        {form.ethereumAddress.trim() ? (
          <button
            type="button"
            onClick={() => { form.setEthereumAddress(''); form.setWalletValidation('idle'); }}
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
      </div>
      {form.walletValidation === 'invalid' && form.ethereumAddress.trim() && (
        <span className="text-xs text-[#ff393a] mt-1 block">Enter a valid address (0x...) or ENS name (.eth)</span>
      )}
    </div>
  );

  // ---- Success screen ----
  if (form.submitted) {
    const getSuccessIcon = () => {
      if (form.alreadyRegistered && !form.wasUpdated) return 'bg-[#ff393a]/20 border-[#ff393a]/30';
      if (form.waitlisted) return 'bg-[#ffc107]/20 border-[#ffc107]/30';
      if (form.pendingApproval) return 'bg-[#ffc107]/20 border-[#ffc107]/30';
      return 'bg-[#39d98a]/20 border-[#39d98a]/30';
    };

    const getSuccessTitle = () => {
      if (form.wasUpdated) return 'RSVP Updated!';
      if (form.alreadyRegistered) return "You're already registered!";
      if (form.waitlisted) return "You're on the Waitlist!";
      if (form.pendingApproval) return 'RSVP Submitted!';
      return `See you at ${event.name}!`;
    };

    const getSuccessIconComponent = () => {
      if (form.alreadyRegistered && !form.wasUpdated) {
        return <AlertCircle className="w-8 h-8 text-[#ff393a]" />;
      }
      if (form.waitlisted) {
        return <span className="text-2xl font-bold text-[#ffc107]">#{form.waitlistPosition}</span>;
      }
      if (form.pendingApproval) {
        return <Loader2 className="w-8 h-8 text-[#ffc107]" />;
      }
      return <Check className="w-8 h-8 text-[#39d98a]" />;
    };

    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center px-2 py-4 sm:p-4 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      >
        <div
          className="card p-8 max-w-md w-full text-center"
          data-testid="rsvp-success"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border ${getSuccessIcon()}`}>
            {getSuccessIconComponent()}
          </div>
          <h1 className="text-2xl font-bold text-theme-text mb-2">
            {getSuccessTitle()}
          </h1>
          {form.alreadyRegistered && !form.wasUpdated && (
            <p className="text-theme-text-secondary mb-4">
              This email has already been used to RSVP to this event.
            </p>
          )}
          {form.wasUpdated && (
            <p className="text-theme-text-secondary mb-4">
              Your preferences have been saved.
            </p>
          )}
          {form.waitlisted && !form.wasUpdated && (
            <p className="text-theme-text-secondary mb-4">
              This event is currently at capacity, but you're #{form.waitlistPosition} on the waitlist!
              We'll notify you if a spot opens up.
            </p>
          )}
          {form.pendingApproval && !form.alreadyRegistered && !form.waitlisted && (
            <p className="text-theme-text-secondary mb-4">
              Your RSVP is pending approval from the host. You'll receive an email with your check-in QR code once approved.
            </p>
          )}
          {/* NFT Minting Status */}
          {event.nftEnabled && form.ethereumAddress.trim() && event.eventImageUrl && (
            <div className="mt-4 pt-4 border-t border-theme-stroke">
              {mintStatus === 'minting' && (
                <div className="flex items-center gap-2 text-theme-text-secondary justify-center">
                  <Loader2 size={16} className="animate-spin" />
                  <span>Minting your NFT...</span>
                </div>
              )}
              {mintStatus === 'success' && (mintResult.txHash || mintResult.tokenId) && (
                <div className="space-y-2">
                  <p className="text-[#39d98a] font-medium">
                    {mintResult.alreadyMinted ? 'NFT Already Claimed!' : 'NFT Minted!'}
                  </p>
                  {mintResult.tokenId ? (
                    <a
                      href={getNFTViewUrl((event.nftChain || 'base') as NFTChain, mintResult.tokenId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-theme-text-secondary hover:text-theme-text underline"
                    >
                      View on OpenSea
                    </a>
                  ) : mintResult.txHash ? (
                    <a
                      href={`${getChainConfig((event.nftChain || 'base') as NFTChain).explorerUrl}/tx/${mintResult.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-theme-text-secondary hover:text-theme-text underline"
                    >
                      View Transaction
                    </a>
                  ) : null}
                </div>
              )}
              {mintStatus === 'error' && (
                <p className="text-[#ff393a] text-sm">{mintResult.error || 'NFT minting failed'}</p>
              )}
            </div>
          )}
          {/* Donation Section */}
          {event.donationEnabled && !donationComplete && !showDonation && (
            <>
              <button
                onClick={() => setShowDonation(true)}
                className="w-full bg-theme-surface border border-theme-stroke rounded-xl p-4 hover:bg-theme-surface-hover transition-colors cursor-pointer mt-4 flex items-center justify-center gap-2 text-theme-text"
              >
                <Heart size={18} className="text-[#ff393a]" />
                Donate
              </button>
              <p className="text-theme-text-secondary text-sm text-center mt-1">
                {event.donationRecipient ? (
                  <>Buy Pizza for {event.donationRecipientUrl ? <a href={event.donationRecipientUrl} target="_blank" rel="noopener noreferrer" className="text-[#ff393a] hover:text-[#ff6b6b] underline transition-colors">{event.donationRecipient}</a> : event.donationRecipient}</>
                ) : `Buy Pizza for ${event.name}`}
              </p>
            </>
          )}
          {showDonation && (
            <div className="mt-4">
              <DonationStep
                partyId={event.id}
                partyName={event.name}
                guestName={form.name}
                guestEmail={form.email}
                onComplete={() => {
                  setDonationComplete(true);
                  setShowDonation(false);
                }}
                onSkip={() => setShowDonation(false)}
              />
            </div>
          )}
          {donationComplete && (
            <div className="flex items-center justify-center gap-2 mt-4 text-[#39d98a]">
              <Check size={16} />
              <span className="text-sm">Thanks for your support!</span>
            </div>
          )}
          <button
            onClick={handleClose}
            className="btn-secondary mt-4"
          >
            Close
          </button>
        </div>
      </div>,
      document.body
    );
  }

  // ---- Step 1 - Personal Info ----
  if (form.step === 1) {
    return createPortal(
      <div
        className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm"
        data-testid="rsvp-modal"
        onClick={handleClose}
      >
        <div className="min-h-full flex items-center justify-center px-2 py-4 sm:p-4">
          <div
            className="card p-8 max-w-lg w-full relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text transition-colors"
            >
              <X size={24} />
            </button>

            <div className="mb-6">
              <h1 className="text-2xl font-bold text-theme-text">{isEditing ? 'Edit RSVP' : `RSVP to ${event.name}`}</h1>
              <p className="text-sm text-theme-text-secondary">Step 1 of 2</p>
            </div>

            <RSVPFormStep1
              form={form}
              eventName={event.name}
              isEditing={isEditing}
              showWallet={!!(event.nftEnabled || event.eventType === 'gpp')}
              walletFieldSlot={walletFieldSlot}
            />
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // ---- Step 2 - Pizza Preferences ----
  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div className="min-h-full flex items-center justify-center px-2 py-4 sm:p-4">
        <div
          className="card p-8 max-w-2xl w-full relative"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text transition-colors"
          >
            <X size={24} />
          </button>

          <div className="mb-6">
            <h1 className="text-2xl font-bold text-theme-text">{isEditing ? 'Edit Pizza Preferences' : 'Pizza Requests'}</h1>
            <p className="text-sm text-theme-text-secondary">Step 2 of 2</p>
          </div>

          <RSVPFormStep2
            form={form}
            isEditing={isEditing}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
