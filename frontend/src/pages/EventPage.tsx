import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { MapPin, Users, Pizza, Loader2, Lock, AlertCircle, Settings, Heart, Camera, Link2, LogIn, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { verifyPartyPassword, isUserGuestAtParty, getExistingGuest, ExistingGuestData } from '../lib/supabase';
import { getEventBySlug, PublicEvent, getPhotoStats, verifyTweet, trackLinkClick } from '../lib/api';
import { IconInput } from '../components/IconInput';
import { HostsList, HostsAvatars } from '../components/HostsList';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { CornerLinks } from '../components/CornerLinks';
import { GPPClouds } from '../components/GPPClouds';
import { useAuth } from '../contexts/AuthContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { RSVPModal } from '../components/RSVPModal';
import { DonationStep } from '../components/DonationStep';
import { LoginModal } from '../components/LoginModal';
import { PhotoGallery } from '../components/photos';
import { GPPBadge } from '../components/gpp';
import { MusicWidget } from '../components/music';
import { PhotoStats } from '../types';
import { PizzaChefModal } from '../components/PizzaChefModal';
import { PizzaDAOModal } from '../components/PizzaDAOModal';
import { stripMarkdown } from '../lib/utils';
import { formatTimezoneDisplay } from '../utils/dateUtils';
import { useConfetti } from '../hooks/useConfetti';
import { AddToCalendarPopup } from '../components/AddToCalendarPopup';
import { ParticipatingPizzerias } from '../components/ParticipatingPizzerias';
import { LastYearPhotos } from '../components/LastYearPhotos';
import VenueMap from '../components/VenueMap';
import { CheckInButton } from '../components/CheckInButton';
import { GuestScorecard } from '../components/scorecard';

function normalizeTelegramUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      if (!/(^|\.)t\.me$/i.test(u.hostname) && !/(^|\.)telegram\.me$/i.test(u.hostname)) return null;
      return u.toString();
    } catch {
      return null;
    }
  }

  const noScheme = trimmed.match(/^(?:t\.me|telegram\.me)\/(.+)$/i);
  if (noScheme) {
    return `https://t.me/${noScheme[1].replace(/^\/+/, '')}`;
  }

  const bare = trimmed.replace(/^@/, '');
  if (/^[A-Za-z0-9_+\-]{3,}$/.test(bare)) {
    return `https://t.me/${bare}`;
  }

  return null;
}

export function EventPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, i18n } = useTranslation('event');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDonationModal, setShowDonationModal] = useState(false);
  const [event, setEvent] = useState<PublicEvent | null>(null);

  // Password protection state
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showEditPasswordPrompt, setShowEditPasswordPrompt] = useState(false);
  const [editPasswordInput, setEditPasswordInput] = useState('');
  const [editPasswordError, setEditPasswordError] = useState<string | null>(null);
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const [showRSVPModal, setShowRSVPModal] = useState(false);
  const [userHasRSVPd, setUserHasRSVPd] = useState(false);
  const [existingGuestData, setExistingGuestData] = useState<ExistingGuestData | null>(null);
  const [photoStats, setPhotoStats] = useState<PhotoStats | null>(null);
  const [showPhotos, setShowPhotos] = useState(false);
  const [showPizzaChef, setShowPizzaChef] = useState(false);
  const [showPizzaDAO, setShowPizzaDAO] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [canEditAsCoHost, setCanEditAsCoHost] = useState(false);
  const [isHostUser, setIsHostUser] = useState(false);
  const [showTweetInput, setShowTweetInput] = useState(false);
  const [tweetUrl, setTweetUrl] = useState('');
  const [tweetError, setTweetError] = useState<string | null>(null);
  const [verifyingTweet, setVerifyingTweet] = useState(false);
  const { fire: fireConfetti, ConfettiOverlay } = useConfetti();
  const [showCalendarPopup, setShowCalendarPopup] = useState(false);
  const calendarAnchorRef = useRef<HTMLDivElement>(null);

  // Sticky RSVP button on mobile: show when inline button is scrolled above the viewport.
  // Uses a scroll listener instead of IntersectionObserver because IO won't fire when an
  // element moves between two non-intersecting states (below-fold to above-fold on fast scroll).
  const mobileRsvpRef = useRef<HTMLButtonElement>(null);
  const [showStickyRsvp, setShowStickyRsvp] = useState(false);

  useEffect(() => {
    const el = mobileRsvpRef.current;
    if (!el) return;

    let ticking = false;
    const check = () => {
      const rect = el.getBoundingClientRect();
      setShowStickyRsvp(rect.top < 0);
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(check);
        ticking = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    check(); // initial check

    return () => window.removeEventListener('scroll', onScroll);
  }, [event, isAuthenticated]);

  useEffect(() => {
    async function loadEvent() {
      if (slug) {
        const result = await getEventBySlug(slug);

        // Handle redirect from old slug alias
        if (result && 'redirect' in result) {
          navigate(`/${result.slug}`, { replace: true });
          return;
        }

        const foundEvent = result;
        if (foundEvent) {
          setEvent(foundEvent);
          setCanEditAsCoHost(false);

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
          let isHost = user?.id === foundEvent.userId;
          if (!isHost && user?.email) {
            try {
              const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
              const resp = await fetch(`${apiUrl}/api/events/${slug}/check-host`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: user.email }),
              });
              if (resp.ok) {
                const data = await resp.json();
                isHost = data.isHost;
                setCanEditAsCoHost(data.canEdit || false);
              }
            } catch (e) {
              console.warn('Could not check host status:', e);
            }
          }

          // Store host status for check-in button
          setIsHostUser(isHost);

          // Skip password for hosts and already-RSVP'd guests
          if (isHost || hasRSVPd) {
            setIsAuthenticated(true);
          } else if (foundEvent.hasPassword) {
            // Check if already authenticated in this session
            // Use inviteCode as key to be consistent with RSVPPage
            const authKey = `rsvpizza_auth_${foundEvent.inviteCode}`;
            const storedAuth = sessionStorage.getItem(authKey);

            if (storedAuth) {
              const isValid = await verifyPartyPassword(slug!, storedAuth);
              if (isValid) {
                setIsAuthenticated(true);
              }
            }
          } else {
            // No password, automatically authenticated
            setIsAuthenticated(true);
          }

          // Fire-and-forget page view tracking
          const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
          fetch(`${apiUrl}/api/events/${slug}/view`, {
            method: 'POST',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ referrer: document.referrer || null }),
          }).catch(() => {});

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

    setVerifyingPassword(true);
    setPasswordError(null);

    const isValid = await verifyPartyPassword(slug!, passwordInput);

    if (isValid) {
      setIsAuthenticated(true);
      const authKey = `rsvpizza_auth_${event.inviteCode}`;
      sessionStorage.setItem(authKey, passwordInput);
    } else {
      setPasswordError('Incorrect password. Please try again.');
      setPasswordInput('');
    }
    setVerifyingPassword(false);
  };

  const handleRSVP = () => {
    // porchetta-81402: defense-in-depth. The button is replaced with a
    // cancellation card when `cancelledAt` is set, so this branch only
    // fires if a caller bypasses the UI (e.g. a stale tab cached the old
    // button). Drop the call rather than open a modal that would 410.
    if (event?.cancelledAt) return;
    setShowRSVPModal(true);
  };

  const handleEditEvent = () => {
    if (!event) return;
    navigate(`/host/${event.inviteCode}`);
  };

  const handleEditPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!event?.hasPassword) return;

    const isValid = await verifyPartyPassword(slug!, editPasswordInput);

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
          <h1 className="text-2xl font-bold text-theme-text mb-2">{t('notFound.title')}</h1>
          <p className="text-theme-text-secondary mb-6">{error}</p>
          <Link to="/" className="btn-primary inline-block">
            {t('notFound.goHome')}
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
          <h1 className="text-2xl font-bold text-theme-text mb-2 text-center">{t('password.title')}</h1>
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
              placeholder={t('password.placeholder')}
              required
              autoFocus
              autoComplete="off"
              data-testid="password-input"
            />

            <button
              type="submit"
              className="w-full btn-primary"
              disabled={verifyingPassword}
              data-testid="password-submit"
            >
              {verifyingPassword ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> {t('password.verifying')}
                </span>
              ) : t('password.continue')}
            </button>
          </form>

          {/* Already RSVP'd? Log in */}
          {!user && (
            <div className="mt-4">
              <button
                onClick={() => setShowLoginModal(true)}
                className="w-full flex items-center justify-center gap-2 py-3 bg-black hover:bg-black/80 text-theme-text rounded-xl border border-theme-stroke transition-colors"
              >
                <LogIn className="w-4 h-4" />
                {t('password.alreadyRsvpd')}
              </button>
            </div>
          )}

          {/* Post to Get In */}
          {event.shareToUnlock && (
            <div className="mt-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-theme-surface-hover" />
                <span className="text-theme-text-muted text-sm">{t('password.or')}</span>
                <div className="flex-1 h-px bg-theme-surface-hover" />
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
                  className="w-full flex items-center justify-center gap-2 py-3 bg-black hover:bg-black/80 text-theme-text rounded-xl border border-theme-stroke transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  {t('password.postToGetIn')}
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-theme-text-secondary text-sm text-center">
                    {t('password.pasteTweetUrl')}
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
                        {t('password.verifying')}
                      </>
                    ) : (
                      t('password.verifyUnlock')
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

  // Extract month abbreviation and day number for calendar icon
  const eventMonthAbbr = eventDate
    ? eventDate.toLocaleDateString('en-US', { month: 'short', timeZone: event.timezone || undefined }).toUpperCase()
    : '';
  const eventDayNum = eventDate
    ? eventDate.toLocaleDateString('en-US', { day: 'numeric', timeZone: event.timezone || undefined })
    : '';

  const isFutureEvent = eventDate ? eventDate.getTime() > Date.now() : false;

  // Check-in: visible 1hr before event start through 1hr after event end (or +4hr if no duration)
  const isEventDay = (() => {
    if (!eventDate) return false;
    const now = Date.now();
    const startWindow = eventDate.getTime() - 60 * 60 * 1000; // 1hr before
    const durationMs = (event?.duration || 4) * 3600000;
    const endWindow = eventDate.getTime() + durationMs + 60 * 60 * 1000; // 1hr after end
    return now >= startWindow && now <= endWindow;
  })();

  // Show check-in: event day + (RSVPd guest or host)
  const showCheckIn = isEventDay && user && (userHasRSVPd || isHostUser);

  const handleCheckIn = (checkedInAt: string) => {
    setExistingGuestData((prev) =>
      prev ? { ...prev, checkedInAt } : prev
    );
  };

  // Interactive Google Maps JS SDK venue thumbnail (see VenueMap component).
  // Per Google's Maps Universal URL spec, `/maps/search/?api=1` with both
  // `query` and `query_place_id` opens the canonical place card. `/maps/place/?api=1`
  // is not a valid action and Google falls back to a generic IP-located map view.
  // Skip query_place_id for Google's address-shell IDs (prefixes Ei…/Ek…), which
  // are autocomplete fallbacks that don't resolve to a Maps place page. Fall
  // back to address alone, then to lat/lng if no address.
  const hasCanonicalPlaceId = event.placeId?.startsWith('ChIJ') ?? false;
  const googleMapsUrl = hasCanonicalPlaceId && event.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}&query_place_id=${event.placeId}`
    : event.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}`
      : event.latitude && event.longitude
        ? `https://www.google.com/maps/search/?api=1&query=${event.latitude},${event.longitude}`
        : null;

  const telegramLink = normalizeTelegramUrl(event.telegramGroup);

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

  const isGPP = event?.eventType === 'gpp';
  const themeClass = isGPP ? 'gpp-theme' : '';
  const backgroundStyle = isGPP ? { background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)' } as React.CSSProperties : undefined;

  return (
    <ThemeProvider theme={isGPP ? 'gpp' : 'dark'}>
    <div
      className={`min-h-screen ${themeClass}`}
      style={backgroundStyle}
      onClick={(e) => { if (isGPP) fireConfetti(e.clientX, e.clientY); }}
    >
      {isGPP && <GPPClouds />}
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
      {showEditPasswordPrompt && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl p-8 max-w-md w-full">
            <div className="w-16 h-16 bg-[#ff393a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#ff393a]/30">
              <Lock className="w-8 h-8 text-[#ff393a]" />
            </div>
            <h1 className="text-2xl font-bold text-theme-text mb-2 text-center">{t('editPassword.title')}</h1>
            <p className="text-theme-text-secondary mb-6 text-center">
              {t('editPassword.subtitle')}
            </p>

            <form onSubmit={handleEditPasswordSubmit} className="space-y-3">
              {editPasswordError && (
                <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
                  {editPasswordError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-theme-text mb-2">
                  {t('editPassword.label')}
                </label>
                <input
                  type="password"
                  value={editPasswordInput}
                  onChange={(e) => setEditPasswordInput(e.target.value)}
                  placeholder={t('editPassword.placeholder')}
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
                  {t('editPassword.cancel')}
                </button>
                <button
                  type="submit"
                  className="btn-primary flex-1"
                >
                  {t('editPassword.continue')}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
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

      <div className="max-w-[1212px] mx-auto py-8 px-4">
        {/* porchetta-81402: cancelled banner. Shown above the event card so
            visitors see the cancel state before anything else. Past RSVPers
            still see the full event details below — the page is preserved. */}
        {event.cancelledAt && (
          <div
            className="mb-6 rounded-2xl border border-[#ff393a]/50 bg-[#ff393a]/10 p-6 text-center"
            data-testid="event-cancelled-banner"
          >
            <h2 className="text-2xl font-bold text-[#ff5a5b]">{t('cancelled.bannerTitle')}</h2>
            {event.cancellationReason && (
              <p className="mt-2 text-base text-theme-text-secondary">
                <span className="font-medium text-theme-text">{t('cancelled.reasonLabel')}:</span>{' '}
                {event.cancellationReason}
              </p>
            )}
          </div>
        )}
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
              {user && (user.id === event.userId || user.email?.toLowerCase() === 'hello@rarepizzas.com' || canEditAsCoHost) && (
                <div className="p-4 border-t border-theme-stroke">
                  <button
                    onClick={handleEditEvent}
                    className="btn-secondary w-full flex items-center justify-center gap-2"
                  >
                    {t('hostDashboard')}
                    <Settings size={16} />
                  </button>
                </div>
              )}

              {/* Donate Button - Desktop */}
              {event.donationEnabled && (
                <div className="p-4 border-t border-theme-stroke">
                  <button
                    onClick={() => setShowDonationModal(true)}
                    className="btn-secondary w-full flex items-center justify-center gap-2"
                  >
                    <Heart size={16} />
                    {t('donate')}
                  </button>
                  <p className="text-theme-text-secondary text-sm text-center mt-1">
                    {event.donationRecipient ? (
                      <>{ t('buyPizzaFor', { recipient: '' }) }{event.donationRecipientUrl ? <a href={event.donationRecipientUrl} target="_blank" rel="noopener noreferrer" className="text-[#ff393a] hover:text-[#ff6b6b] underline transition-colors" onClick={() => slug && trackLinkClick(slug, event.donationRecipientUrl!, 'donation', event.donationRecipient || 'donation_recipient')}>{event.donationRecipient}</a> : event.donationRecipient}</>
                    ) : t('buyPizzaForEvent', { eventName: event.name })}
                  </p>
                </div>
              )}

              {/* Host and Guest Info */}
              <div className="p-6 border-t border-theme-stroke">
                <HostsList
                  hostName={event.hostName}
                  hostProfile={event.hostProfile}
                  coHosts={event.coHosts}
                  size="md"
                  onLinkClick={slug ? (url, label) => trackLinkClick(slug, url, 'host_social', label) : undefined}
                />

                {/* Guest Count */}
                {!event.hideGuests && (() => {
                  const isGpp = event.eventType === 'gpp';
                  if (!isGpp) {
                    return (
                      <div className="pt-4 border-t border-theme-stroke mt-4">
                        <div className="flex items-center gap-2 text-theme-text-secondary text-sm">
                          <Users className="w-4 h-4" />
                          <span>
                            {t('guest', { count: event.guestCount })}
                            {event.maxGuests && ` / ${event.maxGuests}`}
                          </span>
                          {event.maxGuests && event.guestCount >= event.maxGuests && (
                            <span className="text-[#ffc107] text-xs">{t('waitlistOpen')}</span>
                          )}
                          {event.maxGuests && event.guestCount < event.maxGuests && (
                            <span className="text-theme-text-muted text-xs">
                              {t('spotsLeft', { count: event.maxGuests - event.guestCount })}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  }
                  const spotsRemaining = event.maxGuests != null ? event.maxGuests - event.guestCount : null;
                  const isSoldOut = spotsRemaining != null && spotsRemaining <= 0;
                  const showSpotsLeft = spotsRemaining != null && spotsRemaining > 0 && spotsRemaining < 20;
                  if (!isSoldOut && !showSpotsLeft) return null;
                  return (
                    <div className="pt-4 border-t border-theme-stroke mt-4">
                      <div className="flex items-center gap-2 text-theme-text-secondary text-sm">
                        <Users className="w-4 h-4" />
                        {isSoldOut && (
                          <span className="text-[#ffc107] text-xs">{t('waitlistOpen')}</span>
                        )}
                        {showSpotsLeft && (
                          <span className="text-theme-text-muted text-xs">
                            {t('spotsLeft', { count: spotsRemaining! })}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
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
                ) : event.address ? (
                  <div className="relative aspect-square overflow-hidden">
                    <VenueMap
                      address={event.address}
                      venueName={event.venueName}
                      latitude={event.latitude}
                      longitude={event.longitude}
                      className="w-full h-full"
                    />
                  </div>
                ) : (
                  <div className="relative aspect-square bg-gradient-to-br from-[#ff393a] to-[#ff6b35] flex items-center justify-center">
                    <Pizza className="w-32 h-32 text-white/30" />
                  </div>
                )}

                {/* Host Button - Mobile */}
                {user && (user.id === event.userId || user.email?.toLowerCase() === 'hello@rarepizzas.com' || canEditAsCoHost) && (
                  <div className="p-4 border-b border-theme-stroke">
                    <button
                      onClick={handleEditEvent}
                      className="btn-secondary w-full flex items-center justify-center gap-2"
                    >
                      {t('hostDashboard')}
                      <Settings size={16} />
                    </button>
                  </div>
                )}
              </div>

              {/* Event Title */}
              <div className="p-6 md:border-b md:border-theme-stroke">
                {event.eventType === 'gpp' && (
                  <div className="mb-3">
                    <GPPBadge community={event.underbossStatus === 'listed'} />
                  </div>
                )}
                <h1 className="text-4xl md:text-5xl font-bold text-theme-text mb-0" data-testid="event-name" style={{ fontFamily: "'Rubik', sans-serif" }}>{event.name}</h1>
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
                {/* Desktop: Date, Location, RSVP, and Map Thumbnail */}
                <div className="hidden md:block relative">
                  <div className="w-[58%] space-y-3">
                    {/* Date & Time */}
                    {event.date && (
                      <div className="relative">
                        <div
                          ref={calendarAnchorRef}
                          className={`flex items-start gap-3 group${isFutureEvent ? ' cursor-pointer' : ''}`}
                          data-testid="event-date"
                          onClick={isFutureEvent ? () => setShowCalendarPopup((v) => !v) : undefined}
                        >
                          {/* Stylized calendar page icon */}
                          <div className={`flex-shrink-0 w-11 h-12 rounded-lg border border-theme-stroke overflow-hidden flex flex-col shadow-sm${isFutureEvent ? ' group-hover:border-[#ff393a] transition-colors' : ''}`}>
                            <div className="bg-[#ff393a] text-white text-[9px] font-bold tracking-wider text-center py-0.5 leading-tight">
                              {eventMonthAbbr}
                            </div>
                            <div className="flex-1 bg-theme-surface flex items-center justify-center">
                              <span className="text-lg font-bold text-theme-text leading-none">{eventDayNum}</span>
                            </div>
                          </div>
                          <div className="flex-1">
                            <p className={`text-lg font-medium text-theme-text${isFutureEvent ? ' group-hover:text-[#ff393a] transition-colors' : ''}`}>
                              {formattedDate}
                            </p>
                            <p className={`text-base text-theme-text-secondary${isFutureEvent ? ' group-hover:text-[#ff393a] transition-colors' : ''}`}>
                              {formattedTime}
                              {formattedEndTime && ` - ${formattedEndTime}`}
                              {timezoneAbbr && ` ${timezoneAbbr}`}
                            </p>
                          </div>
                        </div>
                        {isFutureEvent && (
                          <AddToCalendarPopup
                            isOpen={showCalendarPopup}
                            onClose={() => setShowCalendarPopup(false)}
                            event={event}
                            anchorRef={calendarAnchorRef}
                          />
                        )}
                      </div>
                    )}

                    {/* Location */}
                    {event.address && googleMapsUrl && (
                      <a
                        href={googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-3 group"
                        data-testid="event-address"
                      >
                        {/* MapPin inside rounded square border */}
                        <div className="flex-shrink-0 w-11 h-12 rounded-lg border border-theme-stroke bg-theme-surface flex items-center justify-center mt-0.5 group-hover:border-[#ff393a] transition-colors">
                          <MapPin className="w-5 h-5 text-theme-text" />
                        </div>
                        <div>
                          {event.venueName && (
                            <p className="text-lg font-medium text-theme-text group-hover:text-[#ff393a] transition-colors">{event.venueName}</p>
                          )}
                          <p className={`${event.venueName ? 'text-base text-theme-text-secondary' : 'text-lg font-medium text-theme-text group-hover:text-[#ff393a] transition-colors'}`}>{event.address}</p>
                        </div>
                      </a>
                    )}

                    {/* Telegram group */}
                    {telegramLink && (
                      <a
                        href={telegramLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => slug && trackLinkClick(slug, telegramLink, 'telegram')}
                        className="flex items-start gap-3 group"
                        data-testid="event-telegram"
                      >
                        <div className="flex-shrink-0 w-11 h-12 rounded-lg border border-theme-stroke bg-theme-surface flex items-center justify-center mt-0.5 group-hover:border-[#ff393a] transition-colors">
                          <Send className="w-5 h-5 text-theme-text" />
                        </div>
                        <div>
                          <p className="text-lg font-medium text-theme-text group-hover:text-[#ff393a] transition-colors">
                            {t('telegramGroup')}
                          </p>
                        </div>
                      </a>
                    )}

                    {/* RSVP Button (+ Check In) - Desktop
                        porchetta-81402: replace with cancelled-card when the
                        host has cancelled the event. Check-in button is also
                        hidden — historical check-in records still exist via
                        the dedicated /checkin route. */}
                    <div className="pt-1">
                      {event.cancelledAt ? (
                        <div
                          className="w-full rounded-xl border border-[#ff393a]/30 bg-[#ff393a]/5 px-4 py-3 text-center"
                          data-testid="rsvp-cancelled-card-desktop"
                        >
                          <p className="text-base font-medium text-[#ff5a5b]">{t('cancelled.noticeTitle')}</p>
                          <p className="text-sm text-theme-text-secondary mt-1">{t('cancelled.noticeBody')}</p>
                        </div>
                      ) : showCheckIn ? (
                        <div className="flex gap-2">
                          <button
                            ref={mobileRsvpRef}
                            data-testid="rsvp-button-desktop"
                            onClick={(e) => {
                              if (isGPP) {
                                const rect = e.currentTarget.getBoundingClientRect();
                                fireConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
                              }
                              handleRSVP();
                            }}
                            className="flex-1 btn-primary flex items-center justify-center gap-2 text-base py-3"
                          >
                            {userHasRSVPd ? t('editRsvp') : t('rsvp')}
                          </button>
                          <CheckInButton
                            inviteCode={event.customUrl || event.inviteCode}
                            guestId={existingGuestData?.id || ''}
                            checkedInAt={existingGuestData?.checkedInAt || null}
                            isHost={isHostUser}
                            guestName={existingGuestData?.name || user?.name || ''}
                            onCheckIn={handleCheckIn}
                          />
                        </div>
                      ) : (
                        <button
                          ref={mobileRsvpRef}
                          data-testid="rsvp-button-desktop"
                          onClick={(e) => {
                            if (isGPP) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              fireConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
                            }
                            handleRSVP();
                          }}
                          className="w-full btn-primary flex items-center justify-center gap-2 text-base py-3"
                        >
                          {userHasRSVPd ? t('editRsvp') : t('rsvp')}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Map Thumbnail - Desktop (absolutely positioned to match left column height) */}
                  {event.address && (
                    <div
                      className="absolute right-0 top-0 bottom-0 w-[40%] bg-theme-surface-hover rounded-lg border border-theme-stroke overflow-hidden"
                    >
                      <VenueMap
                        address={event.address}
                        venueName={event.venueName}
                        latitude={event.latitude}
                        longitude={event.longitude}
                        className="w-full h-full"
                      />
                    </div>
                  )}
                </div>

                {/* Mobile: Date & Time */}
                {event.date && (
                  <div
                    className={`md:hidden flex items-start gap-3 group${isFutureEvent ? ' cursor-pointer' : ''}`}
                    onClick={isFutureEvent ? () => setShowCalendarPopup((v) => !v) : undefined}
                  >
                    {/* Stylized calendar page icon */}
                    <div className={`flex-shrink-0 w-11 h-12 rounded-lg border border-theme-stroke overflow-hidden flex flex-col shadow-sm${isFutureEvent ? ' group-hover:border-[#ff393a] transition-colors' : ''}`}>
                      <div className="bg-[#ff393a] text-white text-[9px] font-bold tracking-wider text-center py-0.5 leading-tight">
                        {eventMonthAbbr}
                      </div>
                      <div className="flex-1 bg-theme-surface flex items-center justify-center">
                        <span className="text-lg font-bold text-theme-text leading-none">{eventDayNum}</span>
                      </div>
                    </div>
                    <div className="flex-1">
                      <p className="text-lg font-medium text-theme-text">
                        {formattedDate}
                      </p>
                      <p className="text-base text-theme-text-secondary">
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
                    {/* MapPin inside rounded square border */}
                    <div className="flex-shrink-0 w-11 h-12 rounded-lg border border-theme-stroke bg-theme-surface flex items-center justify-center mt-0.5 group-hover:border-[#ff393a] transition-colors">
                      <MapPin className="w-5 h-5 text-theme-text" />
                    </div>
                    <div>
                      {event.venueName && (
                        <p className="text-lg font-medium text-theme-text group-hover:text-[#ff393a] transition-colors">{event.venueName}</p>
                      )}
                      <p className={`${event.venueName ? 'text-base text-theme-text-secondary' : 'text-lg font-medium text-theme-text group-hover:text-[#ff393a] transition-colors'}`}>{event.address}</p>
                    </div>
                  </a>
                )}

                {/* Mobile: Telegram group */}
                {telegramLink && (
                  <a
                    href={telegramLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => slug && trackLinkClick(slug, telegramLink, 'telegram')}
                    className="md:hidden flex items-start gap-3 group"
                  >
                    <div className="flex-shrink-0 w-11 h-12 rounded-lg border border-theme-stroke bg-theme-surface flex items-center justify-center mt-0.5 group-hover:border-[#ff393a] transition-colors">
                      <Send className="w-5 h-5 text-theme-text" />
                    </div>
                    <div>
                      <p className="text-lg font-medium text-theme-text group-hover:text-[#ff393a] transition-colors">
                        {t('telegramGroup')}
                      </p>
                    </div>
                  </a>
                )}

                {/* RSVP Button (+ Check In) - Mobile only
                    porchetta-81402: same cancelled treatment as desktop. */}
                <div className="pt-4 md:hidden">
                  {event.cancelledAt ? (
                    <div
                      className="w-[85%] mx-auto rounded-xl border border-[#ff393a]/30 bg-[#ff393a]/5 px-4 py-3 text-center"
                      data-testid="rsvp-cancelled-card-mobile"
                    >
                      <p className="text-base font-medium text-[#ff5a5b]">{t('cancelled.noticeTitle')}</p>
                      <p className="text-sm text-theme-text-secondary mt-1">{t('cancelled.noticeBody')}</p>
                    </div>
                  ) : showCheckIn ? (
                    <div className="flex gap-2 w-[85%] mx-auto">
                      <button
                        data-testid="rsvp-button"
                        onClick={(e) => {
                          if (isGPP) {
                            const rect = e.currentTarget.getBoundingClientRect();
                            fireConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
                          }
                          handleRSVP();
                        }}
                        className="flex-1 btn-primary flex items-center justify-center gap-2 text-lg py-4"
                      >
                        {userHasRSVPd ? t('editRsvp') : t('rsvp')}
                      </button>
                      <CheckInButton
                        inviteCode={event.customUrl || event.inviteCode}
                        guestId={existingGuestData?.id || ''}
                        checkedInAt={existingGuestData?.checkedInAt || null}
                        isHost={isHostUser}
                        guestName={existingGuestData?.name || user?.name || ''}
                        onCheckIn={handleCheckIn}
                      />
                    </div>
                  ) : (
                    <button
                      data-testid="rsvp-button"
                      onClick={(e) => {
                        if (isGPP) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          fireConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
                        }
                        handleRSVP();
                      }}
                      className="w-[85%] mx-auto btn-primary flex items-center justify-center gap-2 text-lg py-4"
                    >
                      {userHasRSVPd ? t('editRsvp') : t('rsvp')}
                    </button>
                  )}
                </div>
                {event.rsvpClosedAt && (
                  <p className="text-theme-text-muted text-sm">
                    {t('rsvpsClosed')}
                  </p>
                )}

                {/* Guest Scorecard - shown after check-in on event day */}
                {isEventDay && existingGuestData?.checkedInAt && (
                  <GuestScorecard inviteCode={event.customUrl || event.inviteCode} />
                )}

                {/* Guest Count - Mobile */}
                {!event.hideGuests && (() => {
                  const isGpp = event.eventType === 'gpp';
                  if (!isGpp) {
                    return (
                      <div className="md:hidden pt-4 border-t border-theme-stroke">
                        <div className="flex items-center gap-2 text-theme-text-secondary text-sm">
                          <Users className="w-4 h-4" />
                          <span>
                            {t('guest', { count: event.guestCount })}
                            {event.maxGuests && ` / ${event.maxGuests}`}
                          </span>
                          {event.maxGuests && event.guestCount >= event.maxGuests && (
                            <span className="text-[#ffc107] text-xs">{t('waitlistOpen')}</span>
                          )}
                          {event.maxGuests && event.guestCount < event.maxGuests && (
                            <span className="text-theme-text-muted text-xs">
                              {t('spotsLeft', { count: event.maxGuests - event.guestCount })}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  }
                  const spotsRemaining = event.maxGuests != null ? event.maxGuests - event.guestCount : null;
                  const isSoldOut = spotsRemaining != null && spotsRemaining <= 0;
                  const showSpotsLeft = spotsRemaining != null && spotsRemaining > 0 && spotsRemaining < 20;
                  if (!isSoldOut && !showSpotsLeft) return null;
                  return (
                    <div className="md:hidden pt-4 border-t border-theme-stroke">
                      <div className="flex items-center gap-2 text-theme-text-secondary text-sm">
                        <Users className="w-4 h-4" />
                        {isSoldOut && (
                          <span className="text-[#ffc107] text-xs">{t('waitlistOpen')}</span>
                        )}
                        {showSpotsLeft && (
                          <span className="text-theme-text-muted text-xs">
                            {t('spotsLeft', { count: spotsRemaining! })}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Description + Sponsor Blurbs */}
                {(event.description || (event.sponsors && event.sponsors.filter(s => s.brandDescription).length > 0)) && (
                  <div className="border-y border-theme-stroke/50 py-4 mt-4">
                    <div className="text-theme-text leading-relaxed prose prose-invert prose-lg max-w-none">
                      {event.description && (() => {
                        const isDefaultGpp = event.description!.startsWith('On May 22, 2010, two pizzas changed the world');
                        const displayDescription = (isDefaultGpp && i18n.language !== 'en') ? t('gppDefaultDescription') : event.description!;
                        return (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkBreaks]}
                          components={{
                            a: ({ node, ...props }) => (
                              <a
                                {...props}
                                className="text-[#ff393a] hover:text-[#ff5a5b] font-semibold no-underline"
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => {
                                  if (slug && props.href) {
                                    trackLinkClick(slug, props.href, 'description', typeof props.children === 'string' ? props.children : undefined);
                                  }
                                }}
                              />
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
                              <h1 {...props} className="text-xl font-bold text-theme-text mt-4 mb-2 first:mt-0" />
                            ),
                            h2: ({ node, ...props }) => (
                              <h2 {...props} className="text-lg font-bold text-theme-text mt-4 mb-2 first:mt-0" />
                            ),
                            h3: ({ node, ...props }) => (
                              <h3 {...props} className="text-base font-semibold text-theme-text mt-3 mb-2 first:mt-0" />
                            ),
                            strong: ({ node, ...props }) => (
                              <strong {...props} className="font-semibold text-theme-text" />
                            ),
                            em: ({ node, ...props }) => (
                              <em {...props} className="italic" />
                            ),
                            blockquote: ({ node, ...props }) => (
                              <blockquote {...props} className="border-l-4 border-[#ff393a] pl-4 my-3 italic" />
                            ),
                            code: ({ node, inline, ...props }) =>
                              inline ? (
                                <code {...props} className="bg-theme-surface-hover px-1.5 py-0.5 rounded text-xs font-mono" />
                              ) : (
                                <code {...props} className="block bg-theme-surface-hover p-3 rounded text-xs font-mono overflow-x-auto my-3" />
                              ),
                            img: ({ node, ...props }) => (
                              <img
                                {...props}
                                className="rounded-lg max-w-full h-auto my-3"
                                loading="lazy"
                                style={{ maxHeight: '400px', objectFit: 'contain' }}
                              />
                            ),
                          }}
                        >
                          {displayDescription}
                        </ReactMarkdown>
                        );
                      })()}
                      <div className={event.description ? 'mt-4 pt-4 border-t border-theme-stroke/50' : ''}>
                        {/* PizzaDAO — always first */}
                        <p className="mb-2 last:mb-0 text-base">
                          <strong>
                            <a
                              href="https://pizzadao.org"
                              className="text-[#ff393a] hover:text-[#ff5a5b] font-semibold no-underline"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              PizzaDAO
                            </a>
                          </strong>{' '}
                          {' '}{t('pizzadaoDescription')}
                        </p>
                        {event.sponsors && event.sponsors
                          .filter(s => s.brandDescription)
                          .map(sponsor => {
                            const sponsorKey = ({ 'ENS': 'ens', 'Brave': 'brave', 'World Pizza Champions': 'wpc', 'Own The Doge': 'ownTheDoge', 'Stand With Crypto EU': 'swcEu' } as Record<string, string>)[sponsor.name];
                            const desc = sponsorKey ? t(`sponsorDescription.${sponsorKey}`) : sponsor.brandDescription;
                            return (
                            <p key={sponsor.id} className="mb-2 last:mb-0 text-base">
                              <strong>
                                {sponsor.website ? (
                                  <a
                                    href={sponsor.website}
                                    className="text-[#ff393a] hover:text-[#ff5a5b] font-semibold no-underline"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => slug && trackLinkClick(slug, sponsor.website!, 'sponsor', sponsor.name)}
                                  >
                                    {sponsor.name}
                                  </a>
                                ) : (
                                  sponsor.name
                                )}
                              </strong>{' '}
                              {desc}
                            </p>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Mobile: Location Section */}
                {event.address && (
                  <div className="md:hidden border-t border-theme-stroke pt-6 mt-6">
                    {event.venueName && (
                      <p className="text-theme-text font-medium mb-1">{event.venueName}</p>
                    )}
                    <a href={googleMapsUrl!} target="_blank" rel="noopener noreferrer" className={`${event.venueName ? 'text-theme-text-secondary text-sm' : 'text-theme-text font-medium'} mb-3 block hover:underline`}>{event.address}</a>
                    {/* Interactive venue map */}
                    <div className="block w-full h-48 bg-theme-surface rounded-lg overflow-hidden relative">
                      <VenueMap
                        address={event.address}
                        venueName={event.venueName}
                        latitude={event.latitude}
                        longitude={event.longitude}
                        className="w-full h-full"
                      />
                    </div>
                  </div>
                )}

                {/* Donate Button - Mobile */}
                {event.donationEnabled && (
                  <div className="md:hidden border-t border-theme-stroke pt-6 mt-6">
                    <button
                      onClick={() => setShowDonationModal(true)}
                      className="btn-secondary w-full flex items-center justify-center gap-2"
                    >
                      <Heart size={16} />
                      Donate
                    </button>
                    <p className="text-theme-text-secondary text-sm text-center mt-1">
                      {event.donationRecipient ? (
                        <>{t('supportingRecipient', { recipient: '' })}{event.donationRecipientUrl ? <a href={event.donationRecipientUrl} target="_blank" rel="noopener noreferrer" className="text-[#ff393a] hover:text-[#ff6b6b] underline transition-colors" onClick={() => slug && trackLinkClick(slug, event.donationRecipientUrl!, 'donation', event.donationRecipient || 'donation_recipient')}>{event.donationRecipient}</a> : event.donationRecipient}</>
                      ) : t('supportingEvent', { eventName: event.name })}
                    </p>
                  </div>
                )}

                {/* Mobile: Full Host Section */}
                <div id="host-section" className="md:hidden border-t border-theme-stroke pt-6 mt-6">
                  <HostsList
                    hostName={event.hostName}
                    hostProfile={event.hostProfile}
                    coHosts={event.coHosts}
                    size="lg"
                    showTitle={true}
                    onLinkClick={slug ? (url, label) => trackLinkClick(slug, url, 'host_social', label) : undefined}
                  />
                </div>

                {/* Music Lineup Section */}
                <MusicWidget isHost={false} partyId={event.id} className="border-t border-theme-stroke pt-6 mt-6" />

                {/* Participating Pizzerias Section */}
                {event.selectedPizzerias && event.selectedPizzerias.length > 0 && (
                  <ParticipatingPizzerias
                    pizzerias={event.selectedPizzerias}
                    venueAddress={event.address}
                    eventSlug={slug}
                  />
                )}

                {/* Last Year's Party Photos — GPP events only */}
                {event.eventType === 'gpp' && event.customUrl && (
                  <LastYearPhotos
                    customUrl={event.customUrl}
                    hiddenGppPhotos={event.hiddenGppPhotos}
                    extraGppPhotos={event.extraGppPhotos}
                  />
                )}

                {/* Photo Gallery Section - only for confirmed guests */}
                {photoStats?.photosEnabled && existingGuestData?.status === 'CONFIRMED' && (
                  <div className="border-t border-theme-stroke pt-6 mt-6">
                    {showPhotos ? (
                      <PhotoGallery
                        partyId={event.id}
                        isHost={false}
                        photoModeration={true}
                        uploaderName={existingGuestData?.name || user?.name || undefined}
                        uploaderEmail={existingGuestData?.email || user?.email}
                        guestId={existingGuestData?.id}
                      />
                    ) : (
                      <button
                        onClick={() => setShowPhotos(true)}
                        className="w-full flex items-center justify-center gap-3 py-4 bg-theme-surface hover:bg-theme-surface-hover rounded-xl transition-colors border border-theme-stroke"
                      >
                        <Camera className="w-5 h-5 text-[#ff393a]" />
                        <span className="text-theme-text font-medium">
                          {photoStats.totalPhotos > 0
                            ? t('viewPhotos', { count: photoStats.totalPhotos })
                            : t('sharePhotos')}
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

      {/* Donation Modal */}
      {showDonationModal && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowDonationModal(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <DonationStep
              partyId={event.id}
              partyName={event.name}
              onComplete={() => setShowDonationModal(false)}
              onSkip={() => setShowDonationModal(false)}
            />
          </div>
        </div>,
        document.body
      )}

      {/* Sticky RSVP button — mobile only, appears when inline button scrolls out of view.
          porchetta-81402: hidden on cancelled events to mirror the inline button. */}
      {showStickyRsvp && !event.cancelledAt && (
        <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-theme-card/95 backdrop-blur-sm border-b border-theme-stroke px-4 py-2.5">
          {showCheckIn ? (
            <div className="flex gap-2">
              <button
                onClick={(e) => {
                  if (isGPP) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    fireConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
                  }
                  handleRSVP();
                }}
                className="flex-1 btn-primary flex items-center justify-center gap-2 text-sm py-2.5"
              >
                {userHasRSVPd ? t('editRsvp') : t('rsvp')}
              </button>
              <CheckInButton
                inviteCode={event!.customUrl || event!.inviteCode}
                guestId={existingGuestData?.id || ''}
                checkedInAt={existingGuestData?.checkedInAt || null}
                isHost={isHostUser}
                guestName={existingGuestData?.name || user?.name || ''}
                onCheckIn={handleCheckIn}
              />
            </div>
          ) : (
            <button
              onClick={(e) => {
                if (isGPP) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  fireConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
                }
                handleRSVP();
              }}
              className="w-full btn-primary flex items-center justify-center gap-2 text-sm py-2.5"
            >
              {userHasRSVPd ? t('editRsvp') : t('rsvp')}
            </button>
          )}
        </div>
      )}

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

      {ConfettiOverlay}
    </div>
    </ThemeProvider>
  );
}
