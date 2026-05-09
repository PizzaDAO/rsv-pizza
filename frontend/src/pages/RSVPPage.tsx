import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, AlertCircle, Loader2, Lock, X, ChevronRight, Heart, Calendar } from 'lucide-react';
import { getPartyByInviteCodeOrCustomUrl, verifyPartyPassword, isUserGuestAtParty, DbParty } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { DonationForm } from '../components/DonationForm';
import { getDonationStats, PublicEvent } from '../lib/api';
import { AddToCalendarPopup } from '../components/AddToCalendarPopup';
import { DonationPublicStats } from '../types';
import { useRSVPForm, dbPartyToRSVPData } from '../hooks/useRSVPForm';
import { RSVPFormStep1 } from '../components/RSVPFormStep1';
import { RSVPFormStep2 } from '../components/RSVPFormStep2';
// GPP theme applied conditionally
import { GPPClouds } from '../components/GPPClouds';
import { useConfetti } from '../hooks/useConfetti';
import { ShareRSVP } from '../components/ShareRSVP';

export function RSVPPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Page-level loading state
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [party, setParty] = useState<DbParty | null>(null);

  // Donation state (page-specific)
  const [donationsEnabled, setDonationsEnabled] = useState(false);
  const [donationStats, setDonationStats] = useState<DonationPublicStats | null>(null);
  const [showDonationForm, setShowDonationForm] = useState(false);

  // GPP theme
  const isGPP = party?.event_type === 'gpp';
  const gppClass = isGPP ? 'gpp-theme' : '';

  useEffect(() => {
    if (isGPP) document.body.classList.add('gpp-theme-active');
    else document.body.classList.remove('gpp-theme-active');
    return () => { document.body.classList.remove('gpp-theme-active'); };
  }, [isGPP]);

  const { fire: fireConfetti, fireFromCenter, ConfettiOverlay } = useConfetti();

  // Calendar popup state
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarBtnRef = useRef<HTMLButtonElement>(null);

  // Password protection state
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Load party
  useEffect(() => {
    async function loadParty() {
      if (inviteCode) {
        const foundParty = await getPartyByInviteCodeOrCustomUrl(inviteCode);
        if (foundParty) {
          setParty(foundParty);

          // Check if donations are enabled
          const stats = await getDonationStats(foundParty.id);
          setDonationStats(stats);
          setDonationsEnabled(stats?.enabled || false);

          // Check if party has password protection
          if (foundParty.has_password) {
            const userIsGuest = user?.email && await isUserGuestAtParty(foundParty.id, user.email);
            let userIsHost = false;
            if (!userIsGuest && user?.email && inviteCode) {
              try {
                const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
                const resp = await fetch(`${apiUrl}/api/events/${inviteCode}/check-host`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: user.email }),
                });
                if (resp.ok) {
                  const data = await resp.json();
                  userIsHost = data.isHost;
                }
              } catch (e) {
                console.warn('Could not check host status:', e);
              }
            }

            if (userIsGuest || userIsHost) {
              setIsAuthenticated(true);
            } else {
              const authKey = `rsvpizza_auth_${inviteCode}`;
              const storedAuth = sessionStorage.getItem(authKey);
              if (storedAuth) {
                const isValid = await verifyPartyPassword(inviteCode!, storedAuth);
                if (isValid) {
                  setIsAuthenticated(true);
                }
              }
            }
          } else {
            setIsAuthenticated(true);
          }
        } else {
          setLoadError('Party not found. The invite link may be invalid or expired.');
        }
      }
      setLoading(false);
    }
    loadParty();
  }, [inviteCode, user?.email]);

  // Create the eventData only when party is loaded
  const eventData = party ? dbPartyToRSVPData(party) : null;

  // Use the shared form hook (only when party is loaded)
  const form = useRSVPForm({
    eventData: eventData || {
      id: '',
      name: '',
      inviteCode: inviteCode || '',
      customUrl: null,
      address: null,
      availableBeverages: [],
      availableToppings: [],
    },
    user,
    isOpen: !!party, // Only active when party is loaded
    onSuccess: (result) => {
      if (isGPP) fireFromCenter();
    },
  });

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!party?.has_password) return;

    const isValid = await verifyPartyPassword(inviteCode!, passwordInput);
    if (isValid) {
      setIsAuthenticated(true);
      setPasswordError(null);
      const authKey = `rsvpizza_auth_${inviteCode}`;
      sessionStorage.setItem(authKey, passwordInput);
    } else {
      setPasswordError('Incorrect password. Please try again.');
      setPasswordInput('');
    }
  };

  const handleClose = () => {
    const eventUrl = party?.custom_url
      ? `/${party.custom_url}`
      : `/${inviteCode}`;
    navigate(eventUrl);
  };

  // ---- Loading state ----
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  // ---- Error state (no party found) ----
  if (loadError && !party) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card p-8 max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-[#ff393a] mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-theme-text mb-2">Party Not Found</h1>
          <p className="text-theme-text-secondary">{loadError}</p>
        </div>
      </div>
    );
  }

  // ---- Password protection UI ----
  if (!isAuthenticated && party?.has_password) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${gppClass}`} onClick={(e) => { if (isGPP) fireConfetti(e.clientX, e.clientY); }}>
        {isGPP && <GPPClouds />}
        <div className="card p-8 max-w-md w-full">
          <div className="w-16 h-16 bg-[#ff393a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#ff393a]/30">
            <Lock className="w-8 h-8 text-[#ff393a]" />
          </div>
          <h1 className="text-2xl font-bold text-theme-text mb-2 text-center">Password Required</h1>
          <p className="text-theme-text-secondary mb-6 text-center">
            This event is password-protected
          </p>

          <form onSubmit={handlePasswordSubmit} className="space-y-3">
            {passwordError && (
              <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
                {passwordError}
              </div>
            )}

            <div>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Event Password"
                className="w-full"
                required
                autoFocus
              />
            </div>

            <button type="submit" className="w-full btn-primary">
              Continue
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---- Donation slot for Step 2 ----
  const donationSlot = donationsEnabled && donationStats ? (
    <>
      {!showDonationForm && (
        <div className="border-t border-theme-stroke pt-4">
          <button
            type="button"
            onClick={() => setShowDonationForm(true)}
            className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-[#ff393a]/10 to-[#ff6b6b]/10 rounded-xl border border-[#ff393a]/20 hover:border-[#ff393a]/40 transition-all"
          >
            <div className="w-12 h-12 bg-[#ff393a]/20 rounded-full flex items-center justify-center border border-[#ff393a]/30 flex-shrink-0">
              <Heart size={24} className="text-[#ff393a]" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-theme-text font-medium">Donate</p>
              <p className="text-theme-text-muted text-sm">
                {donationStats.message || 'Make a donation to help make this event possible'}
              </p>
            </div>
            <ChevronRight size={20} className="text-theme-text-muted" />
          </button>
        </div>
      )}
      {showDonationForm && (
        <div className="border-t border-theme-stroke pt-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-[#ff393a]/20 rounded-full flex items-center justify-center border border-[#ff393a]/30">
              <Heart size={20} className="text-[#ff393a]" />
            </div>
            <div>
              <h3 className="text-theme-text font-medium">Make a Donation</h3>
              <p className="text-theme-text-muted text-sm">
                {donationStats.recipient ? (
                  <>Buy Pizza for {donationStats.recipientUrl ? <a href={donationStats.recipientUrl} target="_blank" rel="noopener noreferrer" className="text-[#ff393a] hover:text-[#ff6b6b] underline transition-colors">{donationStats.recipient}</a> : donationStats.recipient}</>
                ) : 'Buy Pizza for this event'}
              </p>
            </div>
          </div>
          <DonationForm
            partyId={party!.id}
            stats={donationStats}
            guestName={form.name}
            guestEmail={form.email}
            onSuccess={() => setShowDonationForm(false)}
            onCancel={() => setShowDonationForm(false)}
          />
        </div>
      )}
    </>
  ) : undefined;

  // ---- Success screen ----
  if (form.submitted) {
    const getSuccessIcon = () => {
      if (form.alreadyRegistered) return 'bg-[#ff393a]/20 border-[#ff393a]/30';
      if (form.pendingApproval) return 'bg-[#ffc107]/20 border-[#ffc107]/30';
      return 'bg-[#39d98a]/20 border-[#39d98a]/30';
    };

    const getSuccessTitle = () => {
      if (form.alreadyRegistered) return "You're already registered!";
      if (form.pendingApproval) return 'RSVP Submitted!';
      return `See you at ${party?.name}!`;
    };

    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${gppClass}`} onClick={(e) => { if (isGPP) fireConfetti(e.clientX, e.clientY); }}>
        {isGPP && <GPPClouds />}
        <div className="card p-8 max-w-md text-center">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border ${getSuccessIcon()}`}>
            {form.alreadyRegistered ? (
              <AlertCircle className="w-8 h-8 text-[#ff393a]" />
            ) : form.pendingApproval ? (
              <Loader2 className="w-8 h-8 text-[#ffc107]" />
            ) : (
              <Check className="w-8 h-8 text-[#39d98a]" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-theme-text mb-2">
            {getSuccessTitle()}
          </h1>
          {form.alreadyRegistered && (
            <p className="text-theme-text-secondary mb-4">
              This email has already been used to RSVP to this event.
            </p>
          )}
          {form.pendingApproval && !form.alreadyRegistered && (
            <p className="text-theme-text-secondary mb-4">
              Your RSVP is pending approval from the host. You'll receive an email with your check-in QR code once approved.
            </p>
          )}
          {!form.alreadyRegistered && !form.pendingApproval && (() => {
            const twitterHandles: string[] = [];
            if (party?.co_hosts) {
              for (const host of party.co_hosts as any[]) {
                if (host.twitter && host.showOnEvent !== false) twitterHandles.push(host.twitter);
              }
            }
            return (
              <ShareRSVP
                eventName={party?.name || ''}
                eventImageUrl={party?.event_image_url || null}
                customUrl={party?.custom_url || null}
                inviteCode={inviteCode || ''}
                twitterHandles={twitterHandles}
              />
            );
          })()}
          {party?.date && (
            <div className="relative inline-block mt-2 mb-4">
              <button
                ref={calendarBtnRef}
                onClick={() => setCalendarOpen(!calendarOpen)}
                className="btn-secondary flex items-center gap-2 mx-auto"
              >
                <Calendar size={18} />
                Add to Calendar
              </button>
              <AddToCalendarPopup
                isOpen={calendarOpen}
                onClose={() => setCalendarOpen(false)}
                event={{
                  name: party.name,
                  date: party.date,
                  duration: party.duration,
                  timezone: party.timezone,
                  address: party.address,
                  venueName: party.venue_name,
                  inviteCode: party.invite_code,
                  customUrl: party.custom_url,
                  description: party.description,
                } as PublicEvent}
                anchorRef={calendarBtnRef}
              />
            </div>
          )}
          <button
            onClick={handleClose}
            className="btn-secondary"
          >
            Back to Event
          </button>
        </div>
        {ConfettiOverlay}
      </div>
    );
  }

  // ---- Step 1 - Personal Info ----
  if (form.step === 1) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${gppClass}`} onClick={(e) => { if (isGPP) fireConfetti(e.clientX, e.clientY); }}>
        {isGPP && <GPPClouds />}
        <div className="card p-8 max-w-lg w-full relative">
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text transition-colors"
          >
            <X size={24} />
          </button>

          <div className="mb-6">
            <h1 className="text-2xl font-bold text-theme-text">RSVP to {party?.name}</h1>
            <p className="text-sm text-theme-text-secondary">Step 1 of 2</p>
          </div>

          <RSVPFormStep1
            form={form}
            eventName={party?.name || ''}
            showWallet={!!(party?.nft_enabled || party?.event_type === 'gpp')}
            showTurtleRoles={!!party?.turtle_roles_enabled}
          />
        </div>
      </div>
    );
  }

  // ---- Step 2 - Pizza Preferences ----
  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${gppClass}`}>
      {isGPP && <GPPClouds />}
      <div className="card p-8 max-w-2xl w-full relative">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text transition-colors"
        >
          <X size={24} />
        </button>

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-theme-text">Pizza Requests</h1>
          <p className="text-sm text-theme-text-secondary">Step 2 of 2</p>
        </div>

        <RSVPFormStep2
          form={form}
          donationSlot={donationSlot}
        />
      </div>
      {ConfettiOverlay}
    </div>
  );
}
