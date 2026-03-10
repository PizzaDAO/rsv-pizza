import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Song, MusicPlatform } from '../../types';
import { IconInput } from '../IconInput';
import { X, Loader2, Music, Link as LinkIcon, Upload, User } from 'lucide-react';
import { PlatformIcon } from './SongCard';

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
  file?: File | null;
}

const defaultFormData: SongFormData = {
  title: '',
  artist: '',
  platform: 'spotify',
  url: '',
  file: null,
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

export const SongForm: React.FC<SongFormProps> = ({
  song,
  isOpen,
  onClose,
  onSave,
  saving = false,
}) => {
  const [formData, setFormData] = useState<SongFormData>(defaultFormData);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    // Auto-detect platform when URL changes
    if (field === 'url' && value) {
      const detectedPlatform = detectPlatform(value);
      setFormData((prev) => ({ ...prev, [field]: value, platform: detectedPlatform }));
    } else {
      setFormData((prev) => ({ ...prev, [field]: value }));
    }
  };

  // Platform labels for display
  const platformLabels: Record<MusicPlatform, string> = {
    spotify: 'Spotify',
    apple_music: 'Apple Music',
    youtube: 'YouTube',
    soundcloud: 'SoundCloud',
    other: 'Link',
  };



  const audioAccept = '.mp3,.wav,.m4a,.ogg,.flac,audio/*';

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData((prev) => ({ ...prev, file, title: prev.title || file.name.replace(/\.[^\.]+$/, '') }));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      setFormData((prev) => ({ ...prev, file, title: prev.title || file.name.replace(/\.[^\.]+$/, '') }));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  if (!isOpen) return null;

  const isEditing = !!song;

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
            <Music size={20} className="text-[#ff393a]" />
            <h2 className="text-lg font-semibold text-theme-text">
              {isEditing ? 'Edit Song' : 'Add Song'}
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
          {/* Song Title */}
          <IconInput icon={Music} type="text" value={formData.title} onChange={(e) => handleChange('title', e.target.value)} placeholder="Song name" required />

          {/* Artist */}
          <IconInput icon={User} type="text" value={formData.artist} onChange={(e) => handleChange('artist', e.target.value)} placeholder="Artist name" required />

          {/* URL */}
          <div>
            <IconInput icon={LinkIcon} type="url" value={formData.url} onChange={(e) => handleChange("url", e.target.value)} placeholder="Paste a link (Spotify, Apple Music, YouTube, etc.)" />
            {formData.url && formData.platform !== 'other' && (
              <div className="flex items-center gap-1.5 mt-1.5 ml-1">
                <PlatformIcon platform={formData.platform} size={14} />
                <span className="text-xs text-theme-text-muted">{platformLabels[formData.platform]} detected</span>
              </div>
            )}
          </div>

          {/* File Upload */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition-colors ${
              isDragOver
                ? 'border-[#ff393a] bg-[#ff393a]/10'
                : formData.file
                  ? 'border-green-500/30 bg-green-500/5'
                  : 'border-theme-stroke hover:border-theme-stroke-hover'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={audioAccept}
              onChange={handleFileSelect}
              className="hidden"
            />
            {formData.file ? (
              <div className="flex items-center justify-center gap-2 text-green-400">
                <Upload size={16} />
                <span className="text-sm truncate max-w-[300px]">{formData.file.name}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 text-theme-text-muted">
                <Upload size={20} />
                <span className="text-sm">Upload audio file or drag &amp; drop</span>
                <span className="text-xs">.mp3, .wav, .m4a, .ogg, .flac</span>
              </div>
            )}
          </div>

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
    </div>,
    document.body
  );
};
