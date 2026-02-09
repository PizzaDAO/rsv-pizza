import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Calendar, MapPin, Users, Pizza, Loader2, Lock, AlertCircle, Settings, Camera, Link2, LogIn } from 'lucide-react';
import { verifyPartyPassword, isUserGuestAtParty, getExistingGuest, ExistingGuestData } from '../lib/supabase';
import { getEventBySlug, PublicEvent, getPhotoStats, verifyTweet } from '../lib/api';
import { IconInput } from '../components/IconInput';
import { HostsList, HostsAvatars } from '../components/HostsList';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { CornerLinks } from '../components/CornerLinks';
import { useAuth } from '../contexts/AuthContext';
import { RSVPModal } from '../components/RSVPModal';
import { LoginModal } from '../components/LoginModal';
import { PhotoGallery } from '../components/photos';
import { GPPBadge } from '../components/gpp';
import { PhotoStats } from '../types';
import { PizzaChefModal } from '../components/PizzaChefModal';
import { PizzaDAOModal } from '../components/PizzaDAOModal';
import { stripMarkdown } from '../lib/utils';
import { formatTimezoneDisplay } from '../utils/dateUtils';

export function EventPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<PublicEvent | null>(null);

  // Password protection state
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showEditPasswordPrompt, setShowEditPasswordPrompt] = useState(false);
  const [editPasswordInput, setEditPasswordInput] = useState('');
  const [editPasswordError, setEditPasswordError] = useState<string | null>(null);
  const [showRSVPModal, setShowRSVPModal] = useState(false);
  const [userHasRSVPd, setUserHasRSVPd] = useState(false);
  const [existingGuestData, setExistingGuestData] = useState<ExistingGuestData | null>(null);
  const [photoStats, setPhotoStats] = useState<PhotoStats | null>(null);
  const [showPhotos, setShowPhotos] = useState(false);
  const [showPizzaChef, setShowPizzaChef] = useState(false);
  const [showPizzaDAO, setShowPizzaDAO] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showTweetInput, setShowTweetInput] = useState(false);
  const [tweetUrl, setTweetUrl] = useState('');
  const [tweetError, setTweetError] = useState<string | null>(null);
  const [verifyingTweet, setVerifyingTweet] = useState(false);

  useEffect(() => {
    async function loadEvent() {
      if (slug) {
        const foundEvent = await getEventBySlug(slug);
        if (foundEvent) {
          setEvent(foundEvent);

          // Check if logged-in user has already RSVP'd and fetch their data
          let hasRSVPd = false;
          if (user?.email) {
            hasRSVPd = await isUserGuestAtParty(foundEvent.id, user.email);
            setUserHasRSVPd(hasRSVPd);

            if (hasRSVPd) {
              const inviteCode = foundEvent.customUrl || foundEvent.inviteCode;
              const guestData = await getExistingGuest(inviteCode, user.email);
              setExistingGuestData(guestData);
            }
          }

          // Check if current user is a host (primary or co-host)
          const isHost = user?.id === foundEvent.userId ||
            (user?.email && foundEvent.coHosts?.some((h: any) => h.email?.toLowerCase() === user.email?.toLowerCase()));

          // Skip password for hosts and already-RSVP'd guests
          if (isHost || hasRSVPd) {
            setIsAuthenticated(true);
          } else if (foundEvent.hasPassword) {
            // Check if already authenticated in this session
            // Use inviteCode as key to be consistent with RSVPPage
            const authKey = `rsvpizza_auth_${foundEvent.inviteCode}`;
            const storedAuth = sessionStorage.getItem(authKey);

            if (storedAuth) {
              const isValid = await verifyPartyPassword(foundEvent.id, storedAuth);
              if (isValid) {
                setIsAuthenticated(true);
              }
            }
          } else {
            // No password, automatically authenticated
            setIsAuthenticated(true);
          }

          // Load photo stats to see if photos are enabled and have content
          const stats = await getPhotoStats(foundEvent.id);
          if (stats) {
            setPhotoStats(stats);
          }
        } else {
          setError('Event not found. The link may be invalid or expired.');
        }
      }
      setLoading(false);
    }
    loadEvent();
  }, [slug, user?.email]);

  // Easter eggs: Press 'p' for Pizza Chef, Enter for PizzaDAO
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isEditable = (e.target as HTMLElement).isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isEditable) return;

      if ((e.key === 'p' || e.key === 'P') && !showPizzaChef) {
        setShowPizzaChef(true);
      }

      if (e.key === 'Enter' && !showPizzaDAO && !showRSVPModal) {
        setShowPizzaDAO(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showPizzaChef, showPizzaDAO, showRSVPModal]);

  const handleTweetVerify = async () => {
    if (!slug || !tweetUrl.trim()) return;
    setVerifyingTweet(true);
    setTweetError(null);
    try {
      const result = await verifyTweet(slug, tweetUrl.trim());
      if (result.verified) {
        setIsAuthenticated(true);
        if (event) {
          const authKey = `rsvpizza_auth_${event.inviteCode}`;
          sessionStorage.setItem(authKey, '__shared_on_x__');
        }
      } else {
        setTweetError(result.error || 'Could not verify your tweet. Please check the URL.');
      }
    } catch {
      setTweetError('Could not verify your tweet. Please try again.');
    } finally {
      setVerifyingTweet(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!event?.hasPassword) return;

    const isValid = await verifyPartyPassword(event.id, passwordInput);

    if (isValid) {
      // Correct password
      setIsAuthenticated(true);
      setPasswordError(null);
      // Store in session storage to avoid re-prompting
      // Use inviteCode as key to be consistent with RSVPPage
      const authKey = `rsvpizza_auth_${event.inviteCode}`;
      sessionStorage.setItem(authKey, passwordInput);
    } else {
      // Wrong password
      setPasswordError('Incorrect password. Please try again.');
      setPasswordInput('');
    }
  };

  const handleRSVP = () => {
    setShowRSVPModal(true);
  };

  const handleEditEvent = () => {
    if (!event) return;
    navigate(`/host/${event.inviteCode}`);
  };

  const handleEditPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!event?.hasPassword) return;

    const isValid = await verifyPartyPassword(event.id, editPasswordInput);

    if (isValid) {
      // Correct password - navigate to host page
      navigate(`/host/${event.inviteCode}`);
    } else {
      // Wrong password
      setEditPasswordError('Incorrect password. Please try again.');
      setEditPasswordInput('');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card p-8 max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-[#ff393a] mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Event Not Found</h1>
          <p className="text-white/60 mb-6">{error}</p>
          <Link to="/" className="btn-primary inline-block">
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  // Show password prompt if event is password-protected and not authenticated
  if (event.hasPassword && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card p-8 max-w-md">
          <div className="w-16 h-16 bg-[#ff393a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#ff393a]/30">
            <Lock className="w-8 h-8 text-[#ff393a]" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2 text-center">Password Required</h1>
          <form onSubmit={handlePasswordSubmit} className="space-y-3 mt-4">
            {passwordError && (
              <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
                {passwordError}
              </div>
            )}

            <IconInput
              icon={Lock}
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="What's the password?"
              required
              autoFocus
              autoComplete="off"
            />

            <button
              type="submit"
              className="w-full btn-primary"
            >
              Continue
            </button>
          </form>

          {/* Already RSVP'd? Log in */}
          {!user && (
            <div className="mt-4">
              <button
                onClick={() => setShowLoginModal(true)}
                className="w-full flex items-center justify-center gap-2 py-3 bg-black hover:bg-black/80 text-white rounded-xl border border-white/10 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                Already RSVP'd? Log in
              </button>
            </div>
          )}

          {/* Post to Get In */}
          {event.shareToUnlock && (
            <div className="mt-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-white/40 text-sm">or</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>
              {!showTweetInput ? (
                <button
                  onClick={() => {
                    const eventUrl = `https://rsv.pizza/${slug}`;
                    const tweetText = event.shareTweetText
                      ? event.shareTweetText + '\n\n' + eventUrl
                      : `I'm going to ${event.name}! RSVP at ${eventUrl}`;
                    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
                    window.open(intentUrl, '_blank');
                    setShowTweetInput(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-black hover:bg-black/80 text-white rounded-xl border border-white/10 transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  Post to Get In
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-white/60 text-sm text-center">
                    Paste your tweet URL to unlock the event
                  </p>

                  {tweetError && (
                    <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
                      {tweetError}
                    </div>
                  )}

                  <IconInput
                    icon={Link2}
                    type="text"
                    value={tweetUrl}
                    onChange={(e) => setTweetUrl(e.target.value)}
                    placeholder="https://x.com/you/status/..."
                  />

                  <button
                    onClick={handleTweetVerify}
                    disabled={verifyingTweet || !tweetUrl.trim()}
                    className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {verifyingTweet ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      'Verify & Unlock'
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <LoginModal
          isOpen={showLoginModal}
          onClose={() => setShowLoginModal(false)}
        />
      </div>
    );
  }

  // Generate meta tags for social sharing
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://www.rsv.pizza';
  const pageUrl = `${baseUrl}/${slug}`;
  const ogImageUrl = (() => {
    if (!event.eventImageUrl) return `${baseUrl}/logo.png`;
    if (event.eventImageUrl.startsWith('http')) return event.eventImageUrl;
    if (event.eventImageUrl.startsWith('/')) return `${baseUrl}${event.eventImageUrl}`;
    return `${baseUrl}/${event.eventImageUrl}`;
  })();

  const eventDate = event.date ? new Date(event.date) : null;
  const formattedDate = eventDate?.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: event.timezone || undefined,
  });
  const formattedTime = eventDate?.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: event.timezone || undefined,
  });

  // Calculate and format end time
  const endDate = eventDate && event.duration
    ? new Date(eventDate.getTime() + event.duration * 3600000)
    : null;
  const formattedEndTime = endDate?.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: event.timezone || undefined,
  });

  const timezoneAbbr = formatTimezoneDisplay(event.timezone || '');

  // Google Maps static map for location thumbnail
  const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const staticMapUrl = googleMapsApiKey && event.address
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(event.address)}&zoom=15&size=400x400&scale=2&markers=color:red%7C${encodeURIComponent(event.address)}&key=${googleMapsApiKey}`
    : null;
  const googleMapsUrl = event.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}`
    : null;

  const metaTitle = event.name;

  // Construct description: Host * Date @ Time * Location. Description
  const detailsParts: string[] = [];
  if (event.hostName) detailsParts.push(`Hosted by ${event.hostName}`);
  if (formattedDate) detailsParts.push(`${formattedDate}${formattedTime ? ` @ ${formattedTime}` : ''}`);
  if (event.address) detailsParts.push(event.address);

  const details = detailsParts.join(' \u2022 ');
  let metaDescription = details;

  if (event.description) {
    const cleanDescription = stripMarkdown(event.description);
    const remainingChars = 300 - details.length;
    if (remainingChars > 10) {
      metaDescription += `. ${cleanDescription.substring(0, remainingChars)}${cleanDescription.length > remainingChars ? '...' : ''}`;
    }
  } else if (!metaDescription) {
    metaDescription = `Join us for ${event.name}! RSVP now.`;
  }

  return (
    <div className="min-h-screen">
      <Helmet>
        {/* Primary Meta Tags */}
        <title>{metaTitle} | RSV.Pizza</title>
        <meta name="title" content={metaTitle} />
        <meta name="description" content={metaDescription} />

        {/* Open Graph / Facebook */}
        <meta property="og:site_name" content="RSV.Pizza" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:image" content={ogImageUrl} />


        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:url" content={pageUrl} />
        <meta name="twitter:title" content={metaTitle} />
        <meta name="twitter:description" content={metaDescription} />
        <meta name="twitter:image" content={ogImageUrl} />

        {/* Event specific */}
        {eventDate && (
          <>
            <meta property="event:start_time" content={eventDate.toISOString()} />
            {event.duration && (
              <meta
                property="event:end_time"
                content={new Date(eventDate.getTime() + event.duration * 3600000).toISOString()}
              />
            )}
          </>
        )}
        {event.address && <meta property="event:location" content={event.address} />}
      </Helmet>

      <Header variant="transparent" />

      {/* Edit Password Prompt Modal */}
      {showEditPasswordPrompt && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl p-8 max-w-md w-full">
            <div className="w-16 h-16 bg-[#ff393a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#ff393a]/30">
              <Lock className="w-8 h-8 text-[#ff393a]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2 text-center">Host Password Required</h1>
            <p className="text-white/60 mb-6 text-center">
              Enter the password you set when creating this event to edit it.
            </p>

            <form onSubmit={handleEditPasswordSubmit} className="space-y-3">
              {editPasswordError && (
                <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
                  {editPasswordError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={editPasswordInput}
                  onChange={(e) => setEditPasswordInput(e.target.value)}
                  placeholder="Enter password"
                  className="w-full"
                  required
                  autoFocus
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditPasswordPrompt(false);
                    setEditPasswordInput('');
                    setEditPasswordError(null);
                  }}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary flex-1"
                >
                  Continue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RSVP Modal */}
      {event && (
        <RSVPModal
          isOpen={showRSVPModal}
          onClose={() => setShowRSVPModal(false)}
          event={event}
          existingGuest={existingGuestData}
          onRSVPSuccess={async () => {
            // Always update the RSVP status after successful submission
            setUserHasRSVPd(true);
            // Refetch guest data if user is logged in
            if (user?.email && event) {
              const inviteCode = event.customUrl || event.inviteCode;
              const guestData = await getExistingGuest(inviteCode, user.email);
              setExistingGuestData(guestData);
            }
          }}
        />
      )}

      <div className="py-8 md:px-8">
        <div className="card overflow-hidden">
          <div className="grid md:grid-cols-[400px,1fr] gap-0 md:gap-8">
            {/* Left Column - Image and Host Info (Desktop only) */}
            <div className="hidden md:flex flex-col">
              {/* Square Image */}
              {event.eventImageUrl ? (
                <div className="relative aspect-square bg-black/30">
                  <img
                    src={event.eventImageUrl}
                    alt={event.name}
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <div className="relative aspect-square bg-gradient-to-br from-[#ff393a] to-[#ff6b35] flex items-center justify-center">
                  <Pizza className="w-32 h-32 text-white/30" />
                </div>
              )}

              {/* Host Button - Desktop */}
              {user && (user.id === event.userId || user.email?.toLowerCase() === 'hello@rarepizzas.com') && (
                <div className="p-4 bg-[#39d98a]/10 border-t border-white/10">
                  <button
                    onClick={handleEditEvent}
                    className="btn-secondary w-full flex items-center justify-center gap-2"
                  >
                    Host Dashboard
                    <Settings size={16} />
                  </button>
                </div>
              )}

              {/* Host and Guest Info */}
              <div className="p-6 border-t border-white/10">
                <HostsList
                  hostName={event.hostName}
                  hostProfile={event.hostProfile}
                  coHosts={event.coHosts}
                  size="md"
                />

                {/* Guest Count */}
                {!event.hideGuests && (
                  <div className="pt-4 border-t border-white/10 mt-4">
                    <div className="flex items-center gap-2 text-white/60 text-sm">
                      <Users className="w-4 h-4" />
                      <span>
                        {event.guestCount} {event.guestCount === 1 ? 'guest' : 'guests'}
                        {event.maxGuests && ` • ${event.maxGuests} expected`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column - Event Details */}
            <div className="flex flex-col">
              {/* Mobile-only sections */}
              <div className="md:hidden">
                {/* Square Image - Mobile */}
                {event.eventImageUrl ? (
                  <div className="relative aspect-square">
                    <img
                      src={event.eventImageUrl}
                      alt={event.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : event.address && googleMapsUrl ? (
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative aspect-square block overflow-hidden"
                  >
                    {staticMapUrl ? (
                      <img
                        src={staticMapUrl}
                        alt="Event location map"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#ff393a]/20 to-[#ff6b35]/20 flex items-center justify-center">
                        <div className="text-center">
                          <MapPin className="w-16 h-16 text-white/80 mx-auto mb-2" />
                          <p className="text-white/80 text-sm font-medium">View on Google Maps</p>
                        </div>
                      </div>
                    )}
                  </a>
                ) : (
                  <div className="relative aspect-square bg-gradient-to-br from-[#ff393a] to-[#ff6b35] flex items-center justify-center">
                    <Pizza className="w-32 h-32 text-white/30" />
                  </div>
                )}

                {/* Host Button - Mobile */}
                {user && (user.id === event.userId || user.email?.toLowerCase() === 'hello@rarepizzas.com') && (
                  <div className="p-4 bg-[#39d98a]/10 border-b border-white/10">
                    <button
                      onClick={handleEditEvent}
                      className="btn-secondary w-full flex items-center justify-center gap-2"
                    >
                      Host Dashboard
                      <Settings size={16} />
                    </button>
                  </div>
                )}
              </div>

              {/* Event Title */}
              <div className="p-6 pb-1 md:border-b md:border-white/10">
                {event.eventType === 'gpp' && (
                  <div className="mb-3">
                    <GPPBadge />
                  </div>
                )}
                <h1 className="text-4xl md:text-5xl font-bold text-white mb-0" style={{ fontFamily: "'Rubik', sans-serif" }}>{event.name}</h1>
              </div>

              {/* Mobile: Host Info */}
              <div
                className="md:hidden px-6 pt-1 pb-1 cursor-pointer"
                onClick={() => document.getElementById('host-section')?.scrollIntoView({ behavior: 'smooth' })}
              >
                <HostsAvatars
                  hostName={event.hostName}
                  hostProfile={event.hostProfile}
                  coHosts={event.coHosts}
                />
              </div>

              {/* Event Details */}
              <div className="p-6 pt-2 space-y-3 flex-1">
                {/* Desktop: Date, Location, and Map Thumbnail */}
                <div className="hidden md:flex items-start gap-4">
                  <div className="flex-1 space-y-3">
                    {/* Date & Time */}
                    {event.date && (
                      <div className="flex items-start gap-3">
                        <Calendar className="w-5 h-5 text-[#ff393a] flex-shrink-0 mt-1" />
                        <div>
                          <p className="text-lg font-medium text-white">
                            {formattedDate}
                          </p>
                          <p className="text-base text-white/60">
                            {formattedTime}
                            {formattedEndTime && ` - ${formattedEndTime}`}
                            {timezoneAbbr && ` ${timezoneAbbr}`}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Location */}
                    {event.address && googleMapsUrl && (
                      <a
                        href={googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-3 group"
                      >
                        <MapPin className="w-5 h-5 text-[#ff393a] flex-shrink-0 mt-1" />
                        <div>
                          {event.venueName && (
                            <p className="text-lg font-medium text-white group-hover:text-[#ff393a] transition-colors">{event.venueName}</p>
                          )}
                          <p className={`${event.venueName ? 'text-base text-white/60' : 'text-lg font-medium text-white group-hover:text-[#ff393a] transition-colors'}`}>{event.address}</p>
                        </div>
                      </a>
                    )}
                  </div>

                  {/* Map Thumbnail - Desktop */}
                  {event.address && googleMapsUrl && (
                    <a
                      href={googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 w-24 h-24 bg-white/10 rounded-lg border border-white/10 hover:bg-white/20 transition-colors group overflow-hidden relative"
                      title="View on Google Maps"
                    >
                      {staticMapUrl ? (
                        <img
                          src={staticMapUrl}
                          alt="Map"
                          className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center">
                          <MapPin size={24} className="text-[#ff393a] mb-1 group-hover:scale-110 transition-transform" />
                          <span className="text-[10px] uppercase font-bold text-white/70">View Map</span>
                        </div>
                      )}
                    </a>
                  )}
                </div>

                {/* Mobile: Date & Time */}
                {event.date && (
                  <div className="md:hidden flex items-start gap-3">
                    <Calendar className="w-5 h-5 text-[#ff393a] flex-shrink-0 mt-1" />
                    <div>
                      <p className="text-lg font-medium text-white">
                        {formattedDate}
                      </p>
                      <p className="text-base text-white/60">
                        {formattedTime}
                        {formattedEndTime && ` - ${formattedEndTime}`}
                        {timezoneAbbr && ` ${timezoneAbbr}`}
                      </p>
                    </div>
                  </div>
                )}

                {/* Mobile: Location */}
                {event.address && googleMapsUrl && (
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="md:hidden flex items-start gap-3 group"
                  >
                    <MapPin className="w-5 h-5 text-[#ff393a] flex-shrink-0 mt-1" />
                    <div>
                      {event.venueName && (
                        <p className="text-lg font-medium text-white group-hover:text-[#ff393a] transition-colors">{event.venueName}</p>
                      )}
                      <p className={`${event.venueName ? 'text-base text-white/60' : 'text-lg font-medium text-white group-hover:text-[#ff393a] transition-colors'}`}>{event.address}</p>
                    </div>
                  </a>
                )}

                {/* RSVP Button */}
                <div className="pt-4">
                  <button
                    onClick={handleRSVP}
                    className="w-full btn-primary flex items-center justify-center gap-2 text-lg py-4"
                  >
                    <Pizza size={20} />
                    {userHasRSVPd ? "Edit RSVP" : "RSVP"}
                  </button>
                  {event.rsvpClosedAt && (
                    <p className="text-center text-white/50 text-sm mt-3">
                      RSVPs are closed for this event
                    </p>
                  )}
                </div>

                {/* Guest Count - Mobile */}
                {!event.hideGuests && (
                  <div className="md:hidden pt-4 border-t border-white/10">
                    <div className="flex items-center gap-2 text-white/60 text-sm">
                      <Users className="w-4 h-4" />
                      <span>
                        {event.guestCount} {event.guestCount === 1 ? 'guest' : 'guests'}
                        {event.maxGuests && ` • ${event.maxGuests} expected`}
                      </span>
                    </div>
                  </div>
                )}

                {/* Description */}
                {event.description && (
                  <div className="border-t border-white/10 pt-4 mt-4">
                    <div className="text-white/80 leading-relaxed prose prose-invert prose-lg max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkBreaks]}
                        components={{
                          a: ({ node, ...props }) => (
                            <a {...props} className="text-[#ff393a] hover:text-[#ff5a5b] font-semibold no-underline" target="_blank" rel="noopener noreferrer" />
                          ),
                          p: ({ node, ...props }) => (
                            <p {...props} className="mb-3 last:mb-0" />
                          ),
                          ul: ({ node, ...props }) => (
                            <ul {...props} className="list-disc list-inside mb-3 space-y-1" />
                          ),
                          ol: ({ node, ...props }) => (
                            <ol {...props} className="list-decimal list-inside mb-3 space-y-1" />
                          ),
                          h1: ({ node, ...props }) => (
                            <h1 {...props} className="text-xl font-bold text-white mt-4 mb-2 first:mt-0" />
                          ),
                          h2: ({ node, ...props }) => (
                            <h2 {...props} className="text-lg font-bold text-white mt-4 mb-2 first:mt-0" />
                          ),
                          h3: ({ node, ...props }) => (
                            <h3 {...props} className="text-base font-semibold text-white mt-3 mb-2 first:mt-0" />
                          ),
                          strong: ({ node, ...props }) => (
                            <strong {...props} className="font-semibold text-white" />
                          ),
                          em: ({ node, ...props }) => (
                            <em {...props} className="italic" />
                          ),
                          blockquote: ({ node, ...props }) => (
                            <blockquote {...props} className="border-l-4 border-[#ff393a] pl-4 my-3 italic" />
                          ),
                          code: ({ node, inline, ...props }) =>
                            inline ? (
                              <code {...props} className="bg-white/10 px-1.5 py-0.5 rounded text-xs font-mono" />
                            ) : (
                              <code {...props} className="block bg-white/10 p-3 rounded text-xs font-mono overflow-x-auto my-3" />
                            ),
                        }}
                      >
                        {event.description}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* Mobile: Location Section */}
                {event.address && googleMapsUrl && (
                  <div className="md:hidden border-t border-white/10 pt-6 mt-6">
                    {event.venueName && (
                      <p className="text-white font-medium mb-1">{event.venueName}</p>
                    )}
                    <p className={`${event.venueName ? 'text-white/60 text-sm' : 'text-white font-medium'} mb-3`}>{event.address}</p>
                    {/* Google Maps Link */}
                    <a
                      href={googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full h-48 bg-white/5 rounded-lg overflow-hidden relative group hover:opacity-90 transition-opacity"
                    >
                      {staticMapUrl ? (
                        <img
                          src={staticMapUrl}
                          alt="Event location map"
                          className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#ff393a]/20 to-[#ff6b35]/20">
                          <div className="text-center">
                            <MapPin className="w-12 h-12 text-white/80 mx-auto mb-2" />
                            <p className="text-white/80 text-sm font-medium">View on Google Maps</p>
                          </div>
                        </div>
                      )}
                    </a>
                  </div>
                )}

                {/* Mobile: Full Host Section */}
                <div id="host-section" className="md:hidden border-t border-white/10 pt-6 mt-6">
                  <HostsList
                    hostName={event.hostName}
                    hostProfile={event.hostProfile}
                    coHosts={event.coHosts}
                    size="lg"
                    showTitle={true}
                  />
                </div>

                {/* Photo Gallery Section */}
                {photoStats?.photosEnabled && (
                  <div className="border-t border-white/10 pt-6 mt-6">
                    {showPhotos ? (
                      <PhotoGallery
                        partyId={event.id}
                        isHost={false}
                        uploaderName={existingGuestData?.name || user?.name || undefined}
                        uploaderEmail={existingGuestData?.email || user?.email}
                        guestId={existingGuestData?.id}
                      />
                    ) : (
                      <button
                        onClick={() => setShowPhotos(true)}
                        className="w-full flex items-center justify-center gap-3 py-4 bg-white/5 hover:bg-white/10 rounded-xl transition-colors border border-white/10"
                      >
                        <Camera className="w-5 h-5 text-[#ff393a]" />
                        <span className="text-white font-medium">
                          {photoStats.totalPhotos > 0
                            ? `View Photos (${photoStats.totalPhotos})`
                            : 'Share Photos'}
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <Footer className="mt-8 pb-2" />
      </div>

      <CornerLinks />

      {/* Pizza Chef Easter Egg Modal */}
      <PizzaChefModal
        isOpen={showPizzaChef}
        onClose={() => setShowPizzaChef(false)}
      />

      {/* PizzaDAO Easter Egg Modal */}
      <PizzaDAOModal
        isOpen={showPizzaDAO}
        onClose={() => setShowPizzaDAO(false)}
      />
    </div>
  );
}
