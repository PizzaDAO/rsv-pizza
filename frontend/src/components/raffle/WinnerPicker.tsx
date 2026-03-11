import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Trophy, Shuffle, Users, UserCheck, RotateCcw, Sparkles, Crown } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { Guest } from '../../types';

type EligibilityFilter = 'rsvp' | 'checkedIn';

interface Winner {
  guest: Guest;
  timestamp: Date;
}

export function WinnerPicker() {
  const { party } = usePizza();
  const [filter, setFilter] = useState<EligibilityFilter>('rsvp');
  const [isAnimating, setIsAnimating] = useState(false);
  const [currentName, setCurrentName] = useState<string | null>(null);
  const [winner, setWinner] = useState<Guest | null>(null);
  const [winnerHistory, setWinnerHistory] = useState<Winner[]>([]);
  const [showCelebration, setShowCelebration] = useState(false);
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const celebrationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const guests = party?.guests ?? [];

  const eligibleGuests = guests.filter((g) => {
    if (!g.id) return false;
    if (filter === 'checkedIn') return !!g.checkedInAt;
    return true; // 'rsvp' = all guests who submitted RSVP
  });

  // Exclude previous winners from this session
  const previousWinnerIds = new Set(winnerHistory.map((w) => w.guest.id));
  const availableGuests = eligibleGuests.filter((g) => !previousWinnerIds.has(g.id));

  const checkedInCount = guests.filter((g) => !!g.checkedInAt).length;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) clearTimeout(animationRef.current);
      if (celebrationTimeoutRef.current) clearTimeout(celebrationTimeoutRef.current);
    };
  }, []);

  const pickWinner = useCallback(() => {
    if (availableGuests.length === 0 || isAnimating) return;

    setIsAnimating(true);
    setWinner(null);
    setShowCelebration(false);

    // Shuffling animation: cycle through names rapidly then slow down
    const steps = 20;
    let step = 0;

    const animate = () => {
      if (step < steps) {
        // Pick a random name to display during animation
        const randomGuest = availableGuests[Math.floor(Math.random() * availableGuests.length)];
        setCurrentName(randomGuest.name);

        // Slow down as we approach the end (easing)
        const progress = step / steps;
        const delay = 50 + progress * progress * 200; // starts fast, slows down
        step++;
        animationRef.current = setTimeout(animate, delay);
      } else {
        // Final pick - actually random winner
        const winnerIndex = Math.floor(Math.random() * availableGuests.length);
        const selectedWinner = availableGuests[winnerIndex];
        setCurrentName(selectedWinner.name);
        setWinner(selectedWinner);
        setWinnerHistory((prev) => [...prev, { guest: selectedWinner, timestamp: new Date() }]);
        setIsAnimating(false);
        setShowCelebration(true);

        // Clear celebration after a few seconds
        celebrationTimeoutRef.current = setTimeout(() => {
          setShowCelebration(false);
        }, 4000);
      }
    };

    animate();
  }, [availableGuests, isAnimating]);

  const resetHistory = () => {
    setWinnerHistory([]);
    setWinner(null);
    setCurrentName(null);
    setShowCelebration(false);
  };

  if (!party || guests.length === 0) {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-[#ff393a]/20 rounded-full flex items-center justify-center">
            <Trophy className="w-5 h-5 text-[#ff393a]" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-theme-text">Pick a Winner</h3>
            <p className="text-sm text-theme-text-secondary">Randomly select a guest</p>
          </div>
        </div>
        <div className="text-center py-8 text-theme-text-muted">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No guests yet</p>
          <p className="text-sm mt-1">Guests need to RSVP before you can pick a winner</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="p-4 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#ff393a]/20 rounded-full flex items-center justify-center">
              <Trophy className="w-5 h-5 text-[#ff393a]" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-theme-text">Pick a Winner</h3>
              <p className="text-sm text-theme-text-secondary">Randomly select a lucky guest</p>
            </div>
          </div>
          {winnerHistory.length > 0 && (
            <button
              onClick={resetHistory}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors"
              title="Reset all winners"
            >
              <RotateCcw size={14} />
              Reset
            </button>
          )}
        </div>

        {/* Eligibility Toggle */}
        <div className="flex gap-1 p-1 bg-theme-surface rounded-xl mb-4">
          <button
            onClick={() => setFilter('rsvp')}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === 'rsvp'
                ? 'bg-[#ff393a] text-white shadow-lg shadow-[#ff393a]/20'
                : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface'
            }`}
          >
            <Users size={16} />
            RSVP'd ({guests.length})
          </button>
          <button
            onClick={() => setFilter('checkedIn')}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === 'checkedIn'
                ? 'bg-[#ff393a] text-white shadow-lg shadow-[#ff393a]/20'
                : 'text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface'
            }`}
          >
            <UserCheck size={16} />
            Checked In ({checkedInCount})
          </button>
        </div>
      </div>

      {/* Winner Display Area */}
      <div className="px-4 pb-4">
        <div
          className={`relative rounded-xl border-2 border-dashed p-8 text-center transition-all duration-500 ${
            showCelebration
              ? 'border-[#ff393a] bg-[#ff393a]/10'
              : winner
              ? 'border-yellow-500/50 bg-yellow-500/5'
              : isAnimating
              ? 'border-theme-stroke-hover bg-theme-surface'
              : 'border-theme-stroke bg-theme-surface'
          }`}
        >
          {/* Celebration particles */}
          {showCelebration && <CelebrationEffect />}

          {currentName ? (
            <div className="relative z-10">
              {winner && !isAnimating ? (
                <>
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Crown className="w-6 h-6 text-yellow-500" />
                    <span className="text-sm font-medium text-yellow-500 uppercase tracking-wider">
                      Winner!
                    </span>
                    <Crown className="w-6 h-6 text-yellow-500" />
                  </div>
                  <p
                    className={`text-3xl font-bold text-theme-text transition-all duration-300 ${
                      showCelebration ? 'scale-110' : ''
                    }`}
                  >
                    {currentName}
                  </p>
                  {winner.email && (
                    <p className="text-sm text-theme-text-muted mt-2">{winner.email}</p>
                  )}
                </>
              ) : (
                <p className="text-2xl font-bold text-theme-text animate-pulse">{currentName}</p>
              )}
            </div>
          ) : (
            <div className="text-theme-text-muted">
              <Shuffle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">
                {availableGuests.length === 0
                  ? 'All eligible guests have been picked!'
                  : 'Click below to pick a random winner'}
              </p>
            </div>
          )}
        </div>

        {/* Pick Button */}
        <button
          onClick={pickWinner}
          disabled={isAnimating || availableGuests.length === 0}
          className={`w-full mt-4 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-base transition-all ${
            isAnimating
              ? 'bg-theme-surface-hover text-theme-text-secondary cursor-not-allowed'
              : availableGuests.length === 0
              ? 'bg-theme-surface text-theme-text-faint cursor-not-allowed'
              : winner
              ? 'bg-[#ff393a]/20 text-[#ff393a] hover:bg-[#ff393a]/30 border border-[#ff393a]/30'
              : 'bg-[#ff393a] text-white hover:bg-[#ff5a5b] shadow-lg shadow-[#ff393a]/20'
          }`}
        >
          {isAnimating ? (
            <>
              <Shuffle size={20} className="animate-spin" />
              Picking...
            </>
          ) : winner ? (
            <>
              <Shuffle size={20} />
              Pick Again
              <span className="text-sm opacity-70">({availableGuests.length} remaining)</span>
            </>
          ) : (
            <>
              <Sparkles size={20} />
              Pick a Winner
              <span className="text-sm opacity-70">({availableGuests.length} eligible)</span>
            </>
          )}
        </button>
      </div>

      {/* Winner History */}
      {winnerHistory.length > 0 && (
        <div className="border-t border-theme-stroke p-4">
          <h4 className="text-sm font-medium text-theme-text-secondary mb-3 flex items-center gap-2">
            <Trophy size={14} className="text-yellow-500" />
            Winners This Session ({winnerHistory.length})
          </h4>
          <div className="space-y-2">
            {winnerHistory.map((w, index) => (
              <div
                key={`${w.guest.id}-${index}`}
                className="flex items-center gap-3 px-3 py-2 bg-yellow-500/5 border border-yellow-500/10 rounded-lg"
              >
                <span className="flex items-center justify-center w-6 h-6 bg-yellow-500/20 rounded-full text-xs font-bold text-yellow-500">
                  {index + 1}
                </span>
                <span className="flex-1 text-theme-text font-medium">{w.guest.name}</span>
                <span className="text-xs text-theme-text-muted">
                  {w.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Confetti-style celebration effect */
function CelebrationEffect() {
  // Stabilize particle randomization so it doesn't change on re-renders
  const particles = React.useMemo(() => {
    const colors = ['#ff393a', '#ff5a5b', '#ffb347', '#ffd700', '#ff69b4', '#7b68ee'];
    return Array.from({ length: 20 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.5,
      duration: 1.5 + Math.random() * 1,
      size: 4 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      isCircle: Math.random() > 0.5,
    }));
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute animate-confetti"
          style={{
            left: `${p.left}%`,
            top: '-10px',
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            borderRadius: p.isCircle ? '50%' : '2px',
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotation}deg)`,
          }}
        />
      ))}
    </div>
  );
}
