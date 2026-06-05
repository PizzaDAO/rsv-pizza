import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Trophy } from 'lucide-react';
import {
  getPartyLeaderboard,
  fetchLeaderboard,
  LeaderboardEntry,
  LeaderboardGuestRow,
  LeaderboardPartyRow,
  LeaderboardCountryRow,
} from '../../lib/api';

interface LeaderboardModalProps {
  inviteCode: string;
  onClose: () => void;
}

type Tab = 'party' | 'worldwide' | 'parties' | 'countries';

const TABS: { key: Tab; label: string }[] = [
  { key: 'party', label: 'This Party' },
  { key: 'worldwide', label: 'Worldwide' },
  { key: 'parties', label: 'Parties' },
  { key: 'countries', label: 'Countries' },
];

interface GlobalData {
  guests: LeaderboardGuestRow[];
  parties: LeaderboardPartyRow[];
  countries: LeaderboardCountryRow[];
}

export function LeaderboardModal({ inviteCode, onClose }: LeaderboardModalProps) {
  const [tab, setTab] = useState<Tab>('party');

  // "This Party" board
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [partyLoading, setPartyLoading] = useState(true);
  const [partyError, setPartyError] = useState<string | null>(null);

  // Global board (worldwide / parties / countries) — loaded once on first need.
  const [global, setGlobal] = useState<GlobalData | null>(null);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPartyLoading(true);
      try {
        const data = await getPartyLeaderboard(inviteCode);
        if (!cancelled) {
          setEntries(data.leaderboard);
          setPartyError(null);
        }
      } catch (err: any) {
        if (!cancelled) setPartyError(err?.message || 'Failed to load leaderboard');
      } finally {
        if (!cancelled) setPartyLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteCode]);

  // Lazy-load the global board the first time a worldwide tab is opened.
  useEffect(() => {
    if (tab === 'party') return;
    if (global || globalLoading) return;
    let cancelled = false;
    (async () => {
      setGlobalLoading(true);
      try {
        // panzerotti-58931: the worldwide game board was merged into the unified
        // public leaderboard. All-time window; pull a large page so the Parties
        // list isn't truncated (guests are already top-100, countries are full).
        const data = await fetchLeaderboard('all', 200, 0);
        if (!cancelled) {
          setGlobal({
            guests: data.guests.rows,
            parties: data.parties.rows,
            countries: data.countries.rows,
          });
          setGlobalError(null);
        }
      } catch (err: any) {
        if (!cancelled) setGlobalError(err?.message || 'Failed to load leaderboard');
      } finally {
        if (!cancelled) setGlobalLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, global, globalLoading]);

  const renderRow = (
    key: string,
    rank: number,
    primary: string,
    secondary: string | null,
    score: number,
    highlight: boolean
  ) => (
    <li
      key={key}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
        highlight ? 'border border-[#ff393a]/40 bg-[#ff393a]/10' : 'bg-gray-50'
      }`}
    >
      <span className="w-6 text-center text-sm font-bold text-gray-400">{rank}</span>
      <span className="flex-1 min-w-0">
        <span className={`block truncate text-sm ${highlight ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
          {primary}
          {highlight && <span className="ml-1.5 text-xs text-[#ff393a]">(you)</span>}
        </span>
        {secondary && <span className="block truncate text-xs text-gray-400">{secondary}</span>}
      </span>
      <span className="text-sm font-bold text-gray-900">{score}</span>
    </li>
  );

  const spinner = (
    <div className="flex justify-center py-8">
      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
    </div>
  );

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
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
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
        <div className="flex gap-1 overflow-x-auto border-b border-gray-200 px-3 pt-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium ${
                tab === t.key
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-5 py-4">
          {/* This Party */}
          {tab === 'party' && (
            <>
              {partyLoading ? (
                spinner
              ) : partyError ? (
                <p className="py-6 text-center text-sm text-red-600">{partyError}</p>
              ) : entries.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">No checked-in guests yet.</p>
              ) : (
                <ol className="space-y-1.5">
                  {entries.map((entry, idx) =>
                    renderRow(entry.guestId, idx + 1, entry.name, null, entry.score, entry.isCurrentUser)
                  )}
                </ol>
              )}
            </>
          )}

          {/* Worldwide / Parties / Countries (global board) */}
          {tab !== 'party' && (
            <>
              {globalLoading ? (
                spinner
              ) : globalError ? (
                <p className="py-6 text-center text-sm text-red-600">{globalError}</p>
              ) : !global ? (
                spinner
              ) : tab === 'worldwide' ? (
                global.guests.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">No scores yet.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {global.guests.map((g) =>
                      renderRow(`g-${g.rank}-${g.name}`, g.rank, g.name, g.country, g.score, false)
                    )}
                  </ol>
                )
              ) : tab === 'parties' ? (
                global.parties.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">No scores yet.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {global.parties.map((p) =>
                      renderRow(
                        p.id,
                        p.rank,
                        p.name,
                        [p.city, p.country].filter(Boolean).join(', ') || null,
                        p.score,
                        false
                      )
                    )}
                  </ol>
                )
              ) : (
                // countries
                global.countries.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">No scores yet.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {global.countries.map((c) =>
                      renderRow(
                        `c-${c.rank}-${c.country}`,
                        c.rank,
                        c.country,
                        `${c.partyCount} ${c.partyCount === 1 ? 'party' : 'parties'}`,
                        c.score,
                        false
                      )
                    )}
                  </ol>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
