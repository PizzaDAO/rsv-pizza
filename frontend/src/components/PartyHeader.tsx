import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePizza } from '../contexts/PizzaContext';
import { PartyPopper, Link2, Copy, Check, X, Calendar, User, Loader2, Users, MapPin, Lock, Image, FileText, Link as LinkIcon, Upload, Trash2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { uploadEventImage } from '../lib/supabase';

export const PartyHeader: React.FC = () => {
  const { party, createParty, clearParty, getInviteLink, getHostLink } = usePizza();
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState<'guest' | 'host' | 'event' | null>(null);

  // Form state
  const [partyName, setPartyName] = useState('');
  const [hostName, setHostName] = useState('');
  const [partyDate, setPartyDate] = useState('');
  const [partyDuration, setPartyDuration] = useState('');
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
    if (!partyName.trim()) return;
    setCreating(true);

    try {
      const guestCount = expectedGuests ? parseInt(expectedGuests, 10) : undefined;
      const duration = partyDuration ? parseFloat(partyDuration) : undefined;
      const password = partyPassword.trim() || undefined;
      const description = eventDescription.trim() || undefined;
      const urlSlug = customUrl.trim() || undefined;

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

      const inviteCode = await createParty(partyName.trim(), hostName.trim() || undefined, partyDate || undefined, guestCount, partyAddress.trim() || undefined, [], duration, password, imageUrl, description, urlSlug);

      setCreating(false);
      setShowCreateModal(false);

      // Reset form
      setPartyName('');
      setHostName('');
      setPartyDate('');
      setPartyDuration('');
      setExpectedGuests('');
      setPartyAddress('');
      setPartyPassword('');
      setEventImageUrl('');
      setEventImageFile(null);
      setImagePreview(null);
      setImageError(null);
      setEventDescription('');
      setCustomUrl('');

      // Navigate to host page
      if (inviteCode) {
        navigate(`/host/${inviteCode}`);
      } else {
        setImageError('Failed to create party. Please try again.');
      }
    } catch (error) {
      console.error('Error creating party:', error);
      setImageError('Failed to create party. Please try again.');
      setCreating(false);
    }
  };

  const handleCopyLink = (type: 'guest' | 'host' | 'event') => {
    let link = '';
    if (type === 'guest') link = getInviteLink();
    else if (type === 'host') link = getHostLink();
    else if (type === 'event') link = getEventLink();

    navigator.clipboard.writeText(link).then(() => {
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const getEventLink = (): string => {
    if (!party) return '';
    const baseUrl = window.location.origin;
    const slug = party.customUrl || party.inviteCode;
    return `${baseUrl}/${slug}`;
  };

  const handleViewEventPage = () => {
    if (!party) return;
    const slug = party.customUrl || party.inviteCode;
    navigate(`/${slug}`);
  };

  const handleCopyEventLink = () => {
    if (!party) return;
    const slug = party.customUrl || party.inviteCode;
    const eventLink = `${window.location.origin}/${slug}`;
    navigator.clipboard.writeText(eventLink)
      .then(() => {
        setCopied('event');
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(err => console.error('Failed to copy:', err));
  };

  const inviteLink = getInviteLink();
  const hostLink = getHostLink();
  const eventLink = getEventLink();

  return (
    <>
      {/* Party Status Bar */}
      <div className="card p-4 mb-6">
        {party ? (
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Square Event Image */}
            <div className="w-full sm:w-48 h-48 flex-shrink-0 rounded-xl overflow-hidden">
              {party.eventImageUrl ? (
                <img
                  src={party.eventImageUrl}
                  alt={party.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#ff393a] to-[#ff6b35] flex items-center justify-center">
                  <Pizza className="w-24 h-24 text-white/30" />
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-[#ff393a]/20 flex items-center justify-center flex-shrink-0">
                  <PartyPopper className="w-5 h-5 text-[#ff393a]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-white text-lg">{party.name}</h3>
                  {party.date && (
                    <p className="text-sm text-white/70 mb-1 flex items-center gap-1.5">
                      <Calendar size={14} className="flex-shrink-0" />
                      <span>
                        {new Date(party.date).toLocaleDateString('en-US', {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                          timeZone: party.timezone || undefined
                        })}
                        {' at '}
                        {new Date(party.date).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                          timeZone: party.timezone || undefined
                        })}
                        {party.timezone && ` (${party.timezone.replace(/_/g, ' ')})`}
                      </span>
                    </p>
                  )}
                  <p className="text-sm text-white/50">
                    {party.hostName && `Hosted by ${party.hostName} • `}
                    {party.maxGuests ? (
                      <span>
                        {party.guests.length} of {party.maxGuests} guests responded
                      </span>
                    ) : (
                      <span>{party.guests.length} guest{party.guests.length !== 1 ? 's' : ''}</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleViewEventPage}
                  className="btn-secondary flex items-center gap-2"
                >
                  <ExternalLink size={18} />
                  <span className="hidden sm:inline">View Event Page</span>
                </button>
                <button
                  onClick={handleCopyEventLink}
                  className="btn-primary flex items-center gap-2"
                >
                  {copied === 'event' ? (
                    <>
                      <Check size={18} />
                      <span className="hidden sm:inline">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={18} />
                      <span className="hidden sm:inline">Copy Link</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                <PartyPopper className="w-5 h-5 text-white/50" />
              </div>
              <div>
                <h3 className="font-semibold text-white/80">No Party Created</h3>
                <p className="text-sm text-white/50">
                  Create a party to generate a shareable invite link for guests
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary flex items-center gap-2"
            >
              <PartyPopper size={18} />
              Create Party
            </button>
          </div>
        )}
      </div>

      {/* Create Party Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="card p-6 w-full max-w-md my-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Create Pizza Party</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-white/50 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto pr-2">
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

              {/* Date and Duration on same line */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-white/80 mb-2">
                    Party Date
                  </label>
                  <div className="relative">
                    <Calendar size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                    <input
                      type="date"
                      value={partyDate}
                      onChange={(e) => setPartyDate(e.target.value)}
                      className="w-full !pl-14"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/80 mb-2">
                    Duration (hrs)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="12"
                    value={partyDuration}
                    onChange={(e) => setPartyDuration(e.target.value)}
                    placeholder="2.5"
                    className="w-full"
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

              {/* Optional Fields Toggle */}
              <button
                type="button"
                onClick={() => setShowOptionalFields(!showOptionalFields)}
                className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors"
              >
                <span className="text-sm font-medium text-white/80">
                  Optional Details
                </span>
                {showOptionalFields ? (
                  <ChevronUp size={18} className="text-white/60" />
                ) : (
                  <ChevronDown size={18} className="text-white/60" />
                )}
              </button>

              {/* Collapsible Optional Fields */}
              {showOptionalFields && (
                <div className="space-y-3 border-l-2 border-white/10 pl-4">
                  <div>
                    <label className="block text-sm font-medium text-white/80 mb-2">
                      <User size={14} className="inline mr-1" />
                      Host Name
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
                      <Image size={14} className="inline mr-1" />
                      Square Image
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
                  Event Description (Optional)
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

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn-secondary flex-1"
                  disabled={creating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                  disabled={creating}
                >
                  {creating ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Party'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share Link Modal */}
      {showShareModal && party && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Share Invite Link</h2>
              <button
                onClick={() => setShowShareModal(false)}
                className="text-white/50 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            {/* Link Preview Card */}
            <div className="mb-6 bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <div className="p-3 border-b border-white/10">
                <p className="text-xs text-white/40 font-mono truncate">{eventLink}</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-0">
                {/* Event Image */}
                {party.eventImageUrl ? (
                  <div className="sm:w-48 sm:h-48 w-full aspect-square flex-shrink-0 bg-black/30">
                    <img
                      src={party.eventImageUrl}
                      alt={party.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="sm:w-48 sm:h-48 w-full aspect-square flex-shrink-0 bg-gradient-to-br from-[#ff393a] to-[#ff6b35] flex items-center justify-center">
                    <Pizza className="w-20 h-20 text-white/30" />
                  </div>
                )}

                {/* Event Info */}
                <div className="flex-1 p-4">
                  <p className="text-xs text-white/40 mb-1">RSV.Pizza</p>
                  <h3 className="text-lg font-bold text-white mb-2 line-clamp-2">{party.name}</h3>
                  {party.description && (
                    <p className="text-sm text-white/60 line-clamp-3 mb-3">
                      {party.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <PartyPopper size={14} />
                    <span>RSVP</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              {/* Event Page Link */}
              <div>
                <p className="text-white/60 mb-2 text-sm font-medium">
                  Event Page Link (share event details):
                </p>
                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 overflow-hidden">
                      <code className="text-sm text-[#ffb347] break-all">{eventLink}</code>
                    </div>
                    <button
                      onClick={() => handleCopyLink('event')}
                      className={`flex-shrink-0 p-2 rounded-lg transition-all ${
                        copied === 'event'
                          ? 'bg-[#39d98a] text-white'
                          : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      {copied === 'event' ? <Check size={20} /> : <Copy size={20} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Guest Link */}
              <div>
                <p className="text-white/60 mb-2 text-sm font-medium">
                  Guest RSVP Link (direct to RSVP form):
                </p>
                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 overflow-hidden">
                      <code className="text-sm text-[#ff393a] break-all">{inviteLink}</code>
                    </div>
                    <button
                      onClick={() => handleCopyLink('guest')}
                      className={`flex-shrink-0 p-2 rounded-lg transition-all ${
                        copied === 'guest'
                          ? 'bg-[#39d98a] text-white'
                          : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      {copied === 'guest' ? <Check size={20} /> : <Copy size={20} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Host Link */}
              <div>
                <p className="text-white/60 mb-2 text-sm font-medium">
                  Host Dashboard Link (bookmark this):
                </p>
                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 overflow-hidden">
                      <code className="text-sm text-[#39d98a] break-all">{hostLink}</code>
                    </div>
                    <button
                      onClick={() => handleCopyLink('host')}
                      className={`flex-shrink-0 p-2 rounded-lg transition-all ${
                        copied === 'host'
                          ? 'bg-[#39d98a] text-white'
                          : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      {copied === 'host' ? <Check size={20} /> : <Copy size={20} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#ffb347]/10 border border-[#ffb347]/30 rounded-xl p-4 mb-6">
              <p className="text-sm text-[#ffb347]">
                Share the <strong>Event Page Link</strong> to show event details with an RSVP button. Use the <strong>RSVP Link</strong> for direct RSVP access. Bookmark the <strong>Host Dashboard Link</strong> to host your party.
              </p>
            </div>

            <button
              onClick={() => setShowShareModal(false)}
              className="btn-primary w-full"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
};
