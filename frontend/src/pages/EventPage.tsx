import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Calendar, Clock, MapPin, Users, User, Pizza, Loader2, Lock, AlertCircle, Settings, Globe, Instagram } from 'lucide-react';
import { getPartyByInviteCodeOrCustomUrl, DbParty } from '../lib/supabase';

export function EventPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [party, setParty] = useState<DbParty | null>(null);

  // Password protection state
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showEditPasswordPrompt, setShowEditPasswordPrompt] = useState(false);
  const [editPasswordInput, setEditPasswordInput] = useState('');
  const [editPasswordError, setEditPasswordError] = useState<string | null>(null);

  useEffect(() => {
    async function loadParty() {
      if (slug) {
        const foundParty = await getPartyByInviteCodeOrCustomUrl(slug);
        if (foundParty) {
          setParty(foundParty);

          // Check if party has password protection
          if (foundParty.password) {
            // Check if already authenticated in this session
            // Use invite_code as key to be consistent with RSVPPage
            const authKey = `rsvpizza_auth_${foundParty.invite_code}`;
            const storedAuth = sessionStorage.getItem(authKey);
            if (storedAuth === foundParty.password) {
              setIsAuthenticated(true);
            }
          } else {
            // No password, automatically authenticated
            setIsAuthenticated(true);
          }
        } else {
          setError('Event not found. The link may be invalid or expired.');
        }
      }
      setLoading(false);
    }
    loadParty();
  }, [slug]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!party?.password) return;

    if (passwordInput === party.password) {
      // Correct password
      setIsAuthenticated(true);
      setPasswordError(null);
      // Store in session storage to avoid re-prompting
      // Use invite_code as key to be consistent with RSVPPage
      const authKey = `rsvpizza_auth_${party.invite_code}`;
      sessionStorage.setItem(authKey, party.password);
    } else {
      // Wrong password
      setPasswordError('Incorrect password. Please try again.');
      setPasswordInput('');
    }
  };

  const handleRSVP = () => {
    const rsvpUrl = party?.custom_url
      ? `/rsvp/${party.custom_url}`
      : `/rsvp/${party?.invite_code}`;
    navigate(rsvpUrl);
  };

  const handleEditEvent = () => {
    if (!party) return;

    // If no password, just navigate to host page
    if (!party.password) {
      navigate(`/host/${party.invite_code}`);
      return;
    }

    // Show password prompt
    setShowEditPasswordPrompt(true);
  };

  const handleEditPasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!party?.password) return;

    if (editPasswordInput === party.password) {
      // Correct password - navigate to host page
      navigate(`/host/${party.invite_code}`);
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

  if (error || !party) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card p-8 max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-[#ff393a] mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Event Not Found</h1>
          <p className="text-white/60 mb-6">{error}</p>
          <a href="/rsv-pizza/" className="btn-primary inline-block">
            Go to Home
          </a>
        </div>
      </div>
    );
  }

  // Show password prompt if party is password-protected and not authenticated
  if (party.password && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card p-8 max-w-md">
          <div className="w-16 h-16 bg-[#ff393a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#ff393a]/30">
            <Lock className="w-8 h-8 text-[#ff393a]" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2 text-center">Password Required</h1>
          <p className="text-white/60 mb-6 text-center">
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

            <button
              type="submit"
              className="w-full btn-primary"
            >
              Continue
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Generate meta tags for social sharing
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://www.rsv.pizza';
  const pageUrl = `${baseUrl}/${slug}`;
  const ogImageUrl = (() => {
    if (!party.event_image_url) return `${baseUrl}/logo.png`;
    if (party.event_image_url.startsWith('http')) return party.event_image_url;
    if (party.event_image_url.startsWith('/')) return `${baseUrl}${party.event_image_url}`;
    return `${baseUrl}/${party.event_image_url}`;
  })();

  const eventDate = party.date ? new Date(party.date) : null;
  const formattedDate = eventDate?.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: party.timezone || undefined,
  });
  const formattedTime = eventDate?.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: party.timezone || undefined,
  });

  // Get timezone abbreviation for display
  const getTimezoneAbbr = () => {
    if (!party.timezone || !eventDate) return '';
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: party.timezone,
        timeZoneName: 'short'
      });
      const parts = formatter.formatToParts(eventDate);
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      return tzPart?.value || '';
    } catch {
      return '';
    }
  };
  const timezoneAbbr = getTimezoneAbbr();

  const metaTitle = party.name;

  // Construct description: Host • Date @ Time • Location. Description
  const detailsParts: string[] = [];
  if (party.host_name) detailsParts.push(`Hosted by ${party.host_name}`);
  if (formattedDate) detailsParts.push(`${formattedDate}${formattedTime ? ` @ ${formattedTime}` : ''}`);
  if (party.address) detailsParts.push(party.address);

  const details = detailsParts.join(' • ');
  let metaDescription = details;

  if (party.description) {
    const remainingChars = 300 - details.length;
    if (remainingChars > 10) {
      metaDescription += `. ${party.description.substring(0, remainingChars)}${party.description.length > remainingChars ? '...' : ''}`;
    }
  } else if (!metaDescription) {
    metaDescription = `Join us for ${party.name}! RSVP now.`;
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
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />

        {/* Twitter */}
        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:url" content={pageUrl} />
        <meta property="twitter:title" content={metaTitle} />
        <meta property="twitter:description" content={metaDescription} />
        <meta property="twitter:image" content={ogImageUrl} />

        {/* Event specific */}
        {eventDate && (
          <>
            <meta property="event:start_time" content={eventDate.toISOString()} />
            {party.duration && (
              <meta
                property="event:end_time"
                content={new Date(eventDate.getTime() + party.duration * 3600000).toISOString()}
              />
            )}
          </>
        )}
        {party.address && <meta property="event:location" content={party.address} />}
      </Helmet>

      {/* Header with Logo */}
      <header className="border-b border-white/10 bg-black/20 backdrop-blur-sm fixed top-0 left-0 right-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <img
              src="/logo.png"
              alt="RSV.Pizza"
              className="h-8 sm:h-10"
            />
          </Link>
          <button
            onClick={handleEditEvent}
            className="btn-secondary text-sm px-4 py-2 flex items-center gap-2"
          >
            <Settings size={16} />
            <span className="hidden sm:inline">Edit Event</span>
          </button>
        </div>
      </header>

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

      <div className="max-w-6xl mx-auto px-4 py-8 pt-24">
        <div className="card overflow-hidden">
          <div className="grid md:grid-cols-[400px,1fr] gap-0">
            {/* Left Column - Image and Host Info (Desktop only) */}
            <div className="hidden md:flex flex-col">
              {/* Square Image */}
              {party.event_image_url ? (
                <div className="relative aspect-square bg-black/30">
                  <img
                    src={party.event_image_url}
                    alt={party.name}
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <div className="relative aspect-square bg-gradient-to-br from-[#ff393a] to-[#ff6b35] flex items-center justify-center">
                  <Pizza className="w-32 h-32 text-white/30" />
                </div>
              )}

              {/* Host and Guest Info */}
              <div className="p-6 border-t border-white/10">
                <h3 className="text-sm font-semibold text-white/60 mb-3">Hosted By</h3>

                {/* All Hosts - Primary Host + Co-Hosts in one list */}
                <div className="space-y-3">
                  {/* Primary Host */}
                  {party.host_name && (
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#ff393a]/20 flex items-center justify-center flex-shrink-0">
                        <User className="w-5 h-5 text-[#ff393a]" />
                      </div>
                      <span className="text-white font-medium">{party.host_name}</span>
                    </div>
                  )}

                  {/* Co-Hosts */}
                  {party.co_hosts && party.co_hosts.filter(h => h.showOnEvent !== false).length > 0 && (
                    <>
                      {party.co_hosts.filter(h => h.showOnEvent !== false).map((coHost) => (
                        <div key={coHost.id} className="flex items-center gap-3">
                          {coHost.avatar_url ? (
                            <img
                              src={coHost.avatar_url}
                              alt={coHost.name}
                              className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-[#ff393a]/20 flex items-center justify-center flex-shrink-0">
                              <User className="w-5 h-5 text-[#ff393a]" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-medium">{coHost.name}</p>
                            {(coHost.website || coHost.twitter || coHost.instagram) && (
                              <div className="flex items-center gap-2 mt-0.5">
                                {coHost.website && (
                                  <a
                                    href={coHost.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-white/50 hover:text-white transition-colors"
                                  >
                                    <Globe size={14} />
                                  </a>
                                )}
                                {coHost.twitter && (
                                  <a
                                    href={`https://twitter.com/${coHost.twitter}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-white/50 hover:text-white transition-colors"
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                    </svg>
                                  </a>
                                )}
                                {coHost.instagram && (
                                  <a
                                    href={`https://instagram.com/${coHost.instagram}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-white/50 hover:text-white transition-colors"
                                  >
                                    <Instagram size={14} />
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {/* Guest Count */}
                <div className="pt-4 border-t border-white/10 mt-4">
                  <div className="flex items-center gap-2 text-white/60 text-sm">
                    <Users className="w-4 h-4" />
                    <span>
                      {party.guests?.length || 0} {party.guests?.length === 1 ? 'guest' : 'guests'}
                      {party.max_guests && ` • ${party.max_guests} expected`}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - Event Details */}
            <div className="flex flex-col">
              {/* Mobile-only sections */}
              <div className="md:hidden">
                {/* Square Image - Mobile */}
                {party.event_image_url ? (
                  <div className="relative aspect-square bg-black/30">
                    <img
                      src={party.event_image_url}
                      alt={party.name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="relative aspect-square bg-gradient-to-br from-[#ff393a] to-[#ff6b35] flex items-center justify-center">
                    <Pizza className="w-32 h-32 text-white/30" />
                  </div>
                )}

                {/* Host Button - Mobile */}
                <div className="p-4 bg-[#39d98a]/10 border-b border-white/10">
                  <p className="text-sm text-white/60 mb-2">You have host access for this event.</p>
                  <button
                    onClick={handleEditEvent}
                    className="btn-secondary w-full flex items-center justify-center gap-2"
                  >
                    Host Dashboard
                    <Settings size={16} />
                  </button>
                </div>
              </div>

              {/* Event Title */}
              <div className="p-6 md:border-b md:border-white/10">
                <h1 className="text-3xl font-bold text-white mb-2">{party.name}</h1>
              </div>

              {/* Mobile: Host Info */}
              <div className="md:hidden px-6 pt-3 pb-2">
                <div className="flex items-center gap-3">
                  {/* Overlapping avatars */}
                  <div className="flex items-center" style={{ marginLeft: '8px' }}>
                    {/* Primary host avatar */}
                    {party.host_name && (
                      <div className="w-8 h-8 rounded-full bg-[#ff393a] flex items-center justify-center flex-shrink-0 border-2 border-black relative" style={{ zIndex: 10, marginLeft: '-8px' }}>
                        <User className="w-4 h-4 text-white" />
                      </div>
                    )}
                    {/* Co-host avatars (first 6) */}
                    {party.co_hosts && party.co_hosts.filter(h => h.showOnEvent !== false).slice(0, 6).map((coHost, index) => (
                      <div key={coHost.id} style={{ zIndex: 9 - index, marginLeft: '-8px' }}>
                        {coHost.avatar_url ? (
                          <img
                            src={coHost.avatar_url}
                            alt={coHost.name}
                            className="w-8 h-8 rounded-full object-cover flex-shrink-0 border-2 border-black"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-[#ff393a] flex items-center justify-center flex-shrink-0 border-2 border-black">
                            <User className="w-4 h-4 text-white" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Host text */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">
                      Hosted by <span className="font-medium">{party.host_name}</span>
                      {party.co_hosts && party.co_hosts.filter(h => h.showOnEvent !== false).length > 0 && (
                        <> & {party.co_hosts.filter(h => h.showOnEvent !== false).length} other{party.co_hosts.filter(h => h.showOnEvent !== false).length > 1 ? 's' : ''}</>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Event Details */}
              <div className="p-6 space-y-3 flex-1">
                {/* Date & Time */}
                {party.date && (
                  <div className="flex items-start gap-3">
                    <Calendar className="w-5 h-5 text-[#ff393a] flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-white">
                        {formattedDate}
                      </p>
                      <p className="text-sm text-white/60">
                        {formattedTime}
                        {timezoneAbbr && ` ${timezoneAbbr}`}
                        {party.duration && ` • ${party.duration} hour${party.duration !== 1 ? 's' : ''}`}
                      </p>
                    </div>
                  </div>
                )}

                {/* Location - Desktop only */}
                {party.address && (
                  <div className="hidden md:flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-[#ff393a] flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-white">{party.address}</p>
                    </div>
                  </div>
                )}

                {/* RSVP Button */}
                <div className="pt-4">
                  <button
                    onClick={handleRSVP}
                    className="w-full btn-primary flex items-center justify-center gap-2 text-lg py-4"
                  >
                    <Pizza size={20} />
                    RSVP
                  </button>
                  {party.rsvp_closed_at && (
                    <p className="text-center text-white/50 text-sm mt-3">
                      RSVPs are closed for this event
                    </p>
                  )}
                </div>

                {/* Guest Count - Mobile */}
                <div className="md:hidden pt-4 border-t border-white/10">
                  <div className="flex items-center gap-2 text-white/60 text-sm">
                    <Users className="w-4 h-4" />
                    <span>
                      {party.guests?.length || 0} {party.guests?.length === 1 ? 'guest' : 'guests'}
                      {party.max_guests && ` • ${party.max_guests} expected`}
                    </span>
                  </div>
                </div>

                {/* Description */}
                {party.description && (
                  <div className="border-t border-white/10 pt-4 mt-4">
                    <h3 className="font-semibold text-white mb-2">About This Event</h3>
                    <div className="text-white/70 text-sm leading-relaxed prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ node, ...props }) => (
                            <a {...props} className="text-[#ff393a] hover:text-[#ff5a5b] underline" target="_blank" rel="noopener noreferrer" />
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
                        {party.description}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* Mobile: Location Section */}
                {party.address && (
                  <div className="md:hidden border-t border-white/10 pt-6 mt-6">
                    <h3 className="font-semibold text-white mb-4">Location</h3>
                    <p className="text-white font-medium mb-3">{party.address}</p>
                    {/* Google Maps Link */}
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(party.address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full h-48 bg-white/5 rounded-lg overflow-hidden relative group hover:opacity-90 transition-opacity"
                    >
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#ff393a]/20 to-[#ff6b35]/20">
                        <div className="text-center">
                          <MapPin className="w-12 h-12 text-white/80 mx-auto mb-2" />
                          <p className="text-white/80 text-sm font-medium">View on Google Maps</p>
                        </div>
                      </div>
                    </a>
                  </div>
                )}

                {/* Mobile: Full Host Section */}
                <div className="md:hidden border-t border-white/10 pt-6 mt-6">
                  <h3 className="font-semibold text-white mb-4">Hosted By</h3>
                  <div className="space-y-3">
                    {/* Primary Host */}
                    {party.host_name && (
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 rounded-full bg-[#ff393a] flex items-center justify-center flex-shrink-0">
                          <User className="w-6 h-6 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold text-lg">{party.host_name}</p>
                        </div>
                      </div>
                    )}

                    {/* Co-Hosts */}
                    {party.co_hosts && party.co_hosts.filter(h => h.showOnEvent !== false).length > 0 && (
                      <>
                        {party.co_hosts.filter(h => h.showOnEvent !== false).map((coHost) => (
                          <div key={coHost.id} className="flex items-start gap-3">
                            {coHost.avatar_url ? (
                              <img
                                src={coHost.avatar_url}
                                alt={coHost.name}
                                className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-full bg-[#ff393a] flex items-center justify-center flex-shrink-0">
                                <User className="w-6 h-6 text-white" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-semibold text-lg">{coHost.name}</p>
                              {(coHost.website || coHost.twitter || coHost.instagram) && (
                                <div className="flex items-center gap-3 mt-2">
                                  {coHost.website && (
                                    <a
                                      href={coHost.website}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-white/50 hover:text-white transition-colors"
                                    >
                                      <Globe size={18} />
                                    </a>
                                  )}
                                  {coHost.twitter && (
                                    <a
                                      href={`https://twitter.com/${coHost.twitter}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-white/50 hover:text-white transition-colors"
                                    >
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                      </svg>
                                    </a>
                                  )}
                                  {coHost.instagram && (
                                    <a
                                      href={`https://instagram.com/${coHost.instagram}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-white/50 hover:text-white transition-colors"
                                    >
                                      <Instagram size={18} />
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1 mt-8 pb-8">
          <span className="text-white/40 text-sm">Powered by</span>
          <a
            href="https://pizzadao.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:opacity-80 transition-opacity"
          >
            <img
              src="/pizzadao-logo.svg"
              alt="PizzaDAO"
              className="h-7"
            />
          </a>
        </div>
      </div>
    </div>
  );
}
