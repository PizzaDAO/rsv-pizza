import React, { useState } from 'react';
import {
  Check,
  Share2,
  Camera,
  Users,
  Pizza,
  Sticker,
  UserPlus,
  Globe,
  Loader2,
  Link2,
} from 'lucide-react';
import { IconInput } from '../IconInput';

export type ScorecardItemKey =
  | 'post'
  | 'photo'
  | 'vouch'
  | 'pizza_selfie'
  | 'sticker'
  | 'follow_pizzadao'
  | 'signup_pizzadao';

interface ScorecardItemProps {
  itemKey: ScorecardItemKey;
  completed: boolean;
  loading?: boolean;
  onComplete: (itemKey: ScorecardItemKey, proofUrl?: string, proofType?: string) => void;
}

const ITEM_CONFIG: Record<ScorecardItemKey, { label: string; icon: React.ElementType; color: string }> = {
  post: { label: 'Post about the party', icon: Share2, color: '#1DA1F2' },
  photo: { label: 'Upload a photo', icon: Camera, color: '#E1306C' },
  vouch: { label: 'Check in someone', icon: Users, color: '#4ade80' },
  pizza_selfie: { label: 'Pizza selfie', icon: Pizza, color: '#FFC107' },
  sticker: { label: 'Molto benny sticker', icon: Sticker, color: '#FF6B35' },
  follow_pizzadao: { label: 'Follow @pizza_dao', icon: UserPlus, color: '#1DA1F2' },
  signup_pizzadao: { label: 'Sign up on pizzadao.org', icon: Globe, color: '#A855F7' },
};

export function ScorecardItem({ itemKey, completed, loading, onComplete }: ScorecardItemProps) {
  const [showInput, setShowInput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const config = ITEM_CONFIG[itemKey];
  const Icon = config.icon;

  // Items that need URL proof
  const needsUrlProof = itemKey === 'post';
  // Auto-complete items (no user action needed from this UI)
  const isAutoItem = itemKey === 'photo' || itemKey === 'vouch' || itemKey === 'pizza_selfie';
  // Self-report items
  const isSelfReport = itemKey === 'sticker' || itemKey === 'follow_pizzadao' || itemKey === 'signup_pizzadao';

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
    if (itemKey === 'sticker') return 'I used it!';
    if (itemKey === 'follow_pizzadao') return 'I followed!';
    if (itemKey === 'signup_pizzadao') return 'I signed up!';
    return '';
  };

  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors ${completed ? 'bg-green-500/10' : 'bg-white/5 hover:bg-white/10'}`}>
        {/* Icon */}
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${completed ? 'bg-green-500/20' : 'bg-white/10'}`}
          style={{ borderColor: completed ? '#4ade80' : config.color, borderWidth: '1.5px' }}
        >
          {completed ? (
            <Check className="w-4 h-4 text-green-400" />
          ) : (
            <Icon className="w-4 h-4" style={{ color: config.color }} />
          )}
        </div>

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
