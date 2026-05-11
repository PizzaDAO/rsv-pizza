import React from 'react';

interface ShareRSVPProps {
  eventName: string;
  eventImageUrl: string | null;
  customUrl: string | null;
  inviteCode: string;
  twitterHandles?: string[];
  calendarSlot?: React.ReactNode;
}

// X (Twitter) icon
const XIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

/** Normalize a twitter handle: strip @, strip full URL prefixes */
function normalizeHandle(raw: string): string {
  return raw
    .replace(/^https?:\/\/(www\.)?(twitter\.com|x\.com)\//i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '')
    .trim();
}

/** Build share text that fits within maxLen chars */
function buildShareText(base: string, handles: string[], maxLen: number): string {
  let mentions = handles.map(h => `@${h}`);
  let text = `${base}\n\n${mentions.join(' ')}`;
  if (text.length <= maxLen) return text;
  // Drop handles from end but always keep @Pizza_DAO (first)
  while (mentions.length > 1 && text.length > maxLen) {
    mentions.pop();
    text = `${base}\n\n${mentions.join(' ')}`;
  }
  return text;
}

export function ShareRSVP({ eventName, eventImageUrl, customUrl, inviteCode, twitterHandles = [], calendarSlot }: ShareRSVPProps) {
  const city = eventName.replace(/^Global Pizza Party\s*/i, '') || eventName;
  const eventUrl = `https://rsv.pizza/${customUrl || inviteCode}`;
  const baseText = `\u{1F5FA}\uFE0F\u{1F355}\u{1F973}\nI'm going to the Global Pizza Party in ${city}!`;

  // Build deduplicated handles list, always starting with Pizza_DAO
  const allHandles = ['Pizza_DAO', ...twitterHandles];
  const seen = new Set<string>();
  const uniqueHandles: string[] = [];
  for (const raw of allHandles) {
    const normalized = normalizeHandle(raw);
    if (normalized && !seen.has(normalized.toLowerCase())) {
      seen.add(normalized.toLowerCase());
      uniqueHandles.push(normalized);
    }
  }
  const shareText = buildShareText(baseText, uniqueHandles, 250);

  const handleShareX = () => {
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(eventUrl)}`;
    window.open(intentUrl, '_blank');
  };


  return (
    <div className="mt-6 pt-6 border-t border-theme-stroke">
      <p className="text-theme-text font-medium text-center mb-3">Tell your friends about the party!</p>
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
        {calendarSlot}
        <button
          onClick={handleShareX}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-theme-surface border border-theme-stroke rounded-xl hover:bg-theme-surface-hover transition-colors text-theme-text"
        >
          <XIcon size={14} />
          <span className="hidden sm:inline">Share on X</span>
          <span className="sm:hidden">X</span>
        </button>
      </div>
    </div>
  );
}
