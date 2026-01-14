import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Pizza, Check, AlertCircle, Loader2, ThumbsUp, ThumbsDown, Lock } from 'lucide-react';
import { getPartyByInviteCodeOrCustomUrl, addGuestToParty, DbParty } from '../lib/supabase';

const DIETARY_OPTIONS = [
  'Vegetarian',
  'Vegan',
  'Gluten-Free',
  'Dairy-Free',
];

const TOPPINGS = [
  { id: 'pepperoni', name: 'Pepperoni', category: 'meat' },
  { id: 'sausage', name: 'Sausage', category: 'meat' },
  { id: 'bacon', name: 'Bacon', category: 'meat' },
  { id: 'ham', name: 'Ham', category: 'meat' },
  { id: 'chicken', name: 'Chicken', category: 'meat' },
  { id: 'mushrooms', name: 'Mushrooms', category: 'vegetable' },
  { id: 'onions', name: 'Onions', category: 'vegetable' },
  { id: 'bell-peppers', name: 'Bell Peppers', category: 'vegetable' },
  { id: 'olives', name: 'Olives', category: 'vegetable' },
  { id: 'spinach', name: 'Spinach', category: 'vegetable' },
  { id: 'jalapenos', name: 'Jalapeños', category: 'vegetable' },
  { id: 'tomatoes', name: 'Tomatoes', category: 'vegetable' },
  { id: 'extra-cheese', name: 'Extra Cheese', category: 'cheese' },
  { id: 'feta', name: 'Feta Cheese', category: 'cheese' },
  { id: 'pineapple', name: 'Pineapple', category: 'fruit' },
];

const BEVERAGES = [
  { id: 'coke', name: 'Coca-Cola', category: 'soda' },
  { id: 'diet-coke', name: 'Diet Coke', category: 'soda' },
  { id: 'sprite', name: 'Sprite', category: 'soda' },
  { id: 'fanta', name: 'Fanta', category: 'soda' },
  { id: 'pepsi', name: 'Pepsi', category: 'soda' },
  { id: 'mountain-dew', name: 'Mountain Dew', category: 'soda' },
  { id: 'dr-pepper', name: 'Dr Pepper', category: 'soda' },
  { id: 'orange-juice', name: 'Orange Juice', category: 'juice' },
  { id: 'apple-juice', name: 'Apple Juice', category: 'juice' },
  { id: 'lemonade', name: 'Lemonade', category: 'juice' },
  { id: 'iced-tea', name: 'Iced Tea', category: 'other' },
  { id: 'water', name: 'Water', category: 'water' },
  { id: 'sparkling-water', name: 'Sparkling Water', category: 'water' },
];

export function RSVPPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [party, setParty] = useState<DbParty | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Password protection state
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [likedToppings, setLikedToppings] = useState<string[]>([]);
  const [dislikedToppings, setDislikedToppings] = useState<string[]>([]);
  const [likedBeverages, setLikedBeverages] = useState<string[]>([]);
  const [dislikedBeverages, setDislikedBeverages] = useState<string[]>([]);
  const [availableBeverages, setAvailableBeverages] = useState<string[]>([]);

  useEffect(() => {
    async function loadParty() {
      if (inviteCode) {
        const foundParty = await getPartyByInviteCodeOrCustomUrl(inviteCode);
        if (foundParty) {
          setParty(foundParty);
          setAvailableBeverages(foundParty.available_beverages || []);

          // Check if party has password protection
          if (foundParty.password) {
            // Check if already authenticated in this session
            const authKey = `rsvpizza_auth_${inviteCode}`;
            const storedAuth = sessionStorage.getItem(authKey);
            if (storedAuth === foundParty.password) {
              setIsAuthenticated(true);
            }
          } else {
            // No password, automatically authenticated
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
      // Correct password
      setIsAuthenticated(true);
      setPasswordError(null);
      // Store in session storage to avoid re-prompting
      const authKey = `rsvpizza_auth_${inviteCode}`;
      sessionStorage.setItem(authKey, party.password);
    } else {
      // Wrong password
      setPasswordError('Incorrect password. Please try again.');
      setPasswordInput('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }

    if (!inviteCode) {
      setError('Invalid invite code');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Add guest to party in Supabase
      const guest = await addGuestToParty(
        party!.id,
        name.trim(),
        dietaryRestrictions,
        likedToppings,
        dislikedToppings,
        likedBeverages,
        dislikedBeverages
      );

      if (guest) {
        setSubmitted(true);
      } else {
        setError('Failed to submit. Please try again.');
      }
    } catch (err) {
      setError('Failed to submit. The party may no longer exist.');
    }

    setSubmitting(false);
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

  const handleBeverageLike = (id: string) => {
    setDislikedBeverages(prev => prev.filter(b => b !== id));
    setLikedBeverages(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]);
  };

  const handleBeverageDislike = (id: string) => {
    setLikedBeverages(prev => prev.filter(b => b !== id));
    setDislikedBeverages(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]);
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
          <p className="text-white/60 mb-6">{error}</p>
          <a href="#/" className="btn-primary inline-block">
            Go to Home
          </a>
        </div>
      </div>
    );
  }

  // Show password prompt if party is password-protected and not authenticated
  if (party && party.password && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card p-8 max-w-md">
          <div className="w-16 h-16 bg-[#ff393a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#ff393a]/30">
            <Lock className="w-8 h-8 text-[#ff393a]" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2 text-center">Password Required</h1>
          <p className="text-white/60 mb-6 text-center">
            This party is password-protected. Please enter the password to continue.
          </p>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            {passwordError && (
              <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
                {passwordError}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Party Password
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

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-[#39d98a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#39d98a]/30">
            <Check className="w-8 h-8 text-[#39d98a]" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">You're In!</h1>
          <p className="text-white/60 mb-4">
            Your pizza preferences have been saved for {party?.name}.
          </p>
          {party?.date && (
            <p className="text-sm text-white/40">
              See you on {new Date(party.date).toLocaleDateString()}!
            </p>
          )}
        </div>
      </div>
    );
  }

  if (party?.rsvp_closed_at) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card p-8 max-w-md text-center">
          <Pizza className="w-16 h-16 text-white/30 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">{party.name}</h1>
          <p className="text-white/60">RSVPs are closed for this party.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="card overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#ff393a] to-[#ff6b35] p-6 text-center">
            <img
              src="/rsv-pizza/logo.png"
              alt="RSVPizza"
              className="h-10 mx-auto mb-3"
            />
            <h1 className="text-2xl font-bold text-white">{party?.name}</h1>
            {party?.host_name && (
              <p className="text-white/80">Hosted by {party.host_name}</p>
            )}
            {party?.date && (
              <p className="text-white/70 text-sm mt-1">
                {new Date(party.date).toLocaleDateString(undefined, {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            )}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {error && (
              <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
                {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Your Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full"
                placeholder="Enter your name"
                required
              />
            </div>

            {/* Dietary Restrictions */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-3">
                Dietary Restrictions
              </label>
              <div className="flex flex-wrap gap-2">
                {DIETARY_OPTIONS.map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleDietary(option)}
                    className={`chip ${dietaryRestrictions.includes(option) ? 'active' : ''}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            {/* Topping Preferences */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-3">
                Topping Preferences
              </label>
              <div className="flex flex-wrap gap-2">
                {TOPPINGS.map(topping => {
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

            {/* Beverage Preferences - Only show if party has beverages */}
            {availableBeverages.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-white/80 mb-3">
                  Beverage Preferences
                </label>
                <div className="flex flex-wrap gap-2">
                  {BEVERAGES
                    .filter(bev => availableBeverages.includes(bev.id))
                    .map(beverage => {
                      const isLiked = likedBeverages.includes(beverage.id);
                      const isDisliked = dislikedBeverages.includes(beverage.id);
                      return (
                        <div
                          key={beverage.id}
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
                            onClick={() => handleBeverageLike(beverage.id)}
                            className="flex items-center gap-1.5 flex-1 py-0.5 hover:opacity-70 transition-opacity"
                          >
                            <ThumbsUp
                              size={12}
                              className={`transition-all ${
                                isLiked ? 'text-[#39d98a]' : 'text-white/20'
                              }`}
                            />
                            <span className="text-white text-xs">{beverage.name}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBeverageDislike(beverage.id)}
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

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit My Preferences'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-white/30 text-sm mt-6">
          Powered by RSVPizza
        </p>
      </div>
    </div>
  );
}
