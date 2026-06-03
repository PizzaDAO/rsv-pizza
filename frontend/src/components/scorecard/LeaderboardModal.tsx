import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Trophy } from 'lucide-react';
import { getPartyLeaderboard, LeaderboardEntry } from '../../lib/api';

interface LeaderboardModalProps {
  inviteCode: string;
  onClose: () => void;
}

type Tab = 'party' | 'worldwide';

export function LeaderboardModal({ inviteCode, onClose }: LeaderboardModalProps) {
  const [tab, setTab] = useState<Tab>('party');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await getPartyLeaderboard(inviteCode);
        if (!cancelled) {
          setEntries(data.leaderboard);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load leaderboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteCode]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <Trophy className="h-5 w-5 text-yellow-500" /> Leaderboard
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 px-3 pt-3">
          <button
            onClick={() => setTab('party')}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              tab === 'party'
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            This Party
          </button>
          <button
            disabled
            title="Coming soon"
            className="cursor-not-allowed rounded-t-lg px-4 py-2 text-sm font-medium text-gray-300"
          >
            Worldwide
          </button>
        </div>

        <div className="px-5 py-4">
          {tab === 'party' && (
            <>
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                </div>
              ) : error ? (
                <p className="py-6 text-center text-sm text-red-600">{error}</p>
              ) : entries.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">
                  No checked-in guests yet.
                </p>
              ) : (
                <ol className="space-y-1.5">
                  {entries.map((entry, idx) => (
                    <li
                      key={entry.guestId}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                        entry.isCurrentUser
                          ? 'border border-[#ff393a]/40 bg-[#ff393a]/10'
                          : 'bg-gray-50'
                      }`}
                    >
                      <span className="w-6 text-center text-sm font-bold text-gray-400">
                        {idx + 1}
                      </span>
                      <span
                        className={`flex-1 text-sm ${
                          entry.isCurrentUser
                            ? 'font-semibold text-gray-900'
                            : 'text-gray-700'
                        }`}
                      >
                        {entry.name}
                        {entry.isCurrentUser && (
                          <span className="ml-1.5 text-xs text-[#ff393a]">(you)</span>
                        )}
                      </span>
                      <span className="text-sm font-bold text-gray-900">{entry.score}</span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
