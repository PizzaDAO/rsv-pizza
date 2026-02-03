import React from 'react';
import { Song, MusicPlatform } from '../../types';
import { Edit2, Trash2, ExternalLink } from 'lucide-react';

interface SongCardProps {
  song: Song;
  onEdit: (song: Song) => void;
  onDelete: (songId: string) => void;
  isHost?: boolean;
}

// Platform icons with emoji
const platformIcons: Record<MusicPlatform, string> = {
  spotify: '\uD83D\uDFE2',
  apple_music: '\uD83C\uDF4E',
  youtube: '\uD83D\uDCFA',
  soundcloud: '\uD83C\uDF25\uFE0F',
  other: '\uD83C\uDFB5',
};

// Platform colors
const platformColors: Record<MusicPlatform, string> = {
  spotify: 'text-green-400',
  apple_music: 'text-pink-400',
  youtube: 'text-red-400',
  soundcloud: 'text-orange-400',
  other: 'text-white/60',
};

export const SongCard: React.FC<SongCardProps> = ({
  song,
  onEdit,
  onDelete,
  isHost = false,
}) => {
  const platformIcon = platformIcons[song.platform];
  const platformColor = platformColors[song.platform];

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3 transition-all hover:bg-white/[0.07]">
      <div className="flex items-center gap-3">
        {/* Platform Icon */}
        <div className={`text-xl flex-shrink-0 ${platformColor}`}>
          {platformIcon}
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <h4 className="text-white font-medium text-sm truncate">{song.title}</h4>
          <p className="text-white/60 text-xs truncate">{song.artist}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {song.url && (
            <a
              href={song.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="Open link"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={14} />
            </a>
          )}
          {isHost && (
            <>
              <button
                onClick={() => onEdit(song)}
                className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="Edit"
              >
                <Edit2 size={14} />
              </button>
              <button
                onClick={() => onDelete(song.id)}
                className="p-1.5 text-white/50 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
