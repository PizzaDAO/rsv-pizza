/**
 * Cron routes for automated tweet caching.
 *
 * SQL migrations required (not yet applied):
 *
 * -- tweet_cache table
 * CREATE TABLE tweet_cache (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   tweet_id TEXT UNIQUE NOT NULL,
 *   author_handle TEXT NOT NULL,
 *   author_name TEXT NOT NULL,
 *   author_avatar_url TEXT,
 *   tweet_text TEXT NOT NULL,
 *   media_urls JSONB,
 *   conversation_id TEXT,
 *   in_reply_to_id TEXT,
 *   like_count INT NOT NULL DEFAULT 0,
 *   retweet_count INT NOT NULL DEFAULT 0,
 *   reply_count INT NOT NULL DEFAULT 0,
 *   quote_count INT NOT NULL DEFAULT 0,
 *   impression_count INT,
 *   ocr_impression_count INT,
 *   matched_party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
 *   matched_slug TEXT,
 *   tweet_created_at TIMESTAMPTZ NOT NULL,
 *   fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * );
 * CREATE INDEX idx_tweet_cache_matched_party ON tweet_cache(matched_party_id);
 * CREATE INDEX idx_tweet_cache_tweet_created ON tweet_cache(tweet_created_at);
 *
 * -- cron_state table
 * CREATE TABLE cron_state (
 *   key TEXT PRIMARY KEY,
 *   value TEXT NOT NULL,
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * );
 *
 * -- Extend social_posts with auto-discovery fields
 * ALTER TABLE social_posts ADD COLUMN tweet_id TEXT UNIQUE;
 * ALTER TABLE social_posts ADD COLUMN auto_discovered BOOLEAN NOT NULL DEFAULT FALSE;
 * ALTER TABLE social_posts ADD COLUMN author_name TEXT;
 * ALTER TABLE social_posts ADD COLUMN author_avatar_url TEXT;
 * ALTER TABLE social_posts ADD COLUMN like_count INT;
 * ALTER TABLE social_posts ADD COLUMN retweet_count INT;
 * ALTER TABLE social_posts ADD COLUMN impression_count INT;
 * ALTER TABLE social_posts ADD COLUMN tweet_created_at TIMESTAMPTZ;
 *
 * -- Column-level SELECT grants for new columns
 * GRANT SELECT (tweet_id, auto_discovered, author_name, author_avatar_url, like_count, retweet_count, impression_count, tweet_created_at) ON social_posts TO anon, authenticated;
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';

const router = Router();

// Extract rsv.pizza slugs from tweet text
function extractSlugs(text: string): string[] {
  // Match rsv.pizza/SLUG patterns (slug = alphanumeric + hyphens)
  const regex = /rsv\.pizza\/([a-zA-Z0-9_-]+)/gi;
  const slugs: string[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const slug = match[1].toLowerCase();
    // Exclude common non-event paths
    if (!['api', 'about', 'login', 'signup', 'host', 'create', 'www'].includes(slug)) {
      slugs.push(slug);
    }
  }
  return [...new Set(slugs)];
}

// GET /api/cron/fetch-tweets — Cron endpoint to cache tweets mentioning rsv.pizza
router.get('/fetch-tweets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Verify cron secret (Vercel sends Authorization: Bearer <CRON_SECRET>)
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      return res.status(500).json({ error: 'CRON_SECRET not configured' });
    }

    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check for Twitter bearer token
    const twitterBearerToken = process.env.TWITTER_BEARER_TOKEN;
    if (!twitterBearerToken) {
      return res.status(503).json({
        error: 'TWITTER_BEARER_TOKEN not configured',
        message: 'The X/Twitter API bearer token is not set. Tweet caching is disabled.',
      });
    }

    // Get since_id from cron_state
    let sinceId: string | null = null;
    try {
      const state = await prisma.cronState.findUnique({
        where: { key: 'tweet_search_since_id' },
      });
      sinceId = state?.value || null;
    } catch {
      // Table may not exist yet — proceed without since_id
    }

    // Build X API v2 search query
    const searchParams = new URLSearchParams({
      query: '"rsv.pizza" -is:retweet',
      'tweet.fields': 'created_at,public_metrics,conversation_id,in_reply_to_user_id,attachments',
      'expansions': 'author_id,attachments.media_keys',
      'user.fields': 'name,username,profile_image_url',
      'media.fields': 'url,preview_image_url',
      'max_results': '100',
    });

    if (sinceId) {
      searchParams.set('since_id', sinceId);
    }

    const apiUrl = `https://api.twitter.com/2/tweets/search/recent?${searchParams.toString()}`;

    const twitterRes = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${twitterBearerToken}`,
      },
    });

    if (!twitterRes.ok) {
      const errorBody = await twitterRes.text();
      console.error('Twitter API error:', twitterRes.status, errorBody);
      return res.status(502).json({
        error: 'Twitter API request failed',
        status: twitterRes.status,
        details: errorBody,
      });
    }

    const data = await twitterRes.json();

    if (!data.data || data.data.length === 0) {
      return res.json({
        success: true,
        tweetsProcessed: 0,
        message: 'No new tweets found',
      });
    }

    // Build user lookup map from includes
    const usersMap = new Map<string, { name: string; username: string; profile_image_url?: string }>();
    if (data.includes?.users) {
      for (const user of data.includes.users) {
        usersMap.set(user.id, {
          name: user.name,
          username: user.username,
          profile_image_url: user.profile_image_url,
        });
      }
    }

    // Build media lookup map from includes
    const mediaMap = new Map<string, string>();
    if (data.includes?.media) {
      for (const media of data.includes.media) {
        mediaMap.set(media.media_key, media.url || media.preview_image_url || '');
      }
    }

    let tweetsProcessed = 0;
    let socialPostsCreated = 0;
    let newestId: string | null = null;

    for (const tweet of data.data) {
      const tweetId = tweet.id;
      const authorId = tweet.author_id;
      const author = usersMap.get(authorId);

      if (!author) continue;

      // Track newest tweet ID for since_id
      if (!newestId || BigInt(tweetId) > BigInt(newestId)) {
        newestId = tweetId;
      }

      // Extract media URLs from attachments
      const mediaUrls: string[] = [];
      if (tweet.attachments?.media_keys) {
        for (const key of tweet.attachments.media_keys) {
          const url = mediaMap.get(key);
          if (url) mediaUrls.push(url);
        }
      }

      // Extract rsv.pizza slugs and match to events
      const slugs = extractSlugs(tweet.text);
      let matchedPartyId: string | null = null;
      let matchedSlug: string | null = null;

      if (slugs.length > 0) {
        // Try matching by custom_url first, then by invite_code
        for (const slug of slugs) {
          const party = await prisma.party.findFirst({
            where: {
              OR: [
                { customUrl: slug },
                { inviteCode: slug },
              ],
            },
            select: { id: true },
          });

          if (party) {
            matchedPartyId = party.id;
            matchedSlug = slug;
            break;
          }
        }
      }

      // Upsert into tweet_cache
      try {
        await prisma.tweetCache.upsert({
          where: { tweetId },
          update: {
            likeCount: tweet.public_metrics?.like_count || 0,
            retweetCount: tweet.public_metrics?.retweet_count || 0,
            replyCount: tweet.public_metrics?.reply_count || 0,
            quoteCount: tweet.public_metrics?.quote_count || 0,
            impressionCount: tweet.public_metrics?.impression_count || null,
            matchedPartyId,
            matchedSlug,
          },
          create: {
            tweetId,
            authorHandle: author.username,
            authorName: author.name,
            authorAvatarUrl: author.profile_image_url || null,
            tweetText: tweet.text,
            mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
            conversationId: tweet.conversation_id || null,
            inReplyToId: tweet.in_reply_to_user_id || null,
            likeCount: tweet.public_metrics?.like_count || 0,
            retweetCount: tweet.public_metrics?.retweet_count || 0,
            replyCount: tweet.public_metrics?.reply_count || 0,
            quoteCount: tweet.public_metrics?.quote_count || 0,
            impressionCount: tweet.public_metrics?.impression_count || null,
            matchedPartyId,
            matchedSlug,
            tweetCreatedAt: new Date(tweet.created_at),
          },
        });
        tweetsProcessed++;
      } catch (err) {
        console.error(`Failed to upsert tweet ${tweetId}:`, err);
        continue;
      }

      // Auto-create social_post entry if matched to a party
      if (matchedPartyId) {
        try {
          // Check if we already have this tweet as a social post
          const existing = await prisma.socialPost.findFirst({
            where: { tweetId },
          });

          if (!existing) {
            const tweetUrl = `https://x.com/${author.username}/status/${tweetId}`;

            // Get max sort order for this party's social posts
            const maxOrder = await prisma.socialPost.aggregate({
              where: { partyId: matchedPartyId },
              _max: { sortOrder: true },
            });

            await prisma.socialPost.create({
              data: {
                partyId: matchedPartyId,
                platform: 'twitter',
                url: tweetUrl,
                authorHandle: author.username,
                title: null,
                views: tweet.public_metrics?.impression_count || null,
                tweetId,
                autoDiscovered: true,
                authorName: author.name,
                authorAvatarUrl: author.profile_image_url || null,
                likeCount: tweet.public_metrics?.like_count || 0,
                retweetCount: tweet.public_metrics?.retweet_count || 0,
                impressionCount: tweet.public_metrics?.impression_count || null,
                tweetCreatedAt: new Date(tweet.created_at),
                sortOrder: (maxOrder._max.sortOrder || 0) + 1,
              },
            });
            socialPostsCreated++;
          }
        } catch (err) {
          console.error(`Failed to create social post for tweet ${tweetId}:`, err);
        }
      }
    }

    // Update since_id in cron_state
    if (newestId) {
      try {
        await prisma.cronState.upsert({
          where: { key: 'tweet_search_since_id' },
          update: { value: newestId },
          create: { key: 'tweet_search_since_id', value: newestId },
        });
      } catch (err) {
        console.error('Failed to update since_id:', err);
      }
    }

    res.json({
      success: true,
      tweetsProcessed,
      socialPostsCreated,
      newestId,
      totalResults: data.data.length,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
