import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, Loader2 } from 'lucide-react';
import { getScorecard, completeScorecardItem, ScorecardItem as ScorecardItemType } from '../../lib/api';
import { ScorecardItem, ScorecardItemKey } from './ScorecardItem';

interface GuestScorecardProps {
  inviteCode: string;
}

const ITEM_ORDER: ScorecardItemKey[] = [
  'post',
  'photo',
  'vouch',
  'pizza_selfie',
  'sign_pizza_box',
  'join_telegram',
  'follow_pizzadao',
  'signup_pizzadao',
];

export function GuestScorecard({ inviteCode }: GuestScorecardProps) {
  const [items, setItems] = useState<ScorecardItemType[]>([]);
  const [pizzaChefScore, setPizzaChefScore] = useState(0);
  const [totalItems, setTotalItems] = useState(8);
  const [loading, setLoading] = useState(true);
  const [completingItem, setCompletingItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const handleComplete = async (itemKey: ScorecardItemKey, proofUrl?: string, proofType?: string) => {
    setCompletingItem(itemKey);
    try {
      const data = await completeScorecardItem(inviteCode, itemKey, proofUrl, proofType);
      // Update local state
      setItems((prev) =>
        prev.map((item) =>
          item.itemKey === itemKey ? data.item : item
        )
      );
      setPizzaChefScore(data.pizzaChefScore);
    } catch (err: any) {
      console.error('Failed to complete scorecard item:', err);
    } finally {
      setCompletingItem(null);
    }
  };

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
  const progressPercent = Math.round((pizzaChefScore / totalItems) * 100);

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

      {/* Items list */}
      <div className="px-3 pb-3 space-y-1">
        {ITEM_ORDER.map((key) => {
          const item = items.find((i) => i.itemKey === key);
          if (!item) return null;
          return (
            <div key={item.id} className="relative">
              <ScorecardItem
                itemKey={key}
                completed={item.completed}
                loading={completingItem === key}
                onComplete={handleComplete}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
