import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { TimePickerInput } from '../components/TimePickerInput';
import { TimezonePickerInput } from '../components/TimezonePickerInput';
import { Calendar, User, Loader2, Users, MapPin, Lock, Image, FileText, Link as LinkIcon, Upload, Trash2, ChevronDown, ChevronUp, Square, CheckSquare2 } from 'lucide-react';
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
  const [requireApproval, setRequireApproval] = useState(false);
  const [limitGuests, setLimitGuests] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showDateTimeModal, setShowDateTimeModal] = useState(false);

  // Get user's timezone on mount
  React.useEffect(() => {
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimezone(userTimezone);
  }, []);

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyName.trim()) return;
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
        navigate(`/manage/${party.invite_code}`);
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
        <div className="card p-8">
          <form onSubmit={handleCreate} className="space-y-6">
            <div>
              <input
                type="text"
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                placeholder="Party Name *"
                className="w-full pl-3"
                required
                autoFocus
              />
            </div>

            {/* Mobile: Date/Time Button */}
            <button
              type="button"
              onClick={() => setShowDateTimeModal(true)}
              className="md:hidden w-full bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-colors relative"
            >
              <Calendar size={20} className="absolute left-4 top-4 text-white/40 pointer-events-none" />
              {startDate && startTime && endDate && endTime ? (
                <div className="pl-7">
                  <div className="text-white font-medium">
                    {formatDateDisplay(startDate)}
                  </div>
                  <div className="text-white/60 text-sm mt-1">
                    {formatTimeDisplay(startTime)} — {formatTimeDisplay(endTime)} {getTimezoneAbbr()}
                  </div>
                </div>
              ) : (
                <div className="pl-7">
                  <span className="text-white/60">Thursday, January 15</span>
                  <div className="text-white/40 text-sm mt-1">2:00 PM — 3:00 PM EST</div>
                </div>
              )}
            </button>

            {/* Desktop: Inline Date/Time Picker */}
            <div className="hidden md:block bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-start gap-4">
                <Calendar size={20} className="text-white/40 mt-1 flex-shrink-0" />
                <div className="flex-1 space-y-3">
                  {/* Start Time */}
                  <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                      <label className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-white/40 pointer-events-none">
                        Start
                      </label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                          setStartDate(e.target.value);
                          // Auto-populate end date if empty
                          if (!endDate) setEndDate(e.target.value);
                        }}
                        className="w-full bg-transparent border-none text-white text-sm text-right focus:outline-none focus:ring-0 p-0 pl-14 pr-2 cursor-pointer [&::-webkit-calendar-picker-indicator]:hidden"
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
                    <div className="relative flex-1">
                      <label className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-white/40 pointer-events-none">
                        End
                      </label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full bg-transparent border-none text-white text-sm text-right focus:outline-none focus:ring-0 p-0 pl-14 pr-2 cursor-pointer [&::-webkit-calendar-picker-indicator]:hidden"
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

            <div className="relative">
              <MapPin size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              <input
                type="text"
                value={partyAddress}
                onChange={(e) => setPartyAddress(e.target.value)}
                placeholder="Add Event Location"
                className="w-full !pl-14"
              />
              {partyAddress && (
                <p className="text-xs text-white/50 mt-1 ml-14">Offline location or virtual link</p>
              )}
            </div>

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

            <div>
              {/* Image URL Input */}
              <div className="mb-3 relative">
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
                  <button
                    type="button"
                    onClick={() => setRequireApproval(!requireApproval)}
                    className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
                  >
                    {requireApproval ? (
                      <CheckSquare2 size={18} className="text-[#ff393a] flex-shrink-0" />
                    ) : (
                      <Square size={18} className="text-white/40 flex-shrink-0" />
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
                      <Square size={18} className="text-white/40 flex-shrink-0" />
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

                <div className="relative flex items-center">
                  <LinkIcon size={20} className="absolute left-3 text-white/40 pointer-events-none" />
                  <span className="absolute left-12 text-white/60 pointer-events-none font-mono text-sm">rsv.pizza/</span>
                  <input
                    type="text"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="custom-url"
                    className="w-full font-mono text-sm"
                    style={{ paddingLeft: '130px' }}
                    pattern="[a-z0-9-]+"
                    minLength={3}
                    maxLength={50}
                  />
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

      {/* Mobile Date/Time Modal */}
      {showDateTimeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowDateTimeModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-black mb-6">Event Time</h2>

            <div className="space-y-3">
              {/* Start */}
              <div className="flex items-center gap-3">
                <span className="text-gray-500 text-base w-20">Start</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (!endDate) setEndDate(e.target.value);
                  }}
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-black text-base focus:outline-none focus:ring-2 focus:ring-[#ff393a] focus:border-transparent"
                />
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-32 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-black text-base focus:outline-none focus:ring-2 focus:ring-[#ff393a] focus:border-transparent"
                />
              </div>

              {/* End */}
              <div className="flex items-center gap-3">
                <span className="text-gray-500 text-base w-20">End</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-black text-base focus:outline-none focus:ring-2 focus:ring-[#ff393a] focus:border-transparent"
                />
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-32 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-black text-base focus:outline-none focus:ring-2 focus:ring-[#ff393a] focus:border-transparent"
                />
              </div>

              {/* Timezone */}
              <div className="flex items-center gap-3">
                <span className="text-gray-500 text-base w-20">Timezone</span>
                <div className="flex-1">
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-black text-base focus:outline-none focus:ring-2 focus:ring-[#ff393a] focus:border-transparent appearance-none"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 0.5rem center',
                      backgroundSize: '1.5em 1.5em',
                      paddingRight: '2.5rem'
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
                      <option value="America/Sao_Paulo">São Paulo</option>
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
            </div>

            {/* Done Button */}
            <button
              type="button"
              onClick={() => setShowDateTimeModal(false)}
              className="w-full mt-6 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium py-3 rounded-xl transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}
