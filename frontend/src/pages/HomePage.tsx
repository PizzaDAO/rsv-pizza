import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { TimePickerInput } from '../components/TimePickerInput';
import { TimezonePickerInput } from '../components/TimezonePickerInput';
import { LocationAutocomplete } from '../components/LocationAutocomplete';
import { LoginModal } from '../components/LoginModal';
import { useAuth } from '../contexts/AuthContext';
import { Calendar, User, Loader2, Users, Lock, Image, FileText, Upload, Trash2, ChevronDown, ChevronUp, Square as SquareIcon, CheckSquare2, Play, Plus, MapPin, Crown } from 'lucide-react';
import { createParty as createPartyAPI, uploadEventImage, getUserParties, UserParty } from '../lib/supabase';
import { CustomUrlInput } from '../components/CustomUrlInput';

export function HomePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const startDateInputRef = React.useRef<HTMLInputElement>(null);
  const endDateInputRef = React.useRef<HTMLInputElement>(null);

  // Parties state for signed-in users
  const [userParties, setUserParties] = useState<UserParty[]>([]);
  const [partiesLoading, setPartiesLoading] = useState(false);
  const [eventFilter, setEventFilter] = useState<'upcoming' | 'past'>('upcoming');

  // Form state
  const [partyName, setPartyName] = useState('');
  const [hostName, setHostName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timezone, setTimezone] = useState('');
  const [expectedGuests, setExpectedGuests] = useState('');
  const [partyAddress, setPartyAddress] = useState('');
  const [partyPassword, setPartyPassword] = useState('');
  const [eventImageUrl, setEventImageUrl] = useState('');
  const [eventImageFile, setEventImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [eventDescription, setEventDescription] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customUrlValid, setCustomUrlValid] = useState(true);
  const [customUrlError, setCustomUrlError] = useState<string | undefined>();
  const [requireApproval, setRequireApproval] = useState(false);
  const [limitGuests, setLimitGuests] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showDateTimeModal, setShowDateTimeModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Load user's parties when signed in
  useEffect(() => {
    if (user?.email) {
      setPartiesLoading(true);
      getUserParties(user.email)
        .then(parties => {
          setUserParties(parties);
        })
        .catch(err => {
          console.error('Error loading user parties:', err);
        })
        .finally(() => {
          setPartiesLoading(false);
        });
    } else {
      setUserParties([]);
    }
  }, [user?.email]);

  // Get user's timezone on mount
  React.useEffect(() => {
    try {
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setTimezone(userTimezone);
    } catch (error) {
      // Fallback to UTC if timezone detection fails
      console.warn('Timezone detection failed, using UTC', error);
      setTimezone('UTC');
    }
  }, []);

  // Check for pending party form data after auth redirect
  const pendingFormProcessed = React.useRef(false);
  React.useEffect(() => {
    if (!user || pendingFormProcessed.current) return;

    const savedForm = sessionStorage.getItem('pendingPartyForm');
    if (savedForm) {
      pendingFormProcessed.current = true;
      sessionStorage.removeItem('pendingPartyForm');

      try {
        const formData = JSON.parse(savedForm);
        // Auto-create party with saved form data
        createPartyFromSavedData(formData);
      } catch (err) {
        console.error('Failed to restore form data:', err);
      }
    }
  }, [user]);

  // Create party from saved form data (after auth redirect)
  const createPartyFromSavedData = async (formData: any) => {
    setCreating(true);

    try {
      const guestCount = formData.expectedGuests ? parseInt(formData.expectedGuests, 10) : undefined;
      const password = formData.partyPassword?.trim() || undefined;
      const description = formData.eventDescription?.trim() || undefined;
      const urlSlug = formData.customUrl?.trim() || undefined;

      // Calculate duration from start/end times
      let duration: number | undefined;
      let startDateTime: string | undefined;
      if (formData.startDate && formData.startTime && formData.endDate && formData.endTime) {
        const start = new Date(`${formData.startDate}T${formData.startTime}`);
        const end = new Date(`${formData.endDate}T${formData.endTime}`);
        const durationMs = end.getTime() - start.getTime();
        duration = durationMs / (1000 * 60 * 60);
        startDateTime = start.toISOString();
      } else if (formData.startDate && formData.startTime) {
        startDateTime = new Date(`${formData.startDate}T${formData.startTime}`).toISOString();
      }

      const imageUrl = formData.eventImageUrl?.trim() || undefined;

      // Use logged-in user's name as host if available
      const effectiveHostName = user?.name || formData.hostName?.trim() || undefined;

      const party = await createPartyAPI(
        formData.partyName?.trim() || undefined,
        effectiveHostName,
        startDateTime,
        'new-york',
        guestCount,
        formData.partyAddress?.trim() || undefined,
        [],
        duration,
        password,
        imageUrl,
        description,
        urlSlug,
        formData.timezone || undefined,
        user?.email
      );

      setCreating(false);

      if (party?.invite_code) {
        navigate(`/host/${party.invite_code}`);
      }
    } catch (error) {
      console.error('Error creating party:', error);
      setCreating(false);
    }
  };

  // Format date for display
  const formatDateDisplay = (date: string) => {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // Format time for display (12-hour)
  const formatTimeDisplay = (time: string) => {
    if (!time) return '';
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${hours12.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  // Get timezone abbreviation
  const getTimezoneAbbr = () => {
    if (!timezone) return '';
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'short'
      });
      const parts = formatter.formatToParts(new Date());
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      return tzPart?.value || '';
    } catch {
      return '';
    }
  };

  // Format party date for display
  const formatPartyDate = (dateStr: string | null) => {
    if (!dateStr) return 'Date TBD';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Revoke previous preview URL if it exists
    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview);
    }

    setImageError(null);

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setImageError('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setImageError('Image must be less than 5MB');
      return;
    }

    // Validate square aspect ratio
    const img = new window.Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const aspectRatio = img.width / img.height;

      // Allow some tolerance (0.9 to 1.1 is considered square)
      if (aspectRatio < 0.9 || aspectRatio > 1.1) {
        setImageError('Image must be square (1:1 aspect ratio)');
        setEventImageFile(null);
        setImagePreview(null);
        URL.revokeObjectURL(objectUrl);
        return;
      }

      // Image is valid
      setEventImageFile(file);
      setImagePreview(objectUrl);
      // Don't revoke URL - we need it for the preview
    };

    img.onerror = () => {
      setImageError('Failed to load image');
      URL.revokeObjectURL(objectUrl);
    };

    img.src = objectUrl;
  };

  const removeImage = () => {
    // Revoke the object URL if it exists to free memory
    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview);
    }
    setEventImageFile(null);
    setImagePreview(null);
    setImageError(null);
    setEventImageUrl('');
  };

  const handleCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();

    // Show sign-in modal if user is not authenticated
    if (!user) {
      // Save form data to restore after auth
      const formData = {
        partyName, hostName, startDate, startTime, endDate, endTime, timezone,
        expectedGuests, partyAddress, partyPassword, eventImageUrl, eventDescription,
        customUrl, requireApproval, limitGuests
      };
      sessionStorage.setItem('pendingPartyForm', JSON.stringify(formData));
      sessionStorage.setItem('authReturnUrl', '/');
      setShowLoginModal(true);
      return;
    }

    setCreating(true);

    try {
      const guestCount = expectedGuests ? parseInt(expectedGuests, 10) : undefined;
      const password = partyPassword.trim() || undefined;
      const description = eventDescription.trim() || undefined;
      const urlSlug = customUrl.trim() || undefined;

      // Check if custom URL is valid (already validated by CustomUrlInput)
      if (urlSlug && !customUrlValid) {
        setImageError(customUrlError || 'Invalid custom URL');
        setCreating(false);
        return;
      }

      // Calculate duration from start/end times
      let duration: number | undefined;
      let startDateTime: string | undefined;
      if (startDate && startTime && endDate && endTime) {
        const start = new Date(`${startDate}T${startTime}`);
        const end = new Date(`${endDate}T${endTime}`);
        const durationMs = end.getTime() - start.getTime();
        duration = durationMs / (1000 * 60 * 60); // Convert to hours
        startDateTime = start.toISOString();
      } else if (startDate && startTime) {
        startDateTime = new Date(`${startDate}T${startTime}`).toISOString();
      }

      // Upload image if file is selected
      let imageUrl = eventImageUrl.trim() || undefined;
      if (eventImageFile) {
        const uploadedUrl = await uploadEventImage(eventImageFile);
        if (uploadedUrl) {
          imageUrl = uploadedUrl;
        } else {
          setImageError('Failed to upload image. Please try again.');
          setCreating(false);
          return;
        }
      }

      // Use logged-in user's name as host if available
      const effectiveHostName = user?.name || hostName.trim() || undefined;

      const party = await createPartyAPI(
        partyName.trim() || undefined,
        effectiveHostName,
        startDateTime,
        'new-york',
        guestCount,
        partyAddress.trim() || undefined,
        [],
        duration,
        password,
        imageUrl,
        description,
        urlSlug,
        timezone || undefined,
        user?.email
      );

      setCreating(false);

      // Navigate to host page
      if (party?.invite_code) {
        navigate(`/host/${party.invite_code}`);
      } else {
        setImageError('Failed to create party. Please try again.');
      }
    } catch (error) {
      console.error('Error creating party:', error);
      setImageError('Failed to create party. Please try again.');
      setCreating(false);
    }
  };

  // Show loading state while auth is loading
  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 size={32} className="animate-spin text-white/60" />
        </div>
      </Layout>
    );
  }

  // If user is signed in and has parties, show parties list
  if (user && (userParties.length > 0 || partiesLoading)) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-white mb-2">Your Events</h1>
            <p className="text-white/60">Events you're hosting or attending</p>
          </div>

          {/* Upcoming/Past Toggle */}
          <div className="flex mb-6">
            <div className="inline-flex bg-white/5 border border-white/10 rounded-xl p-1">
              <button
                type="button"
                onClick={() => setEventFilter('upcoming')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  eventFilter === 'upcoming'
                    ? 'bg-white text-black'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Upcoming
              </button>
              <button
                type="button"
                onClick={() => setEventFilter('past')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  eventFilter === 'past'
                    ? 'bg-white text-black'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Past
              </button>
            </div>
          </div>

          {partiesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={32} className="animate-spin text-white/60" />
            </div>
          ) : (
            <div className="space-y-3 mb-8">
              {(() => {
                const now = new Date();
                const filteredParties = userParties.filter(party => {
                  const partyDate = party.date ? new Date(party.date) : null;
                  if (eventFilter === 'upcoming') {
                    return !partyDate || partyDate >= now;
                  } else {
                    return partyDate && partyDate < now;
                  }
                });

                if (filteredParties.length === 0) {
                  return (
                    <div className="text-center py-8 text-white/50">
                      No {eventFilter} events
                    </div>
                  );
                }

                return filteredParties.map(party => (
                <Link
                  key={party.id}
                  to={party.userRole === 'host' ? `/host/${party.invite_code}` : `/rsvp/${party.invite_code}`}
                  className="block card p-4 hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    {/* Event Image or Placeholder */}
                    {party.event_image_url ? (
                      <img
                        src={party.event_image_url}
                        alt={party.name}
                        className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#ff393a]/20 to-[#ff5a5b]/20 border border-white/10 flex items-center justify-center flex-shrink-0">
                        <Calendar size={24} className="text-white/40" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-white truncate">{party.name}</h3>
                        {party.userRole === 'host' && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-[#ff393a]/20 border border-[#ff393a]/30 rounded-full text-xs text-[#ff393a] flex-shrink-0">
                            <Crown size={10} />
                            Host
                          </span>
                        )}
                      </div>

                      <p className="text-sm text-white/60 mb-1">
                        {formatPartyDate(party.date)}
                      </p>

                      <div className="flex items-center gap-4 text-xs text-white/50">
                        {party.address && (
                          <span className="flex items-center gap-1 truncate">
                            <MapPin size={12} />
                            {party.address.split(',')[0]}
                          </span>
                        )}
                        {party.guestCount !== undefined && (
                          <span className="flex items-center gap-1">
                            <Users size={12} />
                            {party.guestCount} guest{party.guestCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ));
              })()}
            </div>
          )}

          {/* Create Party Button */}
          <Link
            to="/new"
            className="btn-primary w-full flex items-center justify-center gap-2 text-lg py-4"
          >
            <Plus size={20} />
            Create Party
          </Link>
        </div>
      </Layout>
    );
  }

  // Default: Show event creation form (for non-signed-in users or users with no parties)
  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="card p-8">
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <input
                type="text"
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                placeholder="Party Name"
                className="w-full pl-3"
                autoFocus
              />
            </div>

            {/* Host Name - only show if user is not logged in or doesn't have a name */}
            {(!user || !user.name) && (
              <div className="relative">
                <User size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                <input
                  type="text"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="Host Name"
                  className="w-full !pl-14"
                />
              </div>
            )}

            {/* Mobile: Date/Time Button */}
            <button
              type="button"
              onClick={() => setShowDateTimeModal(true)}
              className="md:hidden w-full bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Play size={18} className="text-white/40 flex-shrink-0" />
                {startDate && startTime && endDate && endTime ? (
                  <div>
                    <div className="text-white font-medium">
                      {formatDateDisplay(startDate)}
                    </div>
                    <div className="text-white/60 text-sm mt-1">
                      {formatTimeDisplay(startTime)} — {formatTimeDisplay(endTime)} {getTimezoneAbbr()}
                    </div>
                  </div>
                ) : (
                  <div>
                    <span className="text-white/60">Thursday, January 15</span>
                    <div className="text-white/40 text-sm mt-1">2:00 PM — 3:00 PM EST</div>
                  </div>
                )}
              </div>
            </button>

            {/* Desktop: Inline Date/Time Picker */}
            <div className="hidden md:block bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-start gap-4">
                <div className="flex-1 space-y-3">
                  {/* Start Time */}
                  <div className="flex items-center gap-3">
                    <div
                      className="relative flex-1 cursor-pointer"
                      onClick={() => startDateInputRef.current?.showPicker?.()}
                    >
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        <Play size={21} className="text-white/40" />
                      </div>
                      <input
                        ref={startDateInputRef}
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                          setStartDate(e.target.value);
                          // Auto-populate end date if empty
                          if (!endDate) setEndDate(e.target.value);
                        }}
                        className="w-full bg-transparent border-none text-white text-sm text-right focus:outline-none focus:ring-0 p-0 pl-12 pr-2 cursor-pointer [&::-webkit-calendar-picker-indicator]:hidden"
                        style={{ colorScheme: 'dark' }}
                      />
                    </div>
                    <TimePickerInput
                      value={startTime}
                      onChange={setStartTime}
                      placeholder="12:30 PM"
                    />
                  </div>

                  {/* End Time */}
                  <div className="flex items-center gap-3">
                    <div
                      className="relative flex-1 cursor-pointer"
                      onClick={() => endDateInputRef.current?.showPicker?.()}
                    >
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        <SquareIcon size={17} className="text-white/40" />
                      </div>
                      <input
                        ref={endDateInputRef}
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full bg-transparent border-none text-white text-sm text-right focus:outline-none focus:ring-0 p-0 pl-12 pr-2 cursor-pointer [&::-webkit-calendar-picker-indicator]:hidden"
                        style={{ colorScheme: 'dark' }}
                      />
                    </div>
                    <TimePickerInput
                      value={endTime}
                      onChange={setEndTime}
                      placeholder="01:30 PM"
                    />
                  </div>
                </div>

                {/* Timezone Picker */}
                <TimezonePickerInput
                  value={timezone}
                  onChange={setTimezone}
                />
              </div>
            </div>

            <LocationAutocomplete
              value={partyAddress}
              onChange={setPartyAddress}
              placeholder="Add Event Location"
            />

            <div className="relative">
              <FileText size={20} className="absolute left-3 top-3 text-white/40 pointer-events-none" />
              <textarea
                value={eventDescription}
                onChange={(e) => setEventDescription(e.target.value)}
                placeholder="Add Description"
                className="w-full !pl-14"
                rows={3}
              />
            </div>

            <div>
              {/* File Upload */}
              {imagePreview ? (
                <div className="space-y-3 mb-3">
                  <div className="relative w-full max-w-xs mx-auto">
                    <img
                      src={imagePreview}
                      alt="Event flyer preview"
                      className="w-full h-auto rounded-xl border-2 border-white/20"
                    />
                    <button
                      type="button"
                      onClick={removeImage}
                      className="absolute top-2 right-2 p-2 bg-red-500/90 hover:bg-red-600 rounded-full text-white transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative mb-3">
                  <input
                    type="file"
                    id="eventImage"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="hidden"
                    disabled={!!eventImageUrl.trim()}
                  />
                  <label
                    htmlFor="eventImage"
                    className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-white/20 rounded-xl cursor-pointer hover:border-[#ff393a]/50 transition-colors bg-white/5 hover:bg-white/10 ${
                      eventImageUrl.trim() ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    <Upload className="w-8 h-8 text-white/40 mb-2" />
                    <span className="text-sm text-white/60">Click to upload square image</span>
                    <span className="text-xs text-white/40 mt-1">Max 5MB - 1:1 aspect ratio</span>
                  </label>
                </div>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 h-px bg-white/10"></div>
                <span className="text-xs text-white/40">OR</span>
                <div className="flex-1 h-px bg-white/10"></div>
              </div>

              {/* Image URL Input */}
              <div className="relative">
                <Image size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                <input
                  type="url"
                  value={eventImageUrl}
                  onChange={(e) => {
                    setEventImageUrl(e.target.value);
                    // Clear file if URL is entered
                    if (e.target.value.trim()) {
                      setEventImageFile(null);
                      setImagePreview(null);
                      setImageError(null);
                    }
                  }}
                  placeholder="Square Image URL"
                  className="w-full !pl-14"
                />
              </div>

              {imageError && (
                <p className="text-xs text-red-400 mt-2">{imageError}</p>
              )}
            </div>

            {/* Options Toggle */}
            <button
              type="button"
              onClick={() => setShowOptionalFields(!showOptionalFields)}
              className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors"
            >
              <span className="text-sm font-medium text-white/80">
                Options
              </span>
              {showOptionalFields ? (
                <ChevronUp size={18} className="text-white/60" />
              ) : (
                <ChevronDown size={18} className="text-white/60" />
              )}
            </button>

            {/* Collapsible Options */}
            {showOptionalFields && (
              <div className="space-y-3 border-l-2 border-white/10 pl-4">
                <div>
                  <button
                    type="button"
                    onClick={() => setRequireApproval(!requireApproval)}
                    className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
                  >
                    {requireApproval ? (
                      <CheckSquare2 size={18} className="text-[#ff393a] flex-shrink-0" />
                    ) : (
                      <SquareIcon size={18} className="text-white/40 flex-shrink-0" />
                    )}
                    <span className="text-sm font-medium text-white/80">Require Approval</span>
                  </button>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setLimitGuests(!limitGuests)}
                    className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
                  >
                    {limitGuests ? (
                      <CheckSquare2 size={18} className="text-[#ff393a] flex-shrink-0" />
                    ) : (
                      <SquareIcon size={18} className="text-white/40 flex-shrink-0" />
                    )}
                    <span className="text-sm font-medium text-white/80">Limit Guests</span>
                  </button>
                </div>

                {limitGuests && (
                  <div className="relative">
                    <Users size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                    <input
                      type="number"
                      min="1"
                      value={expectedGuests}
                      onChange={(e) => setExpectedGuests(e.target.value)}
                      placeholder="Capacity"
                      className="w-full !pl-14"
                    />
                  </div>
                )}

                <div className="relative">
                  <Lock size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                  <input
                    type="password"
                    value={partyPassword}
                    onChange={(e) => setPartyPassword(e.target.value)}
                    placeholder="Event Password"
                    className="w-full !pl-14"
                  />
                </div>

                <CustomUrlInput
                  value={customUrl}
                  onChange={setCustomUrl}
                  onValidationChange={(isValid, error) => {
                    setCustomUrlValid(isValid);
                    setCustomUrlError(error);
                  }}
                />
              </div>
            )}

            <button
              type="submit"
              className="btn-primary w-full flex items-center justify-center gap-2 text-lg py-4"
              disabled={creating}
            >
              {creating ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Party'
              )}
            </button>
          </form>
        </div>

        <div className="mt-8 text-center">
          <p className="text-white/50 text-sm">
            Already created a party?{' '}
            <a href="/parties" className="text-[#ff393a] hover:text-[#ff5a5b] underline">
              View all test events
            </a>
          </p>
        </div>
      </div>

      {/* Mobile Date/Time Modal */}
      {showDateTimeModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/70" onClick={() => setShowDateTimeModal(false)}>
          <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">Event Time</h2>

            <div className="space-y-3">
              {/* Start */}
              <div className="flex items-center gap-2">
                <Play size={18} className="text-white/40 flex-shrink-0" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (!endDate) setEndDate(e.target.value);
                  }}
                  className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                  style={{ colorScheme: 'dark' }}
                />
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-24 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                  style={{ colorScheme: 'dark' }}
                />
              </div>

              {/* End */}
              <div className="flex items-center gap-2">
                <SquareIcon size={16} className="text-white/40 flex-shrink-0" />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                  style={{ colorScheme: 'dark' }}
                />
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-24 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                  style={{ colorScheme: 'dark' }}
                />
              </div>

              {/* Timezone */}
              <div className="pt-2 border-t border-white/10">
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] appearance-none"
                  style={{
                    colorScheme: 'dark',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23ffffff80'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                    backgroundSize: '1.2em 1.2em',
                    paddingRight: '2rem'
                  }}
                >
                  <option value="">Select timezone</option>
                  <optgroup label="Popular">
                    <option value="America/Los_Angeles">Los Angeles (GMT-08:00)</option>
                    <option value="America/Chicago">Chicago (GMT-06:00)</option>
                    <option value="America/New_York">New York (GMT-05:00)</option>
                    <option value="Europe/London">London (GMT+00:00)</option>
                    <option value="Europe/Paris">Paris (GMT+01:00)</option>
                    <option value="Asia/Tokyo">Tokyo (GMT+09:00)</option>
                  </optgroup>
                  <optgroup label="Americas">
                    <option value="America/Anchorage">Anchorage</option>
                    <option value="America/Phoenix">Phoenix</option>
                    <option value="America/Denver">Denver</option>
                    <option value="America/Toronto">Toronto</option>
                    <option value="America/Mexico_City">Mexico City</option>
                    <option value="America/Sao_Paulo">Sao Paulo</option>
                  </optgroup>
                  <optgroup label="Europe">
                    <option value="Europe/Madrid">Madrid</option>
                    <option value="Europe/Berlin">Berlin</option>
                    <option value="Europe/Rome">Rome</option>
                    <option value="Europe/Moscow">Moscow</option>
                  </optgroup>
                  <optgroup label="Asia & Pacific">
                    <option value="Asia/Dubai">Dubai</option>
                    <option value="Asia/Kolkata">Kolkata</option>
                    <option value="Asia/Singapore">Singapore</option>
                    <option value="Asia/Hong_Kong">Hong Kong</option>
                    <option value="Asia/Shanghai">Shanghai</option>
                    <option value="Australia/Sydney">Sydney</option>
                  </optgroup>
                </select>
              </div>
            </div>

            {/* Done Button */}
            <button
              type="button"
              onClick={() => setShowDateTimeModal(false)}
              className="w-full mt-4 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Sign In Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
      />
    </Layout>
  );
}
