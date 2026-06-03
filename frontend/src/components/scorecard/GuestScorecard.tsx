import { useState, useEffect, useCallback } from 'react';
import { Trophy, Loader2, Camera, Gamepad2, ListChecks, ChevronLeft } from 'lucide-react';
import {
  getScorecard,
  completeScorecardItem,
  ScorecardItem as ScorecardItemType,
  PublicEventSponsor,
} from '../../lib/api';
import { ScorecardItem, ScorecardItemKey } from './ScorecardItem';
import { PhotoGameModal } from './PhotoGameModal';
import { LeaderboardModal } from './LeaderboardModal';

interface GuestScorecardProps {
  inviteCode: string;
  onUploadPhoto?: () => void;
  onScanGuest?: () => void;
  onTakeSelfie?: () => void;
  /** When this number changes, the scorecard refetches its items. */
  refreshSignal?: number;
  /** Public event URL, used as the second line in the share tweet. */
  eventUrl?: string;
  /** Sponsor Twitter handles (no `@`, deduped, excluding `pizza_dao`). */
  partnerHandles?: string[];
  /** Per-event Telegram URL (normalized). Falls back to https://t.me/pizzadao when absent. */
  telegramUrl?: string | null;
  /** panzerotti-58931: host display name, used in Photo Game prompts. */
  hostName?: string | null;
  /** panzerotti-58931: event sponsors, surfaced as Photo Game partner prompts. */
  sponsors?: PublicEventSponsor[];
}

// Mission-category items, rendered via ScorecardItem in the Missions tile.
const MISSION_ORDER: ScorecardItemKey[] = [
  'post',
  'vouch',
  'join_telegram',
  'follow_pizzadao',
  'signup_pizzadao',
];

type View = 'hub' | 'play' | 'missions';

export function GuestScorecard({
  inviteCode,
  onUploadPhoto,
  onScanGuest,
  onTakeSelfie,
  refreshSignal,
  eventUrl,
  partnerHandles,
  telegramUrl,
  hostName,
  sponsors,
}: GuestScorecardProps) {
  const [items, setItems] = useState<ScorecardItemType[]>([]);
  const [pizzaChefScore, setPizzaChefScore] = useState(0);
  const [totalItems, setTotalItems] = useState(11);
  const [loading, setLoading] = useState(true);
  const [completingItem, setCompletingItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>('hub');
  const [showPhotoGame, setShowPhotoGame] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  const fetchScorecard = useCallback(async () => {
    try {
      const data = await getScorecard(inviteCode);
      setItems(data.items);
      setPizzaChefScore(data.pizzaChefScore);
      setTotalItems(data.totalItems);
      setError(null);
    } catch (err: any) {
      // If guest isn't checked in yet or not a guest, just hide quietly
      if (err.message?.includes('NOT_A_GUEST') || err.message?.includes('403')) {
        setError('hidden');
      } else {
        setError(err.message || 'Failed to load scorecard');
      }
    } finally {
      setLoading(false);
    }
  }, [inviteCode]);

  useEffect(() => {
    fetchScorecard();
  }, [fetchScorecard]);

  // Refetch when the parent bumps `refreshSignal` (e.g. after a photo upload,
  // a successful vouch, or a selfie upload — all of which auto-complete a
  // scorecard item on the backend).
  useEffect(() => {
    if (refreshSignal === undefined) return;
    fetchScorecard();
  }, [refreshSignal, fetchScorecard]);

  const handleComplete = useCallback(
    async (itemKey: ScorecardItemKey, proofUrl?: string, proofType?: string) => {
      setCompletingItem(itemKey);
      try {
        const data = await completeScorecardItem(inviteCode, itemKey, proofUrl, proofType);
        // Update local state (insert if not present, e.g. Photo Game keys)
        setItems((prev) => {
          const exists = prev.some((item) => item.itemKey === itemKey);
          return exists
            ? prev.map((item) => (item.itemKey === itemKey ? data.item : item))
            : [...prev, data.item];
        });
        setPizzaChefScore(data.pizzaChefScore);
      } catch (err: any) {
        console.error('Failed to complete scorecard item:', err);
        throw err;
      } finally {
        setCompletingItem(null);
      }
    },
    [inviteCode]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-white/40" />
      </div>
    );
  }

  // If error is 'hidden', don't render anything
  if (error === 'hidden') return null;
  if (error) return null;

  const isComplete = pizzaChefScore === totalItems;
  const progressPercent = totalItems > 0 ? Math.round((pizzaChefScore / totalItems) * 100) : 0;

  return (
    <div className="mt-6 border border-theme-stroke rounded-xl bg-theme-surface/50 overflow-hidden">
      {/* Header with Pizza Chef score */}
      <div className="px-4 py-3 border-b border-theme-stroke/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className={`w-5 h-5 ${isComplete ? 'text-yellow-400' : 'text-[#ff393a]'}`} />
          <span className="text-sm font-semibold text-white">Party Guest Score</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-lg font-bold ${isComplete ? 'text-yellow-400' : 'text-white'}`}>
            {pizzaChefScore}/{totalItems}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 pt-3">
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isComplete ? 'bg-yellow-400' : 'bg-[#ff393a]'}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="text-xs text-white/50 mt-1.5 mb-2">
          {isComplete
            ? 'All tasks completed! You are a Pizza Chef!'
            : `Complete tasks to earn your Pizza Chef title`}
        </p>
      </div>

      <div className="px-3 pb-3">
        {/* Hub: Play + Leaderboard */}
        {view === 'hub' && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => setView('play')}
              className="flex flex-col items-center gap-1.5 rounded-xl bg-[#ff393a] hover:bg-[#ff5a5b] py-4 text-[#ffffff] transition-colors"
            >
              <Gamepad2 className="w-6 h-6" />
              <span className="text-sm font-semibold">Play</span>
            </button>
            <button
              onClick={() => setShowLeaderboard(true)}
              className="flex flex-col items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/15 py-4 text-white transition-colors"
            >
              <Trophy className="w-6 h-6 text-yellow-400" />
              <span className="text-sm font-semibold">Leaderboard</span>
            </button>
          </div>
        )}

        {/* Play: three tiles */}
        {view === 'play' && (
          <div className="pt-1">
            <button
              onClick={() => setView('hub')}
              className="mb-2 flex items-center gap-1 text-xs text-white/60 hover:text-white"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <div className="space-y-2">
              <button
                onClick={() => setShowPhotoGame(true)}
                className="flex w-full items-center gap-3 rounded-xl bg-white/5 hover:bg-white/10 px-3 py-3 text-left transition-colors"
              >
                <Camera className="w-5 h-5 text-[#ff393a]" />
                <span className="flex-1 text-sm font-medium text-white">Photo Game</span>
                <span className="text-xs text-white/40">Tap to play</span>
              </button>

              <div className="flex w-full items-center gap-3 rounded-xl bg-white/5 px-3 py-3 opacity-50">
                <Gamepad2 className="w-5 h-5 text-white/50" />
                <span className="flex-1 text-sm font-medium text-white">Mini Game</span>
                <span className="text-xs text-white/40">Coming soon</span>
              </div>

              <button
                onClick={() => setView('missions')}
                className="flex w-full items-center gap-3 rounded-xl bg-white/5 hover:bg-white/10 px-3 py-3 text-left transition-colors"
              >
                <ListChecks className="w-5 h-5 text-[#ff393a]" />
                <span className="flex-1 text-sm font-medium text-white">Missions</span>
                <span className="text-xs text-white/40">Tap to play</span>
              </button>
            </div>
          </div>
        )}

        {/* Missions: existing scorecard items (mission category) */}
        {view === 'missions' && (
          <div className="pt-1">
            <button
              onClick={() => setView('play')}
              className="mb-2 flex items-center gap-1 text-xs text-white/60 hover:text-white"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <div className="space-y-1">
              {MISSION_ORDER.map((key) => {
                const item = items.find((i) => i.itemKey === key);
                if (!item) return null;
                return (
                  <div key={item.id} className="relative">
                    <ScorecardItem
                      itemKey={key}
                      completed={item.completed}
                      loading={completingItem === key}
                      onComplete={handleComplete}
                      onUploadPhoto={onUploadPhoto}
                      onScanGuest={onScanGuest}
                      onTakeSelfie={onTakeSelfie}
                      eventUrl={eventUrl}
                      partnerHandles={partnerHandles}
                      telegramUrl={telegramUrl}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {showPhotoGame && (
        <PhotoGameModal
          inviteCode={inviteCode}
          hostName={hostName}
          sponsors={sponsors}
          items={items}
          onComplete={handleComplete}
          onClose={() => setShowPhotoGame(false)}
        />
      )}

      {showLeaderboard && (
        <LeaderboardModal
          inviteCode={inviteCode}
          onClose={() => setShowLeaderboard(false)}
        />
      )}
    </div>
  );
}
