import React from 'react';
import { CreditCard, Banknote, Coins, HelpCircle } from 'lucide-react';
import type { PayoutMethod } from '../../types';

interface PayoutMethodIconProps {
  /** arugula-38633 v3 follow-up: null when the host hasn't set their payment details. */
  method: PayoutMethod | null;
  size?: number;
  showLabel?: boolean;
  className?: string;
}

export const PAYOUT_METHOD_LABELS: Record<PayoutMethod, string> = {
  mercury_card: 'Mercury Card',
  wire: 'Wire Transfer',
  usdc_base: 'USDC (Base)',
};

/**
 * Renders an icon (and optional label) for a payout method. Shared between the
 * host-facing PayoutsList (PR 3) and the admin PayoutsTable (PR 4).
 *
 * arugula-38633 v3 follow-up: payout method is now optional at submission
 * time. When unset, renders a placeholder icon + "Not set" label.
 */
export const PayoutMethodIcon: React.FC<PayoutMethodIconProps> = ({
  method,
  size = 16,
  showLabel = false,
  className = '',
}) => {
  let Icon = CreditCard;
  let label: string = '—';
  if (method == null) {
    Icon = HelpCircle;
    label = 'Not set';
  } else if (method === 'wire') {
    Icon = Banknote;
    label = PAYOUT_METHOD_LABELS[method];
  } else if (method === 'usdc_base') {
    Icon = Coins;
    label = PAYOUT_METHOD_LABELS[method];
  } else {
    // mercury_card
    label = PAYOUT_METHOD_LABELS[method];
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Icon size={size} className="text-theme-text-secondary" />
      {showLabel && (
        <span className="text-sm text-theme-text-secondary">{label}</span>
      )}
    </span>
  );
};
