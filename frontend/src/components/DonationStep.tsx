import React, { useState, useEffect } from 'react';
import { Heart, DollarSign, Target, Loader2, ChevronRight } from 'lucide-react';
import { getDonationStats } from '../lib/api';
import { DonationForm } from './DonationForm';
import { DonationPublicStats } from '../types';

interface DonationStepProps {
  partyId: string;
  partyName: string;
  guestId?: string;
  guestName?: string;
  guestEmail?: string;
  onComplete: () => void;
  onSkip: () => void;
}

export const DonationStep: React.FC<DonationStepProps> = ({
  partyId,
  partyName,
  guestId,
  guestName,
  guestEmail,
  onComplete,
  onSkip,
}) => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DonationPublicStats | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    async function fetchStats() {
      const result = await getDonationStats(partyId);
      setStats(result);
      setLoading(false);
    }
    fetchStats();
  }, [partyId]);

  if (loading) {
    return (
      <div className="min-h-[300px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  // If donations not enabled, skip this step
  if (!stats?.enabled) {
    // Auto-skip after a brief moment
    useEffect(() => {
      onComplete();
    }, []);
    return null;
  }

  const formatAmount = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const goalProgress = stats.goal
    ? Math.min((stats.totalAmount! / (stats.goal * 100)) * 100, 100)
    : null;

  // Donation form view
  if (showForm) {
    return (
      <div className="card p-8 max-w-lg w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-[#ff393a]/20 rounded-full flex items-center justify-center border border-[#ff393a]/30">
            <Heart className="w-6 h-6 text-[#ff393a]" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Make a Donation</h2>
            <p className="text-sm text-white/60">
              {stats.recipient ? `Supporting ${stats.recipient}` : `Supporting ${partyName}`}
            </p>
          </div>
        </div>

        <DonationForm
          partyId={partyId}
          stats={stats}
          guestId={guestId}
          guestName={guestName}
          guestEmail={guestEmail}
          onSuccess={onComplete}
          onCancel={() => setShowForm(false)}
        />
      </div>
    );
  }

  // Initial donation prompt view
  return (
    <div className="card p-8 max-w-lg w-full">
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-[#ff393a]/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#ff393a]/30">
          <Heart className="w-8 h-8 text-[#ff393a]" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Support This Event</h2>
        <p className="text-white/60">
          {stats.message || 'Would you like to make a donation to help make this event possible?'}
        </p>
      </div>

      {/* Stats */}
      {stats.totalAmount !== undefined && stats.totalAmount > 0 && (
        <div className="bg-white/5 rounded-xl p-4 border border-white/10 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white/60 text-sm">
              {stats.donorCount} {stats.donorCount === 1 ? 'person has' : 'people have'} donated
            </span>
            <span className="text-[#39d98a] font-bold">
              {formatAmount(stats.totalAmount)} raised
            </span>
          </div>

          {/* Goal Progress */}
          {stats.goal && goalProgress !== null && (
            <div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden mb-1">
                <div
                  className="h-full bg-gradient-to-r from-[#ff393a] to-[#ff6b6b] transition-all duration-500"
                  style={{ width: `${goalProgress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/50 flex items-center gap-1">
                  <Target size={12} />
                  Goal: ${stats.goal}
                </span>
                <span className="text-white/50">{goalProgress.toFixed(0)}%</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent Donors */}
      {stats.recentDonors && stats.recentDonors.length > 0 && (
        <div className="mb-6">
          <p className="text-white/50 text-sm mb-2">Recent supporters:</p>
          <div className="flex flex-wrap gap-2">
            {stats.recentDonors.slice(0, 5).map((donor, index) => (
              <span
                key={index}
                className="px-3 py-1 bg-white/5 rounded-full text-sm text-white/70"
              >
                {donor.name || 'Anonymous'}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-3">
        <button
          onClick={() => setShowForm(true)}
          className="w-full btn-primary flex items-center justify-center gap-2"
        >
          <DollarSign size={18} />
          Make a Donation
        </button>
        <button
          onClick={onSkip}
          className="w-full btn-secondary flex items-center justify-center gap-2"
        >
          Skip
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
};
