import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Users, Pizza, X, Check } from 'lucide-react';
import { dismissNextSteps, isNextStepsDismissed, shouldShowNextSteps } from '../lib/nextSteps';

interface NextStepsCardProps {
  partyId: string;
  inviteCode: string;
  customUrl?: string | null;
  createdAt?: string | null;
  guestCount: number;
  onInviteGuests?: () => void;
  onOrderPizza?: () => void;
}

/** Dismissible first-run card on the host dashboard for a brand-new event with no guests yet. */
export function NextStepsCard({ partyId, inviteCode, customUrl, createdAt, guestCount, onInviteGuests, onOrderPizza }: NextStepsCardProps) {
  const { t } = useTranslation('host');
  const [dismissed, setDismissed] = useState(() => isNextStepsDismissed(partyId));
  const [copied, setCopied] = useState(false);

  if (dismissed || !shouldShowNextSteps({ createdAt }, guestCount)) return null;

  const link = `${window.location.origin}/${customUrl || inviteCode}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  };

  const dismiss = () => {
    dismissNextSteps(partyId);
    setDismissed(true);
  };

  return (
    <div className="card p-5 mb-6 relative" data-testid="next-steps-card">
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('nextSteps.dismiss')}
        className="absolute top-3 right-3 text-theme-text-muted hover:text-theme-text transition-colors"
      >
        <X size={18} />
      </button>
      <h2 className="text-lg font-semibold text-theme-text">{t('nextSteps.title')}</h2>
      <p className="text-sm text-theme-text-secondary mb-4">{t('nextSteps.subtitle')}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={copy} className="btn-primary flex items-center gap-2" data-testid="next-steps-copy">
          {copied ? <Check size={16} /> : <Link2 size={16} />}
          {copied ? t('nextSteps.copied') : t('nextSteps.copyLink')}
        </button>
        {onInviteGuests && (
          <button type="button" onClick={onInviteGuests} className="btn-secondary flex items-center gap-2">
            <Users size={16} />
            {t('nextSteps.inviteGuests')}
          </button>
        )}
        {onOrderPizza && (
          <button type="button" onClick={onOrderPizza} className="btn-secondary flex items-center gap-2">
            <Pizza size={16} />
            {t('nextSteps.orderPizza')}
          </button>
        )}
      </div>
    </div>
  );
}
