import React, { useState, useEffect } from 'react';
import { Gift, Trophy, Loader2, CheckCircle, Users } from 'lucide-react';
import { Raffle, RaffleStatus } from '../../types';
import { getRaffles, enterRaffle } from '../../lib/api';

interface RaffleEntryProps {
  partyId: string;
  guestId?: string;
  guestName?: string;
}

export function RaffleEntry({ partyId, guestId, guestName }: RaffleEntryProps) {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [loading, setLoading] = useState(true);
  const [enteringRaffle, setEnteringRaffle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    loadRaffles();
  }, [partyId]);

  const loadRaffles = async () => {
    setLoading(true);
    const result = await getRaffles(partyId);
    if (result) {
      // Only show open or drawn raffles to guests
      const visibleRaffles = result.raffles.filter(
        (r) => r.status === 'open' || r.status === 'drawn'
      );
      setRaffles(visibleRaffles);
    }
    setLoading(false);
  };

  const handleEnterRaffle = async (raffleId: string) => {
    if (!guestId) {
      setError('You must RSVP to enter the raffle');
      return;
    }

    setEnteringRaffle(raffleId);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await enterRaffle(partyId, raffleId, guestId);
      if (result) {
        setSuccessMessage('You have been entered into the raffle!');
        await loadRaffles(); // Refresh to show updated entry count
      }
    } catch (err: any) {
      setError(err.message || 'Failed to enter raffle');
    } finally {
      setEnteringRaffle(null);
    }
  };

  const hasEnteredRaffle = (raffle: Raffle): boolean => {
    if (!guestId) return false;
    return raffle.entries.some((e) => e.guestId === guestId);
  };

  const isWinner = (raffle: Raffle): { won: boolean; prizes: string[] } => {
    if (!guestId || raffle.status !== 'drawn') return { won: false, prizes: [] };
    const wins = raffle.winners.filter((w) => w.guestId === guestId);
    return {
      won: wins.length > 0,
      prizes: wins.map((w) => w.prize?.name || 'Prize'),
    };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  if (raffles.length === 0) {
    return null; // Don't show anything if no raffles
  }

  return (
    <div className="border-t border-white/10 pt-6 mt-6 space-y-4">
      <div className="flex items-center gap-3 mb-4">
        <Gift className="w-6 h-6 text-[#ff393a]" />
        <h2 className="text-xl font-semibold text-white">Raffles</h2>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-400 p-3 rounded-lg text-sm flex items-center gap-2">
          <CheckCircle size={18} />
          {successMessage}
        </div>
      )}

      <div className="space-y-4">
        {raffles.map((raffle) => {
          const entered = hasEnteredRaffle(raffle);
          const winnerStatus = isWinner(raffle);
          const entryCount = raffle._count?.entries ?? raffle.entries.length;

          return (
            <div
              key={raffle.id}
              className={`p-4 rounded-xl border ${
                winnerStatus.won
                  ? 'bg-yellow-500/10 border-yellow-500/30'
                  : 'bg-white/5 border-white/10'
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-white">{raffle.name}</h3>
                    {raffle.status === 'drawn' && (
                      <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded-full">
                        Drawn
                      </span>
                    )}
                  </div>
                  {raffle.description && (
                    <p className="text-sm text-white/60 mt-1">{raffle.description}</p>
                  )}
                </div>

                {/* Entry count */}
                <div className="flex items-center gap-1 text-sm text-white/60">
                  <Users size={14} />
                  <span>{entryCount} entries</span>
                </div>
              </div>

              {/* Prizes */}
              {raffle.prizes.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {raffle.prizes.map((prize) => (
                    <div
                      key={prize.id}
                      className="flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-lg"
                    >
                      {prize.imageUrl ? (
                        <img
                          src={prize.imageUrl}
                          alt={prize.name}
                          className="w-6 h-6 rounded object-cover"
                        />
                      ) : (
                        <Gift size={16} className="text-[#ff393a]" />
                      )}
                      <span className="text-sm text-white">{prize.name}</span>
                      {prize.quantity > 1 && (
                        <span className="text-xs text-white/50">x{prize.quantity}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Winner announcement */}
              {winnerStatus.won && (
                <div className="mt-4 p-3 bg-yellow-500/20 rounded-lg flex items-center gap-3">
                  <Trophy className="w-6 h-6 text-yellow-500" />
                  <div>
                    <p className="font-semibold text-yellow-400">Congratulations, you won!</p>
                    <p className="text-sm text-yellow-400/80">
                      {winnerStatus.prizes.join(', ')}
                    </p>
                  </div>
                </div>
              )}

              {/* Action button */}
              {raffle.status === 'open' && (
                <div className="mt-4">
                  {entered ? (
                    <div className="flex items-center gap-2 text-green-400">
                      <CheckCircle size={18} />
                      <span className="text-sm font-medium">You're in the raffle!</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleEnterRaffle(raffle.id)}
                      disabled={enteringRaffle === raffle.id || !guestId}
                      className="btn-primary w-full flex items-center justify-center gap-2"
                    >
                      {enteringRaffle === raffle.id ? (
                        <>
                          <Loader2 size={18} className="animate-spin" />
                          Entering...
                        </>
                      ) : (
                        <>
                          <Gift size={18} />
                          Enter Raffle
                        </>
                      )}
                    </button>
                  )}
                  {!guestId && (
                    <p className="text-xs text-white/50 text-center mt-2">
                      RSVP to this event to enter the raffle
                    </p>
                  )}
                </div>
              )}

              {/* Show all winners if drawn */}
              {raffle.status === 'drawn' && raffle.winners.length > 0 && !winnerStatus.won && (
                <div className="mt-4 pt-3 border-t border-white/10">
                  <p className="text-sm font-medium text-white/80 mb-2">Winners:</p>
                  <div className="flex flex-wrap gap-2">
                    {raffle.winners.map((winner) => (
                      <div
                        key={winner.id}
                        className="flex items-center gap-2 px-2 py-1 bg-yellow-500/10 rounded text-sm"
                      >
                        <Trophy size={14} className="text-yellow-500" />
                        <span className="text-white">{winner.guest?.name || 'Guest'}</span>
                        <span className="text-white/50">- {winner.prize?.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
