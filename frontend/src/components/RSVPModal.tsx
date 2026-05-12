import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, X, Wallet } from 'lucide-react';
import { ExistingGuestData } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { IconInput } from './IconInput';
import { PublicEvent, trackRsvpFunnel } from '../lib/api';
import { useRSVPForm, publicEventToRSVPData, RSVPSubmitResult } from '../hooks/useRSVPForm';
import { useMintNFT, MintStatus, MintResult } from '../hooks/useMintNFT';
import { useAccount } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { useTranslation } from 'react-i18next';
import { RSVPFlowContent } from './RSVPFlowContent';

interface RSVPModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: PublicEvent;
  existingGuest?: ExistingGuestData | null;
  onRSVPSuccess?: () => void;
}

export function RSVPModal({ isOpen, onClose, event, existingGuest, onRSVPSuccess }: RSVPModalProps) {
  const { user } = useAuth();
  const { t } = useTranslation('rsvp');
  const { t: tCommon } = useTranslation('common');

  // NFT minting state
  const [mintStatus, setMintStatus] = useState<MintStatus>('idle');
  const [mintResult, setMintResult] = useState<MintResult>({});
  const { mint: mintNFT } = useMintNFT();

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
      form.resetForm();
      setMintStatus('idle');
      setMintResult({});

      document.body.classList.add('modal-open');
    } else if (!isOpen) {
      document.body.classList.remove('modal-open');
    }
    wasOpenRef.current = isOpen;
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isOpen, existingGuest]);

  // Track RSVP funnel: opened
  useEffect(() => {
    if (isOpen) {
      const slug = event.customUrl || event.inviteCode;
      if (slug) trackRsvpFunnel(slug, 'rsvp_opened');
    }
  }, [isOpen, event.customUrl, event.inviteCode]);

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

  // ---- Build twitter handles ----
  const twitterHandles: string[] = [];
  if (event.hostProfile?.twitter) twitterHandles.push(event.hostProfile.twitter);
  if (event.coHosts) {
    for (const host of event.coHosts) {
      if (host.twitter && host.showOnEvent !== false) twitterHandles.push(host.twitter);
    }
  }
  if (event.sponsors) {
    for (const sponsor of event.sponsors) {
      if (sponsor.brandTwitter) twitterHandles.push(sponsor.brandTwitter);
    }
  }

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
            placeholder={t('step1.walletPlaceholder')}
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
            <span className="hidden sm:inline">{tCommon('buttons.clear')}</span>
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
                <span className="hidden sm:inline">{tCommon('buttons.connect')}</span>
              </button>
            )}
          </ConnectKitButton.Custom>
        )}
      </div>
      {form.walletValidation === 'invalid' && form.ethereumAddress.trim() && (
        <span className="text-xs text-[#ff393a] mt-1 block">{tCommon('errors.invalidWallet')}</span>
      )}
    </div>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div className="min-h-full flex items-center justify-center px-2 py-4 sm:p-4">
        <div onClick={(e) => e.stopPropagation()} data-testid={form.submitted ? 'rsvp-success' : 'rsvp-modal'}>
          <RSVPFlowContent
            event={event}
            form={form}
            eventName={event.name}
            closeButtonLabel="Close"
            onClose={handleClose}
            isEditing={isEditing}
            walletFieldSlot={walletFieldSlot}
            mintStatus={mintStatus}
            mintResult={mintResult}
            twitterHandles={twitterHandles}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
