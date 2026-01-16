import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, MapPin, User, Lock, Image as ImageIcon, FileText, Link as LinkIcon, Clock, Save, Loader2, UserPlus, X, Globe, Instagram, GripVertical, Square as SquareIcon, CheckSquare2, Trash2, Play } from 'lucide-react';
import { usePizza } from '../contexts/PizzaContext';
import { updateParty, uploadEventImage, deleteParty } from '../lib/supabase';
import { LocationAutocomplete } from './LocationAutocomplete';
import { CoHost } from '../types';
import { TimezonePickerInput } from './TimezonePickerInput';

export const EventDetailsTab: React.FC = () => {
  const { party } = usePizza();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [hostName, setHostName] = useState('');
  const [date, setDate] = useState('');
  const [duration, setDuration] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timezone, setTimezone] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [password, setPassword] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [eventImageUrl, setEventImageUrl] = useState('');
  const [eventImageFile, setEventImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [maxGuests, setMaxGuests] = useState('');
  const [requireApproval, setRequireApproval] = useState(false);
  const [limitGuests, setLimitGuests] = useState(false);

  // Co-hosts state
  const [coHosts, setCoHosts] = useState<CoHost[]>([]);
  const [newCoHostName, setNewCoHostName] = useState('');
  const [newCoHostWebsite, setNewCoHostWebsite] = useState('');
  const [newCoHostTwitter, setNewCoHostTwitter] = useState('');
  const [newCoHostInstagram, setNewCoHostInstagram] = useState('');
  const [newCoHostAvatarUrl, setNewCoHostAvatarUrl] = useState('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [showOptionalFields, setShowOptionalFields] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDateTimeModal, setShowDateTimeModal] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  // Track original values to detect changes
  const [originalValues, setOriginalValues] = useState<any>(null);

  // Load party data into form
  useEffect(() => {
    if (party) {
      const partyName = party.name || '';
      const partyHostName = party.hostName || '';
      const partyDate = party.date || '';
      const partyDuration = party.duration?.toString() || '';
      const partyTimezone = party.timezone || (() => {
        try {
          return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch (error) {
          return 'UTC';
        }
      })();

      let partyStartDate = '';
      let partyStartTime = '';
      let partyEndDate = '';
      let partyEndTime = '';

      // Parse date and duration into start/end date/time fields
      if (party.date) {
        const startDateTime = new Date(party.date);
        // Use local date formatting to avoid timezone shift
        const startYear = startDateTime.getFullYear();
        const startMonth = (startDateTime.getMonth() + 1).toString().padStart(2, '0');
        const startDay = startDateTime.getDate().toString().padStart(2, '0');
        partyStartDate = `${startYear}-${startMonth}-${startDay}`;
        const hours = startDateTime.getHours().toString().padStart(2, '0');
        const minutes = startDateTime.getMinutes().toString().padStart(2, '0');
        partyStartTime = `${hours}:${minutes}`;

        // Calculate end date/time if duration exists
        if (party.duration) {
          const endDateTime = new Date(startDateTime.getTime() + party.duration * 60 * 60 * 1000);
          const endYear = endDateTime.getFullYear();
          const endMonth = (endDateTime.getMonth() + 1).toString().padStart(2, '0');
          const endDay = endDateTime.getDate().toString().padStart(2, '0');
          partyEndDate = `${endYear}-${endMonth}-${endDay}`;
          const endHours = endDateTime.getHours().toString().padStart(2, '0');
          const endMinutes = endDateTime.getMinutes().toString().padStart(2, '0');
          partyEndTime = `${endHours}:${endMinutes}`;
        } else {
          partyEndDate = partyStartDate;
          partyEndTime = '';
        }
      }

      const partyAddress = party.address || '';
      const partyDescription = party.description || '';
      const partyPassword = party.password || '';
      const partyCustomUrl = party.customUrl || '';
      const partyEventImageUrl = party.eventImageUrl || '';
      const partyMaxGuests = party.maxGuests?.toString() || '';
      const partyLimitGuests = !!party.maxGuests;
      const partyCoHosts = party.coHosts || [];

      // Set form values
      setName(partyName);
      setHostName(partyHostName);
      setDate(partyDate);
      setDuration(partyDuration);
      setTimezone(partyTimezone);
      setStartDate(partyStartDate);
      setStartTime(partyStartTime);
      setEndDate(partyEndDate);
      setEndTime(partyEndTime);
      setAddress(partyAddress);
      setDescription(partyDescription);
      setPassword(partyPassword);
      setCustomUrl(partyCustomUrl);
      setEventImageUrl(partyEventImageUrl);
      setImagePreview(partyEventImageUrl || null);
      setMaxGuests(partyMaxGuests);
      setLimitGuests(partyLimitGuests);
      setCoHosts(partyCoHosts);

      // Store original values
      setOriginalValues({
        name: partyName,
        hostName: partyHostName,
        startDate: partyStartDate,
        startTime: partyStartTime,
        endDate: partyEndDate,
        endTime: partyEndTime,
        timezone: partyTimezone,
        address: partyAddress,
        description: partyDescription,
        password: partyPassword,
        customUrl: partyCustomUrl,
        eventImageUrl: partyEventImageUrl,
        maxGuests: partyMaxGuests,
        limitGuests: partyLimitGuests,
        coHosts: JSON.stringify(partyCoHosts),
      });
    }
  }, [party]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Revoke previous preview URL if it exists
    if (imagePreview && imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreview);
    }

    setImageError(null);

    if (!file.type.startsWith('image/')) {
      setImageError('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setImageError('Image must be less than 5MB');
      return;
    }

    // Validate square aspect ratio
    const img = new window.Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const aspectRatio = img.width / img.height;

      if (aspectRatio < 0.9 || aspectRatio > 1.1) {
        setImageError('Image must be square (1:1 aspect ratio)');
        setEventImageFile(null);
        setImagePreview(null);
        URL.revokeObjectURL(objectUrl);
        return;
      }

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

  const addCoHost = () => {
    if (!newCoHostName.trim()) return;

    const newCoHost: CoHost = {
      id: crypto.randomUUID(),
      name: newCoHostName.trim(),
      website: newCoHostWebsite.trim() || undefined,
      twitter: newCoHostTwitter.trim() || undefined,
      instagram: newCoHostInstagram.trim() || undefined,
      avatar_url: newCoHostAvatarUrl.trim() || undefined,
      showOnEvent: true,
    };

    setCoHosts([...coHosts, newCoHost]);

    // Reset form
    setNewCoHostName('');
    setNewCoHostWebsite('');
    setNewCoHostTwitter('');
    setNewCoHostInstagram('');
    setNewCoHostAvatarUrl('');
  };

  const removeCoHost = (id: string) => {
    setCoHosts(coHosts.filter(h => h.id !== id));
  };

  const toggleCoHostShowOnEvent = (id: string) => {
    setCoHosts(coHosts.map(h =>
      h.id === id ? { ...h, showOnEvent: !h.showOnEvent } : h
    ));
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newCoHosts = [...coHosts];
    const draggedItem = newCoHosts[draggedIndex];
    newCoHosts.splice(draggedIndex, 1);
    newCoHosts.splice(index, 0, draggedItem);

    setCoHosts(newCoHosts);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Check if any values have changed
  const hasChanges = () => {
    if (!originalValues) return false;

    return (
      name !== originalValues.name ||
      hostName !== originalValues.hostName ||
      startDate !== originalValues.startDate ||
      startTime !== originalValues.startTime ||
      endDate !== originalValues.endDate ||
      endTime !== originalValues.endTime ||
      timezone !== originalValues.timezone ||
      address !== originalValues.address ||
      description !== originalValues.description ||
      password !== originalValues.password ||
      customUrl !== originalValues.customUrl ||
      eventImageUrl !== originalValues.eventImageUrl ||
      maxGuests !== originalValues.maxGuests ||
      limitGuests !== originalValues.limitGuests ||
      JSON.stringify(coHosts) !== originalValues.coHosts ||
      eventImageFile !== null
    );
  };

  // Cancel changes and revert to original values
  const handleCancelChanges = () => {
    if (!originalValues) return;

    setName(originalValues.name);
    setHostName(originalValues.hostName);
    setStartDate(originalValues.startDate);
    setStartTime(originalValues.startTime);
    setEndDate(originalValues.endDate);
    setEndTime(originalValues.endTime);
    setTimezone(originalValues.timezone);
    setAddress(originalValues.address);
    setDescription(originalValues.description);
    setPassword(originalValues.password);
    setCustomUrl(originalValues.customUrl);
    setEventImageUrl(originalValues.eventImageUrl);
    setImagePreview(originalValues.eventImageUrl || null);
    setMaxGuests(originalValues.maxGuests);
    setLimitGuests(originalValues.limitGuests);
    setCoHosts(JSON.parse(originalValues.coHosts));
    setEventImageFile(null);
    setImageError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!party) return;

    setSaving(true);
    setMessage(null);

    try {
      // Upload image if file is selected
      let imageUrl = eventImageUrl.trim() || undefined;
      if (eventImageFile) {
        const uploadedUrl = await uploadEventImage(eventImageFile);
        if (uploadedUrl) {
          imageUrl = uploadedUrl;
        } else {
          throw new Error('Failed to upload image. Please ensure the storage bucket is configured or use an image URL instead.');
        }
      }

      // Calculate duration from start/end times
      let calculatedDuration: number | null = null;
      let startDateTime: string | null = null;
      if (startDate && startTime && endDate && endTime) {
        const start = new Date(`${startDate}T${startTime}`);
        const end = new Date(`${endDate}T${endTime}`);
        const durationMs = end.getTime() - start.getTime();
        calculatedDuration = durationMs / (1000 * 60 * 60); // Convert to hours
        startDateTime = start.toISOString();
      } else if (startDate && startTime) {
        startDateTime = new Date(`${startDate}T${startTime}`).toISOString();
      }

      // Update party in database
      const success = await updateParty(party.id, {
        name: name.trim(),
        host_name: hostName.trim() || null,
        date: startDateTime,
        duration: calculatedDuration,
        timezone: timezone || null,
        address: address.trim() || null,
        description: description.trim() || null,
        password: password.trim() || null,
        custom_url: customUrl.trim() || null,
        event_image_url: imageUrl || null,
        max_guests: limitGuests && maxGuests ? parseInt(maxGuests, 10) : null,
        co_hosts: coHosts,
      });

      if (success) {
        setMessage({ type: 'success', text: 'Event details updated successfully!' });
        // Reload the page to reflect changes
        setTimeout(() => window.location.reload(), 1500);
      } else {
        throw new Error('Failed to update party');
      }
    } catch (error) {
      console.error('Error updating party:', error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to update event details' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!party) return;

    setDeleting(true);
    setMessage(null);

    try {
      const success = await deleteParty(party.id);
      if (success) {
        setMessage({ type: 'success', text: 'Event deleted successfully' });
        // Redirect to home page after a short delay
        setTimeout(() => {
          navigate('/');
        }, 1500);
      } else {
        throw new Error('Failed to delete event');
      }
    } catch (error) {
      console.error('Error deleting party:', error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to delete event' });
      setDeleting(false);
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

  if (!party) {
    return <div className="card p-6 text-white/60">No party loaded</div>;
  }

  return (
    <div className="card p-8">
      <form onSubmit={handleSave} className="space-y-3">
        {/* Name */}
        <div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Party Name *"
            className="w-full"
            required
          />
        </div>

        {/* Host Name */}
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
                <span className="text-white/60">Add Date & Time</span>
                <div className="text-white/40 text-sm mt-1">Tap to set event time</div>
              </div>
            )}
          </div>
        </button>

        {/* Desktop: Date/Time Picker */}
        <div className="hidden md:block bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="space-y-3">
            {/* Start Time */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <Play size={21} className="text-white/40" />
                </div>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (!endDate) setEndDate(e.target.value);
                  }}
                  className="w-full bg-transparent border-none text-white text-sm text-right focus:outline-none focus:ring-0 p-0 pl-12 pr-2 [&::-webkit-calendar-picker-indicator]:hidden"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#ff393a]"
                style={{ colorScheme: 'dark' }}
              />
            </div>

            {/* End Time */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <SquareIcon size={17} className="text-white/40" />
                </div>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-transparent border-none text-white text-sm text-right focus:outline-none focus:ring-0 p-0 pl-12 pr-2 [&::-webkit-calendar-picker-indicator]:hidden"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#ff393a]"
                style={{ colorScheme: 'dark' }}
              />
            </div>

            {/* Timezone Picker */}
            <div className="flex justify-end">
              <TimezonePickerInput
                value={timezone}
                onChange={setTimezone}
              />
            </div>
          </div>
        </div>

        {/* Address */}
        <LocationAutocomplete
          value={address}
          onChange={setAddress}
          placeholder="Add Event Location"
        />

        {/* Description */}
        <div className="relative">
          <FileText size={20} className="absolute left-3 top-3 text-white/40 pointer-events-none" />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add Description"
            className="w-full !pl-14 min-h-[100px]"
            rows={3}
          />
        </div>

        {/* Event Image */}
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
                  <X size={16} />
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
              />
              <label
                htmlFor="eventImage"
                className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-white/20 rounded-xl cursor-pointer hover:border-[#ff393a]/50 transition-colors bg-white/5 hover:bg-white/10"
              >
                <svg className="w-8 h-8 text-white/40 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="text-sm text-white/60">Click to upload square image</span>
                <span className="text-xs text-white/40 mt-1">Max 5MB • 1:1 aspect ratio</span>
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
            <ImageIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
            <input
              type="url"
              value={eventImageUrl}
              onChange={(e) => {
                setEventImageUrl(e.target.value);
                setImagePreview(e.target.value);
              }}
              placeholder="Square Image URL"
              className="w-full !pl-14"
            />
          </div>

          {imageError && (
            <p className="text-xs text-red-400 mt-2">{imageError}</p>
          )}
        </div>

        {/* Custom URL and Password in Options */}
        <button
          type="button"
          onClick={() => setShowOptionalFields(!showOptionalFields)}
          className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors"
        >
          <span className="text-sm font-medium text-white/80">Options</span>
          {showOptionalFields ? (
            <svg className="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>

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
                <User size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                <input
                  type="number"
                  min="1"
                  value={maxGuests}
                  onChange={(e) => setMaxGuests(e.target.value)}
                  placeholder="Capacity"
                  className="w-full !pl-14"
                />
              </div>
            )}

            <div className="relative">
              <Lock size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Event Password"
                className="w-full !pl-14"
                autoComplete="new-password"
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

        {/* Co-Hosts */}
        <div>
          <div className="mb-3">
            <label className="block text-sm font-medium text-white/80">
              <User size={16} className="inline mr-2" />
              Co-Hosts
            </label>
          </div>

          {/* Current Co-Hosts List */}
          {coHosts.length > 0 && (
            <div className="space-y-2 mb-3">
              {coHosts.map((coHost, index) => (
                <div
                  key={coHost.id}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10 transition-all cursor-move ${
                    draggedIndex === index ? 'opacity-50' : 'opacity-100'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className="cursor-grab active:cursor-grabbing text-white/30 hover:text-white/60">
                      <GripVertical size={18} />
                    </div>
                    {coHost.avatar_url ? (
                      <img src={coHost.avatar_url} alt={coHost.name} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-[#ff393a]/20 flex items-center justify-center">
                        <User className="w-5 h-5 text-[#ff393a]" />
                      </div>
                    )}
                    <div className="flex-1">
                      <p className="text-white font-medium">{coHost.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {coHost.website && (
                          <a href={coHost.website} target="_blank" rel="noopener noreferrer" className="text-white/50 hover:text-white" onClick={(e) => e.stopPropagation()}>
                            <Globe size={14} />
                          </a>
                        )}
                        {coHost.twitter && (
                          <a href={`https://twitter.com/${coHost.twitter}`} target="_blank" rel="noopener noreferrer" className="text-white/50 hover:text-white" onClick={(e) => e.stopPropagation()}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                            </svg>
                          </a>
                        )}
                        {coHost.instagram && (
                          <a href={`https://instagram.com/${coHost.instagram}`} target="_blank" rel="noopener noreferrer" className="text-white/50 hover:text-white" onClick={(e) => e.stopPropagation()}>
                            <Instagram size={14} />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleCoHostShowOnEvent(coHost.id)}
                      className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                    >
                      {coHost.showOnEvent !== false ? (
                        <CheckSquare2 size={16} className="text-[#ff393a] flex-shrink-0" />
                      ) : (
                        <SquareIcon size={16} className="text-white/40 flex-shrink-0" />
                      )}
                      <span className="text-xs font-medium text-white/60">Show on event</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCoHost(coHost.id)}
                      className="text-[#ff393a] hover:text-[#ff5a5b]"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add New Co-Host Form */}
          <div className="border border-white/20 rounded-xl p-4 space-y-3">
            <input
              type="text"
              value={newCoHostName}
              onChange={(e) => setNewCoHostName(e.target.value)}
              placeholder="Name *"
              className="w-full"
            />

            <div className="grid grid-cols-2 gap-3">
              <input
                type="url"
                value={newCoHostWebsite}
                onChange={(e) => setNewCoHostWebsite(e.target.value)}
                placeholder="Website"
                className="w-full"
              />
              <input
                type="url"
                value={newCoHostAvatarUrl}
                onChange={(e) => setNewCoHostAvatarUrl(e.target.value)}
                placeholder="Avatar URL"
                className="w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={newCoHostTwitter}
                onChange={(e) => setNewCoHostTwitter(e.target.value)}
                placeholder="Twitter username (no @)"
                className="w-full"
              />
              <input
                type="text"
                value={newCoHostInstagram}
                onChange={(e) => setNewCoHostInstagram(e.target.value)}
                placeholder="Instagram username (no @)"
                className="w-full"
              />
            </div>

            <button
              type="button"
              onClick={addCoHost}
              disabled={!newCoHostName.trim()}
              className="w-full btn-secondary flex items-center justify-center gap-2"
            >
              <UserPlus size={16} />
              Add Co-Host
            </button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`p-3 rounded-xl text-sm ${
            message.type === 'success'
              ? 'bg-[#39d98a]/10 border border-[#39d98a]/30 text-[#39d98a]'
              : 'bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a]'
          }`}>
            {message.text}
          </div>
        )}

        {/* Save Button */}
        <button
          type="submit"
          disabled={saving}
          className="w-full btn-primary flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save size={18} />
              Save Settings
            </>
          )}
        </button>

        {/* Cancel Changes Button */}
        {hasChanges() && (
          <button
            type="button"
            onClick={handleCancelChanges}
            className="w-full btn-secondary flex items-center justify-center gap-2"
          >
            <X size={18} />
            Cancel Changes
          </button>
        )}

        {/* Cancel Event Button */}
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={deleting}
          className="w-full bg-[#ff393a]/10 hover:bg-[#ff393a]/20 border border-[#ff393a]/30 text-[#ff393a] hover:text-[#ff5a5b] font-medium px-6 py-3 rounded-xl transition-all flex items-center justify-center gap-2"
        >
          <Trash2 size={18} />
          Cancel Event
        </button>
      </form>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-white mb-3">Cancel Event?</h2>
            <p className="text-white/60 mb-6">
              This will permanently delete this event and all guest responses. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 btn-secondary"
              >
                Keep Event
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium px-6 py-3 rounded-xl transition-all flex items-center justify-center gap-2"
              >
                {deleting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={18} />
                    Delete Event
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
};
