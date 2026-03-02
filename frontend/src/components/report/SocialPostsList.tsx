import React, { useState } from 'react';
import { Plus, Trash2, ExternalLink, Loader2, Search, RefreshCw, ClipboardList } from 'lucide-react';
import { SocialPost } from '../../types';
import { TweetEmbed } from './TweetEmbed';
import { TwitterFeed } from './TwitterFeed';
import { IconInput } from '../IconInput';

// Platform icons/colors
const PLATFORMS = {
  twitter: { name: 'X (Twitter)', color: 'bg-blue-500', icon: 'X' },
  farcaster: { name: 'Farcaster', color: 'bg-purple-500', icon: 'F' },
  instagram: { name: 'Instagram', color: 'bg-pink-500', icon: 'IG' },
};

interface SocialPostsListProps {
  posts: SocialPost[];
  onAdd: (post: { platform: string; url: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onBulkAdd?: (urls: string[]) => Promise<void>;
  onRefreshEmbed?: (id: string) => Promise<void>;
  editable?: boolean;
  eventSlug?: string | null;
}

export function SocialPostsList({ posts, onAdd, onDelete, onBulkAdd, onRefreshEmbed, editable = true, eventSlug }: SocialPostsListProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [newPlatform, setNewPlatform] = useState<string>('twitter');
  const [newUrl, setNewUrl] = useState('');
  const [bulkUrls, setBulkUrls] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!newUrl.trim()) return;

    setLoading(true);
    try {
      await onAdd({
        platform: newPlatform,
        url: newUrl.trim(),
      });
      setNewUrl('');
      setIsAdding(false);
    } catch (error) {
      console.error('Failed to add social post:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkAdd = async () => {
    if (!bulkUrls.trim() || !onBulkAdd) return;

    const urls = bulkUrls
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.length > 0 && (u.startsWith('http://') || u.startsWith('https://')));

    if (urls.length === 0) return;

    setLoading(true);
    try {
      await onBulkAdd(urls);
      setBulkUrls('');
      setIsBulkMode(false);
    } catch (error) {
      console.error('Failed to bulk add social posts:', error);
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

  const handleRefreshEmbed = async (id: string) => {
    if (!onRefreshEmbed) return;
    setRefreshingId(id);
    try {
      await onRefreshEmbed(id);
    } catch (error) {
      console.error('Failed to refresh embed:', error);
    } finally {
      setRefreshingId(null);
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

  const searchXUrl = eventSlug
    ? `https://x.com/search?q=url%3Arsv.pizza%2F${encodeURIComponent(eventSlug)}`
    : null;

  // Read-only display
  if (!editable) {
    if (posts.length === 0 && !eventSlug) return null;

    return (
      <div className="space-y-4">
        {posts.length > 0 && (
          <>
            <h3 className="text-lg font-semibold text-white">Attendee Social Posts</h3>
            <div className="space-y-3">
              {posts.map((post) => {
                if (post.platform === 'twitter' && post.embedHtml) {
                  return (
                    <TweetEmbed
                      key={post.id}
                      embedHtml={post.embedHtml}
                      url={post.url}
                      authorHandle={post.authorHandle}
                    />
                  );
                }
                const platform = PLATFORMS[post.platform as keyof typeof PLATFORMS] || PLATFORMS.twitter;
                return (
                  <a
                    key={post.id}
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 transition-colors"
                  >
                    <div className={`w-8 h-8 ${platform.color} rounded-lg flex items-center justify-center text-white text-xs font-bold`}>
                      {platform.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      {post.authorHandle && (
                        <span className="text-sm text-white font-medium">@{post.authorHandle}</span>
                      )}
                      <p className="text-xs text-white/40 truncate">{post.url}</p>
                    </div>
                    <ExternalLink size={16} className="text-white/40" />
                  </a>
                );
              })}
            </div>
          </>
        )}
        {eventSlug && <TwitterFeed eventSlug={eventSlug} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Attendee Social Posts</h3>
        <div className="flex items-center gap-2">
          {searchXUrl && (
            <a
              href={searchXUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-white/60 hover:text-white transition-colors"
              title="Search X for posts mentioning your event"
            >
              <Search size={16} />
              Search X
            </a>
          )}
          {!isAdding && !isBulkMode && onBulkAdd && (
            <button
              onClick={() => setIsBulkMode(true)}
              className="flex items-center gap-1 text-sm text-white/60 hover:text-white transition-colors"
            >
              <ClipboardList size={16} />
              Bulk Add
            </button>
          )}
          {!isAdding && !isBulkMode && (
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-1 text-sm text-white/60 hover:text-white transition-colors"
            >
              <Plus size={16} />
              Add Post
            </button>
          )}
        </div>
      </div>

      {/* Add new post form */}
      {isAdding && (
        <div className="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
          <div className="flex gap-2">
            {Object.entries(PLATFORMS).map(([key, platform]) => (
              <button
                key={key}
                onClick={() => setNewPlatform(key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  newPlatform === key
                    ? `${platform.color} text-white`
                    : 'bg-white/10 text-white/60 hover:bg-white/20'
                }`}
              >
                {platform.name}
              </button>
            ))}
          </div>
          <IconInput
            icon={ExternalLink}
            type="url"
            value={newUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setNewUrl(e.target.value);
              detectPlatform(e.target.value);
            }}
            placeholder="Paste post URL"
            className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
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
              }}
              className="btn-secondary text-sm py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Bulk URL paste form */}
      {isBulkMode && (
        <div className="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
          <p className="text-sm text-white/60">Paste multiple post URLs, one per line</p>
          <IconInput
            icon={ClipboardList}
            multiline
            rows={5}
            value={bulkUrls}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBulkUrls(e.target.value)}
            placeholder={"https://x.com/user/status/123\nhttps://x.com/user/status/456"}
            className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] font-mono"
          />
          <p className="text-xs text-white/40">
            {bulkUrls.split('\n').filter(u => u.trim().startsWith('http')).length} valid URL(s) detected
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleBulkAdd}
              disabled={loading || !bulkUrls.trim()}
              className="flex-1 btn-primary text-sm py-2 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Add All
            </button>
            <button
              onClick={() => {
                setIsBulkMode(false);
                setBulkUrls('');
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
        <div className="space-y-3">
          {posts.map((post) => {
            const platform = PLATFORMS[post.platform as keyof typeof PLATFORMS] || PLATFORMS.twitter;

            // Show tweet embed for Twitter posts with embed HTML
            if (post.platform === 'twitter' && post.embedHtml) {
              return (
                <div key={post.id} className="relative group">
                  <TweetEmbed
                    embedHtml={post.embedHtml}
                    url={post.url}
                    authorHandle={post.authorHandle}
                  />
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onRefreshEmbed && (
                      <button
                        onClick={() => handleRefreshEmbed(post.id)}
                        disabled={refreshingId === post.id}
                        className="p-1.5 bg-black/80 rounded-lg text-white/60 hover:text-white transition-colors"
                        title="Refresh embed"
                      >
                        {refreshingId === post.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <RefreshCw size={14} />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(post.id)}
                      disabled={deletingId === post.id}
                      className="p-1.5 bg-black/80 rounded-lg text-white/60 hover:text-red-400 transition-colors"
                      title="Delete post"
                    >
                      {deletingId === post.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </div>
                </div>
              );
            }

            // Non-embedded post display
            return (
              <div
                key={post.id}
                className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10"
              >
                <div className={`w-8 h-8 ${platform.color} rounded-lg flex items-center justify-center text-white text-xs font-bold`}>
                  {platform.icon}
                </div>
                <div className="flex-1 min-w-0">
                  {post.authorHandle && (
                    <span className="text-sm text-white font-medium">@{post.authorHandle}</span>
                  )}
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-white/40 hover:text-white/60 truncate block"
                  >
                    {post.url}
                  </a>
                </div>
                <div className="flex items-center gap-1">
                  {post.platform === 'twitter' && onRefreshEmbed && (
                    <button
                      onClick={() => handleRefreshEmbed(post.id)}
                      disabled={refreshingId === post.id}
                      className="p-2 text-white/40 hover:text-white transition-colors"
                      title="Refresh embed"
                    >
                      {refreshingId === post.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <RefreshCw size={16} />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(post.id)}
                    disabled={deletingId === post.id}
                    className="p-2 text-white/40 hover:text-red-400 transition-colors"
                  >
                    {deletingId === post.id ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        !isAdding && !isBulkMode && (
          <div className="bg-white/5 rounded-xl p-6 border border-white/10 text-center">
            <p className="text-white/40 text-sm">No social posts added yet</p>
            <p className="text-white/30 text-xs mt-1">Add links to attendee posts about your event</p>
          </div>
        )
      )}

      {/* Live Twitter Feed */}
      {eventSlug && <TwitterFeed eventSlug={eventSlug} />}
    </div>
  );
}
