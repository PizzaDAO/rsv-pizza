import React, { useState, useEffect } from 'react';
import { Calendar, MapPin, User, Lock, Image as ImageIcon, FileText, Link as LinkIcon, Clock, Save, Loader2, UserPlus, X, Globe, Twitter, Instagram, GripVertical } from 'lucide-react';
import { usePizza } from '../contexts/PizzaContext';
import { updateParty, uploadEventImage } from '../lib/supabase';
import { CoHost } from '../types';

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
      setCoHosts(party.coHosts || []);
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

  const addCoHost = () => {
    if (!newCoHostName.trim()) return;

    const newCoHost: CoHost = {
      id: crypto.randomUUID(),
      name: newCoHostName.trim(),
      website: newCoHostWebsite.trim() || undefined,
      twitter: newCoHostTwitter.trim() || undefined,
      instagram: newCoHostInstagram.trim() || undefined,
      avatar_url: newCoHostAvatarUrl.trim() || undefined,
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

  if (!party) {
    return <div className="card p-6 text-white/60">No party loaded</div>;
  }

  return (
    <div className="card p-8">
      <form onSubmit={handleSave} className="space-y-6">
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
            placeholder="Your Name (Host)"
            className="w-full !pl-14"
          />
        </div>

        {/* Date and Duration - Hidden for now, matching homepage */}

        {/* Address */}
        <div className="relative">
          <MapPin size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Add Event Location"
            className="w-full !pl-14"
          />
        </div>

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
          {/* Image URL Input */}
          <div className="mb-3 relative">
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
                  <X size={16} />
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
          <div className="space-y-4 border-l-2 border-white/10 pl-4">
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
          <label className="block text-sm font-medium text-white/80 mb-2">
            <User size={16} className="inline mr-2" />
            Co-Hosts
          </label>

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
                    <div>
                      <p className="text-white font-medium">{coHost.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {coHost.website && (
                          <a href={coHost.website} target="_blank" rel="noopener noreferrer" className="text-white/50 hover:text-white" onClick={(e) => e.stopPropagation()}>
                            <Globe size={14} />
                          </a>
                        )}
                        {coHost.twitter && (
                          <a href={`https://twitter.com/${coHost.twitter}`} target="_blank" rel="noopener noreferrer" className="text-white/50 hover:text-white" onClick={(e) => e.stopPropagation()}>
                            <Twitter size={14} />
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
                  <button
                    type="button"
                    onClick={() => removeCoHost(coHost.id)}
                    className="text-[#ff393a] hover:text-[#ff5a5b]"
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add New Co-Host Form */}
          <div className="border border-white/20 rounded-xl p-4 space-y-3">
            <p className="text-sm text-white/60 mb-3">Add a co-host or partner organization</p>

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

          <p className="text-xs text-white/50 mt-2">
            Co-hosts will be displayed on the event page with their social links
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
