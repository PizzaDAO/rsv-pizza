import React from 'react';
import type { AdminPayout, Payout } from '../../types';
import { ClickableEmail } from '../ClickableEmail';
import { PayoutStatusPill } from './PayoutStatusPill';
import { PayoutMethodIcon } from './PayoutMethodIcon';
import { formatPayoutAmount } from './formatPayoutAmount';

interface PayoutRowProps {
  /**
   * A Payout (host view) or AdminPayout (admin view, with embedded host +
   * party info). Admin-mode columns are only rendered when the row carries
   * the AdminPayout fields AND `showAdminColumns` is true.
   */
  payout: Payout | AdminPayout;
  /** Render host-info columns (admin dashboard). */
  showAdminColumns?: boolean;
  /** Render a leading checkbox column (bulk-actions). */
  selectable?: boolean;
  selected?: boolean;
  onSelectToggle?: () => void;
  /** Row click handler (open detail modal). */
  onClick?: () => void;
  /** Extra cell rendered at the end of the row (admin actions menu). */
  actions?: React.ReactNode;
}

/**
 * Shared payout row primitive. Used as a `<tr>` in both the host PayoutsList
 * (PR 3) and the admin PayoutsTable (PR 4). Props toggle which columns appear
 * so we don't end up with two divergent row implementations (see the
 * "two checklist renderers" precedent).
 */
export const PayoutRow: React.FC<PayoutRowProps> = ({
  payout,
  showAdminColumns = false,
  selectable = false,
  selected = false,
  onSelectToggle,
  onClick,
  actions,
}) => {
  const admin = payout as AdminPayout;
  const firstPizza = (payout.documents || []).find((d) => d.kind === 'pizza');
  const thumbUrl = firstPizza?.url || null;

  const submittedAbs = new Date(payout.createdAt).toLocaleString();
  const submittedRel = relativeTime(new Date(payout.createdAt));

  return (
    <tr
      className={`border-b border-theme-stroke transition-colors ${onClick ? 'cursor-pointer hover:bg-theme-surface-hover' : ''}`}
      onClick={onClick}
    >
      {selectable && (
        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelectToggle?.()}
            className="rounded border-theme-stroke-hover bg-theme-surface"
            aria-label="Select payment"
          />
        </td>
      )}
      <td className="px-3 py-3 w-14">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            className="w-10 h-10 rounded object-cover border border-theme-stroke"
            loading="lazy"
          />
        ) : (
          <div className="w-10 h-10 rounded border border-dashed border-theme-stroke" />
        )}
      </td>

      {showAdminColumns && admin.host && (
        <td className="px-3 py-3 text-sm">
          <div className="font-medium text-theme-text">{admin.host.name || '—'}</div>
          {admin.host.email && (
            <div className="text-xs text-theme-text-muted">
              <ClickableEmail email={admin.host.email} />
            </div>
          )}
        </td>
      )}

      {showAdminColumns && admin.party && (
        <td className="px-3 py-3 text-sm">
          <a
            href={`/host/${admin.party.inviteCode}`}
            className="text-theme-text hover:underline"
            onClick={(e) => e.stopPropagation()}
            target="_blank"
            rel="noopener noreferrer"
          >
            {admin.party.name}
          </a>
        </td>
      )}

      <td className="px-3 py-3 text-sm text-theme-text-secondary">
        <div title={submittedAbs}>{submittedRel}</div>
        <div className="text-xs text-theme-text-faint">{submittedAbs}</div>
      </td>

      <td className="px-3 py-3 text-sm text-theme-text">
        <div className="font-medium">
          {formatPayoutAmount(
            Number(payout.finalAmountUsd),
            Number(payout.originalAmount),
            payout.originalCurrency,
          )}
        </div>
      </td>

      <td className="px-3 py-3">
        <PayoutMethodIcon method={payout.payoutMethod} />
      </td>

      <td className="px-3 py-3">
        <PayoutStatusPill status={payout.status} />
      </td>

      {actions && (
        <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
          {actions}
        </td>
      )}
    </tr>
  );
};

/** Small "x minutes / hours / days ago" formatter. */
function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
