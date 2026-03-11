import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, ExternalLink, Loader2, Eye, Link, Type } from 'lucide-react';
import { SocialPost } from '../../types';
import { IconInput } from '../IconInput';

// Platform icons/colors
const PLATFORMS = {
  twitter: { name: 'X (Twitter)', color: 'bg-blue-500', icon: 'X' },
  farcaster: { name: 'Farcaster', color: 'bg-purple-500', icon: 'F' },
  instagram: { name: 'Instagram', color: 'bg-pink-500', icon: 'IG' },
};

interface SocialPostsListProps {
  posts: SocialPost[];
  onAdd: (post: { platform: string; url: string; title?: string; views?: number | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  editable?: boolean;
}

// Helper: detect if URL is a Twitter/X post
function isTwitterUrl(url: string): boolean {
  return /^https?:\/\/(twitter\.com|x\.com)\//i.test(url);
}

// Helper: extract tweet ID from URL
function getTweetId(url: string): string | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  return match ? match[1] : null;
}

// Twitter/X embed component
function TwitterEmbed({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tweetId = getTweetId(url);

  useEffect(() => {
    if (!tweetId || !containerRef.current) return;

    const embedTweet = () => {
      if (!(window as any).twttr?.widgets || !containerRef.current) return;
      // Clear any previous content
      containerRef.current.innerHTML = '';
      (window as any).twttr.widgets.createTweet(tweetId, containerRef.current, {
        theme: 'dark',
        align: 'center',
        conversation: 'none',
      }).then(() => {
        // After tweet renders, measure and collapse the wrapper
        requestAnimationFrame(() => {
          if (containerRef.current && wrapperRef.current) {
            const contentHeight = containerRef.current.scrollHeight;
            wrapperRef.current.style.height = `${contentHeight * 0.55}px`;
          }
        });
      });
    };

    // Load Twitter widget script if not already loaded
    const existingScript = document.querySelector('script[src="https://platform.twitter.com/widgets.js"]');
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://platform.twitter.com/widgets.js';
      script.async = true;
      script.charset = 'utf-8';
      document.head.appendChild(script);
      script.onload = embedTweet;
    } else {
      // Script loaded but twttr may not be ready yet
      const checkReady = () => {
        if ((window as any).twttr?.widgets) {
          embedTweet();
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    }
  }, [tweetId]);

  if (!tweetId) return null;

  return (
    <div ref={wrapperRef} className="overflow-hidden">
      <div ref={containerRef} className="origin-top-left" style={{ transform: 'scale(0.55)', width: '182%' }} />
    </div>
  );
}

// Generic link preview for non-Twitter URLs
function LinkPreview({ url, platform }: { url: string; platform: string }) {
  const platformInfo = PLATFORMS[platform as keyof typeof PLATFORMS] || PLATFORMS.twitter;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex items-center gap-2 px-3 py-2 bg-theme-surface rounded-lg border border-theme-stroke hover:bg-theme-surface-hover transition-colors text-sm text-theme-text-secondary hover:text-theme-text"
    >
      <div className={`w-5 h-5 ${platformInfo.color} rounded flex items-center justify-center text-theme-text text-[10px] font-bold flex-shrink-0`}>
        {platformInfo.icon}
      </div>
      <span className="truncate">{url}</span>
      <ExternalLink size={14} className="flex-shrink-0" />
    </a>
  );
}

export function SocialPostsList({ posts, onAdd, onDelete, editable = true }: SocialPostsListProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newPlatform, setNewPlatform] = useState<string>('twitter');
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newViews, setNewViews] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!newUrl.trim()) return;

    setLoading(true);
    try {
      await onAdd({
        platform: newPlatform,
        url: newUrl.trim(),
        title: newTitle.trim() || undefined,
        views: newViews ? parseInt(newViews, 10) : null,
      });
      setNewUrl('');
      setNewTitle('');
      setNewViews('');
      setIsAdding(false);
    } catch (error) {
      console.error('Failed to add social post:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDelete(id);
    } catch (error) {
      console.error('Failed to delete social post:', error);
    } finally {
      setDeletingId(null);
    }
  };

  // Auto-detect platform from URL
  const detectPlatform = (url: string) => {
    if (url.includes('twitter.com') || url.includes('x.com')) {
      setNewPlatform('twitter');
    } else if (url.includes('warpcast.com') || url.includes('farcaster')) {
      setNewPlatform('farcaster');
    } else if (url.includes('instagram.com')) {
      setNewPlatform('instagram');
    }
  };

  // Calculate total views across all posts
  const totalViews = posts.reduce((sum, post) => sum + (post.views || 0), 0);

  // Read-only display
  if (!editable) {
    if (posts.length === 0) return null;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-theme-text">Social Posts</h3>
          {totalViews > 0 && (
            <div className="flex items-center gap-1.5 text-theme-text-secondary text-sm">
              <Eye size={14} />
              <span>{totalViews.toLocaleString()} total views</span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {posts.map((post) => {
            const platform = PLATFORMS[post.platform as keyof typeof PLATFORMS] || PLATFORMS.twitter;
            return (
              <div key={post.id} className="bg-theme-surface rounded-xl border border-theme-stroke overflow-hidden">
                <div className="flex items-center gap-2 p-2">
                  <div className={`w-6 h-6 ${platform.color} rounded flex items-center justify-center text-theme-text text-[9px] font-bold flex-shrink-0`}>
                    {platform.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    {post.title && (
                      <p className="text-xs text-theme-text font-medium truncate">{post.title}</p>
                    )}
                    {post.authorHandle && (
                      <span className="text-[10px] text-theme-text-secondary">@{post.authorHandle}</span>
                    )}
                    {!post.title && !post.authorHandle && (
                      <p className="text-[10px] text-theme-text-muted truncate">{post.url}</p>
                    )}
                  </div>
                  {post.views != null && (
                    <div className="flex items-center gap-1 text-theme-text-secondary text-[10px] flex-shrink-0">
                      <Eye size={10} />
                      <span>{post.views.toLocaleString()}</span>
                    </div>
                  )}
                  <a href={post.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                    <ExternalLink size={12} className="text-theme-text-muted hover:text-theme-text-secondary" />
                  </a>
                </div>
                {/* Embed for Twitter/X posts */}
                {isTwitterUrl(post.url) && (
                  <div className="px-2 pb-2">
                    <TwitterEmbed url={post.url} />
                  </div>
                )}
                {/* Link preview for non-Twitter posts */}
                {!isTwitterUrl(post.url) && (
                  <div className="px-2 pb-2">
                    <LinkPreview url={post.url} platform={post.platform} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-theme-text">Social Posts</h3>
          {totalViews > 0 && (
            <p className="text-xs text-theme-text-muted mt-0.5">
              {totalViews.toLocaleString()} total views across {posts.length} post{posts.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1 text-sm text-theme-text-secondary hover:text-theme-text transition-colors"
          >
            <Plus size={16} />
            Add Post
          </button>
        )}
      </div>

      {/* Add new post form */}
      {isAdding && (
        <div className="bg-theme-surface rounded-xl p-4 border border-theme-stroke space-y-3">
          <div className="flex gap-2">
            {Object.entries(PLATFORMS).map(([key, platform]) => (
              <button
                key={key}
                onClick={() => setNewPlatform(key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  newPlatform === key
                    ? `${platform.color} text-theme-text`
                    : 'bg-theme-surface-hover text-theme-text-secondary hover:bg-theme-surface-hover'
                }`}
              >
                {platform.name}
              </button>
            ))}
          </div>
          <IconInput
            icon={Link}
            type="url"
            value={newUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setNewUrl(e.target.value);
              detectPlatform(e.target.value);
            }}
            placeholder="Post URL"
          />
          <IconInput
            icon={Type}
            type="text"
            value={newTitle}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTitle(e.target.value)}
            placeholder="Title (what the post is about)"
          />
          <IconInput
            icon={Eye}
            type="number"
            value={newViews}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewViews(e.target.value)}
            placeholder="Views (optional)"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={loading || !newUrl.trim()}
              className="flex-1 btn-primary text-sm py-2 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Add
            </button>
            <button
              onClick={() => {
                setIsAdding(false);
                setNewUrl('');
                setNewTitle('');
                setNewViews('');
              }}
              className="btn-secondary text-sm py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List of posts */}
      {posts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {posts.map((post) => {
            const platform = PLATFORMS[post.platform as keyof typeof PLATFORMS] || PLATFORMS.twitter;
            return (
              <div
                key={post.id}
                className="bg-theme-surface rounded-xl border border-theme-stroke overflow-hidden"
              >
                {/* Post header row */}
                <div className="flex items-center gap-2 p-2">
                  <div className={`w-6 h-6 ${platform.color} rounded flex items-center justify-center text-theme-text text-[9px] font-bold flex-shrink-0`}>
                    {platform.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    {post.title && (
                      <p className="text-xs text-theme-text font-medium truncate">{post.title}</p>
                    )}
                    {post.authorHandle && (
                      <span className="text-[10px] text-theme-text-secondary">@{post.authorHandle}</span>
                    )}
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-theme-text-muted hover:text-theme-text-secondary truncate block"
                    >
                      {post.url}
                    </a>
                  </div>
                  {post.views != null && (
                    <div className="flex items-center gap-1 text-theme-text-muted text-[10px] flex-shrink-0 bg-theme-surface px-1.5 py-0.5 rounded">
                      <Eye size={10} />
                      <span>{post.views.toLocaleString()}</span>
                    </div>
                  )}
                  <button
                    onClick={() => handleDelete(post.id)}
                    disabled={deletingId === post.id}
                    className="p-1 text-theme-text-muted hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    {deletingId === post.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>
                {/* Embed for Twitter/X posts */}
                {isTwitterUrl(post.url) && (
                  <div className="px-2 pb-2">
                    <TwitterEmbed url={post.url} />
                  </div>
                )}
                {/* Link preview for non-Twitter posts */}
                {!isTwitterUrl(post.url) && (
                  <div className="px-2 pb-2">
                    <LinkPreview url={post.url} platform={post.platform} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !isAdding && (
          <div className="bg-theme-surface rounded-xl p-6 border border-theme-stroke text-center">
            <p className="text-theme-text-muted text-sm">No social posts added yet</p>
            <p className="text-theme-text-faint text-xs mt-1">Add links to posts about your event</p>
          </div>
        )
      )}
    </div>
  );
}
