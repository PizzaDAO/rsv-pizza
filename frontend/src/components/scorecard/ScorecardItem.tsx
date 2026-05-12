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
  | 'signup_pizzadao';

interface ScorecardItemProps {
  itemKey: ScorecardItemKey;
  completed: boolean;
  loading?: boolean;
  onComplete: (itemKey: ScorecardItemKey, proofUrl?: string, proofType?: string) => void;
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
};

export function ScorecardItem({ itemKey, completed, loading, onComplete }: ScorecardItemProps) {
  const [showInput, setShowInput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const config = ITEM_CONFIG[itemKey];

  // Items that need URL proof
  const needsUrlProof = itemKey === 'post';
  // Auto-complete items (no user action needed from this UI)
  const isAutoItem = itemKey === 'photo' || itemKey === 'vouch' || itemKey === 'pizza_selfie';
  // Self-report items
  const isSelfReport = itemKey === 'sign_pizza_box' || itemKey === 'join_telegram' || itemKey === 'follow_pizzadao' || itemKey === 'signup_pizzadao';

  const handleAction = () => {
    if (completed) return;

    if (needsUrlProof) {
      // Open Twitter intent first, then show input for URL
      const tweetText = encodeURIComponent("Having a great time at the pizza party! @pizza_dao #PizzaDAO");
      window.open(`https://twitter.com/intent/tweet?text=${tweetText}`, '_blank');
      setShowInput(true);
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
    if (itemKey === 'sign_pizza_box') return 'I signed it!';
    if (itemKey === 'join_telegram') return 'I joined!';
    if (itemKey === 'follow_pizzadao') return 'I followed!';
    if (itemKey === 'signup_pizzadao') return 'I signed up!';
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
        ) : isAutoItem ? (
          <span className="text-xs text-white/40">Auto</span>
        ) : (
          <button
            onClick={handleAction}
            className="text-xs font-medium px-3 py-1.5 rounded-full bg-[#ff393a] hover:bg-[#ff5a5b] text-white transition-colors"
          >
            {getActionLabel()}
          </button>
        )}
      </div>

      {/* URL Input (for post item) - appears below the row */}
      {showInput && !completed && (
        <div className="ml-11 p-3 bg-[#1a1a2e] border border-white/10 rounded-lg">
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
              className="px-3 py-1.5 rounded bg-[#ff393a] hover:bg-[#ff5a5b] text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
