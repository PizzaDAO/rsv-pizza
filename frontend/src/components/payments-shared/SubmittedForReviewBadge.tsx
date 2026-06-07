import React from 'react';
import { CheckCircle2 } from 'lucide-react';

interface SubmittedForReviewBadgeProps {
  /**
   * ziti-58300: the rolling reimbursement's `submittedForReviewAt` timestamp
   * (ISO string) or null. When null the badge renders nothing — the host
   * hasn't signalled their reimbursement is ready for review yet.
   */
  submittedForReviewAt?: string | null;
  /** Compact variant drops the date text and shows just the check + label. */
  compact?: boolean;
  className?: string;
}

/**
 * ziti-58300: amber "Submitted {date}" pill surfaced wherever a payout / host
 * reimbursement row is shown on the admin /payments app. Signals that a co-host
 * has explicitly marked their rolling reimbursement ready for review (the
 * `submitted_for_review_at` flag) so admins can prioritise host-ready records.
 *
 * Mirrors PayoutStatusPill's pill aesthetic so it sits cleanly alongside the
 * status pill. Amber matches the "pending but actionable" convention used for
 * the unapprove / cap-warning affordances across the admin tables.
 */
export const SubmittedForReviewBadge: React.FC<SubmittedForReviewBadgeProps> = ({
  submittedForReviewAt,
  compact = false,
  className = '',
}) => {
  if (!submittedForReviewAt) return null;
  const abs = new Date(submittedForReviewAt).toLocaleString();
  const label = compact
    ? 'Submitted'
    : `Submitted ${new Date(submittedForReviewAt).toLocaleDateString()}`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium border px-2 py-0.5 text-xs bg-amber-100 text-amber-800 border-amber-300 ${className}`}
      title={`Host marked this reimbursement ready for review on ${abs}`}
    >
      <CheckCircle2 size={12} className="shrink-0" />
      {label}
    </span>
  );
};
