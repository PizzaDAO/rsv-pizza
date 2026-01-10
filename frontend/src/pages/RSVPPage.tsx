import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Pizza, Check, AlertCircle, Loader2 } from 'lucide-react';
import { getPartyByInviteCode, addGuestToParty, DbParty } from '../lib/supabase';

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

export function RSVPPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [party, setParty] = useState<DbParty | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [likedToppings, setLikedToppings] = useState<string[]>([]);
  const [dislikedToppings, setDislikedToppings] = useState<string[]>([]);

  useEffect(() => {
    async function loadParty() {
      if (inviteCode) {
        const foundParty = await getPartyByInviteCode(inviteCode);
        if (foundParty) {
          setParty(foundParty);
        } else {
          setError('Party not found. The invite link may be invalid or expired.');
        }
      }
      setLoading(false);
    }
    loadParty();
  }, [inviteCode]);

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
        dislikedToppings
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

  const toggleLikedTopping = (id: string) => {
    setDislikedToppings(prev => prev.filter(t => t !== id));
    setLikedToppings(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const toggleDislikedTopping = (id: string) => {
    setLikedToppings(prev => prev.filter(t => t !== id));
    setDislikedToppings(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
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
              src="https://i.imgur.com/mKqxzeb.png"
              alt="PizzaDAO"
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

            {/* Favorite Toppings */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-3">
                Favorite Toppings
              </label>
              <div className="flex flex-wrap gap-2">
                {TOPPINGS.map(topping => (
                  <button
                    key={topping.id}
                    type="button"
                    onClick={() => toggleLikedTopping(topping.id)}
                    className={`chip ${likedToppings.includes(topping.id) ? 'liked' : ''}`}
                  >
                    {topping.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Disliked Toppings */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-3">
                Toppings You Dislike
              </label>
              <div className="flex flex-wrap gap-2">
                {TOPPINGS.map(topping => (
                  <button
                    key={topping.id}
                    type="button"
                    onClick={() => toggleDislikedTopping(topping.id)}
                    className={`chip ${dislikedToppings.includes(topping.id) ? 'disliked' : ''}`}
                  >
                    {topping.name}
                  </button>
                ))}
              </div>
            </div>

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
