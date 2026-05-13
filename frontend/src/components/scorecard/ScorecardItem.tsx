import React, { useState } from 'react';
import {
  Loader2,
  Link2,
  X,
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

export interface ActionContext {
  eventName: string;
  eventUrl: string;
  twitterHandles: string[];
  telegramUrl: string | null;
  onOpenPhotos: () => void;
  onOpenScanner: () => void;
}

interface ScorecardItemProps {
  itemKey: ScorecardItemKey;
  completed: boolean;
  loading?: boolean;
  onComplete: (itemKey: ScorecardItemKey, proofUrl?: string, proofType?: string) => void;
  actionContext: ActionContext;
}

const ITEM_CONFIG: Record<ScorecardItemKey, { label: string; emoji: string }> = {
  post: { label: 'Post about the party', emoji: '📣' },
  photo: { label: 'Upload a photo', emoji: '📸' },
  vouch: { label: 'Check someone in', emoji: '⛶' },
  pizza_selfie: { label: 'Pizza selfie', emoji: '🍕' },
  sign_pizza_box: { label: 'Sign the party pizza box', emoji: '✍️' },
  join_telegram: { label: "Join your city's PizzaDAO Telegram", emoji: 'tg' },
  follow_pizzadao: { label: 'Follow @pizza_dao', emoji: 'x' },
  signup_pizzadao: { label: 'Sign up on pizzadao.org', emoji: '🌐' },
};

const XIcon = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const TelegramIcon = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#0088cc">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
  </svg>
);

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

export function ScorecardItem({ itemKey, completed, loading, onComplete, actionContext }: ScorecardItemProps) {
  const [showInput, setShowInput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [showPizzaBoxModal, setShowPizzaBoxModal] = useState(false);
  const [showPizzaSelfieModal, setShowPizzaSelfieModal] = useState(false);
  const [selfieUploaded, setSelfieUploaded] = useState(false);
  const config = ITEM_CONFIG[itemKey];

  const isDisabled = itemKey === 'join_telegram' && !actionContext.telegramUrl;

  const handleAction = () => {
    if (completed || isDisabled) return;

    switch (itemKey) {
      case 'post': {
        const city = actionContext.eventName.replace(/^Global Pizza Party\s*/i, '') || actionContext.eventName;
        const baseText = `\u{1F5FA}\uFE0F\u{1F355}\u{1F973}\nI'm at the Global Pizza Party in ${city}!`;
        // Build deduplicated handles list, always starting with Pizza_DAO
        const allHandles = ['Pizza_DAO', ...actionContext.twitterHandles];
        const seen = new Set<string>();
        const uniqueHandles: string[] = [];
        for (const h of allHandles) {
          const normalized = h.replace(/^@/, '').trim();
          if (normalized && !seen.has(normalized.toLowerCase())) {
            seen.add(normalized.toLowerCase());
            uniqueHandles.push(normalized);
          }
        }
        const shareText = buildShareText(baseText, uniqueHandles, 250);
        const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(actionContext.eventUrl)}`;
        window.open(intentUrl, '_blank');
        setShowInput(true);
        break;
      }
      case 'photo':
        actionContext.onOpenPhotos();
        break;
      case 'vouch':
        actionContext.onOpenScanner();
        break;
      case 'pizza_selfie':
        setShowPizzaSelfieModal(true);
        break;
      case 'sign_pizza_box':
        setShowPizzaBoxModal(true);
        break;
      case 'join_telegram':
        if (actionContext.telegramUrl) {
          window.open(actionContext.telegramUrl, '_blank');
          onComplete(itemKey, undefined, 'self_report');
        }
        break;
      case 'follow_pizzadao':
        window.open('https://x.com/pizza_dao', '_blank');
        onComplete(itemKey, undefined, 'self_report');
        break;
      case 'signup_pizzadao':
        window.open('https://pizzadao.org', '_blank');
        onComplete(itemKey, undefined, 'self_report');
        break;
    }
  };

  const handleSubmitUrl = () => {
    if (!inputValue.trim()) return;
    onComplete(itemKey, inputValue.trim(), 'tweet_url');
    setShowInput(false);
    setInputValue('');
  };

  const getActionLabel = (): string => {
    switch (itemKey) {
      case 'post': return 'Share';
      case 'photo': return 'Upload';
      case 'vouch': return 'Scan QR';
      case 'pizza_selfie': return 'I took one!';
      case 'sign_pizza_box': return 'I signed it!';
      case 'join_telegram': return 'I joined!';
      case 'follow_pizzadao': return 'I followed!';
      case 'signup_pizzadao': return 'I signed up!';
      default: return '';
    }
  };

  const renderEmoji = () => {
    if (completed) return '✅';
    if (config.emoji === 'tg') return <TelegramIcon />;
    if (config.emoji === 'x') return <XIcon />;
    return config.emoji;
  };

  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors ${completed ? 'bg-green-500/10' : 'bg-white/5 hover:bg-white/10'}`}>
        {/* Emoji */}
        <span className="w-8 h-8 flex items-center justify-center flex-shrink-0 text-2xl leading-none">
          {renderEmoji()}
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
            disabled={isDisabled}
            className="text-xs font-medium px-3 py-1.5 rounded-full bg-[#ff393a] hover:bg-[#ff5a5b] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {getActionLabel()}
          </button>
        )}
      </div>

      {/* URL Input (for post item) - appears below the row */}
      {showInput && !completed && (
        <div className="ml-11 p-3 bg-theme-surface border border-theme-stroke rounded-lg">
          <p className="text-xs text-theme-text-muted mb-2">Paste the link to your post:</p>
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

      {/* Pizza Selfie Modal */}
      {showPizzaSelfieModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setShowPizzaSelfieModal(false)}
        >
          <div
            className="bg-[#1a1a2e] border border-white/10 rounded-xl max-w-sm w-full mx-4 p-6 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowPizzaSelfieModal(false)}
              className="absolute top-3 right-3 text-white/50 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold text-white mb-3">Pizza Selfie</h3>
            <p className="text-sm text-white/70 mb-4">
              Take a selfie with a slice of pizza and upload it to the photo gallery!
            </p>
            {!selfieUploaded ? (
              <button
                onClick={() => {
                  actionContext.onOpenPhotos();
                  setSelfieUploaded(true);
                }}
                className="w-full py-2.5 rounded-lg bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium transition-colors"
              >
                Upload Photo
              </button>
            ) : (
              <button
                onClick={() => {
                  setShowPizzaSelfieModal(false);
                  onComplete('pizza_selfie', undefined, 'self_report');
                }}
                className="w-full py-2.5 rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium transition-colors"
              >
                I uploaded my selfie!
              </button>
            )}
          </div>
        </div>
      )}

      {/* Pizza Box Modal */}
      {showPizzaBoxModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setShowPizzaBoxModal(false)}
        >
          <div
            className="bg-[#1a1a2e] border border-white/10 rounded-xl max-w-sm w-full mx-4 p-6 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowPizzaBoxModal(false)}
              className="absolute top-3 right-3 text-white/50 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold text-white mb-3">Sign the Pizza Box</h3>
            <p className="text-sm text-white/70 mb-4">
              It's a PizzaDAO tradition! Every party has a pizza box that all guests
              sign as a memento. Find the party pizza box, grab a marker, and leave
              your mark -- your name, a doodle, a message, anything goes!
            </p>
            <button
              onClick={() => {
                onComplete('sign_pizza_box', undefined, 'self_report');
                setShowPizzaBoxModal(false);
              }}
              className="w-full py-2.5 rounded-lg bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium transition-colors"
            >
              I signed it!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
