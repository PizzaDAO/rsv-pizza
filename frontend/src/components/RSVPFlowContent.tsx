import React, { useState, useRef } from 'react';
import { Check, AlertCircle, Loader2, X, Heart, Calendar } from 'lucide-react';
import { PublicEvent } from '../lib/api';
import { DonationStep } from './DonationStep';
import { RSVPFormStep1 } from './RSVPFormStep1';
import { RSVPFormStep2 } from './RSVPFormStep2';
import { ShareRSVP } from './ShareRSVP';
import { AddToCalendarPopup } from './AddToCalendarPopup';
import { MintStatus, MintResult } from '../hooks/useMintNFT';
import { getNFTViewUrl, getChainConfig, NFTChain } from '../lib/nftContract';
import type { useRSVPForm } from '../hooks/useRSVPForm';

interface RSVPFlowContentProps {
  event: PublicEvent;
  form: ReturnType<typeof useRSVPForm>;
  eventName: string;
  closeButtonLabel: string;
  onClose: () => void;
  isEditing?: boolean;
  walletFieldSlot?: React.ReactNode;
  donationSlot?: React.ReactNode;
  mintStatus?: MintStatus;
  mintResult?: MintResult;
  twitterHandles: string[];
}

export function RSVPFlowContent({
  event,
  form,
  eventName,
  closeButtonLabel,
  onClose,
  isEditing,
  walletFieldSlot,
  donationSlot,
  mintStatus,
  mintResult,
  twitterHandles,
}: RSVPFlowContentProps) {
  // Calendar popup state (success screen)
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarBtnRef = useRef<HTMLButtonElement>(null);

  // Donation state (success screen)
  const [showDonation, setShowDonation] = useState(false);
  const [donationComplete, setDonationComplete] = useState(false);

  // ---- Success screen ----
  if (form.submitted) {
    const getSuccessIcon = () => {
      if (form.alreadyRegistered && !form.wasUpdated) return 'bg-[#ff393a]/20 border-[#ff393a]/30';
      if (form.waitlisted) return 'bg-[#ffc107]/20 border-[#ffc107]/30';
      if (form.pendingApproval) return 'bg-[#ffc107]/20 border-[#ffc107]/30';
      return 'bg-[#39d98a]/20 border-[#39d98a]/30';
    };

    const getSuccessTitle = () => {
      if (form.wasUpdated) return 'RSVP Updated';
      if (form.alreadyRegistered) return "You're already registered!";
      if (form.waitlisted) return "You're on the Waitlist!";
      if (form.pendingApproval) return 'RSVP Submitted!';
      return `See you at ${eventName}!`;
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

    return (
      <div className="card p-8 max-w-md w-full text-center relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text transition-colors"
        >
          <X size={20} />
        </button>
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
        {/* Share Section */}
        {(!form.alreadyRegistered || form.wasUpdated) && (
          <ShareRSVP
            eventName={eventName}
            eventImageUrl={event.eventImageUrl}
            customUrl={event.customUrl}
            inviteCode={event.inviteCode}
            twitterHandles={twitterHandles}
            calendarSlot={event.date ? (
              <div className="relative flex-1">
                <button
                  ref={calendarBtnRef}
                  onClick={() => setCalendarOpen(!calendarOpen)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-theme-surface border border-theme-stroke rounded-xl hover:bg-theme-surface-hover transition-colors text-theme-text"
                >
                  <Calendar size={14} />
                  <span className="hidden sm:inline">Add to Calendar</span>
                  <span className="sm:hidden">Calendar</span>
                </button>
                <AddToCalendarPopup
                  isOpen={calendarOpen}
                  onClose={() => setCalendarOpen(false)}
                  event={event}
                  anchorRef={calendarBtnRef}
                />
              </div>
            ) : undefined}
          />
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
            {mintStatus === 'success' && (mintResult?.txHash || mintResult?.tokenId) && (
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
              <p className="text-[#ff393a] text-sm">{mintResult?.error || 'NFT minting failed'}</p>
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
              ) : `Buy Pizza for ${eventName}`}
            </p>
          </>
        )}
        {showDonation && (
          <div className="mt-4">
            <DonationStep
              partyId={event.id}
              partyName={eventName}
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

      </div>
    );
  }

  // ---- Step 1 - Personal Info ----
  if (form.step === 1) {
    return (
      <div className="card p-8 max-w-lg w-full relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text transition-colors"
        >
          <X size={24} />
        </button>

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-theme-text">{isEditing ? 'Edit RSVP' : `RSVP to ${eventName}`}</h1>
          <p className="text-sm text-theme-text-secondary">Step 1 of 2</p>
        </div>

        <RSVPFormStep1
          form={form}
          eventName={eventName}
          isEditing={isEditing}
          showWallet={!!(event.nftEnabled || event.eventType === 'gpp')}
          showTurtleRoles={!!event.turtleRolesEnabled}
          walletFieldSlot={walletFieldSlot}
        />
      </div>
    );
  }

  // ---- Step 2 - Pizza Preferences ----
  return (
    <div className="card p-8 max-w-2xl w-full relative">
      <button
        onClick={onClose}
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
        donationSlot={donationSlot}
      />
    </div>
  );
}
