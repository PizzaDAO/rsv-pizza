import React from 'react';
import { User, Globe, Instagram, Youtube, Linkedin } from 'lucide-react';

interface CoHost {
  id: string;
  name: string;
  avatar_url?: string;
  website?: string;
  twitter?: string;
  instagram?: string;
  showOnEvent?: boolean;
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
}) => {
  const visibleCoHosts = coHosts?.filter(h => h.showOnEvent !== false) || [];

  // Size configurations
  const sizeConfig = {
    sm: { avatar: 'w-8 h-8', icon: 'w-4 h-4', text: 'text-sm', socialIcon: 14, gap: 'gap-2' },
    md: { avatar: 'w-10 h-10', icon: 'w-5 h-5', text: 'text-base', socialIcon: 14, gap: 'gap-3' },
    lg: { avatar: 'w-12 h-12', icon: 'w-6 h-6', text: 'text-lg', socialIcon: 18, gap: 'gap-3' },
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
        <h3 className="text-sm font-semibold text-white/60 mb-3">Hosted By</h3>
      )}

      <div className="space-y-3">
        {/* Primary Host */}
        {displayHostName && (
          <div className={`flex items-start ${config.gap}`}>
            {hostProfile?.avatar_url ? (
              <img
                src={hostProfile.avatar_url}
                alt={displayHostName}
                className={`${config.avatar} rounded-full object-cover flex-shrink-0`}
              />
            ) : (
              <div className={`${config.avatar} rounded-full bg-[#ff393a]/20 flex items-center justify-center flex-shrink-0`}>
                <User className={`${config.icon} text-[#ff393a]`} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className={`text-white font-medium ${config.text}`}>{displayHostName}</p>
              {showSocialLinks && hostHasSocials && (
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {hostProfile.website && (
                    <a
                      href={hostProfile.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/50 hover:text-white transition-colors"
                    >
                      <Globe size={config.socialIcon} />
                    </a>
                  )}
                  {hostProfile.twitter && (
                    <a
                      href={`https://twitter.com/${hostProfile.twitter}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/50 hover:text-white transition-colors"
                    >
                      <XIcon size={config.socialIcon} />
                    </a>
                  )}
                  {hostProfile.instagram && (
                    <a
                      href={`https://instagram.com/${hostProfile.instagram}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/50 hover:text-white transition-colors"
                    >
                      <Instagram size={config.socialIcon} />
                    </a>
                  )}
                  {hostProfile.youtube && (
                    <a
                      href={`https://youtube.com/@${hostProfile.youtube}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/50 hover:text-white transition-colors"
                    >
                      <Youtube size={config.socialIcon} />
                    </a>
                  )}
                  {hostProfile.tiktok && (
                    <a
                      href={`https://tiktok.com/@${hostProfile.tiktok}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/50 hover:text-white transition-colors"
                    >
                      <TikTokIcon size={config.socialIcon} />
                    </a>
                  )}
                  {hostProfile.linkedin && (
                    <a
                      href={`https://linkedin.com/in/${hostProfile.linkedin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/50 hover:text-white transition-colors"
                    >
                      <Linkedin size={config.socialIcon} />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Co-Hosts */}
        {visibleCoHosts.map((coHost) => (
          <div key={coHost.id} className={`flex items-start ${config.gap}`}>
            {coHost.avatar_url ? (
              <img
                src={coHost.avatar_url}
                alt={coHost.name}
                className={`${config.avatar} rounded-full object-cover flex-shrink-0`}
              />
            ) : (
              <div className={`${config.avatar} rounded-full bg-[#ff393a]/20 flex items-center justify-center flex-shrink-0`}>
                <User className={`${config.icon} text-[#ff393a]`} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className={`text-white font-medium ${config.text}`}>{coHost.name}</p>
              {showSocialLinks && (coHost.website || coHost.twitter || coHost.instagram) && (
                <div className="flex items-center gap-2 mt-1">
                  {coHost.website && (
                    <a
                      href={coHost.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/50 hover:text-white transition-colors"
                    >
                      <Globe size={config.socialIcon} />
                    </a>
                  )}
                  {coHost.twitter && (
                    <a
                      href={`https://twitter.com/${coHost.twitter}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/50 hover:text-white transition-colors"
                    >
                      <XIcon size={config.socialIcon} />
                    </a>
                  )}
                  {coHost.instagram && (
                    <a
                      href={`https://instagram.com/${coHost.instagram}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/50 hover:text-white transition-colors"
                    >
                      <Instagram size={config.socialIcon} />
                    </a>
                  )}
                </div>
              )}
            </div>
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
  const visibleCoHosts = coHosts?.filter(h => h.showOnEvent !== false) || [];
  const displayCoHosts = visibleCoHosts.slice(0, maxVisible);
  const remainingCount = visibleCoHosts.length > maxVisible ? visibleCoHosts.length - maxVisible : 0;

  // Use hostProfile name if available, otherwise fall back to hostName
  const displayHostName = hostProfile?.name || hostName;

  return (
    <div className="flex items-center gap-3">
      {/* Overlapping avatars */}
      <div className="flex items-center" style={{ marginLeft: '8px' }}>
        {/* Primary host avatar */}
        {displayHostName && (
          hostProfile?.avatar_url ? (
            <img
              src={hostProfile.avatar_url}
              alt={displayHostName}
              className="w-8 h-8 rounded-full object-cover flex-shrink-0 border-2 border-black"
              style={{ zIndex: 10, marginLeft: '-8px' }}
            />
          ) : (
            <div
              className="w-8 h-8 rounded-full bg-[#ff393a] flex items-center justify-center flex-shrink-0 border-2 border-black relative"
              style={{ zIndex: 10, marginLeft: '-8px' }}
            >
              <User className="w-4 h-4 text-white" />
            </div>
          )
        )}
        {/* Co-host avatars */}
        {displayCoHosts.map((coHost, index) => (
          <div key={coHost.id} style={{ zIndex: 9 - index, marginLeft: '-8px' }}>
            {coHost.avatar_url ? (
              <img
                src={coHost.avatar_url}
                alt={coHost.name}
                className="w-8 h-8 rounded-full object-cover flex-shrink-0 border-2 border-black"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#ff393a] flex items-center justify-center flex-shrink-0 border-2 border-black">
                <User className="w-4 h-4 text-white" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Host text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white">
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
