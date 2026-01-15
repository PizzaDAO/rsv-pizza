import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { TimePickerInput } from '../components/TimePickerInput';
import { TimezonePickerInput } from '../components/TimezonePickerInput';
import { Calendar, User, Loader2, Users, MapPin, Lock, Image, FileText, Link as LinkIcon, Upload, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { createParty as createPartyAPI, uploadEventImage } from '../lib/supabase';

export function HomePage() {
  const navigate = useNavigate();

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
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [creating, setCreating] = useState(false);

  // Get user's timezone on mount
  React.useEffect(() => {
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimezone(userTimezone);
  }, []);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
      URL.revokeObjectURL(objectUrl);
    };

    img.onerror = () => {
      setImageError('Failed to load image');
      URL.revokeObjectURL(objectUrl);
    };

    img.src = objectUrl;
  };

  const removeImage = () => {
    setEventImageFile(null);
    setImagePreview(null);
    setImageError(null);
    setEventImageUrl('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyName.trim() || !expectedGuests) return;
    setCreating(true);

    try {
      const guestCount = expectedGuests ? parseInt(expectedGuests, 10) : undefined;
      const password = partyPassword.trim() || undefined;
      const description = eventDescription.trim() || undefined;
      const urlSlug = customUrl.trim() || undefined;

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

      const party = await createPartyAPI(
        partyName.trim(),
        hostName.trim() || undefined,
        startDateTime,
        'new-york',
        guestCount,
        partyAddress.trim() || undefined,
        [],
        duration,
        password,
        imageUrl,
        description,
        urlSlug
      );

      setCreating(false);

      // Navigate to host page
      if (party?.invite_code) {
        navigate(`/party/${party.invite_code}`);
      } else {
        setImageError('Failed to create party. Please try again.');
      }
    } catch (error) {
      console.error('Error creating party:', error);
      setImageError('Failed to create party. Please try again.');
      setCreating(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <header className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Create Your Pizza Party
          </h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto">
            Get the perfect pizza order recommendations based on guest preferences
          </p>
        </header>

        <div className="card p-8">
          <form onSubmit={handleCreate} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Party Name *
              </label>
              <input
                type="text"
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                placeholder="e.g., Friday Night Pizza"
                className="w-full"
                required
                autoFocus
              />
            </div>

            {/* Start and End Time Picker */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-start gap-4">
                <div className="flex-1 space-y-3">
                  {/* Start Time */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 w-12">
                      <div className="w-3 h-3 rounded-full bg-[#ff393a] border-2 border-white"></div>
                      <span className="text-sm text-white/60">Start</span>
                    </div>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        // Auto-populate end date if empty
                        if (!endDate) setEndDate(e.target.value);
                      }}
                      className="flex-1 bg-transparent border-none text-white text-sm focus:outline-none focus:ring-0 p-0"
                    />
                    <TimePickerInput
                      value={startTime}
                      onChange={setStartTime}
                      placeholder="12:30 PM"
                    />
                  </div>

                  {/* End Time */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 w-12">
                      <div className="w-3 h-3 rounded-full border-2 border-white/40"></div>
                      <span className="text-sm text-white/60">End</span>
                    </div>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="flex-1 bg-transparent border-none text-white text-sm focus:outline-none focus:ring-0 p-0"
                    />
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

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                <Users size={14} className="inline mr-1" />
                Expected Guests *
              </label>
              <input
                type="number"
                min="1"
                value={expectedGuests}
                onChange={(e) => setExpectedGuests(e.target.value)}
                placeholder="e.g., 12"
                className="w-full"
                required
              />
              <p className="text-xs text-white/50 mt-1">
                Total people attending (we'll calculate extra pizza for those who don't RSVP)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                <User size={14} className="inline mr-1" />
                Your Name (Host)
              </label>
              <input
                type="text"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                placeholder="e.g., John"
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                <MapPin size={14} className="inline mr-1" />
                Party Address
              </label>
              <input
                type="text"
                value={partyAddress}
                onChange={(e) => setPartyAddress(e.target.value)}
                placeholder="e.g., 123 Main St, New York, NY"
                className="w-full"
              />
              <p className="text-xs text-white/50 mt-1">
                Used to find nearby pizzerias for ordering
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                <Image size={14} className="inline mr-1" />
                Event Flyer (Square Image)
              </label>

              {/* Image URL Input */}
              <div className="mb-3">
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
                  placeholder="https://example.com/image.jpg"
                  className="w-full"
                />
                <p className="text-xs text-white/50 mt-1">
                  Enter an image URL, or upload a file below
                </p>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 h-px bg-white/10"></div>
                <span className="text-xs text-white/40">OR</span>
                <div className="flex-1 h-px bg-white/10"></div>
              </div>

              {/* File Upload */}
              {imagePreview ? (
                <div className="space-y-3">
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
                <div className="relative">
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
                    <span className="text-xs text-white/40 mt-1">Max 5MB • 1:1 aspect ratio</span>
                  </label>
                </div>
              )}

              {imageError && (
                <p className="text-xs text-red-400 mt-2">{imageError}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                <FileText size={14} className="inline mr-1" />
                Event Description
              </label>
              <textarea
                value={eventDescription}
                onChange={(e) => setEventDescription(e.target.value)}
                placeholder="Tell guests about your event..."
                className="w-full"
                rows={3}
              />
              <p className="text-xs text-white/50 mt-1">
                Describe your event for the event page
              </p>
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
              <div className="space-y-4 border-l-2 border-white/10 pl-4">
                <div>
                  <label className="block text-sm font-medium text-white/80 mb-2">
                    <Lock size={14} className="inline mr-1" />
                    Event Password
                  </label>
                  <input
                    type="password"
                    value={partyPassword}
                    onChange={(e) => setPartyPassword(e.target.value)}
                    placeholder="Password to protect event page"
                    className="w-full"
                  />
                  <p className="text-xs text-white/50 mt-1">
                    Guests will need this password to view event details
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/80 mb-2">
                    <LinkIcon size={14} className="inline mr-1" />
                    Custom URL
                  </label>
                  <input
                    type="text"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="my-awesome-party"
                    className="w-full font-mono"
                    pattern="[a-z0-9-]+"
                    minLength={3}
                    maxLength={50}
                  />
                  <p className="text-xs text-white/50 mt-1">
                    Your event will be at: /{customUrl || 'custom-url'}
                  </p>
                </div>
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
    </Layout>
  );
}
