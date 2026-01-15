import React, { useState, useEffect } from 'react';
import { Calendar, MapPin, User, Lock, Image as ImageIcon, FileText, Link as LinkIcon, Clock, Save, Loader2 } from 'lucide-react';
import { usePizza } from '../contexts/PizzaContext';
import { updateParty, uploadEventImage } from '../lib/supabase';

export const EventDetailsTab: React.FC = () => {
  const { party } = usePizza();

  const [name, setName] = useState('');
  const [hostName, setHostName] = useState('');
  const [date, setDate] = useState('');
  const [duration, setDuration] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [password, setPassword] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [eventImageUrl, setEventImageUrl] = useState('');
  const [eventImageFile, setEventImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [maxGuests, setMaxGuests] = useState('');

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  // Load party data into form
  useEffect(() => {
    if (party) {
      setName(party.name || '');
      setHostName(party.hostName || '');
      setDate(party.date || '');
      setDuration(party.duration?.toString() || '');
      setAddress(party.address || '');
      setDescription(party.description || '');
      setPassword(party.password || '');
      setCustomUrl(party.customUrl || '');
      setEventImageUrl(party.eventImageUrl || '');
      setImagePreview(party.eventImageUrl || null);
      setMaxGuests(party.maxGuests?.toString() || '');
    }
  }, [party]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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

      // Update party in database
      const success = await updateParty(party.id, {
        name: name.trim(),
        host_name: hostName.trim() || null,
        date: date || null,
        duration: duration ? parseFloat(duration) : null,
        address: address.trim() || null,
        description: description.trim() || null,
        password: password.trim() || null,
        custom_url: customUrl.trim() || null,
        event_image_url: imageUrl || null,
        max_guests: maxGuests ? parseInt(maxGuests, 10) : null,
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

  if (!party) {
    return <div className="card p-6 text-white/60">No party loaded</div>;
  }

  return (
    <div className="card p-6">
      <h2 className="text-xl font-bold text-white mb-6">Event Details</h2>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            <User size={16} className="inline mr-2" />
            Event Name*
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pizza Party at My Place"
            className="w-full"
            required
          />
        </div>

        {/* Host Name */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            <User size={16} className="inline mr-2" />
            Host Name
          </label>
          <input
            type="text"
            value={hostName}
            onChange={(e) => setHostName(e.target.value)}
            placeholder="Your name"
            className="w-full"
          />
        </div>

        {/* Date and Duration */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              <Calendar size={16} className="inline mr-2" />
              Party Date
            </label>
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              <Clock size={16} className="inline mr-2" />
              Duration (hrs)
            </label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="2.5"
              className="w-full"
            />
          </div>
        </div>

        {/* Address */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            <MapPin size={16} className="inline mr-2" />
            Address
          </label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St, City, State"
            className="w-full"
          />
        </div>

        {/* Max Guests */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            <User size={16} className="inline mr-2" />
            Expected Guests
          </label>
          <input
            type="number"
            min="1"
            value={maxGuests}
            onChange={(e) => setMaxGuests(e.target.value)}
            placeholder="20"
            className="w-full"
          />
          <p className="text-xs text-white/50 mt-1">
            Used for ordering extra pizzas beyond RSVPs
          </p>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            <FileText size={16} className="inline mr-2" />
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell guests about your party... (Markdown supported)"
            className="w-full min-h-[150px]"
          />
          <p className="text-xs text-white/50 mt-1">
            Supports Markdown: **bold**, *italic*, [links](url), etc.
          </p>
        </div>

        {/* Event Image */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            <ImageIcon size={16} className="inline mr-2" />
            Event Image
          </label>

          {imagePreview && (
            <div className="mb-3">
              <img
                src={imagePreview}
                alt="Event preview"
                className="w-full max-w-xs h-auto rounded-xl border border-white/10"
              />
              <button
                type="button"
                onClick={removeImage}
                className="mt-2 text-sm text-[#ff393a] hover:text-[#ff5a5b]"
              >
                Remove image
              </button>
            </div>
          )}

          <div className="space-y-3">
            <input
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="w-full"
            />
            <div className="flex items-center gap-2 text-white/40 text-sm">
              <div className="flex-1 h-px bg-white/10" />
              <span>or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
            <input
              type="url"
              value={eventImageUrl}
              onChange={(e) => {
                setEventImageUrl(e.target.value);
                setImagePreview(e.target.value);
              }}
              placeholder="https://example.com/image.jpg"
              className="w-full"
            />
          </div>

          {imageError && (
            <p className="text-xs text-[#ff393a] mt-2">{imageError}</p>
          )}
          <p className="text-xs text-white/50 mt-1">
            Square images (1:1 ratio) work best. Max 5MB.
          </p>
        </div>

        {/* Custom URL */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            <LinkIcon size={16} className="inline mr-2" />
            Custom URL
          </label>
          <div className="flex items-center gap-2">
            <span className="text-white/40 text-sm whitespace-nowrap">/rsv-pizza/</span>
            <input
              type="text"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="my-party"
              className="flex-1"
              pattern="[a-z0-9-]+"
            />
          </div>
          <p className="text-xs text-white/50 mt-1">
            Creates a clean URL like /rsv-pizza/my-party
          </p>
        </div>

        {/* Password */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            <Lock size={16} className="inline mr-2" />
            Event Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Optional password protection"
            className="w-full"
            autoComplete="new-password"
          />
          <p className="text-xs text-white/50 mt-1">
            Guests will need this password to view the event page
          </p>
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
              Save Event Details
            </>
          )}
        </button>
      </form>
    </div>
  );
};
