import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, Upload, Instagram, Youtube, Linkedin, Globe, LogOut, Trash2, AlertTriangle, Save, X, User, Mail, ThumbsUp, ThumbsDown, Pizza, Handshake, ExternalLink, Calendar } from 'lucide-react';
import { IconInput } from '../components/IconInput';
import { uploadProfilePicture, getUserPreferences, saveUserPreferences, UserPreferences } from '../lib/supabase';
import { getUserSponsorships, UserSponsorshipEntry } from '../lib/api';
import { DIETARY_OPTIONS, TOPPINGS, DRINKS, getExcludedToppingIds } from '../constants/options';
import { fetchXAvatarToSupabase, isAutoFilledXAvatar } from '../utils/avatarUtils';

export function AccountPage() {
  const { user, loading: authLoading, signOut, updateProfile } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation('account');

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [bio, setBio] = useState('');
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [profilePictureFile, setProfilePictureFile] = useState<File | null>(null);
  // Provenance: tracks the X handle that produced the current profile picture (null = user-set or unknown)
  const [profilePictureFromX, setProfilePictureFromX] = useState<string | null>(null);
  const [xAvatarFetching, setXAvatarFetching] = useState(false);

  // Social links
  const [instagram, setInstagram] = useState('');
  const [twitter, setTwitter] = useState('');
  const [youtube, setYoutube] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [website, setWebsite] = useState('');

  // Pizza preferences
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [likedToppings, setLikedToppings] = useState<string[]>([]);
  const [dislikedToppings, setDislikedToppings] = useState<string[]>([]);
  const [likedBeverages, setLikedBeverages] = useState<string[]>([]);
  const [dislikedBeverages, setDislikedBeverages] = useState<string[]>([]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [originalPreferences, setOriginalPreferences] = useState<UserPreferences | null>(null);

  // Sponsorships
  const [sponsorships, setSponsorships] = useState<UserSponsorshipEntry[]>([]);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Track original values to detect changes
  const [originalValues, setOriginalValues] = useState({
    name: '',
    bio: '',
    instagram: '',
    twitter: '',
    youtube: '',
    tiktok: '',
    linkedin: '',
    website: '',
  });

  // Helper to compare arrays
  const arraysEqual = (a: string[], b: string[]) =>
    a.length === b.length && a.every((v, i) => b.includes(v)) && b.every((v) => a.includes(v));

  // Check if preferences have changed
  const preferencesChanged = originalPreferences
    ? !arraysEqual(dietaryRestrictions, originalPreferences.dietary_restrictions) ||
      !arraysEqual(likedToppings, originalPreferences.liked_toppings) ||
      !arraysEqual(dislikedToppings, originalPreferences.disliked_toppings) ||
      !arraysEqual(likedBeverages, originalPreferences.liked_beverages) ||
      !arraysEqual(dislikedBeverages, originalPreferences.disliked_beverages)
    : dietaryRestrictions.length > 0 ||
      likedToppings.length > 0 ||
      dislikedToppings.length > 0 ||
      likedBeverages.length > 0 ||
      dislikedBeverages.length > 0;

  // Check if any field has changed
  const hasChanges =
    name !== originalValues.name ||
    bio !== originalValues.bio ||
    instagram !== originalValues.instagram ||
    twitter !== originalValues.twitter ||
    youtube !== originalValues.youtube ||
    tiktok !== originalValues.tiktok ||
    linkedin !== originalValues.linkedin ||
    website !== originalValues.website ||
    profilePictureFile !== null ||
    (profilePicture !== null && !profilePicture.startsWith('blob:') && profilePicture !== (user?.profilePictureUrl || null)) ||
    preferencesChanged;

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login');
    }
  }, [user, authLoading, navigate]);

  // Load user data
  useEffect(() => {
    if (user) {
      const values = {
        name: user.name || '',
        bio: user.bio || '',
        instagram: user.instagram || '',
        twitter: user.twitter || '',
        youtube: user.youtube || '',
        tiktok: user.tiktok || '',
        linkedin: user.linkedin || '',
        website: user.website || '',
      };
      setName(values.name);
      setEmail(user.email || '');
      setBio(values.bio);
      setInstagram(values.instagram);
      setTwitter(values.twitter);
      setYoutube(values.youtube);
      setTiktok(values.tiktok);
      setLinkedin(values.linkedin);
      setWebsite(values.website);
      if (user.profilePictureUrl) {
        setProfilePicture(user.profilePictureUrl);
      }
      setOriginalValues(values);
    }
  }, [user]);

  // Load user preferences
  useEffect(() => {
    async function loadPreferences() {
      if (user?.email && !preferencesLoaded) {
        const prefs = await getUserPreferences(user.email);
        if (prefs) {
          setDietaryRestrictions(prefs.dietary_restrictions);
          setLikedToppings(prefs.liked_toppings);
          setDislikedToppings(prefs.disliked_toppings);
          setLikedBeverages(prefs.liked_beverages);
          setDislikedBeverages(prefs.disliked_beverages);
          setOriginalPreferences(prefs);
        }
        setPreferencesLoaded(true);
      }
    }
    loadPreferences();
  }, [user?.email, preferencesLoaded]);

  // Load sponsorships
  useEffect(() => {
    async function loadSponsorships() {
      if (user) {
        try {
          const data = await getUserSponsorships();
          setSponsorships(data);
        } catch (err) {
          // Silently fail - section just won't show
          console.error('Failed to load sponsorships:', err);
        }
      }
    }
    loadSponsorships();
  }, [user]);

  // Auto-deselect liked toppings that conflict with selected dietary restrictions
  useEffect(() => {
    const excluded = getExcludedToppingIds(dietaryRestrictions);
    if (excluded.size > 0) {
      setLikedToppings(prev => prev.filter(id => !excluded.has(id)));
    }
  }, [dietaryRestrictions]);

  const handleProfilePictureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);

    if (!file.type.startsWith('image/')) {
      setUploadError(t('profile.uploadError'));
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setUploadError(t('profile.uploadSizeError'));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setProfilePictureFile(file);
    setProfilePicture(objectUrl);
    // User is taking ownership of the avatar slot — drop X provenance
    setProfilePictureFromX(null);
  };

  // Pizza preference handlers
  const toggleDietary = (option: string) => {
    setDietaryRestrictions(prev =>
      prev.includes(option)
        ? prev.filter(d => d !== option)
        : [...prev, option]
    );
  };

  const handleToppingLike = (id: string) => {
    if (likedToppings.includes(id)) {
      setLikedToppings(prev => prev.filter(t => t !== id));
    } else {
      setLikedToppings(prev => [...prev, id]);
      setDislikedToppings(prev => prev.filter(t => t !== id));
    }
  };

  const handleToppingDislike = (id: string) => {
    if (dislikedToppings.includes(id)) {
      setDislikedToppings(prev => prev.filter(t => t !== id));
    } else {
      setDislikedToppings(prev => [...prev, id]);
      setLikedToppings(prev => prev.filter(t => t !== id));
    }
  };

  const handleDrinkLike = (id: string) => {
    if (likedBeverages.includes(id)) {
      setLikedBeverages(prev => prev.filter(d => d !== id));
    } else {
      setLikedBeverages(prev => [...prev, id]);
      setDislikedBeverages(prev => prev.filter(d => d !== id));
    }
  };

  const handleDrinkDislike = (id: string) => {
    if (dislikedBeverages.includes(id)) {
      setDislikedBeverages(prev => prev.filter(d => d !== id));
    } else {
      setDislikedBeverages(prev => [...prev, id]);
      setLikedBeverages(prev => prev.filter(d => d !== id));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      // Upload profile picture if one was selected
      let newProfilePictureUrl: string | undefined;
      if (profilePictureFile && user) {
        const uploadedUrl = await uploadProfilePicture(profilePictureFile, user.id);
        if (uploadedUrl) {
          newProfilePictureUrl = uploadedUrl;
        } else {
          setUploadError(t('profile.uploadFailed'));
        }
      } else if (
        profilePicture &&
        !profilePicture.startsWith('blob:') &&
        profilePicture !== user?.profilePictureUrl
      ) {
        // Profile picture was set via URL (e.g. X avatar auto-fill), not file upload
        newProfilePictureUrl = profilePicture;
      }

      // Save profile to backend
      await updateProfile({
        name: name.trim() || undefined,
        bio: bio.trim() || undefined,
        instagram: instagram.trim() || undefined,
        twitter: twitter.trim() || undefined,
        youtube: youtube.trim() || undefined,
        tiktok: tiktok.trim() || undefined,
        linkedin: linkedin.trim() || undefined,
        website: website.trim() || undefined,
        ...(newProfilePictureUrl && { profilePictureUrl: newProfilePictureUrl }),
      });

      // Save pizza preferences if changed
      if (preferencesChanged && user?.email) {
        await saveUserPreferences(user.email, {
          dietary_restrictions: dietaryRestrictions,
          liked_toppings: likedToppings,
          disliked_toppings: dislikedToppings,
          liked_beverages: likedBeverages,
          disliked_beverages: dislikedBeverages,
        });
        setOriginalPreferences({
          dietary_restrictions: dietaryRestrictions,
          liked_toppings: likedToppings,
          disliked_toppings: dislikedToppings,
          liked_beverages: likedBeverages,
          disliked_beverages: dislikedBeverages,
        });
      }

      // Update original values to current values
      setOriginalValues({
        name,
        bio,
        instagram,
        twitter,
        youtube,
        tiktok,
        linkedin,
        website,
      });
      setProfilePictureFile(null);

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save profile:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    signOut();
    navigate('/');
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    // TODO: Call API to delete user account and all associated data
    await new Promise(resolve => setTimeout(resolve, 500));
    signOut();
    navigate('/');
  };

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 size={32} className="animate-spin text-theme-text-secondary" />
        </div>
      </Layout>
    );
  }

  if (!user) {
    return null;
  }

  const excludedToppings = getExcludedToppingIds(dietaryRestrictions);

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="card p-8 relative">
          {/* Close button */}
          <button
            type="button"
            onClick={() => navigate('/')}
            className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text transition-colors"
          >
            <X size={24} />
          </button>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-theme-text mb-2">{t('profile.title')}</h1>
            <p className="text-theme-text-secondary">{t('profile.subtitle')}</p>
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            {/* Name and Profile Picture Row */}
            <div className="flex flex-col md:flex-row gap-6">
              <div className="flex-1 space-y-4">
                {/* Name */}
                <IconInput
                  icon={User}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('profile.namePlaceholder')}
                />

                {/* Email */}
                <IconInput
                  icon={Mail}
                  type="email"
                  value={email}
                  placeholder={t('profile.emailPlaceholder')}
                  disabled
                />
              </div>

              {/* Profile Picture */}
              <div className="flex-shrink-0">
                <div className="relative">
                  <input
                    type="file"
                    id="profilePicture"
                    accept="image/*"
                    onChange={handleProfilePictureChange}
                    className="hidden"
                  />
                  <label
                    htmlFor="profilePicture"
                    className="block w-24 h-24 rounded-full cursor-pointer overflow-hidden bg-[#ff393a]/20 border-2 border-theme-stroke hover:border-[#ff393a]/50 transition-colors"
                  >
                    {profilePicture ? (
                      <img
                        src={profilePicture}
                        alt="Profile"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-4xl">🍕</span>
                      </div>
                    )}
                  </label>
                  <label
                    htmlFor="profilePicture"
                    className="absolute -bottom-1 -right-1 w-8 h-8 bg-theme-header border-2 border-theme-stroke-hover rounded-full flex items-center justify-center cursor-pointer hover:bg-theme-surface-hover transition-colors"
                  >
                    <Upload size={14} className="text-theme-text-secondary" />
                  </label>
                </div>
              </div>
              {uploadError && (
                <p className="text-xs text-red-400 mt-1">{uploadError}</p>
              )}
            </div>

            {/* Bio */}
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder={t('profile.bioPlaceholder')}
              className="w-full"
              rows={3}
            />

            {/* Social Links */}
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Instagram */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 flex-shrink-0">
                    <Instagram size={16} className="text-theme-text-muted" />
                    <span className="text-theme-text-muted text-sm">instagram.com/</span>
                  </div>
                  <input
                    type="text"
                    value={instagram}
                    onChange={(e) => setInstagram(e.target.value)}
                    placeholder="username"
                    className="flex-1 min-w-0"
                  />
                </div>

                {/* X (Twitter) */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 flex-shrink-0">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-theme-text-muted fill-current">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    <span className="text-theme-text-muted text-sm">x.com/</span>
                  </div>
                  <div className="relative flex-1 min-w-0">
                    <input
                      type="text"
                      value={twitter}
                      onChange={(e) => setTwitter(e.target.value)}
                      onBlur={async () => {
                        if (profilePictureFile) return;
                        const handle = twitter.trim();
                        if (!handle) return;
                        // Skip partial-handle lookups that resolve to wrong users
                        if (handle.length < 4) return;
                        // Already current for this handle — no-op
                        if (profilePictureFromX === handle) return;
                        // First-time fetch: only auto-fill empty slot or legacy unavatar URL
                        if (profilePictureFromX == null) {
                          if (profilePicture && !isAutoFilledXAvatar(profilePicture)) return;
                        }
                        setXAvatarFetching(true);
                        try {
                          const avatarUrl = await fetchXAvatarToSupabase(twitter);
                          if (avatarUrl) {
                            setProfilePicture(avatarUrl);
                            setProfilePictureFromX(handle);
                          }
                        } finally {
                          setXAvatarFetching(false);
                        }
                      }}
                      disabled={xAvatarFetching}
                      placeholder="username"
                      className="w-full disabled:opacity-60"
                    />
                    {xAvatarFetching && (
                      <Loader2
                        size={14}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted animate-spin pointer-events-none"
                      />
                    )}
                  </div>
                </div>

                {/* YouTube */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 flex-shrink-0">
                    <Youtube size={16} className="text-theme-text-muted" />
                    <span className="text-theme-text-muted text-sm">youtube.com/@</span>
                  </div>
                  <input
                    type="text"
                    value={youtube}
                    onChange={(e) => setYoutube(e.target.value)}
                    placeholder="channel"
                    className="flex-1 min-w-0"
                  />
                </div>

                {/* TikTok */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 flex-shrink-0">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-theme-text-muted fill-current">
                      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
                    </svg>
                    <span className="text-theme-text-muted text-sm">tiktok.com/@</span>
                  </div>
                  <input
                    type="text"
                    value={tiktok}
                    onChange={(e) => setTiktok(e.target.value)}
                    placeholder="username"
                    className="flex-1 min-w-0"
                  />
                </div>

                {/* LinkedIn */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 flex-shrink-0">
                    <Linkedin size={16} className="text-theme-text-muted" />
                    <span className="text-theme-text-muted text-sm">linkedin.com</span>
                  </div>
                  <input
                    type="text"
                    value={linkedin}
                    onChange={(e) => setLinkedin(e.target.value)}
                    placeholder="/in/handle"
                    className="flex-1 min-w-0"
                  />
                </div>

                {/* Website */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 flex-shrink-0">
                    <Globe size={16} className="text-theme-text-muted" />
                  </div>
                  <input
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://yourwebsite.com"
                    className="flex-1 min-w-0"
                  />
                </div>
              </div>
            </div>

            {/* Pizza Preferences */}
            <div className="pt-6 border-t border-theme-stroke">
              <div className="flex items-center gap-3 mb-6">
                <Pizza className="w-6 h-6 text-[#ff393a]" />
                <h2 className="text-lg font-semibold text-theme-text">{t('profile.pizzaPreferences')}</h2>
              </div>

              {/* Dietary Restrictions */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-theme-text mb-3">
                  {t('profile.diet')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {DIETARY_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => toggleDietary(option)}
                      className={`px-4 py-2 rounded-lg transition-colors ${dietaryRestrictions.includes(option)
                          ? 'bg-[#ff393a] text-white'
                          : 'bg-theme-surface-hover text-theme-text-secondary hover:bg-theme-surface-hover'
                        }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toppings */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-theme-text mb-3">
                  {t('profile.toppings')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {TOPPINGS.map((topping) => {
                    const isLiked = likedToppings.includes(topping.id);
                    const isDisliked = dislikedToppings.includes(topping.id);
                    const isExcluded = excludedToppings.has(topping.id);

                    return (
                      <div
                        key={topping.id}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${isExcluded
                            ? 'opacity-40 cursor-not-allowed bg-theme-surface border-theme-stroke'
                            : isLiked
                              ? 'bg-[#39d98a]/20 border-[#39d98a]/30'
                              : isDisliked
                                ? 'bg-[#ff393a]/20 border-[#ff393a]/30'
                                : 'bg-theme-surface border-theme-stroke'
                          }`}
                      >
                        <button
                          type="button"
                          onClick={() => !isExcluded && handleToppingLike(topping.id)}
                          disabled={isExcluded}
                          className={`flex items-center gap-1.5 flex-1 py-0.5 transition-opacity ${isExcluded ? 'cursor-not-allowed' : 'hover:opacity-70'}`}
                        >
                          <ThumbsUp
                            size={12}
                            className={`transition-all ${isLiked ? 'text-[#39d98a]' : 'text-theme-text-faint'
                              }`}
                          />
                          <span className={`text-xs ${isExcluded ? 'line-through text-theme-text-muted' : 'text-theme-text'}`}>{topping.name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => !isExcluded && handleToppingDislike(topping.id)}
                          disabled={isExcluded}
                          className={`p-0.5 transition-opacity ${isExcluded ? 'cursor-not-allowed' : 'hover:opacity-70'}`}
                        >
                          <ThumbsDown
                            size={12}
                            className={`transition-all ${isDisliked ? 'text-[#ff393a]' : 'text-theme-text-faint'
                              }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Drinks */}
              <div>
                <label className="block text-sm font-medium text-theme-text mb-3">
                  {t('profile.drinkPreferences')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {DRINKS.map((drink) => {
                    const isLiked = likedBeverages.includes(drink.id);
                    const isDisliked = dislikedBeverages.includes(drink.id);

                    return (
                      <div
                        key={drink.id}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${isLiked
                            ? 'bg-[#39d98a]/20 border-[#39d98a]/30'
                            : isDisliked
                              ? 'bg-[#ff393a]/20 border-[#ff393a]/30'
                              : 'bg-theme-surface border-theme-stroke'
                          }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleDrinkLike(drink.id)}
                          className="flex items-center gap-1.5 flex-1 py-0.5 hover:opacity-70 transition-opacity"
                        >
                          <ThumbsUp
                            size={12}
                            className={`transition-all ${isLiked ? 'text-[#39d98a]' : 'text-theme-text-faint'
                              }`}
                          />
                          <span className="text-theme-text text-xs">{drink.name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDrinkDislike(drink.id)}
                          className="p-0.5 hover:opacity-70 transition-opacity"
                        >
                          <ThumbsDown
                            size={12}
                            className={`transition-all ${isDisliked ? 'text-[#ff393a]' : 'text-theme-text-faint'
                              }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Sponsorships Section - only show if user has sponsorships */}
            {sponsorships.length > 0 && (
              <div className="pt-6 border-t border-theme-stroke">
                <div className="flex items-center gap-3 mb-6">
                  <Handshake className="w-6 h-6 text-[#ff393a]" />
                  <h2 className="text-lg font-semibold text-theme-text">{t('profile.sponsorships')}</h2>
                </div>

                <div className="space-y-4">
                  {sponsorships.map((s) => {
                    const eventUrl = `/${s.party.customUrl || s.party.id}`;
                    const statusColors: Record<string, string> = {
                      paid: 'bg-[#39d98a]/20 text-[#39d98a]',
                      yes: 'bg-[#5b8af5]/20 text-[#5b8af5]',
                      billed: 'bg-[#f5c85b]/20 text-[#f5c85b]',
                      stuck: 'bg-[#ff393a]/20 text-[#ff393a]',
                    };
                    const statusColor = statusColors[s.status] || 'bg-theme-surface-hover text-theme-text-secondary';
                    const typeLabels: Record<string, string> = {
                      cash: 'Cash',
                      'in-kind': 'In-Kind',
                      venue: 'Venue',
                      pizza: 'Pizza',
                      drinks: 'Drinks',
                      community: 'Community',
                      other: 'Other',
                    };

                    return (
                      <div
                        key={s.id}
                        className="bg-theme-surface border border-theme-stroke rounded-xl p-4"
                      >
                        <div className="flex items-start gap-4">
                          {/* Brand logo */}
                          {s.brandLogo && (
                            <img
                              src={s.brandLogo}
                              alt={s.brandName}
                              className="w-12 h-12 rounded-lg object-contain bg-white flex-shrink-0"
                            />
                          )}

                          <div className="flex-1 min-w-0">
                            {/* Brand name + badges */}
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className="font-semibold text-theme-text truncate">{s.brandName}</span>
                              {s.sponsorshipType && (
                                <span className="px-2 py-0.5 rounded-full text-xs bg-theme-surface-hover text-theme-text-secondary">
                                  {typeLabels[s.sponsorshipType] || s.sponsorshipType}
                                </span>
                              )}
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
                                {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                              </span>
                            </div>

                            {/* Event link */}
                            <Link
                              to={eventUrl}
                              className="inline-flex items-center gap-1.5 text-sm text-[#ff393a] hover:text-[#ff393a]/80 transition-colors mb-1"
                            >
                              <ExternalLink size={12} />
                              {s.party.name}
                            </Link>

                            {/* Amount (if cash) */}
                            {s.sponsorshipType === 'cash' && s.amount != null && (
                              <p className="text-sm text-theme-text-secondary">
                                ${s.amount.toLocaleString()}
                              </p>
                            )}

                            {/* Brand description */}
                            {s.brandDescription && (
                              <p className="text-sm text-theme-text-muted mt-1 line-clamp-2">
                                {s.brandDescription}
                              </p>
                            )}

                            {/* Submission date */}
                            <div className="flex items-center gap-1.5 mt-2 text-xs text-theme-text-faint">
                              <Calendar size={11} />
                              {t('profile.submitted', { date: new Date(s.intakeSubmittedAt).toLocaleDateString() })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Save Button - only show when there are changes */}
            {(hasChanges || saving || saved) && (
              <div className="flex items-center gap-4">
                <button
                  type="submit"
                  disabled={saving || !hasChanges}
                  className="btn-primary flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      {t('profile.saving')}
                    </>
                  ) : saved ? (
                    t('profile.saved')
                  ) : (
                    <>
                      <Save size={18} />
                      {t('profile.save')}
                    </>
                  )}
                </button>
              </div>
            )}
          </form>

          {/* Logout Section */}
          <div className="mt-12 pt-6 border-t border-theme-stroke flex items-center justify-between">
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-theme-text-secondary hover:text-theme-text transition-colors"
            >
              <LogOut size={18} />
              {t('profile.logOut')}
            </button>

            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-2 text-[#ff393a]/60 hover:text-[#ff393a] transition-colors"
            >
              <Trash2 size={18} />
              {t('profile.deleteAccount')}
            </button>
          </div>
        </div>

        {/* Delete Account Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
            <div className="card p-6 max-w-md w-full">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-[#ff393a]/20 rounded-full flex items-center justify-center">
                  <AlertTriangle size={24} className="text-[#ff393a]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-theme-text">{t('profile.deleteConfirmTitle')}</h2>
                  <p className="text-theme-text-secondary text-sm">{t('profile.deleteConfirmSubtitle')}</p>
                </div>
              </div>

              <p className="text-theme-text-secondary mb-6">
                {t('profile.deleteConfirmMessage')}
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 btn-secondary"
                  disabled={deleting}
                >
                  {t('profile.cancel')}
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className="flex-1 bg-[#ff393a] hover:bg-[#ff393a]/80 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      {t('profile.deleting')}
                    </>
                  ) : (
                    <>
                      <Trash2 size={18} />
                      {t('profile.deleteAccount')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
