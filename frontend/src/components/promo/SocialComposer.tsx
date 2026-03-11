import React, { useState, useEffect, useCallback } from 'react';
import { Copy, ExternalLink, Check, MessageSquare, Download, Image } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Party } from '../../types';
import {
  SocialPlatform,
  SOCIAL_PLATFORMS,
  generateSocialPost,
  generateTwitterThread,
  getShareUrl,
} from './promoUtils';

interface SocialComposerProps {
  party: Party;
}

const PLATFORM_ORDER: SocialPlatform[] = ['twitter', 'instagram', 'facebook', 'linkedin'];

const THREAD_LABELS = ['Post 1', 'Reply 1', 'Reply 2'];

// Platform icons as simple components
function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function InstagramIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function FacebookIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function LinkedInIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function getPlatformIcon(platform: SocialPlatform, size = 16) {
  switch (platform) {
    case 'twitter': return <XIcon size={size} />;
    case 'instagram': return <InstagramIcon size={size} />;
    case 'facebook': return <FacebookIcon size={size} />;
    case 'linkedin': return <LinkedInIcon size={size} />;
  }
}

export const SocialComposer: React.FC<SocialComposerProps> = ({ party }) => {
  const [activePlatform, setActivePlatform] = useState<SocialPlatform>('twitter');
  const [postText, setPostText] = useState('');
  const [threadPosts, setThreadPosts] = useState<string[]>(['', '', '']);
  const [copied, setCopied] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [shared, setShared] = useState<Record<SocialPlatform, boolean>>({
    twitter: false,
    instagram: false,
    facebook: false,
    linkedin: false,
  });

  const isTwitter = activePlatform === 'twitter';

  // Generate initial post text when platform or party changes
  const regeneratePost = useCallback(() => {
    if (isTwitter) {
      const thread = generateTwitterThread(party);
      setThreadPosts(thread);
    } else {
      const text = generateSocialPost(party, activePlatform);
      setPostText(text);
    }
  }, [party, activePlatform, isTwitter]);

  useEffect(() => {
    regeneratePost();
  }, [regeneratePost]);

  const config = SOCIAL_PLATFORMS[activePlatform];

  // For non-twitter
  const charCount = postText.length;
  const isOverLimit = charCount > config.charLimit;

  const handleCopy = async (text?: string) => {
    try {
      const copyText = text || (isTwitter ? threadPosts.join('\n\n---\n\n') : postText);
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleCopyThread = async (idx: number) => {
    try {
      await navigator.clipboard.writeText(threadPosts[idx]);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleShare = () => {
    const url = getShareUrl(activePlatform, isTwitter ? threadPosts[0] : postText, party);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    setShared(prev => ({ ...prev, [activePlatform]: true }));
  };

  const handleDownloadImage = async () => {
    if (!party.eventImageUrl) return;
    try {
      const response = await fetch(party.eventImageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = party.name.replace(/[^a-zA-Z0-9]/g, '_') + '_event_image.' + (blob.type.split('/')[1] || 'png');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download image:', err);
      // Fallback: open in new tab
      window.open(party.eventImageUrl, '_blank');
    }
  };

  const updateThreadPost = (idx: number, value: string) => {
    setThreadPosts(prev => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Platform Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {PLATFORM_ORDER.map((platform) => {
          const cfg = SOCIAL_PLATFORMS[platform];
          const isActive = activePlatform === platform;
          const wasShared = shared[platform];

          return (
            <button
              key={platform}
              onClick={() => setActivePlatform(platform)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-theme-surface-hover text-theme-text border border-theme-stroke-hover'
                  : 'bg-theme-surface text-theme-text-muted hover:text-theme-text-secondary hover:bg-theme-surface-hover border border-transparent'
              }`}
            >
              {getPlatformIcon(platform, 14)}
              <span>{cfg.name}</span>
              {wasShared && (
                <Check size={12} className="text-green-400" />
              )}
            </button>
          );
        })}
      </div>

      {/* Event Image Preview */}
      {party.eventImageUrl && (
        <div className="rounded-lg overflow-hidden border border-theme-stroke bg-theme-surface">
          <div className="relative">
            <img
              src={party.eventImageUrl}
              alt={party.name}
              className="w-full h-40 object-cover"
            />
            <button
              type="button"
              onClick={handleDownloadImage}
              className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-black/70 hover:bg-black/90 text-theme-text text-xs font-medium px-3 py-1.5 rounded-lg transition-colors backdrop-blur-sm"
            >
              <Download size={14} />
              Download Image
            </button>
          </div>
          <div className="px-3 py-2 flex items-center gap-2 text-theme-text-muted text-xs">
            <Image size={12} />
            Attach this image to your post for best engagement
          </div>
        </div>
      )}

      {/* Post Editor - Thread mode for Twitter, single post for others */}
      {isTwitter ? (
        <div className="space-y-3">
          {threadPosts.map((post, idx) => (
            <div key={idx}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-theme-text-muted font-medium">{THREAD_LABELS[idx]}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${post.length > 280 ? 'text-red-400' : 'text-theme-text-muted'}`}>
                    {post.length} / 280
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyThread(idx)}
                    className="text-xs text-theme-text-muted hover:text-theme-text-secondary transition-colors flex items-center gap-1"
                  >
                    {copiedIdx === idx ? (
                      <><Check size={10} className="text-green-400" /> Copied</>
                    ) : (
                      <><Copy size={10} /> Copy</>
                    )}
                  </button>
                </div>
              </div>
              <IconInput
                icon={MessageSquare}
                multiline
                rows={idx === 1 ? 2 : 4}
                value={post}
                onChange={(e) => updateThreadPost(idx, e.target.value)}
                placeholder={`${THREAD_LABELS[idx]}...`}
              />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="relative">
            <IconInput
              icon={MessageSquare}
              multiline
              rows={8}
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              placeholder={`Write your ${config.name} post...`}
            />
          </div>

          {/* Character Count */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={regeneratePost}
              className="text-xs text-theme-text-muted hover:text-theme-text-secondary transition-colors"
            >
              Regenerate
            </button>
            <span className={`text-xs ${isOverLimit ? 'text-red-400' : 'text-theme-text-muted'}`}>
              {charCount} / {config.charLimit}
            </span>
          </div>
        </>
      )}

      {/* Regenerate for Twitter */}
      {isTwitter && (
        <div className="flex items-center justify-start">
          <button
            type="button"
            onClick={regeneratePost}
            className="text-xs text-theme-text-muted hover:text-theme-text-secondary transition-colors"
          >
            Regenerate thread
          </button>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleCopy()}
          className="flex-1 flex items-center justify-center gap-2 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm"
        >
          {copied ? (
            <>
              <Check size={16} className="text-green-400" />
              Copied!
            </>
          ) : (
            <>
              <Copy size={16} />
              {isTwitter ? 'Copy All' : 'Copy Text'}
            </>
          )}
        </button>

        {activePlatform === 'instagram' ? (
          <button
            type="button"
            onClick={() => handleCopy()}
            className="flex-1 flex items-center justify-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
          >
            <Copy size={16} />
            Copy for Instagram
          </button>
        ) : (
          <button
            type="button"
            onClick={handleShare}
            disabled={!isTwitter && isOverLimit}
            className="flex-1 flex items-center justify-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
          >
            <ExternalLink size={16} />
            Share on {SOCIAL_PLATFORMS[activePlatform].name}
          </button>
        )}
      </div>
    </div>
  );
};
