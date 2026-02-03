import React, { useState, useEffect } from 'react';
import { Song, MusicPlatform } from '../../types';
import { X, Loader2, Music, Link as LinkIcon } from 'lucide-react';

interface SongFormProps {
  song?: Song | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: SongFormData) => Promise<void>;
  saving?: boolean;
}

export interface SongFormData {
  title: string;
  artist: string;
  platform: MusicPlatform;
  url: string;
}

const defaultFormData: SongFormData = {
  title: '',
  artist: '',
  platform: 'spotify',
  url: '',
};

const platformOptions: { value: MusicPlatform; label: string; icon: string }[] = [
  { value: 'spotify', label: 'Spotify', icon: '\uD83D\uDFE2' },
  { value: 'apple_music', label: 'Apple Music', icon: '\uD83C\uDF4E' },
  { value: 'youtube', label: 'YouTube', icon: '\uD83D\uDCFA' },
  { value: 'soundcloud', label: 'SoundCloud', icon: '\uD83C\uDF25\uFE0F' },
  { value: 'other', label: 'Other', icon: '\uD83C\uDFB5' },
];

// Detect platform from URL
function detectPlatform(url: string): MusicPlatform {
  const lowercaseUrl = url.toLowerCase();
  if (lowercaseUrl.includes('spotify.com') || lowercaseUrl.includes('open.spotify')) return 'spotify';
  if (lowercaseUrl.includes('music.apple.com') || lowercaseUrl.includes('itunes.apple')) return 'apple_music';
  if (lowercaseUrl.includes('youtube.com') || lowercaseUrl.includes('youtu.be')) return 'youtube';
  if (lowercaseUrl.includes('soundcloud.com')) return 'soundcloud';
  return 'other';
}

export const SongForm: React.FC<SongFormProps> = ({
  song,
  isOpen,
  onClose,
  onSave,
  saving = false,
}) => {
  const [formData, setFormData] = useState<SongFormData>(defaultFormData);

  // Reset form when modal opens/closes or song changes
  useEffect(() => {
    if (isOpen && song) {
      setFormData({
        title: song.title,
        artist: song.artist,
        platform: song.platform,
        url: song.url || '',
      });
    } else if (isOpen) {
      setFormData(defaultFormData);
    }
  }, [isOpen, song]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(formData);
  };

  const handleChange = (field: keyof SongFormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));

    // Auto-detect platform when URL changes
    if (field === 'url' && value) {
      const detectedPlatform = detectPlatform(value);
      if (detectedPlatform !== formData.platform) {
        setFormData((prev) => ({ ...prev, platform: detectedPlatform }));
      }
    }
  };

  if (!isOpen) return null;

  const isEditing = !!song;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-10 p-4 bg-black/70 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl max-w-lg w-full p-5 my-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Music size={20} className="text-[#ff393a]" />
            <h2 className="text-lg font-semibold text-white">
              {isEditing ? 'Edit Song' : 'Add Song'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Song Title */}
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">
              Song Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="Song name"
              required
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            />
          </div>

          {/* Artist */}
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">
              Artist <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={formData.artist}
              onChange={(e) => handleChange('artist', e.target.value)}
              placeholder="Artist name"
              required
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            />
          </div>

          {/* URL */}
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">
              Link (optional)
            </label>
            <div className="relative">
              <LinkIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="url"
                value={formData.url}
                onChange={(e) => handleChange('url', e.target.value)}
                placeholder="https://open.spotify.com/track/..."
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              />
            </div>
            <p className="text-xs text-white/40 mt-1">
              Paste a Spotify, Apple Music, YouTube, or SoundCloud link
            </p>
          </div>

          {/* Platform */}
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Platform</label>
            <div className="flex flex-wrap gap-2">
              {platformOptions.map((platform) => (
                <button
                  key={platform.value}
                  type="button"
                  onClick={() => handleChange('platform', platform.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1.5 ${
                    formData.platform === platform.value
                      ? 'bg-[#ff393a] text-white'
                      : 'bg-white/10 text-white/70 hover:bg-white/20'
                  }`}
                >
                  <span>{platform.icon}</span>
                  <span>{platform.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !formData.title.trim() || !formData.artist.trim()}
              className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </>
              ) : isEditing ? (
                'Save Changes'
              ) : (
                'Add Song'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
