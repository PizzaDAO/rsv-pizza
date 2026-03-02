import React, { useEffect, useRef } from 'react';
import { ExternalLink } from 'lucide-react';

// Extend window to include twttr
declare global {
  interface Window {
    twttr?: {
      widgets: {
        load: (el?: HTMLElement) => void;
      };
    };
  }
}

// Track whether the Twitter widgets script has been loaded
let twitterScriptLoaded = false;
let twitterScriptLoading = false;

function loadTwitterWidgets(): Promise<void> {
  if (twitterScriptLoaded) return Promise.resolve();
  if (twitterScriptLoading) {
    // Wait for existing load
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (twitterScriptLoaded) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  twitterScriptLoading = true;
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://platform.twitter.com/widgets.js';
    script.async = true;
    script.onload = () => {
      twitterScriptLoaded = true;
      twitterScriptLoading = false;
      resolve();
    };
    script.onerror = () => {
      twitterScriptLoading = false;
      resolve(); // Don't block on script failure
    };
    document.head.appendChild(script);
  });
}

interface TweetEmbedProps {
  embedHtml: string | null;
  url: string;
  authorHandle?: string | null;
}

export function TweetEmbed({ embedHtml, url, authorHandle }: TweetEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!embedHtml || !containerRef.current) return;

    // Load Twitter widgets and render
    loadTwitterWidgets().then(() => {
      if (window.twttr && containerRef.current) {
        window.twttr.widgets.load(containerRef.current);
      }
    });
  }, [embedHtml]);

  // If no embed HTML, fall back to simple link
  if (!embedHtml) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 transition-colors"
      >
        <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-white text-xs font-bold">
          X
        </div>
        <div className="flex-1 min-w-0">
          {authorHandle && (
            <span className="text-sm text-white font-medium">@{authorHandle}</span>
          )}
          <p className="text-xs text-white/40 truncate">{url}</p>
        </div>
        <ExternalLink size={16} className="text-white/40" />
      </a>
    );
  }

  return (
    <div
      ref={containerRef}
      className="tweet-embed max-w-full overflow-hidden [&_twitter-widget]:!max-w-full [&_.twitter-tweet]:!max-w-full"
      dangerouslySetInnerHTML={{ __html: embedHtml }}
    />
  );
}
