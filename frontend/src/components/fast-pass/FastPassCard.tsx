import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, CalendarClock, Loader2, Sparkles } from 'lucide-react';
import { fetchHostFastPass, type HostFastPassStatus } from '../../lib/api';

interface Props {
  partyId: string;
}

/**
 * Host-facing Fast Pass card. Shows the approved budget very clearly (amount,
 * what it covers, receipt deadline) or the host's progress toward the badge.
 * Intentionally shows NO fraud-review details (admin-only).
 */
export const FastPassCard: React.FC<Props> = ({ partyId }) => {
  const { t, i18n } = useTranslation('host');
  const [status, setStatus] = useState<HostFastPassStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchHostFastPass(partyId)
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [partyId]);

  if (loading) {
    return (
      <div className="card p-4 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" />
      </div>
    );
  }
  if (!status || !status.track) return null;

  const { track, approval, thresholds } = status;
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-3">
      {approval && (
        <div
          className="rounded-xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-4"
          data-testid="fast-pass-approval"
        >
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-semibold">
            <BadgeCheck size={20} />
            {t('fastPass.approvedTitle')}
          </div>
          <div className="mt-2 text-3xl font-bold text-theme-text">
            {t('fastPass.amountUsd', {
              amount: approval.approvedAmountUsd.toLocaleString(i18n.language, { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
            })}
          </div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-theme-text-muted">{t('fastPass.covers')}</dt>
              <dd className="text-theme-text font-medium">
                {approval.covers.map((c) => t(`fastPass.cat.${c}`, { defaultValue: c })).join(', ')}
              </dd>
            </div>
            <div>
              <dt className="text-theme-text-muted flex items-center gap-1">
                <CalendarClock size={14} />
                {t('fastPass.receiptDeadline')}
              </dt>
              <dd className="text-theme-text font-medium">{fmtDate(approval.receiptDeadline)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-theme-text-secondary">{t('fastPass.approvedFootnote')}</p>
        </div>
      )}

      {track.tier === 'fast_pass' ? (
        <div className="rounded-xl border border-theme-stroke bg-theme-surface p-3 flex items-start gap-2">
          <Sparkles size={18} className="text-amber-500 mt-0.5" />
          <div>
            <div className="font-semibold text-theme-text text-sm">{t('fastPass.badge')}</div>
            <p className="text-xs text-theme-text-secondary">
              {approval ? t('fastPass.badgeHaveBudget') : t('fastPass.badgeDesc')}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-theme-stroke bg-theme-surface p-3 text-sm">
          <div className="font-semibold text-theme-text">{t('fastPass.progressTitle')}</div>
          <p className="text-xs text-theme-text-secondary mb-2">{t('fastPass.progressDesc')}</p>
          <ul className="space-y-1 text-xs text-theme-text-secondary">
            <li>
              {t('fastPass.reqVerified', {
                have: track.verifiedParties,
                need: thresholds.minVerifiedParties,
                rsvps: thresholds.minRsvps,
                days: thresholds.receiptDeadlineDays,
              })}
            </li>
            <li>
              {t('fastPass.reqAccountAge', {
                have: track.accountAgeDays,
                need: thresholds.minAccountAgeDays,
              })}
            </li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default FastPassCard;
