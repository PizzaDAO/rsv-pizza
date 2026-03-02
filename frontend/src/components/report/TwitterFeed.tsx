import React, { useEffect, useRef } from 'react';
import { ExternalLink } from 'lucide-react';
import { loadTwitterWidgets } from './TweetEmbed';

interface TwitterFeedProps {
  eventSlug: string;
}

export function TwitterFeed({ eventSlug }: TwitterFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const searchQuery = `rsv.pizza%2F${encodeURIComponent(eventSlug)}`;
  const searchUrl = `https://twitter.com/search?q=${searchQuery}`;

  useEffect(() => {
    loadTwitterWidgets().then(() => {
      if (window.twttr && containerRef.current) {
        window.twttr.widgets.load(containerRef.current);
      }
    });
  }, [eventSlug]);

  return (
    <div className="space-y-3 mt-6">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-md font-semibold text-white">Live Twitter Feed</h4>
          <p className="text-xs text-white/40 mt-0.5">Tweets mentioning your event</p>
        </div>
        <a
          href={searchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-white/40 hover:text-white/60 transition-colors"
        >
          Open on X
          <ExternalLink size={12} />
        </a>
      </div>
      <div
        ref={containerRef}
        className="max-h-[500px] overflow-y-auto rounded-xl border border-white/10"
      >
        <a
          className="twitter-timeline"
          href={searchUrl}
          data-theme="dark"
          data-chrome="noheader nofooter noborders transparent"
          data-tweet-limit="10"
        >
          Tweets about this event
        </a>
      </div>
    </div>
  );
}
