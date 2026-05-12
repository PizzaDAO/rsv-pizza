import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, Lock, ChevronRight, Heart } from 'lucide-react';
import { getPartyByInviteCodeOrCustomUrl, verifyPartyPassword, isUserGuestAtParty, DbParty } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { DonationForm } from '../components/DonationForm';
import { PublicEvent, getDonationStats, trackRsvpFunnel } from '../lib/api';
import { DonationPublicStats } from '../types';
import { useRSVPForm, dbPartyToRSVPData } from '../hooks/useRSVPForm';
// GPP theme applied conditionally
import { GPPClouds } from '../components/GPPClouds';
import { useConfetti } from '../hooks/useConfetti';
import { useTranslation } from 'react-i18next';
import { RSVPFlowContent } from '../components/RSVPFlowContent';

/** Map DbParty (snake_case) to a partial PublicEvent for RSVPFlowContent */
function dbPartyToPublicEvent(party: DbParty, inviteCode: string): PublicEvent {
  return {
    id: party.id,
    name: party.name,
    inviteCode: party.invite_code || inviteCode,
    customUrl: party.custom_url,
    date: party.date,
    duration: party.duration,
    timezone: party.timezone,
    pizzaStyle: party.pizza_style,
    availableBeverages: party.available_beverages || [],
    availableToppings: party.available_toppings || [],
    availableDietaryOptions: party.available_dietary_options || [],
    address: party.address,
    latitude: party.latitude,
    longitude: party.longitude,
    venueName: party.venue_name,
    maxGuests: party.max_guests,
    hideGuests: party.hide_guests,
    eventImageUrl: party.event_image_url,
    description: party.description,
    rsvpClosedAt: party.rsvp_closed_at,
    coHosts: party.co_hosts || [],
    hasPassword: !!party.has_password,
    hostName: party.host_name || null,
    hostProfile: party.host_profile || null,
    guestCount: 0,
    userId: party.user_id,
    selectedPizzerias: party.selected_pizzerias as any,
    eventType: party.event_type,
    eventTags: party.event_tags,
    donationEnabled: party.donation_enabled,
    donationRecipient: party.donation_recipient,
    donationRecipientUrl: party.donation_recipient_url,
    nftEnabled: party.nft_enabled,
    nftChain: party.nft_chain,
    turtleRolesEnabled: party.turtle_roles_enabled,
  } as PublicEvent;
}

export function RSVPPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation('rsvp');
  const { t: tCommon } = useTranslation('common');

  // Page-level loading state
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [party, setParty] = useState<DbParty | null>(null);

  // Donation state (page-specific, for Step 2 slot)
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
          setLoadError(tCommon('errors.partyNotFoundDesc'));
        }
      }
      setLoading(false);
    }
    loadParty();
  }, [inviteCode, user?.email]);

  // Track RSVP funnel: opened
  useEffect(() => {
    if (party && inviteCode) {
      trackRsvpFunnel(inviteCode, 'rsvp_opened');
    }
  }, [party, inviteCode]);

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
      availableDietaryOptions: [],
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
      setPasswordError(tCommon('errors.incorrectPassword'));
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
          <h1 className="text-2xl font-bold text-theme-text mb-2">{tCommon('errors.partyNotFound')}</h1>
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
          <h1 className="text-2xl font-bold text-theme-text mb-2 text-center">{t('password.title')}</h1>
          <p className="text-theme-text-secondary mb-6 text-center">
            {t('password.subtitle')}
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
                placeholder={t('password.placeholder')}
                className="w-full"
                required
                autoFocus
              />
            </div>

            <button type="submit" className="w-full btn-primary">
              {t('password.continue')}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---- Build twitter handles ----
  const twitterHandles: string[] = [];
  if (party?.host_profile) {
    const hp = party.host_profile as any;
    if (hp.twitter) twitterHandles.push(hp.twitter);
  }
  if (party?.co_hosts) {
    for (const host of party.co_hosts as any[]) {
      if (host.twitter && host.showOnEvent !== false) twitterHandles.push(host.twitter);
    }
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
              <p className="text-theme-text font-medium">{t('donation.donate')}</p>
              <p className="text-theme-text-muted text-sm">
                {donationStats.message || t('donation.defaultMessage')}
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
              <h3 className="text-theme-text font-medium">{t('donation.makeADonation')}</h3>
              <p className="text-theme-text-muted text-sm">
                {donationStats.recipient ? (
                  <>{t('donation.buyPizzaFor', { recipient: donationStats.recipient })}{donationStats.recipientUrl ? <> (<a href={donationStats.recipientUrl} target="_blank" rel="noopener noreferrer" className="text-[#ff393a] hover:text-[#ff6b6b] underline transition-colors">{donationStats.recipient}</a>)</> : null}</>
                ) : t('donation.buyPizzaForEvent')}
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

  // ---- Map party to PublicEvent for RSVPFlowContent ----
  const publicEvent = party ? dbPartyToPublicEvent(party, inviteCode || '') : null;

  if (!publicEvent) return null;

  // ---- Unified RSVP flow ----
  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${gppClass}`} onClick={(e) => { if (isGPP) fireConfetti(e.clientX, e.clientY); }}>
      {isGPP && <GPPClouds />}
      <RSVPFlowContent
        event={publicEvent}
        form={form}
        eventName={party?.name || ''}
        closeButtonLabel={t('success.backToEvent')}
        onClose={handleClose}
        donationSlot={donationSlot}
        twitterHandles={twitterHandles}
      />
      {ConfettiOverlay}
    </div>
  );
}
