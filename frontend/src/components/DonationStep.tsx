import React, { useState, useEffect } from 'react';
import { Heart, DollarSign, Target, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('donation');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DonationPublicStats | null>(null);
  const [showForm, setShowForm] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      const result = await getDonationStats(partyId);
      setStats(result);
      setLoading(false);
    }
    fetchStats();
  }, [partyId]);

  // Auto-skip if donations are not enabled (after loading completes)
  useEffect(() => {
    if (!loading && !stats?.enabled) {
      onComplete();
    }
  }, [loading, stats, onComplete]);

  if (loading) {
    return (
      <div className="min-h-[300px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  // If donations not enabled, render nothing (useEffect above handles the skip)
  if (!stats?.enabled) {
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
            <h2 className="text-xl font-bold text-theme-text">{t('step.title')}</h2>
            <p className="text-sm text-theme-text-secondary">
              {stats.recipient ? (
                <>{t('step.buyPizzaFor', { recipient: '' })}{stats.recipientUrl ? <a href={stats.recipientUrl} target="_blank" rel="noopener noreferrer" className="text-[#ff393a] hover:text-[#ff6b6b] underline transition-colors">{stats.recipient}</a> : stats.recipient}</>
              ) : t('step.buyPizzaForEvent', { eventName: partyName })}
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
          onCancel={onSkip}
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
        <h2 className="text-2xl font-bold text-theme-text mb-2">{t('step.donateTitle')}</h2>
        <p className="text-sm text-theme-text-secondary mb-1">
          {stats.recipient ? (
            <>{t('step.supportingRecipient', { recipient: '' })}{stats.recipientUrl ? <a href={stats.recipientUrl} target="_blank" rel="noopener noreferrer" className="text-[#ff393a] hover:text-[#ff6b6b] underline transition-colors">{stats.recipient}</a> : stats.recipient}</>
          ) : t('step.supportingEvent', { eventName: partyName })}
        </p>
        <p className="text-theme-text-secondary">
          {stats.message || t('step.defaultMessage')}
        </p>
      </div>

      {/* Stats */}
      {stats.totalAmount !== undefined && stats.totalAmount > 0 && (
        <div className="bg-theme-surface rounded-xl p-4 border border-theme-stroke mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-theme-text-secondary text-sm">
              {t('step.donorCount', { count: stats.donorCount })}
            </span>
            <span className="text-[#39d98a] font-bold">
              {t('step.raised', { amount: formatAmount(stats.totalAmount) })}
            </span>
          </div>

          {/* Goal Progress */}
          {stats.goal && goalProgress !== null && (
            <div>
              <div className="h-2 bg-theme-surface-hover rounded-full overflow-hidden mb-1">
                <div
                  className="h-full bg-gradient-to-r from-[#ff393a] to-[#ff6b6b] transition-all duration-500"
                  style={{ width: `${goalProgress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-theme-text-muted flex items-center gap-1">
                  <Target size={12} />
                  {t('step.goal', { amount: stats.goal })}
                </span>
                <span className="text-theme-text-muted">{goalProgress.toFixed(0)}%</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent Donors */}
      {stats.recentDonors && stats.recentDonors.length > 0 && (
        <div className="mb-6">
          <p className="text-theme-text-muted text-sm mb-2">{t('step.recentSupporters')}</p>
          <div className="flex flex-wrap gap-2">
            {stats.recentDonors.slice(0, 5).map((donor, index) => (
              <span
                key={index}
                className="px-3 py-1 bg-theme-surface rounded-full text-sm text-theme-text-secondary"
              >
                {donor.name || t('step.anonymous')}
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
          {t('step.makeADonation')}
        </button>
        <button
          onClick={onSkip}
          className="w-full btn-secondary flex items-center justify-center gap-2"
        >
          {t('step.back')}
        </button>
      </div>
    </div>
  );
};
