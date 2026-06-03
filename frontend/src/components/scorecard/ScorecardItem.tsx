import React, { useState } from 'react';
import {
  Loader2,
  Link2,
} from 'lucide-react';
import { IconInput } from '../IconInput';

export type ScorecardItemKey =
  | 'post'
  | 'photo'
  | 'vouch'
  | 'pizza_selfie'
  | 'sign_pizza_box'
  | 'join_telegram'
  | 'follow_pizzadao'
  | 'signup_pizzadao'
  // panzerotti-58931: Photo Game challenge keys (rendered by PhotoGameModal,
  // not by ScorecardItem — included here so onComplete callers type-check).
  | 'photo_box_stack'
  | 'photo_host'
  | 'photo_partner';

interface ScorecardItemProps {
  itemKey: ScorecardItemKey;
  completed: boolean;
  loading?: boolean;
  onComplete: (itemKey: ScorecardItemKey, proofUrl?: string, proofType?: string) => void;
  onUploadPhoto?: () => void;
  onScanGuest?: () => void;
  onTakeSelfie?: () => void;
  /** Public URL of the event, included as a second line in the share tweet. */
  eventUrl?: string;
  /** Sponsor Twitter handles (no `@` prefix, deduped, excluding `pizza_dao`). */
  partnerHandles?: string[];
  /** Per-event Telegram URL (normalized). Falls back to https://t.me/pizzadao when absent. */
  telegramUrl?: string | null;
}

const ITEM_CONFIG: Record<ScorecardItemKey, { label: string; emoji: string }> = {
  post: { label: 'Post about the party', emoji: '📣' },
  photo: { label: 'Upload a photo', emoji: '📸' },
  vouch: { label: 'Check someone in', emoji: '⛶' },
  pizza_selfie: { label: 'Pizza selfie', emoji: '🍕' },
  sign_pizza_box: { label: 'Sign the party pizza box', emoji: '✍️' },
  join_telegram: { label: "Join your city's PizzaDAO Telegram", emoji: 'tg' },
  follow_pizzadao: { label: 'Follow @pizza_dao', emoji: '🐦' },
  signup_pizzadao: { label: 'Sign up on pizzadao.org', emoji: '🌐' },
  // panzerotti-58931: Photo Game challenges are rendered by PhotoGameModal, but
  // configs are kept here so the Record type stays exhaustive.
  photo_box_stack: { label: 'Photo with the box stack', emoji: '📦' },
  photo_host: { label: 'Photo with the host', emoji: '🧑‍🍳' },
  photo_partner: { label: 'Photo with a partner', emoji: '🤝' },
};

export function ScorecardItem({
  itemKey,
  completed,
  loading,
  onComplete,
  onUploadPhoto,
  onScanGuest,
  onTakeSelfie,
  eventUrl,
  partnerHandles,
  telegramUrl,
}: ScorecardItemProps) {
  const [showInput, setShowInput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const config = ITEM_CONFIG[itemKey];

  // Items that need URL proof
  const needsUrlProof = itemKey === 'post';
  // Self-report items
  const isSelfReport = itemKey === 'sign_pizza_box' || itemKey === 'join_telegram' || itemKey === 'follow_pizzadao' || itemKey === 'signup_pizzadao';

  const handleAction = () => {
    if (completed) return;

    if (needsUrlProof) {
      // Open Twitter intent first, then show input for URL.
      // Build tweet body: tag @pizza_dao + all sponsor handles, then event URL on a second line.
      // Falls back to the original hardcoded text if either input is missing.
      let tweetBody: string;
      if (partnerHandles && eventUrl) {
        const handles = partnerHandles.map(h => `@${h}`).join(' ');
        const firstLine = `Having a great time at the pizza party! @pizza_dao${handles ? ' ' + handles : ''} #PizzaDAO`;
        tweetBody = [firstLine, eventUrl].filter(Boolean).join('\n');
      } else {
        tweetBody = "Having a great time at the pizza party! @pizza_dao #PizzaDAO";
      }
      const tweetText = encodeURIComponent(tweetBody);
      window.open(`https://twitter.com/intent/tweet?text=${tweetText}`, '_blank');
      setShowInput(true);
    } else if (itemKey === 'photo') {
      // Backend auto-completes via photo upload side effect.
      onUploadPhoto?.();
    } else if (itemKey === 'vouch') {
      // Backend auto-completes via vouch endpoint side effect.
      onScanGuest?.();
    } else if (itemKey === 'pizza_selfie') {
      // Backend auto-completes when photo tagged "pizza-selfie".
      onTakeSelfie?.();
    } else if (itemKey === 'join_telegram') {
      const url = telegramUrl || 'https://t.me/pizzadao';
      window.open(url, '_blank', 'noopener,noreferrer');
      onComplete(itemKey, url, 'self_report');
    } else if (itemKey === 'follow_pizzadao') {
      const url = 'https://twitter.com/pizza_dao';
      window.open(url, '_blank', 'noopener,noreferrer');
      onComplete(itemKey, url, 'self_report');
    } else if (itemKey === 'signup_pizzadao') {
      const url = 'https://pizzadao.org';
      window.open(url, '_blank', 'noopener,noreferrer');
      onComplete(itemKey, url, 'self_report');
    } else if (isSelfReport) {
      onComplete(itemKey, undefined, 'self_report');
    }
  };

  const handleSubmitUrl = () => {
    if (!inputValue.trim()) return;
    onComplete(itemKey, inputValue.trim(), 'tweet_url');
    setShowInput(false);
    setInputValue('');
  };

  const getActionLabel = (): string => {
    if (itemKey === 'post') return 'Share';
    if (itemKey === 'photo') return 'Upload';
    if (itemKey === 'vouch') return 'Scan';
    if (itemKey === 'pizza_selfie') return 'Selfie';
    if (itemKey === 'sign_pizza_box') return 'I signed it!';
    if (itemKey === 'join_telegram') return 'Join';
    if (itemKey === 'follow_pizzadao') return 'Follow';
    if (itemKey === 'signup_pizzadao') return 'Sign up';
    return '';
  };

  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors ${completed ? 'bg-green-500/10' : 'bg-white/5 hover:bg-white/10'}`}>
        {/* Emoji */}
        <span className="w-8 h-8 flex items-center justify-center flex-shrink-0 text-2xl leading-none">
          {completed ? '✅' : config.emoji === 'tg' ? (
            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#0088cc">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
          ) : config.emoji}
        </span>

        {/* Label */}
        <span className={`flex-1 text-sm ${completed ? 'text-green-300 line-through opacity-70' : 'text-white'}`}>
          {config.label}
        </span>

        {/* Action / Status */}
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-white/50" />
        ) : completed ? (
          <span className="text-xs text-green-400 font-medium">Done</span>
        ) : (
          <button
            onClick={handleAction}
            className="text-xs font-medium px-3 py-1.5 rounded-full bg-[#ff393a] hover:bg-[#ff5a5b] text-[#ffffff] transition-colors"
          >
            {getActionLabel()}
          </button>
        )}
      </div>

      {/* URL Input (for post item) - appears below the row */}
      {showInput && !completed && (
        <div className="ml-11 p-3 bg-white/10 border border-white/10 rounded-lg backdrop-blur-sm">
          <p className="text-xs text-white/60 mb-2">Paste the link to your post:</p>
          <div className="flex gap-2">
            <IconInput
              icon={Link2}
              value={inputValue}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value)}
              placeholder="https://x.com/..."
              className="flex-1 text-sm"
            />
            <button
              onClick={handleSubmitUrl}
              disabled={!inputValue.trim()}
              className="px-3 py-1.5 rounded bg-[#ff393a] hover:bg-[#ff5a5b] text-[#ffffff] text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
