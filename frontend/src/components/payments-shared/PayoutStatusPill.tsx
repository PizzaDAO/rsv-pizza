import React from 'react';
import type { PayoutStatus } from '../../types';

interface PayoutStatusPillProps {
  status: PayoutStatus;
  size?: 'sm' | 'md';
}

/**
 * Status pill used by both the host PayoutsList (PR 3) and the admin
 * PayoutsTable (PR 4). Single source of truth for status colors + labels so
 * we don't end up with the "two checklist renderers" drift bug.
 */
const STATUS_STYLES: Record<PayoutStatus, { bg: string; text: string; border: string; label: string }> = {
  pending: {
    bg: 'bg-amber-100',
    text: 'text-amber-800',
    border: 'border-amber-300',
    label: 'Pending',
  },
  approved: {
    bg: 'bg-blue-100',
    text: 'text-blue-800',
    border: 'border-blue-300',
    label: 'Approved',
  },
  paid: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-800',
    border: 'border-emerald-300',
    label: 'Paid',
  },
  rejected: {
    bg: 'bg-red-100',
    text: 'text-red-800',
    border: 'border-red-300',
    label: 'Rejected',
  },
  failed: {
    bg: 'bg-rose-100',
    text: 'text-rose-800',
    border: 'border-rose-300',
    label: 'Failed',
  },
};

export const PayoutStatusPill: React.FC<PayoutStatusPillProps> = ({ status, size = 'sm' }) => {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  const sizeClass = size === 'md' ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-block rounded-full font-medium border ${sizeClass} ${style.bg} ${style.text} ${style.border}`}
    >
      {style.label}
    </span>
  );
};
