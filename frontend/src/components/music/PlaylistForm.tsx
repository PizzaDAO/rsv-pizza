import React, { useState, useEffect } from 'react';
import { Playlist, MusicPlatform } from '../../types';
import { IconInput } from '../IconInput';
import { X, Loader2, ListMusic, Link as LinkIcon, FileText } from 'lucide-react';

interface PlaylistFormProps {
  playlist?: Playlist | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: PlaylistFormData) => Promise<void>;
  saving?: boolean;
}

export interface PlaylistFormData {
  name: string;
  platform: MusicPlatform;
  url: string;
  description: string;
}

const defaultFormData: PlaylistFormData = {
  name: '',
  platform: 'spotify',
  url: '',
  description: '',
};

const platformOptions: { value: MusicPlatform; label: string; icon: string; placeholder: string }[] = [
  { value: 'spotify', label: 'Spotify', icon: '\uD83D\uDFE2', placeholder: 'https://open.spotify.com/playlist/...' },
  { value: 'apple_music', label: 'Apple Music', icon: '\uD83C\uDF4E', placeholder: 'https://music.apple.com/playlist/...' },
  { value: 'youtube', label: 'YouTube', icon: '\uD83D\uDCFA', placeholder: 'https://youtube.com/playlist?list=...' },
  { value: 'soundcloud', label: 'SoundCloud', icon: '\uD83C\uDF25\uFE0F', placeholder: 'https://soundcloud.com/user/sets/...' },
  { value: 'other', label: 'Other', icon: '\uD83C\uDFB5', placeholder: 'Paste playlist URL' },
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

export const PlaylistForm: React.FC<PlaylistFormProps> = ({
  playlist,
  isOpen,
  onClose,
  onSave,
  saving = false,
}) => {
  const [formData, setFormData] = useState<PlaylistFormData>(defaultFormData);

  // Reset form when modal opens/closes or playlist changes
  useEffect(() => {
    if (isOpen && playlist) {
      setFormData({
        name: playlist.name,
        platform: playlist.platform,
        url: playlist.url,
        description: playlist.description || '',
      });
    } else if (isOpen) {
      setFormData(defaultFormData);
    }
  }, [isOpen, playlist]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(formData);
  };

  const handleChange = (field: keyof PlaylistFormData, value: any) => {
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

  const isEditing = !!playlist;
  const currentPlatform = platformOptions.find(p => p.value === formData.platform);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-10 p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl max-w-lg w-full p-5 my-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ListMusic size={20} className="text-[#ff393a]" />
            <h2 className="text-lg font-semibold text-white">
              {isEditing ? 'Edit Playlist' : 'Add Playlist'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Playlist Name */}
          

          {/* Platform */}
          <div>
            
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

          {/* URL */}
          

          {/* Description */}
          

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
              disabled={saving || !formData.name.trim() || !formData.url.trim()}
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
                'Add Playlist'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
