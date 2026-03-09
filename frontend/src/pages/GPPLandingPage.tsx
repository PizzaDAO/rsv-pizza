import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { CheckCircle, Loader2, ArrowRight, MessageCircle, BookOpen, HelpCircle } from 'lucide-react';
import { CornerLinks } from '../components/CornerLinks';
import { LocationAutocomplete, CityData } from '../components/LocationAutocomplete';
import { createGPPEvent } from '../lib/api';

/* ── colour tokens (from the 2026 flyer) ────────────────── */
const C = {
  skyTop:    '#7EC8E3',
  skyBot:    '#B6E4F7',
  red:       '#E52828',
  redHover:  '#CC2020',
  green:     '#2E7D32',
  yellow:    '#FFD600',
  darkText:  '#1a1a1a',
  mutedText: '#555',
  cardBg:    'rgba(255,255,255,0.92)',
  cardBorder:'rgba(0,0,0,0.08)',
};


export function GPPLandingPage() {
  const navigate = useNavigate();
  const [city, setCity] = useState('');
  const [hostName, setHostName] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ hostPageUrl: string; eventName: string; email: string } | null>(null);
  const cityDataRef = useRef<CityData | null>(null);

  const handleCitySelected = (data: CityData) => {
    cityDataRef.current = data;
    setCity(data.cityName);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const cd = cityDataRef.current;
      const response = await createGPPEvent({
        city: city.trim(),
        hostName: hostName.trim(),
        email: email.trim(),
        ...(cd && {
          country: cd.country,
          countryCode: cd.countryCode,
          cityLat: cd.lat,
          cityLng: cd.lng,
        }),
      });

      if (response.success) {
        setSuccess({
          hostPageUrl: response.hostPageUrl,
          eventName: response.event.name,
          email: email.trim(),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ──────────────── SUCCESS STATE ──────────────── */
  if (success) {
    return (
      <div
        className="min-h-screen"
        style={{ background: `linear-gradient(180deg, ${C.skyTop} 0%, ${C.skyBot} 100%)` }}
      >
        <Helmet>
          <title>Event Created! | Global Pizza Party</title>
        </Helmet>

        {/* dark header on light background */}
        <header className="border-b border-black/10 bg-white/40 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <img src="/logo.png" alt="RSV.Pizza" className="h-8 sm:h-10" />
              <span
                className="hidden sm:inline"
                style={{ fontFamily: "'Bangers', cursive", fontSize: '1.3rem', color: C.darkText }}
              >
                RSV.Pizza
              </span>
            </a>
          </div>
        </header>

        <div className="flex items-center justify-center min-h-[calc(100vh-80px)] px-4 py-12 relative">
          <div className="max-w-lg w-full text-center">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
              style={{ background: `${C.green}22` }}
            >
              <CheckCircle className="w-10 h-10" style={{ color: C.green }} />
            </div>

            <h1 className="text-3xl font-bold mb-4" style={{ color: C.darkText }}>
              Your Global Pizza Party is Live!
            </h1>

            <p className="text-lg mb-8" style={{ color: C.mutedText }}>
              <span className="font-medium" style={{ color: C.darkText }}>{success.eventName}</span> has been created.
              Check your email for a login code to access your host dashboard.
            </p>

            <div className="space-y-4">
              <button
                onClick={() => navigate(`/login?email=${encodeURIComponent(success.email)}&redirect=${encodeURIComponent(success.hostPageUrl)}`)}
                className="w-full flex items-center justify-center gap-2 py-4 text-lg font-semibold text-white rounded-xl transition-all hover:-translate-y-0.5"
                style={{ background: C.red }}
                onMouseEnter={e => (e.currentTarget.style.background = C.redHover)}
                onMouseLeave={e => (e.currentTarget.style.background = C.red)}
              >
                Sign In to Host Dashboard
                <ArrowRight size={20} />
              </button>

              <button
                onClick={() => navigate('/')}
                className="w-full py-3 rounded-xl font-medium transition-all border"
                style={{
                  background: 'rgba(255,255,255,0.7)',
                  borderColor: 'rgba(0,0,0,0.12)',
                  color: C.darkText,
                }}
              >
                Return Home
              </button>
            </div>

            <p className="text-sm mt-8" style={{ color: C.mutedText }}>
              Didn't receive an email? Check your spam folder or request a new login code from the host page.
            </p>
          </div>
        </div>

        <CornerLinks />
      </div>
    );
  }

  /* ──────────────── MAIN PAGE ──────────────── */
  return (
    <div
      className="min-h-screen relative overflow-hidden"
      style={{ background: `linear-gradient(180deg, ${C.skyTop} 0%, ${C.skyBot} 100%)` }}
    >
      {/* ─── Decorative pizza vectors ─── */}
      <img src="/gpp-deco-1.png" alt="" className="absolute pointer-events-none select-none hidden md:block" style={{ top: '8%', right: '-4%', width: 300, animation: 'drift-right 14s ease-in-out infinite' }} />
      <img src="/gpp-deco-2.png" alt="" className="absolute pointer-events-none select-none hidden md:block" style={{ top: '3%', left: '-2%', width: 160, animation: 'drift-left 12s ease-in-out infinite' }} />
      <img src="/gpp-deco-3.png" alt="" className="absolute pointer-events-none select-none" style={{ top: '22%', left: '6%', width: 100, animation: 'drift-right 16s ease-in-out infinite' }} />
      <img src="/gpp-deco-1.png" alt="" className="absolute pointer-events-none select-none hidden md:block" style={{ top: '48%', left: '-5%', width: 260, scaleX: -1, animation: 'drift-left 13s ease-in-out infinite' }} />
      <img src="/gpp-deco-2.png" alt="" className="absolute pointer-events-none select-none" style={{ top: '42%', right: '3%', width: 130, animation: 'drift-right 10s ease-in-out infinite' }} />
      <img src="/gpp-deco-3.png" alt="" className="absolute pointer-events-none select-none hidden md:block" style={{ top: '65%', right: '8%', width: 110, animation: 'drift-left 15s ease-in-out infinite' }} />
      <img src="/gpp-deco-2.png" alt="" className="absolute pointer-events-none select-none" style={{ top: '75%', left: '2%', width: 90, animation: 'drift-right 11s ease-in-out infinite' }} />
      <img src="/gpp-deco-3.png" alt="" className="absolute pointer-events-none select-none hidden md:block" style={{ top: '88%', right: '-2%', width: 140, animation: 'drift-left 17s ease-in-out infinite' }} />

      <Helmet>
        <title>Host a Global Pizza Party | RSV.Pizza</title>
        <meta
          name="description"
          content="Join the worldwide celebration of pizza! Host a Global Pizza Party in your city and connect with pizza lovers around the world."
        />
      </Helmet>

      {/* ─── LIGHT HEADER ─── */}
      <header className="border-b border-black/10 bg-white/40 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <img src="/logo.png" alt="RSV.Pizza" className="h-8 sm:h-10" />
            <span
              className="hidden sm:inline"
              style={{ fontFamily: "'Bangers', cursive", fontSize: '1.3rem', color: C.darkText }}
            >
              RSV.Pizza
            </span>
          </a>
          <a
            href="/login"
            className="text-sm font-medium px-4 py-2 rounded-lg border transition-colors"
            style={{
              color: C.darkText,
              borderColor: 'rgba(0,0,0,0.15)',
              background: 'rgba(255,255,255,0.5)',
            }}
          >
            Log In / Sign Up
          </a>
        </div>
      </header>

      {/* ─── HERO ─── */}
      <div className="relative overflow-hidden">
        <div className="relative max-w-6xl mx-auto px-4 py-12 md:py-20">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            {/* Left: Flyer Image */}
            <div className="flex items-center justify-center">
              <img
                src="/gpp-flyer-2026.png"
                alt="2026 Global Pizza Party — May 22 — In a City Near You"
                className="w-full max-w-md rounded-2xl shadow-lg"
              />
            </div>

            {/* Right: Sign Up Form */}
            <div
              className="p-7 md:p-8 rounded-2xl shadow-lg border"
              style={{
                background: C.cardBg,
                borderColor: C.cardBorder,
              }}
            >
              <h2 className="text-2xl font-bold mb-1" style={{ color: C.darkText }}>
                Create Your Event
              </h2>
              <p className="text-sm mb-6" style={{ color: C.mutedText }}>
                Fill in your details to get started
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <div
                    className="p-4 rounded-xl text-sm"
                    style={{
                      background: `${C.red}12`,
                      border: `1px solid ${C.red}40`,
                      color: C.red,
                    }}
                  >
                    {error.includes('https://') ? (
                      <>
                        {error.split('https://')[0]}
                        <a
                          href={`https://${error.split('https://')[1]}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline opacity-80 hover:opacity-100"
                        >
                          https://{error.split('https://')[1]}
                        </a>
                      </>
                    ) : error}
                  </div>
                )}

                {/* City */}
                <div>
                  <div className="gpp-light-input">
                    <LocationAutocomplete
                      value={city}
                      onChange={(val) => {
                        setCity(val);
                        cityDataRef.current = null;
                      }}
                      onCitySelected={handleCitySelected}
                      types={['(cities)']}
                      placeholder="What city are you hosting in?"
                      disabled={isSubmitting}
                      className="gpp-input"
                    />
                  </div>
                </div>

                {/* Host Name */}
                <div>
                  <input
                    type="text"
                    value={hostName}
                    onChange={(e) => setHostName(e.target.value)}
                    placeholder="What's your name?"
                    className="gpp-input w-full"
                    required
                    disabled={isSubmitting}
                  />
                </div>

                {/* Email */}
                <div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email address"
                    className="gpp-input w-full"
                    required
                    disabled={isSubmitting}
                  />
                  <p className="text-xs mt-2" style={{ color: C.mutedText }}>
                    We'll send you a login code to manage your event
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full flex items-center justify-center gap-2 py-4 text-lg font-semibold text-white rounded-xl transition-all hover:-translate-y-0.5 disabled:opacity-60"
                  style={{ background: C.red }}
                  onMouseEnter={e => { if (!isSubmitting) e.currentTarget.style.background = C.redHover; }}
                  onMouseLeave={e => { e.currentTarget.style.background = C.red; }}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Creating Your Event...
                    </>
                  ) : (
                    <>
                      Create Your GPP Event
                      <ArrowRight size={20} />
                    </>
                  )}
                </button>
              </form>

              <p className="text-center text-sm mt-6" style={{ color: C.mutedText }}>
                Already have an account?{' '}
                <a href="/login" className="font-medium hover:underline" style={{ color: C.red }}>
                  Sign in
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ─── RESOURCES SECTION ─── */}
      <div className="border-t" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 py-16">
          <h2 className="text-2xl font-bold text-center mb-12" style={{ color: C.darkText }}>
            Resources for Hosts
          </h2>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Host Guide */}
            <a
              href="https://docs.google.com/presentation/d/e/2PACX-1vSNFVmhuegxE6QhHFHBC1WCVGJ4eA-Zl-SpzcQG0kMuG1bQf3GA_01BaWtLoL-VUgTT0y3M330lGB5D/pub?start=false&loop=false&delayms=3000"
              target="_blank"
              rel="noopener noreferrer"
              className="p-6 rounded-2xl border transition-all hover:-translate-y-1 hover:shadow-md group"
              style={{ background: C.cardBg, borderColor: C.cardBorder }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors"
                style={{ background: `${C.red}15` }}
              >
                <BookOpen className="w-6 h-6" style={{ color: C.red }} />
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: C.darkText }}>
                GPP Host Guide
              </h3>
              <p className="text-sm" style={{ color: C.mutedText }}>
                Everything you need to know about hosting a successful Global Pizza Party.
              </p>
            </a>

            {/* Telegram */}
            <a
              href="https://t.me/+Qr-B8Y6DYH4yMjIx"
              target="_blank"
              rel="noopener noreferrer"
              className="p-6 rounded-2xl border transition-all hover:-translate-y-1 hover:shadow-md group"
              style={{ background: C.cardBg, borderColor: C.cardBorder }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors"
                style={{ background: `${C.green}15` }}
              >
                <MessageCircle className="w-6 h-6" style={{ color: C.green }} />
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: C.darkText }}>
                Telegram Community
              </h3>
              <p className="text-sm" style={{ color: C.mutedText }}>
                Join fellow hosts and the PizzaDAO team for support and coordination.
              </p>
            </a>

            {/* PizzaDAO Resources */}
            <a
              href="https://pizzadao.xyz/landing"
              target="_blank"
              rel="noopener noreferrer"
              className="p-6 rounded-2xl border transition-all hover:-translate-y-1 hover:shadow-md group"
              style={{ background: C.cardBg, borderColor: C.cardBorder }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors"
                style={{ background: '#5c7cfa15' }}
              >
                <HelpCircle className="w-6 h-6" style={{ color: '#5c7cfa' }} />
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: C.darkText }}>
                PizzaDAO Resources
              </h3>
              <p className="text-sm" style={{ color: C.mutedText }}>
                Common questions about hosting and what to expect on the day.
              </p>
            </a>
          </div>
        </div>
      </div>

      {/* ─── FOOTER ─── */}
      <footer className="py-6 border-t" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
        <div className="flex flex-col items-center gap-1">
          <span className="text-sm" style={{ color: 'rgba(0,0,0,0.4)' }}>Powered by</span>
          <a
            href="https://pizzadao.xyz/join"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:opacity-80 transition-opacity"
          >
            <img src="/pizzadao-logo.svg" alt="PizzaDAO" className="h-7" />
          </a>
        </div>
      </footer>

      <CornerLinks />

      {/* ─── SCOPED LIGHT-THEME OVERRIDES ─── */}
      <style>{`
        /* Drifting animation for decorative pizza vectors */
        @keyframes drift-right {
          0% { transform: translateX(0); }
          50% { transform: translateX(50px); }
          100% { transform: translateX(0); }
        }
        @keyframes drift-left {
          0% { transform: translateX(0); }
          50% { transform: translateX(-50px); }
          100% { transform: translateX(0); }
        }

        /* Override the dark global input styles for the GPP page */
        .gpp-input,
        .gpp-light-input input {
          background: rgba(255,255,255,0.85) !important;
          border: 1px solid rgba(0,0,0,0.12) !important;
          color: #1a1a1a !important;
          border-radius: 12px !important;
          padding: 12px 16px !important;
        }
        .gpp-input:focus,
        .gpp-light-input input:focus {
          border-color: ${C.red} !important;
          background: #fff !important;
          outline: none !important;
        }
        .gpp-input::placeholder,
        .gpp-light-input input::placeholder {
          color: #999 !important;
        }
        /* LocationAutocomplete has a MapPin icon with left padding */
        .gpp-light-input input {
          padding-left: 2.75rem !important;
        }
        .gpp-light-input .absolute {
          color: #999 !important;
        }

        /* Override Google Maps autocomplete dropdown to be light */
        .pac-container {
          background-color: #fff !important;
          border: 1px solid rgba(0,0,0,0.12) !important;
          box-shadow: 0 4px 16px rgba(0,0,0,0.12) !important;
        }
        .pac-item {
          background-color: #fff !important;
          border-top: 1px solid rgba(0,0,0,0.06) !important;
          color: #1a1a1a !important;
        }
        .pac-item:hover {
          background-color: #f5f5f5 !important;
        }
        .pac-item-selected,
        .pac-item-selected:hover {
          background-color: #eee !important;
        }
        .pac-item-query {
          color: #1a1a1a !important;
        }
        .pac-matched {
          color: ${C.red} !important;
        }
      `}</style>
    </div>
  );
}
