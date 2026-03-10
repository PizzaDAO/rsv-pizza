import React from 'react';
import { Playlist, MusicPlatform } from '../../types';
import { Edit2, Trash2, ExternalLink } from 'lucide-react';
import { PlatformIcon } from './SongCard';

interface PlaylistCardProps {
  playlist: Playlist;
  onEdit: (playlist: Playlist) => void;
  onDelete: (playlistId: string) => void;
  isHost?: boolean;
}

// Platform labels
const platformLabels: Record<MusicPlatform, string> = {
  spotify: 'Spotify',
  apple_music: 'Apple Music',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  other: 'Link',
};

// Platform colors
const platformColors: Record<MusicPlatform, { bg: string; text: string }> = {
  spotify: { bg: 'bg-green-500/20', text: 'text-green-400' },
  apple_music: { bg: 'bg-pink-500/20', text: 'text-pink-400' },
  youtube: { bg: 'bg-red-500/20', text: 'text-red-400' },
  soundcloud: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  other: { bg: 'bg-theme-surface-hover', text: 'text-theme-text-secondary' },
};

export const PlaylistCard: React.FC<PlaylistCardProps> = ({
  playlist,
  onEdit,
  onDelete,
  isHost = false,
}) => {
  const platformLabel = platformLabels[playlist.platform];
  const platformStyle = platformColors[playlist.platform];

  return (
    <div className="bg-theme-surface border border-theme-stroke rounded-xl p-4 transition-all hover:bg-theme-surface-hover">
      <div className="flex items-start gap-3">
        {/* Platform Icon */}
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${platformStyle.bg}`}>
          <PlatformIcon platform={playlist.platform} size={22} />
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-theme-text font-medium truncate">{playlist.name}</h4>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 ${platformStyle.bg} ${platformStyle.text}`}>
              <PlatformIcon platform={playlist.platform} size={12} /> {platformLabel}
            </span>
          </div>
          {playlist.description && (
            <p className="text-theme-text-secondary text-sm line-clamp-2">{playlist.description}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <a
            href={playlist.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors"
            title="Open playlist"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={16} />
          </a>
          {isHost && (
            <>
              <button
                onClick={() => onEdit(playlist)}
                className="p-2 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors"
                title="Edit"
              >
                <Edit2 size={16} />
              </button>
              <button
                onClick={() => onDelete(playlist.id)}
                className="p-2 text-theme-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                title="Delete"
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
