import React, { useState } from 'react';
import { Download, Link, Check } from 'lucide-react';

interface ShareRSVPProps {
  eventName: string;
  eventImageUrl: string | null;
  customUrl: string | null;
  inviteCode: string;
}

// X (Twitter) icon
const XIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

export function ShareRSVP({ eventName, eventImageUrl, customUrl, inviteCode }: ShareRSVPProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const city = eventName.replace(/^Global Pizza Party\s*/i, '') || eventName;
  const eventUrl = `https://rsv.pizza/${customUrl || inviteCode}`;
  const shareText = `\u{1F5FA}\uFE0F\u{1F355}\u{1F973}\nI'm going to the Global Pizza Party in ${city}!`;

  const handleShareX = () => {
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(eventUrl)}`;
    window.open(intentUrl, '_blank');
  };

  const handleDownload = async () => {
    if (downloading || !eventImageUrl) return;
    setDownloading(true);
    try {
      const res = await fetch(eventImageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${city.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-pizza-party.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download image:', err);
    } finally {
      setDownloading(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(eventUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  return (
    <div className="mt-6 pt-6 border-t border-theme-stroke">
      {eventImageUrl && (
        <div className="rounded-xl overflow-hidden mb-3">
          <img
            src={eventImageUrl}
            alt={eventName}
            className="w-full rounded-xl"
          />
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleShareX}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-theme-surface border border-theme-stroke rounded-xl hover:bg-theme-surface-hover transition-colors text-theme-text text-sm"
        >
          <XIcon size={14} />
          <span className="hidden sm:inline">Share on X</span>
          <span className="sm:hidden">X</span>
        </button>

        {eventImageUrl && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-theme-surface border border-theme-stroke rounded-xl hover:bg-theme-surface-hover transition-colors text-theme-text text-sm disabled:opacity-50"
          >
            <Download size={14} />
            <span className="hidden sm:inline">Download</span>
            <span className="sm:hidden">Save</span>
          </button>
        )}

        <button
          onClick={handleCopyLink}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-theme-surface border border-theme-stroke rounded-xl hover:bg-theme-surface-hover transition-colors text-sm"
        >
          {copied ? (
            <>
              <Check size={14} className="text-[#39d98a]" />
              <span className="text-[#39d98a]">Copied!</span>
            </>
          ) : (
            <>
              <Link size={14} className="text-theme-text" />
              <span className="text-theme-text hidden sm:inline">Copy Link</span>
              <span className="text-theme-text sm:hidden">Link</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
