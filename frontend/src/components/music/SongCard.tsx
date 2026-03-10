import React from 'react';
import { Song, MusicPlatform } from '../../types';
import { Edit2, Trash2, ExternalLink, Music, Download } from 'lucide-react';

interface SongCardProps {
  song: Song;
  onEdit: (song: Song) => void;
  onDelete: (songId: string) => void;
  isHost?: boolean;
  isDJ?: boolean;
}

// SVG platform logos
const SpotifyLogo: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#1DB954">
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
  </svg>
);

const AppleMusicLogo: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#FC3C44">
    <path d="M23.994 6.124a9.23 9.23 0 00-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043A5.022 5.022 0 0019.7.237C18.85.09 17.89.03 17.12.019 16.1.005 15.09 0 14.07 0H9.93c-1.02 0-2.04.005-3.05.018C6.11.03 5.15.09 4.3.237c-.76.136-1.46.427-2.1.793C1.1 1.753.345 2.743.028 4.053a9.03 9.03 0 00-.224 2.19C-.012 7.274 0 8.306 0 9.336v5.328c0 1.03-.012 2.062.004 3.093a9.23 9.23 0 00.224 2.19c.317 1.31 1.072 2.3 2.172 3.023a5.022 5.022 0 001.874.656c.85.147 1.81.207 2.58.218 1.02.014 2.03.018 3.05.018h4.14c1.02 0 2.04-.004 3.05-.018.78-.011 1.73-.071 2.58-.218.76-.136 1.46-.427 2.1-.793 1.1-.733 1.865-1.723 2.172-3.043a9.03 9.03 0 00.24-2.19c.016-1.03.012-2.063.012-3.093V9.336c0-1.03.004-2.062-.008-3.212zM16.97 17.08c0 .373-.13.624-.42.78-.19.106-.41.15-.64.15a1.16 1.16 0 01-.349-.053l-5.565-1.77V10.1l6.974-2.14v9.12h0zm-1.39-7.787l-4.584 1.41V7.263l4.584-1.41v3.44z" />
  </svg>
);

const YouTubeLogo: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#FF0000">
    <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

const SoundCloudLogo: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#FF5500">
    <path d="M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.27-2.154c-.009-.06-.05-.1-.1-.1m-.899.828c-.06 0-.091.037-.104.094L0 14.479l.172 1.308c.013.06.044.094.104.094.06 0 .09-.037.104-.094l.194-1.308-.194-1.332c-.014-.057-.044-.094-.104-.094m1.81-1.108c-.066 0-.12.055-.12.13l-.21 2.401.21 2.313c0 .074.054.13.12.13.065 0 .119-.056.119-.13l.24-2.313-.24-2.401c0-.075-.054-.13-.12-.13m.824-.246c-.076 0-.132.065-.132.145l-.195 2.648.195 2.59c0 .08.056.145.132.145.075 0 .131-.065.131-.145l.22-2.59-.22-2.648c0-.08-.056-.145-.131-.145m.844-.317c-.085 0-.15.074-.15.165L3.41 14.48l.195 2.842c0 .09.065.165.15.165.084 0 .148-.074.148-.165l.219-2.842-.22-2.897c0-.091-.064-.165-.148-.165m.84-.27c-.094 0-.17.084-.17.186l-.183 3.167.183 3.063c0 .1.076.185.17.185.094 0 .169-.085.169-.185l.209-3.063-.21-3.167c0-.102-.074-.186-.168-.186m.864-.26c-.104 0-.188.094-.188.208l-.17 3.427.17 3.225c0 .113.084.208.188.208.104 0 .188-.095.188-.208l.19-3.225-.19-3.427c0-.114-.084-.208-.188-.208m.85-.187c-.112 0-.205.104-.205.233l-.165 3.614.165 3.318c0 .125.093.232.205.232.113 0 .206-.107.206-.232l.186-3.318-.186-3.614c0-.129-.093-.233-.206-.233m.92.023c-.122 0-.22.114-.22.254l-.14 3.59.14 3.323c0 .14.098.254.22.254.12 0 .219-.114.219-.254l.158-3.323-.158-3.59c0-.14-.099-.254-.22-.254m.898-.187c-.129 0-.236.124-.236.277l-.128 3.777.128 3.284c0 .15.107.277.236.277.13 0 .236-.126.236-.277l.15-3.284-.15-3.777c0-.153-.106-.277-.236-.277m.911-.18c-.14 0-.25.135-.25.3l-.127 3.957.127 3.226c0 .164.11.3.25.3.138 0 .25-.136.25-.3l.14-3.226-.14-3.957c0-.165-.112-.3-.25-.3m3.68.456c-.37 0-.72.074-1.04.208a4.72 4.72 0 00-4.67-4.244c-.3 0-.6.03-.89.085-.13.027-.17.054-.17.108v8.345c0 .06.046.108.106.114h6.664c1.34 0 2.43-1.095 2.43-2.444 0-1.35-1.09-2.172-2.43-2.172" />
  </svg>
);

const PlatformIcon: React.FC<{ platform: MusicPlatform; size?: number }> = ({ platform, size = 18 }) => {
  switch (platform) {
    case 'spotify': return <SpotifyLogo size={size} />;
    case 'apple_music': return <AppleMusicLogo size={size} />;
    case 'youtube': return <YouTubeLogo size={size} />;
    case 'soundcloud': return <SoundCloudLogo size={size} />;
    default: return <Music size={size} className="text-theme-text-secondary" />;
  }
};

export { PlatformIcon };

export const SongCard: React.FC<SongCardProps> = ({
  song,
  onEdit,
  onDelete,
  isHost = false,
  isDJ = false,
}) => {
  return (
    <div className="bg-theme-surface border border-theme-stroke rounded-xl p-3 transition-all hover:bg-theme-surface-hover">
      <div className="flex items-center gap-3">
        {/* Platform Icon */}
        <div className="flex-shrink-0">
          <PlatformIcon platform={song.platform} />
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <h4 className="text-theme-text font-medium text-sm truncate">{song.title}</h4>
          <p className="text-theme-text-secondary text-xs truncate">{song.artist}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {song.fileUrl && isDJ && (
            <a
              href={song.fileUrl}
              download
              className="p-1.5 text-theme-text-muted hover:text-green-400 hover:bg-green-500/10 rounded-lg transition-colors"
              title="Download"
              onClick={(e) => e.stopPropagation()}
            >
              <Download size={14} />
            </a>
          )}
          {song.url && (
            <a
              href={song.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors"
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
                className="p-1.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors"
                title="Edit"
              >
                <Edit2 size={14} />
              </button>
              <button
                onClick={() => onDelete(song.id)}
                className="p-1.5 text-theme-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
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
