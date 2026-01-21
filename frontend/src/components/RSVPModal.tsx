import React, { useState, useEffect } from 'react';
import { Pizza, Check, AlertCircle, Loader2, ThumbsUp, ThumbsDown, X, ChevronRight, ChevronLeft, Square, CheckSquare2, User, Mail, Wallet, Star, MapPin } from 'lucide-react';
import { addGuestToParty, getUserPreferences, saveUserPreferences, ExistingGuestData } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { DIETARY_OPTIONS, ROLE_OPTIONS, TOPPINGS, DRINKS } from '../constants/options';
import { searchPizzerias, geocodeAddress } from '../lib/ordering';
import { Pizzeria } from '../types';
import { IconInput } from './IconInput';
import { PublicEvent } from '../lib/api';
import { useMintNFT, MintStatus, MintResult } from '../hooks/useMintNFT';
import { NFT_CONTRACT_ADDRESS } from '../lib/nftContract';

interface RSVPModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: PublicEvent;
  existingGuest?: ExistingGuestData | null;
  onRSVPSuccess?: () => void;
}

export function RSVPModal({ isOpen, onClose, event, existingGuest, onRSVPSuccess }: RSVPModalProps) {
  const { user } = useAuth();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [wasUpdated, setWasUpdated] = useState(false);
  const [step, setStep] = useState(1);
  const isEditing = !!existingGuest;

  // Step 1 - Personal Info
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [ethereumAddress, setEthereumAddress] = useState('');
  const [walletValidation, setWalletValidation] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [roles, setRoles] = useState<string[]>([]);
  const [mailingListOptIn, setMailingListOptIn] = useState(false);

  // Validate wallet address or ENS name
  const validateWalletAddress = (address: string) => {
    if (!address.trim()) {
      setWalletValidation('idle');
      return;
    }
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    const ensRegex = /^[a-zA-Z0-9-]+\.(eth|xyz|com|org|io|co|app|dev|id)$/;
    if (ethAddressRegex.test(address.trim()) || ensRegex.test(address.trim())) {
      setWalletValidation('valid');
    } else {
      setWalletValidation('invalid');
    }
  };

  // Step 2 - Pizza Preferences
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [likedToppings, setLikedToppings] = useState<string[]>([]);
  const [dislikedToppings, setDislikedToppings] = useState<string[]>(['anchovies']);
  const [likedBeverages, setLikedBeverages] = useState<string[]>([]);
  const [dislikedBeverages, setDislikedBeverages] = useState<string[]>([]);
  const [saveToProfile, setSaveToProfile] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  // Pizzeria rankings
  const [nearbyPizzerias, setNearbyPizzerias] = useState<Pizzeria[]>([]);
  const [pizzeriaRankings, setPizzeriaRankings] = useState<string[]>([]);
  const [loadingPizzerias, setLoadingPizzerias] = useState(false);

  // NFT minting state
  const [mintStatus, setMintStatus] = useState<MintStatus>('idle');
  const [mintResult, setMintResult] = useState<MintResult>({});
  const { mint: mintNFT } = useMintNFT();

  // Reset state when modal opens and lock body scroll
  useEffect(() => {
    if (isOpen) {
      setSubmitted(false);
      setAlreadyRegistered(false);
      setPendingApproval(false);
      setWasUpdated(false);
      setStep(1);
      setError(null);
      setMintStatus('idle');
      setMintResult({});

      // Pre-fill form with existing guest data if editing
      if (existingGuest) {
        setName(existingGuest.name);
        setEmail(existingGuest.email || '');
        setEthereumAddress(existingGuest.ethereumAddress || '');
        setRoles(existingGuest.roles);
        setMailingListOptIn(existingGuest.mailingListOptIn);
        setDietaryRestrictions(existingGuest.dietaryRestrictions);
        setLikedToppings(existingGuest.likedToppings);
        setDislikedToppings(existingGuest.dislikedToppings);
        setLikedBeverages(existingGuest.likedBeverages);
        setDislikedBeverages(existingGuest.dislikedBeverages);
        setPizzeriaRankings(existingGuest.pizzeriaRankings);
        setPreferencesLoaded(true); // Mark as loaded so we don't override with profile preferences
      }

      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, existingGuest]);

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
        if (user?.email) {
          setSaveToProfile(true);
        }
      }
    }
    if (isOpen) {
      loadSavedPreferences();
    }
  }, [user?.email, email, preferencesLoaded, isOpen]);

  // Pre-fill email if user is logged in
  useEffect(() => {
    if (isOpen) {
      if (user?.email && !email) {
        setEmail(user.email);
      }
      if (user?.name && !name) {
        setName(user.name);
      }
    }
  }, [user, isOpen]);

  // Use host-selected pizzerias if available, otherwise fetch nearby pizzerias
  useEffect(() => {
    async function fetchPizzerias() {
      if (!isOpen) return;

      // If host has selected specific pizzerias, use those
      if (event.selectedPizzerias && event.selectedPizzerias.length > 0) {
        setNearbyPizzerias(event.selectedPizzerias);
        return;
      }

      // Otherwise, fall back to auto-fetching based on address
      if (!event.address) return;

      setLoadingPizzerias(true);
      try {
        const location = await geocodeAddress(event.address);
        if (location) {
          const results = await searchPizzerias(location.lat, location.lng);
          setNearbyPizzerias(results.slice(0, 3));
        }
      } catch (err) {
        console.error('Failed to fetch pizzerias:', err);
      } finally {
        setLoadingPizzerias(false);
      }
    }
    fetchPizzerias();
  }, [event.address, event.selectedPizzerias, isOpen]);

  const handlePizzeriaClick = (pizzeriaId: string) => {
    setPizzeriaRankings(prev => {
      const currentIndex = prev.indexOf(pizzeriaId);
      if (currentIndex === -1) {
        return [...prev, pizzeriaId];
      } else {
        return prev.filter(id => id !== pizzeriaId);
      }
    });
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

    setSubmitting(true);
    setError(null);

    try {
      const inviteCode = event.customUrl || event.inviteCode;
      const result = await addGuestToParty(
        event.id,
        name.trim(),
        dietaryRestrictions,
        likedToppings,
        dislikedToppings,
        likedBeverages,
        dislikedBeverages,
        email.trim() || undefined,
        ethereumAddress.trim() || undefined,
        roles,
        mailingListOptIn,
        inviteCode,
        pizzeriaRankings.length > 0 ? pizzeriaRankings : undefined
      );

      if (result) {
        if (saveToProfile && email.trim()) {
          await saveUserPreferences(email.trim(), {
            dietary_restrictions: dietaryRestrictions,
            liked_toppings: likedToppings,
            disliked_toppings: dislikedToppings,
            liked_beverages: likedBeverages,
            disliked_beverages: dislikedBeverages,
          });
        }
        setAlreadyRegistered(result.alreadyRegistered);
        setPendingApproval(result.requireApproval);
        // Check if this was an update (either we were editing or backend says it was updated)
        setWasUpdated(isEditing || result.updated);
        setSubmitted(true);
        // Notify parent to refresh data
        onRSVPSuccess?.();

        // Auto-mint NFT if wallet address provided and event has an image
        if (ethereumAddress.trim() && event.eventImageUrl && result.guest?.id) {
          setMintStatus('minting');
          try {
            const mintRes = await mintNFT({
              recipient: ethereumAddress.trim(),
              partyId: event.id,
              guestId: result.guest.id,
              guestName: name.trim(),
              partyName: event.name,
              partyDate: event.date ? new Date(event.date).toISOString().split('T')[0] : null,
              partyVenue: event.venueName || null,
              partyAddress: event.address || null,
              imageUrl: event.eventImageUrl,
              inviteCode: event.customUrl || event.inviteCode,
            });
            setMintResult({ txHash: mintRes.txHash, tokenId: mintRes.tokenId });
            setMintStatus('success');

            // Save NFT data to backend (requires email for verification)
            if (mintRes.txHash && mintRes.tokenId && email.trim()) {
              const API_URL = import.meta.env.VITE_API_URL || '';
              try {
                const saveResponse = await fetch(`${API_URL}/api/nft/guest/${result.guest.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    tokenId: parseInt(mintRes.tokenId),
                    transactionHash: mintRes.txHash,
                    email: email.trim().toLowerCase(),
                  }),
                });

                if (!saveResponse.ok) {
                  const errorData = await saveResponse.json().catch(() => ({}));
                  console.error('Failed to save NFT data:', errorData.error || saveResponse.statusText);
                  // Don't fail the overall success - NFT is minted, just logging failed
                }
              } catch (saveError) {
                console.error('Failed to save NFT data to database:', saveError);
                // Don't fail the overall success - NFT is minted on-chain
              }
            }
          } catch (err) {
            setMintResult({ error: err instanceof Error ? err.message : 'Minting failed' });
            setMintStatus('error');
          }
        }
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
    onClose();
  };

  if (!isOpen) return null;

  const availableBeverages = event.availableBeverages || [];
  const availableToppings = event.availableToppings || [];

  // Success screen
  if (submitted) {
    const getSuccessIcon = () => {
      if (alreadyRegistered && !wasUpdated) return 'bg-[#ff393a]/20 border-[#ff393a]/30';
      if (pendingApproval) return 'bg-[#ffc107]/20 border-[#ffc107]/30';
      return 'bg-[#39d98a]/20 border-[#39d98a]/30';
    };

    const getSuccessTitle = () => {
      if (wasUpdated) return "RSVP Updated!";
      if (alreadyRegistered) return "You're already registered!";
      if (pendingApproval) return "RSVP Submitted!";
      return `See you at ${event.name}!`;
    };

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      >
        <div
          className="card p-8 max-w-md w-full text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border ${getSuccessIcon()}`}>
            {alreadyRegistered && !wasUpdated ? (
              <AlertCircle className="w-8 h-8 text-[#ff393a]" />
            ) : pendingApproval ? (
              <Loader2 className="w-8 h-8 text-[#ffc107]" />
            ) : (
              <Check className="w-8 h-8 text-[#39d98a]" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            {getSuccessTitle()}
          </h1>
          {alreadyRegistered && !wasUpdated && (
            <p className="text-white/60 mb-4">
              This email has already been used to RSVP to this event.
            </p>
          )}
          {wasUpdated && (
            <p className="text-white/60 mb-4">
              Your preferences have been saved.
            </p>
          )}
          {pendingApproval && !alreadyRegistered && (
            <p className="text-white/60 mb-4">
              Your RSVP is pending approval from the host. You'll receive an email with your check-in QR code once approved.
            </p>
          )}
          {ethereumAddress.trim() && event.eventImageUrl && (
            <div className="mt-4 pt-4 border-t border-white/10">
              {mintStatus === 'minting' && (
                <div className="flex items-center gap-2 text-white/60 justify-center">
                  <Loader2 size={16} className="animate-spin" />
                  <span>Minting your NFT...</span>
                </div>
              )}
              {mintStatus === 'success' && mintResult.txHash && (
                <div className="space-y-2">
                  <p className="text-[#39d98a] font-medium">NFT Minted!</p>
                  {mintResult.tokenId && NFT_CONTRACT_ADDRESS && (
                    <a
                      href={`https://opensea.io/assets/base/${NFT_CONTRACT_ADDRESS}/${mintResult.tokenId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-white/60 hover:text-white underline"
                    >
                      View on OpenSea
                    </a>
                  )}
                </div>
              )}
              {mintStatus === 'error' && (
                <p className="text-[#ff393a] text-sm">{mintResult.error || 'NFT minting failed'}</p>
              )}
            </div>
          )}
          <button
            onClick={handleClose}
            className="btn-secondary mt-4"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Step 1 - Personal Info
  if (step === 1) {
    return (
      <div
        className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      >
        <div className="min-h-full flex items-center justify-center p-4">
          <div
            className="card p-8 max-w-lg w-full relative"
            onClick={(e) => e.stopPropagation()}
          >
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>

          <div className="flex items-center gap-3 mb-6">
            <Pizza className="w-10 h-10 text-[#ff393a]" />
            <div>
              <h1 className="text-2xl font-bold text-white">{isEditing ? 'Edit RSVP' : `RSVP to ${event.name}`}</h1>
              <p className="text-sm text-white/60">Step 1 of 2</p>
            </div>
          </div>

          <form onSubmit={handleStep1Continue} className="space-y-3">
            <IconInput
              icon={User}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              required
              autoFocus
            />

            <IconInput
              icon={Mail}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
            />

            <div className="relative">
              <IconInput
                icon={Wallet}
                type="text"
                value={ethereumAddress}
                onChange={(e) => {
                  setEthereumAddress(e.target.value);
                  validateWalletAddress(e.target.value);
                }}
                placeholder="Wallet Address or ENS (e.g. vitalik.eth)"
                className={walletValidation === 'valid' ? 'pr-10 border-[#39d98a]/50' : walletValidation === 'invalid' ? 'border-[#ff393a]/50' : ''}
              />
              {walletValidation === 'valid' && (
                <Check size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#39d98a]" />
              )}
              {walletValidation === 'invalid' && ethereumAddress.trim() && (
                <span className="text-xs text-[#ff393a] mt-1 block">Enter a valid address (0x...) or ENS name (.eth)</span>
              )}
            </div>

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
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${roles.includes(role)
                        ? 'bg-[#ff393a] text-white'
                        : 'bg-white/10 text-white/70 hover:bg-white/20'
                      }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>

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
      </div>
    );
  }

  // Step 2 - Pizza Preferences
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div
          className="card p-8 max-w-2xl w-full relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
        >
          <X size={24} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <Pizza className="w-10 h-10 text-[#ff393a]" />
          <div>
            <h1 className="text-2xl font-bold text-white">{isEditing ? 'Edit Pizza Preferences' : 'Pizza Requests'}</h1>
            <p className="text-sm text-white/60">Step 2 of 2</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-3">
              Diet
            </label>
            <div className="flex flex-wrap gap-2">
              {DIETARY_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggleDietary(option)}
                  className={`px-4 py-2 rounded-lg transition-colors ${dietaryRestrictions.includes(option)
                      ? 'bg-[#ff393a] text-white'
                      : 'bg-white/10 text-white/70 hover:bg-white/20'
                    }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-3">
              Toppings
            </label>
            <div className="flex flex-wrap gap-2">
              {TOPPINGS.filter(t => availableToppings.length === 0 || availableToppings.includes(t.id)).map((topping) => {
                const isLiked = likedToppings.includes(topping.id);
                const isDisliked = dislikedToppings.includes(topping.id);

                return (
                  <div
                    key={topping.id}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${isLiked
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
                        className={`transition-all ${isLiked ? 'text-[#39d98a]' : 'text-white/20'
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
                        className={`transition-all ${isDisliked ? 'text-[#ff393a]' : 'text-white/20'
                          }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

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
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${isLiked
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
                          className={`transition-all ${isLiked ? 'text-[#39d98a]' : 'text-white/20'
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
                          className={`transition-all ${isDisliked ? 'text-[#ff393a]' : 'text-white/20'
                            }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {nearbyPizzerias.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-white/80 mb-3">
                Favorite Pizzerias <span className="text-white/50 font-normal">(click to rank 1-3)</span>
              </label>
              {loadingPizzerias ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 size={20} className="animate-spin text-white/40" />
                </div>
              ) : (
                <div className="space-y-2">
                  {nearbyPizzerias.map((pizzeria) => {
                    const rankIndex = pizzeriaRankings.indexOf(pizzeria.id);
                    const rank = rankIndex !== -1 ? rankIndex + 1 : null;

                    return (
                      <button
                        key={pizzeria.id}
                        type="button"
                        onClick={() => handlePizzeriaClick(pizzeria.id)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${rank
                            ? 'bg-[#ff393a]/20 border-[#ff393a]/30'
                            : 'bg-white/5 border-white/10 hover:bg-white/10'
                          }`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm ${rank
                            ? 'bg-[#ff393a] text-white'
                            : 'bg-white/10 text-white/30'
                          }`}>
                          {rank || '—'}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-white truncate">{pizzeria.name}</span>
                            {pizzeria.rating && (
                              <span className="flex items-center gap-0.5 text-yellow-400 text-xs">
                                <Star size={10} className="fill-yellow-400" />
                                {pizzeria.rating.toFixed(1)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-white/50">
                            <MapPin size={10} />
                            <span className="truncate">{pizzeria.address}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
              {error}
            </div>
          )}

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
                  {isEditing ? 'Saving...' : 'Submitting...'}
                </>
              ) : (
                <>
                  <Pizza size={18} />
                  {isEditing ? 'Edit RSVP' : 'RSVP'}
                </>
              )}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}
