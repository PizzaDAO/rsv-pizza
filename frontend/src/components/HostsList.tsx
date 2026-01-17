import React from 'react';
import { User, Globe, Instagram } from 'lucide-react';

interface CoHost {
  id: string;
  name: string;
  avatar_url?: string;
  website?: string;
  twitter?: string;
  instagram?: string;
  showOnEvent?: boolean;
}

interface HostsListProps {
  hostName?: string | null;
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

export const HostsList: React.FC<HostsListProps> = ({
  hostName,
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

  if (!hostName && visibleCoHosts.length === 0) {
    return null;
  }

  return (
    <div>
      {showTitle && (
        <h3 className="text-sm font-semibold text-white/60 mb-3">Hosted By</h3>
      )}

      <div className="space-y-3">
        {/* Primary Host */}
        {hostName && (
          <div className={`flex items-center ${config.gap}`}>
            <div className={`${config.avatar} rounded-full bg-[#ff393a]/20 flex items-center justify-center flex-shrink-0`}>
              <User className={`${config.icon} text-[#ff393a]`} />
            </div>
            <span className={`text-white font-medium ${config.text}`}>{hostName}</span>
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
  coHosts?: CoHost[];
  maxVisible?: number;
}

export const HostsAvatars: React.FC<HostsAvatarsProps> = ({
  hostName,
  coHosts,
  maxVisible = 6,
}) => {
  const visibleCoHosts = coHosts?.filter(h => h.showOnEvent !== false) || [];
  const displayCoHosts = visibleCoHosts.slice(0, maxVisible);
  const remainingCount = visibleCoHosts.length > maxVisible ? visibleCoHosts.length - maxVisible : 0;

  return (
    <div className="flex items-center gap-3">
      {/* Overlapping avatars */}
      <div className="flex items-center" style={{ marginLeft: '8px' }}>
        {/* Primary host avatar */}
        {hostName && (
          <div
            className="w-8 h-8 rounded-full bg-[#ff393a] flex items-center justify-center flex-shrink-0 border-2 border-black relative"
            style={{ zIndex: 10, marginLeft: '-8px' }}
          >
            <User className="w-4 h-4 text-white" />
          </div>
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
          Hosted by <span className="font-medium">{hostName}</span>
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
