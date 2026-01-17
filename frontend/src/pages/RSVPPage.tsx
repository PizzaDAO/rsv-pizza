import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Pizza, Check, AlertCircle, Loader2, ThumbsUp, ThumbsDown, Lock, X, ChevronRight, ChevronLeft, Square, CheckSquare2, User, Mail, Wallet } from 'lucide-react';
import { getPartyByInviteCodeOrCustomUrl, addGuestToParty, getUserPreferences, saveUserPreferences, DbParty } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { DIETARY_OPTIONS, ROLE_OPTIONS, TOPPINGS, DRINKS } from '../constants/options';

export function RSVPPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [party, setParty] = useState<DbParty | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [step, setStep] = useState(1); // 1 or 2

  // Password protection state
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Step 1 - Personal Info
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [ethereumAddress, setEthereumAddress] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [mailingListOptIn, setMailingListOptIn] = useState(false);

  // Step 2 - Pizza Preferences
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [likedToppings, setLikedToppings] = useState<string[]>([]);
  const [dislikedToppings, setDislikedToppings] = useState<string[]>(['anchovies']);
  const [likedBeverages, setLikedBeverages] = useState<string[]>([]);
  const [dislikedBeverages, setDislikedBeverages] = useState<string[]>([]);
  const [availableBeverages, setAvailableBeverages] = useState<string[]>([]);
  const [availableToppings, setAvailableToppings] = useState<string[]>([]);
  const [saveToProfile, setSaveToProfile] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  // Load saved preferences when user is logged in or when email matches a saved profile
  useEffect(() => {
    async function loadSavedPreferences() {
      const emailToCheck = user?.email || email;
      if (!emailToCheck || preferencesLoaded) return;

      const prefs = await getUserPreferences(emailToCheck);
      if (prefs) {
        if (prefs.dietary_restrictions.length > 0) {
          setDietaryRestrictions(prefs.dietary_restrictions);
        }
        if (prefs.liked_toppings.length > 0) {
          setLikedToppings(prefs.liked_toppings);
        }
        if (prefs.disliked_toppings.length > 0) {
          setDislikedToppings(prefs.disliked_toppings);
        }
        if (prefs.liked_beverages.length > 0) {
          setLikedBeverages(prefs.liked_beverages);
        }
        if (prefs.disliked_beverages.length > 0) {
          setDislikedBeverages(prefs.disliked_beverages);
        }
        setPreferencesLoaded(true);
        // Auto-check save to profile if user is logged in
        if (user?.email) {
          setSaveToProfile(true);
        }
      }
    }
    loadSavedPreferences();
  }, [user?.email, email, preferencesLoaded]);

  // Pre-fill email if user is logged in
  useEffect(() => {
    if (user?.email && !email) {
      setEmail(user.email);
    }
    if (user?.name && !name) {
      setName(user.name);
    }
  }, [user]);

  useEffect(() => {
    async function loadParty() {
      if (inviteCode) {
        const foundParty = await getPartyByInviteCodeOrCustomUrl(inviteCode);
        if (foundParty) {
          setParty(foundParty);
          setAvailableBeverages(foundParty.available_beverages || []);
          setAvailableToppings(foundParty.available_toppings || []);

          // Check if party has password protection
          if (foundParty.password) {
            const authKey = `rsvpizza_auth_${inviteCode}`;
            const storedAuth = sessionStorage.getItem(authKey);
            if (storedAuth === foundParty.password) {
              setIsAuthenticated(true);
            }
          } else {
            setIsAuthenticated(true);
          }
        } else {
          setError('Party not found. The invite link may be invalid or expired.');
        }
      }
      setLoading(false);
    }
    loadParty();
  }, [inviteCode]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!party?.password) return;

    if (passwordInput === party.password) {
      setIsAuthenticated(true);
      setPasswordError(null);
      const authKey = `rsvpizza_auth_${inviteCode}`;
      sessionStorage.setItem(authKey, party.password);
    } else {
      setPasswordError('Incorrect password. Please try again.');
      setPasswordInput('');
    }
  };

  const handleStep1Continue = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }

    setError(null);
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!inviteCode) {
      setError('Invalid invite code');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const guest = await addGuestToParty(
        party!.id,
        name.trim(),
        dietaryRestrictions,
        likedToppings,
        dislikedToppings,
        likedBeverages,
        dislikedBeverages,
        email.trim() || undefined,
        ethereumAddress.trim() || undefined,
        roles,
        mailingListOptIn
      );

      if (guest) {
        // Save preferences to profile if checkbox is checked and email is provided
        if (saveToProfile && email.trim()) {
          await saveUserPreferences(email.trim(), {
            dietary_restrictions: dietaryRestrictions,
            liked_toppings: likedToppings,
            disliked_toppings: dislikedToppings,
            liked_beverages: likedBeverages,
            disliked_beverages: dislikedBeverages,
          });
        }
        setSubmitted(true);
      } else {
        setError('Failed to submit. Please try again.');
      }
    } catch (err) {
      setError('Failed to submit. The party may no longer exist.');
    }

    setSubmitting(false);
  };

  const toggleRole = (role: string) => {
    setRoles(prev =>
      prev.includes(role)
        ? prev.filter(r => r !== role)
        : [...prev, role]
    );
  };

  const toggleDietary = (option: string) => {
    setDietaryRestrictions(prev =>
      prev.includes(option)
        ? prev.filter(d => d !== option)
        : [...prev, option]
    );
  };

  const handleToppingLike = (id: string) => {
    setDislikedToppings(prev => prev.filter(t => t !== id));
    setLikedToppings(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  };

  const handleToppingDislike = (id: string) => {
    setLikedToppings(prev => prev.filter(t => t !== id));
    setDislikedToppings(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  };

  const handleDrinkLike = (id: string) => {
    setDislikedBeverages(prev => prev.filter(b => b !== id));
    setLikedBeverages(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]);
  };

  const handleDrinkDislike = (id: string) => {
    setLikedBeverages(prev => prev.filter(b => b !== id));
    setDislikedBeverages(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]);
  };

  const handleClose = () => {
    const eventUrl = party?.custom_url
      ? `/${party.custom_url}`
      : `/${inviteCode}`;
    navigate(eventUrl);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  if (error && !party) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card p-8 max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-[#ff393a] mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Party Not Found</h1>
          <p className="text-white/60">{error}</p>
        </div>
      </div>
    );
  }

  // Password protection UI
  if (!isAuthenticated && party?.password) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card p-8 max-w-md w-full">
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

            <button type="submit" className="w-full btn-primary">
              Continue
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Success screen
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-[#39d98a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#39d98a]/30">
            <Check className="w-8 h-8 text-[#39d98a]" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-6">See you at {party?.name}!</h1>
          <button
            onClick={handleClose}
            className="btn-secondary"
          >
            Back to Event
          </button>
        </div>
      </div>
    );
  }

  // Step 1 - Personal Info
  if (step === 1) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card p-8 max-w-lg w-full relative">
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>

          <div className="flex items-center gap-3 mb-6">
            <Pizza className="w-10 h-10 text-[#ff393a]" />
            <div>
              <h1 className="text-2xl font-bold text-white">RSVP to {party?.name}</h1>
              <p className="text-sm text-white/60">Step 1 of 2</p>
            </div>
          </div>

          <form onSubmit={handleStep1Continue} className="space-y-3">
            {/* Name */}
            <div className="relative">
              <User size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                className="w-full !pl-14"
                required
                autoFocus
              />
            </div>

            {/* Email */}
            <div className="relative">
              <Mail size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full !pl-14"
                required
              />
            </div>

            {/* Ethereum Address */}
            <div className="relative">
              <Wallet size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              <input
                type="text"
                value={ethereumAddress}
                onChange={(e) => setEthereumAddress(e.target.value)}
                placeholder="Wallet Address"
                className="w-full !pl-14"
              />
            </div>

            {/* What do you do? */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                What do you do?
              </label>
              <div className="flex flex-wrap gap-2">
                {ROLE_OPTIONS.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleRole(role)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      roles.includes(role)
                        ? 'bg-[#ff393a] text-white'
                        : 'bg-white/10 text-white/70 hover:bg-white/20'
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>

            {/* Mailing List */}
            <button
              type="button"
              onClick={() => setMailingListOptIn(!mailingListOptIn)}
              className="flex items-center gap-3 p-4 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 transition-colors cursor-pointer w-full"
            >
              {mailingListOptIn ? (
                <CheckSquare2 size={20} className="text-[#ff393a] flex-shrink-0" />
              ) : (
                <Square size={20} className="text-white/40 flex-shrink-0" />
              )}
              <span className="text-sm text-white/80">
                Want to join the mailing list?
              </span>
            </button>

            {error && (
              <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
              Next
              <ChevronRight size={18} />
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Step 2 - Pizza Preferences
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card p-8 max-w-2xl w-full relative">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
        >
          <X size={24} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <Pizza className="w-10 h-10 text-[#ff393a]" />
          <div>
            <h1 className="text-2xl font-bold text-white">Pizza Requests</h1>
            <p className="text-sm text-white/60">Step 2 of 2</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Dietary Restrictions */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-3">
              Dietary Restrictions
            </label>
            <div className="flex flex-wrap gap-2">
              {DIETARY_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggleDietary(option)}
                  className={`px-4 py-2 rounded-lg transition-colors ${
                    dietaryRestrictions.includes(option)
                      ? 'bg-[#ff393a] text-white'
                      : 'bg-white/10 text-white/70 hover:bg-white/20'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {/* Toppings */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-3">
              Topping Preferences
            </label>
            <div className="flex flex-wrap gap-2">
              {TOPPINGS.filter(t => availableToppings.length === 0 || availableToppings.includes(t.id)).map((topping) => {
                const isLiked = likedToppings.includes(topping.id);
                const isDisliked = dislikedToppings.includes(topping.id);

                return (
                  <div
                    key={topping.id}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${
                      isLiked
                        ? 'bg-[#39d98a]/20 border-[#39d98a]/30'
                        : isDisliked
                        ? 'bg-[#ff393a]/20 border-[#ff393a]/30'
                        : 'bg-white/5 border-white/10'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleToppingLike(topping.id)}
                      className="flex items-center gap-1.5 flex-1 py-0.5 hover:opacity-70 transition-opacity"
                    >
                      <ThumbsUp
                        size={12}
                        className={`transition-all ${
                          isLiked ? 'text-[#39d98a]' : 'text-white/20'
                        }`}
                      />
                      <span className="text-white text-xs">{topping.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToppingDislike(topping.id)}
                      className="p-0.5 hover:opacity-70 transition-opacity"
                    >
                      <ThumbsDown
                        size={12}
                        className={`transition-all ${
                          isDisliked ? 'text-[#ff393a]' : 'text-white/20'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Drinks */}
          {availableBeverages.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-white/80 mb-3">
                Drink Preferences
              </label>
              <div className="flex flex-wrap gap-2">
                {DRINKS.filter(d => availableBeverages.includes(d.id)).map((drink) => {
                  const isLiked = likedBeverages.includes(drink.id);
                  const isDisliked = dislikedBeverages.includes(drink.id);

                  return (
                    <div
                      key={drink.id}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${
                        isLiked
                          ? 'bg-[#39d98a]/20 border-[#39d98a]/30'
                          : isDisliked
                          ? 'bg-[#ff393a]/20 border-[#ff393a]/30'
                          : 'bg-white/5 border-white/10'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleDrinkLike(drink.id)}
                        className="flex items-center gap-1.5 flex-1 py-0.5 hover:opacity-70 transition-opacity"
                      >
                        <ThumbsUp
                          size={12}
                          className={`transition-all ${
                            isLiked ? 'text-[#39d98a]' : 'text-white/20'
                          }`}
                        />
                        <span className="text-white text-xs">{drink.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDrinkDislike(drink.id)}
                        className="p-0.5 hover:opacity-70 transition-opacity"
                      >
                        <ThumbsDown
                          size={12}
                          className={`transition-all ${
                            isDisliked ? 'text-[#ff393a]' : 'text-white/20'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          {/* Save to Profile Checkbox - only show if email is provided */}
          {email.trim() && (
            <button
              type="button"
              onClick={() => setSaveToProfile(!saveToProfile)}
              className="flex items-center gap-3 w-full p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
            >
              {saveToProfile ? (
                <CheckSquare2 size={20} className="text-[#ff393a] flex-shrink-0" />
              ) : (
                <Square size={20} className="text-white/40 flex-shrink-0" />
              )}
              <div className="text-left">
                <span className="text-sm font-medium text-white">Save to profile</span>
                <p className="text-xs text-white/50">Remember my preferences for future events</p>
              </div>
            </button>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn-secondary flex items-center gap-2"
            >
              <ChevronLeft size={18} />
              Back
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 btn-primary flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Pizza size={18} />
                  RSVP
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
