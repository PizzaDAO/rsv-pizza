import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Calendar, Clock, MapPin, Users, Pizza, Loader2, Lock, AlertCircle } from 'lucide-react';
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

  useEffect(() => {
    async function loadParty() {
      if (slug) {
        const foundParty = await getPartyByInviteCodeOrCustomUrl(slug);
        if (foundParty) {
          setParty(foundParty);

          // Check if party has password protection
          if (foundParty.password) {
            // Check if already authenticated in this session
            const authKey = `rsvpizza_event_auth_${slug}`;
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
      const authKey = `rsvpizza_event_auth_${slug}`;
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
            This event is password-protected. Please enter the password to continue.
          </p>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            {passwordError && (
              <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
                {passwordError}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Event Password
              </label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter password"
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

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="card overflow-hidden">
          {/* Event Image */}
          {party.event_image_url && (
            <div
              className="w-full h-64 bg-cover bg-center"
              style={{ backgroundImage: `url(${party.event_image_url})` }}
            />
          )}

          {/* Event Header */}
          <div className="bg-gradient-to-r from-[#ff393a] to-[#ff6b35] p-6 text-center">
            <img
              src="/rsv-pizza/logo.png"
              alt="RSVPizza"
              className="h-10 mx-auto mb-3"
            />
            <h1 className="text-3xl font-bold text-white mb-2">{party.name}</h1>
            {party.host_name && (
              <p className="text-white/90 text-lg">Hosted by {party.host_name}</p>
            )}
          </div>

          {/* Event Details */}
          <div className="p-6 space-y-6">
            {/* Date & Time */}
            {party.date && (
              <div className="flex items-start gap-3">
                <Calendar className="w-5 h-5 text-[#ff393a] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-white">
                    {new Date(party.date).toLocaleDateString(undefined, {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                  <p className="text-sm text-white/60">
                    {new Date(party.date).toLocaleTimeString(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            )}

            {/* Duration */}
            {party.duration && (
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-[#ff393a] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-white">
                    {party.duration} hour{party.duration !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            )}

            {/* Location */}
            {party.address && (
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-[#ff393a] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-white">{party.address}</p>
                </div>
              </div>
            )}

            {/* Expected Guests */}
            {party.max_guests && (
              <div className="flex items-start gap-3">
                <Users className="w-5 h-5 text-[#ff393a] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-white">
                    {party.max_guests} expected guest{party.max_guests !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            )}

            {/* Description */}
            {party.description && (
              <div className="border-t border-white/10 pt-6">
                <h3 className="font-semibold text-white mb-3">About This Event</h3>
                <p className="text-white/80 whitespace-pre-wrap">{party.description}</p>
              </div>
            )}

            {/* RSVP Button */}
            <div className="border-t border-white/10 pt-6">
              <button
                onClick={handleRSVP}
                className="w-full btn-primary flex items-center justify-center gap-2 text-lg py-4"
              >
                <Pizza size={20} />
                RSVP for Pizza
              </button>
              {party.rsvp_closed_at && (
                <p className="text-center text-white/50 text-sm mt-3">
                  RSVPs are closed for this event
                </p>
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-white/30 text-sm mt-6">
          Powered by RSVPizza
        </p>
      </div>
    </div>
  );
}
