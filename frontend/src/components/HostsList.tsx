import React, { useState } from 'react';
import { User, Globe, Instagram, Youtube, Linkedin } from 'lucide-react';
import { cdnUrl } from '../lib/supabase';
import { normalizeUrl } from '../lib/utils';

// Avatar with onError fallback for broken image URLs
const AvatarImg: React.FC<{
  src: string;
  alt: string;
  className: string;
  fallbackClassName: string;
  iconClassName: string;
  style?: React.CSSProperties;
}> = ({ src, alt, className, fallbackClassName, iconClassName, style }) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={fallbackClassName} style={style}>
        <User className={iconClassName} />
      </div>
    );
  }

  return (
    <img
      src={cdnUrl(src)}
      alt={alt}
      className={className}
      style={style}
      onError={() => setFailed(true)}
    />
  );
};

interface CoHost {
  id: string;
  name: string;
  avatar_url?: string;
  website?: string;
  twitter?: string;
  instagram?: string;
  showOnEvent?: boolean;
  canEdit?: boolean;
}

// Host profile from user account (matches API response)
interface HostProfile {
  name: string | null;
  avatar_url: string | null;
  website: string | null;
  twitter: string | null;
  instagram: string | null;
  youtube: string | null;
  tiktok: string | null;
  linkedin: string | null;
}

interface HostsListProps {
  hostName?: string | null;
  hostProfile?: HostProfile | null;
  coHosts?: CoHost[];
  size?: 'sm' | 'md' | 'lg';
  showTitle?: boolean;
  showSocialLinks?: boolean;
  onLinkClick?: (url: string, linkLabel: string) => void;
}

// X (Twitter) icon component
const XIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

// TikTok icon component
const TikTokIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
  </svg>
);

export const HostsList: React.FC<HostsListProps> = ({
  hostName,
  hostProfile,
  coHosts,
  size = 'md',
  showTitle = true,
  showSocialLinks = true,
  onLinkClick,
}) => {
  const displayHost = hostProfile?.name || hostName;
  const visibleCoHosts = coHosts?.filter(h => h.showOnEvent !== false && h.name !== displayHost) || [];

  // Size configurations
  const sizeConfig = {
    sm: { avatar: 'w-8 h-8', icon: 'w-4 h-4', text: 'text-sm', socialIcon: 14, gap: 'gap-2' },
    md: { avatar: 'w-10 h-10', icon: 'w-5 h-5', text: 'text-lg', socialIcon: 18, gap: 'gap-3' },
    lg: { avatar: 'w-12 h-12', icon: 'w-6 h-6', text: 'text-xl', socialIcon: 22, gap: 'gap-3' },
  };

  const config = sizeConfig[size];

  // Use hostProfile name if available, otherwise fall back to hostName
  const displayHostName = hostProfile?.name || hostName;

  if (!displayHostName && visibleCoHosts.length === 0) {
    return null;
  }

  // Check if host has any social links
  const hostHasSocials = hostProfile && (
    hostProfile.website || hostProfile.twitter || hostProfile.instagram ||
    hostProfile.youtube || hostProfile.tiktok || hostProfile.linkedin
  );

  return (
    <div>
      {showTitle && (
        <h3 className="text-sm font-semibold text-theme-text-secondary mb-3">Hosted by</h3>
      )}

      <div className="space-y-3">
        {/* Primary Host */}
        {displayHostName && (
          <div className={`flex items-center ${config.gap}`}>
            {hostProfile?.avatar_url ? (
              <AvatarImg
                src={hostProfile.avatar_url}
                alt={displayHostName}
                className={`${config.avatar} rounded-full object-cover flex-shrink-0`}
                fallbackClassName={`${config.avatar} rounded-full bg-[#ff393a]/20 flex items-center justify-center flex-shrink-0`}
                iconClassName={`${config.icon} text-[#ff393a]`}
              />
            ) : (
              <div className={`${config.avatar} rounded-full bg-[#ff393a]/20 flex items-center justify-center flex-shrink-0`}>
                <User className={`${config.icon} text-[#ff393a]`} />
              </div>
            )}
            <p className={`text-theme-text font-medium ${config.text} flex-1`}>{displayHostName}</p>
            {showSocialLinks && hostHasSocials && (
              <div className="flex items-center gap-2 flex-shrink-0">
                {hostProfile.website && (
                  <a
                    href={normalizeUrl(hostProfile.website)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-theme-text-muted hover:text-theme-text transition-colors"
                    onClick={() => onLinkClick?.(hostProfile.website!, `${displayHostName}_website`)}
                  >
                    <Globe size={config.socialIcon} />
                  </a>
                )}
                {hostProfile.twitter && (
                  <a
                    href={`https://twitter.com/${hostProfile.twitter}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-theme-text-muted hover:text-theme-text transition-colors"
                    onClick={() => onLinkClick?.(`https://twitter.com/${hostProfile.twitter}`, `${displayHostName}_twitter`)}
                  >
                    <XIcon size={config.socialIcon} />
                  </a>
                )}
                {hostProfile.instagram && (
                  <a
                    href={`https://instagram.com/${hostProfile.instagram}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-theme-text-muted hover:text-theme-text transition-colors"
                    onClick={() => onLinkClick?.(`https://instagram.com/${hostProfile.instagram}`, `${displayHostName}_instagram`)}
                  >
                    <Instagram size={config.socialIcon} />
                  </a>
                )}
                {hostProfile.youtube && (
                  <a
                    href={`https://youtube.com/@${hostProfile.youtube}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-theme-text-muted hover:text-theme-text transition-colors"
                    onClick={() => onLinkClick?.(`https://youtube.com/@${hostProfile.youtube}`, `${displayHostName}_youtube`)}
                  >
                    <Youtube size={config.socialIcon} />
                  </a>
                )}
                {hostProfile.tiktok && (
                  <a
                    href={`https://tiktok.com/@${hostProfile.tiktok}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-theme-text-muted hover:text-theme-text transition-colors"
                    onClick={() => onLinkClick?.(`https://tiktok.com/@${hostProfile.tiktok}`, `${displayHostName}_tiktok`)}
                  >
                    <TikTokIcon size={config.socialIcon} />
                  </a>
                )}
                {hostProfile.linkedin && (
                  <a
                    href={`https://linkedin.com/in/${hostProfile.linkedin}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-theme-text-muted hover:text-theme-text transition-colors"
                    onClick={() => onLinkClick?.(`https://linkedin.com/in/${hostProfile.linkedin}`, `${displayHostName}_linkedin`)}
                  >
                    <Linkedin size={config.socialIcon} />
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {/* Co-Hosts */}
        {visibleCoHosts.map((coHost) => (
          <div key={coHost.id} className={`flex items-center ${config.gap}`}>
            {coHost.avatar_url ? (
              <AvatarImg
                src={coHost.avatar_url}
                alt={coHost.name}
                className={`${config.avatar} rounded-full object-cover flex-shrink-0`}
                fallbackClassName={`${config.avatar} rounded-full bg-[#ff393a]/20 flex items-center justify-center flex-shrink-0`}
                iconClassName={`${config.icon} text-[#ff393a]`}
              />
            ) : (
              <div className={`${config.avatar} rounded-full bg-[#ff393a]/20 flex items-center justify-center flex-shrink-0`}>
                <User className={`${config.icon} text-[#ff393a]`} />
              </div>
            )}
            <p className={`text-theme-text font-medium ${config.text} flex-1`}>{coHost.name}</p>
            {showSocialLinks && (coHost.website || coHost.twitter || coHost.instagram) && (
              <div className="flex items-center gap-2 flex-shrink-0">
                {coHost.website && (
                  <a
                    href={normalizeUrl(coHost.website)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-theme-text-muted hover:text-theme-text transition-colors"
                    onClick={() => onLinkClick?.(coHost.website!, `${coHost.name}_website`)}
                  >
                    <Globe size={config.socialIcon} />
                  </a>
                )}
                {coHost.twitter && (
                  <a
                    href={`https://twitter.com/${coHost.twitter}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-theme-text-muted hover:text-theme-text transition-colors"
                    onClick={() => onLinkClick?.(`https://twitter.com/${coHost.twitter}`, `${coHost.name}_twitter`)}
                  >
                    <XIcon size={config.socialIcon} />
                  </a>
                )}
                {coHost.instagram && (
                  <a
                    href={`https://instagram.com/${coHost.instagram}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-theme-text-muted hover:text-theme-text transition-colors"
                    onClick={() => onLinkClick?.(`https://instagram.com/${coHost.instagram}`, `${coHost.name}_instagram`)}
                  >
                    <Instagram size={config.socialIcon} />
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// Compact version showing overlapping avatars (for mobile summary)
interface HostsAvatarsProps {
  hostName?: string | null;
  hostProfile?: HostProfile | null;
  coHosts?: CoHost[];
  maxVisible?: number;
}

export const HostsAvatars: React.FC<HostsAvatarsProps> = ({
  hostName,
  hostProfile,
  coHosts,
  maxVisible = 6,
}) => {
  const displayHostName = hostProfile?.name || hostName;
  const visibleCoHosts = coHosts?.filter(h => h.showOnEvent !== false && h.name !== displayHostName) || [];
  const displayCoHosts = visibleCoHosts.slice(0, maxVisible);
  const remainingCount = visibleCoHosts.length > maxVisible ? visibleCoHosts.length - maxVisible : 0;

  return (
    <div className="flex items-center gap-3">
      {/* Overlapping avatars */}
      <div className="flex items-center" style={{ marginLeft: '8px' }}>
        {/* Primary host avatar */}
        {displayHostName && (
          hostProfile?.avatar_url ? (
            <AvatarImg
              src={hostProfile.avatar_url}
              alt={displayHostName}
              className="w-8 min-w-8 h-8 min-h-8 rounded-full object-cover flex-shrink-0 border-2 border-theme-card"
              fallbackClassName="w-8 min-w-8 h-8 min-h-8 rounded-full bg-[#ff393a] flex items-center justify-center flex-shrink-0 border-2 border-theme-card relative"
              iconClassName="w-4 h-4 text-theme-text"
              style={{ zIndex: 10, marginLeft: '-8px' }}
            />
          ) : (
            <div
              className="w-8 min-w-8 h-8 min-h-8 rounded-full bg-[#ff393a] flex items-center justify-center flex-shrink-0 border-2 border-theme-card relative"
              style={{ zIndex: 10, marginLeft: '-8px' }}
            >
              <User className="w-4 h-4 text-theme-text" />
            </div>
          )
        )}
        {/* Co-host avatars */}
        {displayCoHosts.map((coHost, index) => (
          <div key={coHost.id} className="flex-shrink-0" style={{ zIndex: 9 - index, marginLeft: '-8px' }}>
            {coHost.avatar_url ? (
              <AvatarImg
                src={coHost.avatar_url}
                alt={coHost.name}
                className="w-8 min-w-8 h-8 min-h-8 rounded-full object-cover border-2 border-theme-card"
                fallbackClassName="w-8 min-w-8 h-8 min-h-8 rounded-full bg-[#ff393a] flex items-center justify-center border-2 border-theme-card"
                iconClassName="w-4 h-4 text-theme-text"
              />
            ) : (
              <div className="w-8 min-w-8 h-8 min-h-8 rounded-full bg-[#ff393a] flex items-center justify-center border-2 border-theme-card">
                <User className="w-4 h-4 text-theme-text" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Host text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-theme-text">
          Hosted by <span className="font-medium">{displayHostName}</span>
          {visibleCoHosts.length > 0 && (
            <> & {visibleCoHosts.length} other{visibleCoHosts.length > 1 ? 's' : ''}</>
          )}
          {remainingCount > 0 && (
            <> (+{remainingCount} more)</>
          )}
        </p>
      </div>
    </div>
  );
};
