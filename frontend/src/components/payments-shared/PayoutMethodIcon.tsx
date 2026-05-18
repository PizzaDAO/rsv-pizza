import React from 'react';
import { CreditCard, Banknote, Coins } from 'lucide-react';
import type { PayoutMethod } from '../../types';

interface PayoutMethodIconProps {
  method: PayoutMethod;
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
 */
export const PayoutMethodIcon: React.FC<PayoutMethodIconProps> = ({
  method,
  size = 16,
  showLabel = false,
  className = '',
}) => {
  let Icon = CreditCard;
  if (method === 'wire') Icon = Banknote;
  else if (method === 'usdc_base') Icon = Coins;

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Icon size={size} className="text-theme-text-secondary" />
      {showLabel && (
        <span className="text-sm text-theme-text-secondary">{PAYOUT_METHOD_LABELS[method]}</span>
      )}
    </span>
  );
};
