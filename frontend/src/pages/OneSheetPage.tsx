import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  User, Mail, Building2, MessageCircle, MapPin, Calendar,
  Users, Eye, Handshake, CheckCircle, Loader2,
} from 'lucide-react';
import { getEventBySlug, PublicEvent, submitOneSheetInterest } from '../lib/api';
import { cdnUrl } from '../lib/supabase';
import { IconInput } from '../components/IconInput';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';

const themeClass = 'gpp-theme';
const backgroundStyle = { background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)' } as React.CSSProperties;

export function OneSheetPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState<PublicEvent | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadEvent() {
      if (!slug) return;
      const result = await getEventBySlug(slug);

      // Handle redirect from old slug alias
      if (result && 'redirect' in result) {
        navigate(`/onesheet/${result.slug}`, { replace: true });
        return;
      }

      setEvent(result);
      setLoading(false);
    }
    loadEvent();
  }, [slug, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug) return;

    setSubmitting(true);
    setError(null);

    try {
      await submitOneSheetInterest(slug, { name, email, company, message: message || undefined });
      setSubmitted(true);
    } catch (err: any) {
      if (err.status === 409) {
        setError("You've already expressed interest in partnering with this event.");
      } else {
        setError(err.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Format date/time with timezone
  const formatEventDateTime = () => {
    if (!event?.date) return null;
    const d = new Date(event.date);
    const opts: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      ...(event.timezone ? { timeZone: event.timezone } : {}),
    };
    return d.toLocaleDateString('en-US', opts);
  };

  // OG image URL
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const ogImageUrl = (() => {
    if (!event?.eventImageUrl) return `${baseUrl}/logo.png`;
    if (event.eventImageUrl.startsWith('http')) return event.eventImageUrl;
    if (event.eventImageUrl.startsWith('/')) return `${baseUrl}${event.eventImageUrl}`;
    return `${baseUrl}/${event.eventImageUrl}`;
  })();

  if (loading) {
    return (
      <div className={`min-h-screen ${themeClass} flex items-center justify-center`} style={backgroundStyle}>
        <Loader2 className="w-8 h-8 animate-spin text-white/40" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Event Not Found</h1>
          <p className="text-white/50">The event you're looking for doesn't exist or has been removed.</p>
        </div>
        <Footer />
      </div>
    );
  }

  const rsvpCount = event.guestCount ?? 0;
  const totalViews = event.pageViewStats?.totalViews ?? 0;
  const partnerCount = event.sponsors?.length ?? 0;
  const sponsorsWithLogos = (event.sponsors || []).filter(s => s.logoUrl);

  const ogDescription = [
    event.venueName,
    event.address,
    formatEventDateTime(),
  ].filter(Boolean).join(' | ');

  return (
    <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
      <Helmet>
        <title>{event.name} - Partner One Sheet</title>
        <meta property="og:title" content={`${event.name} - Partner One Sheet`} />
        <meta property="og:image" content={ogImageUrl} />
        <meta property="og:description" content={ogDescription} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${event.name} - Partner One Sheet`} />
        <meta name="twitter:image" content={ogImageUrl} />
      </Helmet>

      <Header />

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Flyer Image */}
        {event.eventImageUrl && (
          <div className="rounded-xl overflow-hidden">
            <img
              src={cdnUrl(event.eventImageUrl)}
              alt={event.name}
              className="w-full object-contain"
            />
          </div>
        )}

        {/* Event Info */}
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-white">{event.name}</h1>

          {(event.venueName || event.address) && (
            <div className="flex items-start gap-2 text-white/70">
              <MapPin size={18} className="mt-0.5 flex-shrink-0 text-white/40" />
              <span>
                {event.venueName}
                {event.venueName && event.address ? ' — ' : ''}
                {event.address}
              </span>
            </div>
          )}

          {event.date && (
            <div className="flex items-center gap-2 text-white/70">
              <Calendar size={18} className="flex-shrink-0 text-white/40" />
              <span>{formatEventDateTime()}</span>
            </div>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
            <Users size={20} className="mx-auto mb-1 text-white/40" />
            <div className="text-2xl font-bold text-white">{rsvpCount.toLocaleString()}</div>
            <div className="text-xs text-white/40 mt-0.5">RSVPs</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
            <Eye size={20} className="mx-auto mb-1 text-white/40" />
            <div className="text-2xl font-bold text-white">{totalViews.toLocaleString()}</div>
            <div className="text-xs text-white/40 mt-0.5">Page Views</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
            <Handshake size={20} className="mx-auto mb-1 text-white/40" />
            <div className="text-2xl font-bold text-white">{partnerCount.toLocaleString()}</div>
            <div className="text-xs text-white/40 mt-0.5">Partners</div>
          </div>
        </div>

        {/* Partner Logos */}
        {sponsorsWithLogos.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-white/80">Partners</h2>
            <div className="flex flex-wrap items-center gap-4">
              {sponsorsWithLogos.map((sponsor) => {
                const img = (
                  <img
                    key={sponsor.id}
                    src={cdnUrl(sponsor.logoUrl!)}
                    alt={sponsor.name}
                    className="h-12 w-auto object-contain rounded"
                  />
                );
                if (sponsor.website) {
                  return (
                    <a
                      key={sponsor.id}
                      href={sponsor.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={sponsor.name}
                    >
                      {img}
                    </a>
                  );
                }
                return img;
              })}
            </div>
          </div>
        )}

        {/* Interest Form */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-5">
          {submitted ? (
            <div className="flex flex-col items-center py-8 text-center space-y-3">
              <CheckCircle size={48} className="text-green-400" />
              <h2 className="text-xl font-bold text-white">Thank you!</h2>
              <p className="text-white/60">
                We've received your interest and will be in touch soon.
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-white">Interested in Partnering?</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <IconInput
                  icon={User}
                  placeholder="Your name"
                  required
                  value={name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                />
                <IconInput
                  icon={Mail}
                  placeholder="Email address"
                  type="email"
                  required
                  value={email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                />
                <IconInput
                  icon={Building2}
                  placeholder="Company / brand"
                  required
                  value={company}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompany(e.target.value)}
                />
                <IconInput
                  icon={MessageCircle}
                  placeholder="Message (optional)"
                  multiline
                  rows={3}
                  value={message}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
                />

                {error && (
                  <p className="text-sm text-red-400">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 rounded-lg bg-[#E52828] text-white font-semibold hover:bg-[#CC2020] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    'Submit Interest'
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
