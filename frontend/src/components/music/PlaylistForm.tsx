import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Playlist, MusicPlatform } from '../../types';
import { IconInput } from '../IconInput';
import { X, Loader2, ListMusic, Link as LinkIcon, FileText } from 'lucide-react';
import { PlatformIcon } from './SongCard';

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

// Platform labels
const platformLabels: Record<MusicPlatform, string> = {
  spotify: 'Spotify',
  apple_music: 'Apple Music',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  other: 'Link',
};

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
    // Auto-detect platform when URL changes
    if (field === 'url' && value) {
      const detectedPlatform = detectPlatform(value);
      setFormData((prev) => ({ ...prev, [field]: value, platform: detectedPlatform }));
    } else {
      setFormData((prev) => ({ ...prev, [field]: value }));
    }
  };

  if (!isOpen) return null;

  const isEditing = !!playlist;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-theme-header border border-theme-stroke rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ListMusic size={20} className="text-[#ff393a]" />
            <h2 className="text-lg font-semibold text-theme-text">
              {isEditing ? 'Edit Playlist' : 'Add Playlist'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Playlist Name */}
          <IconInput icon={ListMusic} type="text" value={formData.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="Playlist name" required />

          {/* URL with auto-detect */}
          <div>
            <IconInput icon={LinkIcon} type="url" value={formData.url} onChange={(e) => handleChange('url', e.target.value)} placeholder="Paste a link (Spotify, Apple Music, YouTube, etc.)" required />
            {formData.url && formData.platform !== 'other' && (
              <div className="flex items-center gap-1.5 mt-1.5 ml-1">
                <PlatformIcon platform={formData.platform} size={14} />
                <span className="text-xs text-theme-text-muted">{platformLabels[formData.platform]} detected</span>
              </div>
            )}
          </div>

          {/* Description */}
          <IconInput icon={FileText} multiline rows={2} value={formData.description} onChange={(e) => handleChange('description', e.target.value)} placeholder="Optional description..." />

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 bg-theme-surface-hover hover:bg-theme-surface-hover disabled:opacity-50 text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm"
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
    </div>,
    document.body
  );
};
