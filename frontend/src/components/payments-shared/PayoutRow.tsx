import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Flag } from 'lucide-react';
import type { AdminPayout, Payout } from '../../types';
import { ClickableEmail } from '../ClickableEmail';
import { PayoutStatusPill } from './PayoutStatusPill';
import { PayoutMethodIcon } from './PayoutMethodIcon';
import { formatPayoutAmount } from './formatPayoutAmount';
import { CapInlineEditor } from './CapInlineEditor';

/**
 * bruschetta-58291: strip the "Global Pizza Party " prefix from event names so
 * the city stays visible on the /payments admin queue without burning column
 * width. Same helper as PrepayQueueTable — inlined here for now (the helper is
 * defined locally in both places).
 */
function stripGppPrefix(name: string): string {
  return name.replace(/^Global Pizza Party\s+/i, '');
}

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
  /**
   * siciliana-69183: when set + showAdminColumns is on, the host-name cell
   * becomes a button that opens the read-only HostPaymentDetailsModal for
   * `payout.hostUserId`. Parent owns the modal state.
   */
  onHostClick?: (userId: string) => void;
  /**
   * montasio-49102: parent re-fetches the payouts list after an inline cap
   * edit so the row reflects the new value.
   */
  onCapUpdated?: (partyId: string) => void;
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
  onHostClick,
  onCapUpdated,
}) => {
  const admin = payout as AdminPayout;
  // pomodoro-92110: thumbnail fallback order pizza → event → receipt.
  const firstThumbDoc =
    (payout.documents || []).find((d) => d.kind === 'pizza')
    ?? (payout.documents || []).find((d) => d.kind === 'event')
    ?? (payout.documents || []).find((d) => d.kind === 'receipt');
  const thumbUrl = firstThumbDoc?.url || null;

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
        <td className="px-3 py-3 text-sm min-w-[10rem]" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* siciliana-69183: when `onHostClick` is wired, the host name becomes
                a button that opens the read-only HostPaymentDetailsModal. Falls
                back to plain text for any callsite that doesn't want the modal. */}
            {onHostClick && payout.hostUserId ? (
              <button
                type="button"
                onClick={() => onHostClick(payout.hostUserId)}
                className="font-medium text-theme-text hover:text-[#E52828] hover:underline text-left"
                title="View saved payment details"
              >
                <span className="break-words">{admin.host.name || admin.host.email || '—'}</span>
              </button>
            ) : (
              <div className="font-medium text-theme-text break-words">{admin.host.name || '—'}</div>
            )}
            {/* paesana-89172: amber warning when the payout's recipient IS the
                party's primary host (parties.userId) but the primary host
                isn't in co_hosts — meaning the recipient is invisible on the
                event UI. Backfill should make this 0-hit for legacy data;
                this is the defensive flag for any new occurrences. */}
            {admin.party
              && admin.party.primaryHostInCohosts === false
              && admin.party.userId != null
              && admin.party.userId === payout.hostUserId && (
                <span
                  className="inline-flex items-center text-amber-500 shrink-0"
                  title="This host isn't shown on the event page — they may not be the active organizer."
                  aria-label="Primary host not visible in cohost list"
                >
                  <AlertTriangle size={14} />
                </span>
              )}
          </div>
          {admin.host.email && (
            <div className="text-xs text-theme-text-muted">
              <ClickableEmail email={admin.host.email} />
            </div>
          )}
        </td>
      )}

      {showAdminColumns && admin.party && (
        <td className="px-3 py-3 text-sm min-w-[10rem]">
          {/* siciliana-69183: link to the host dashboard's Settings tab. Slug is
              customUrl ?? inviteCode to match user-facing URLs. Tab id 'details'
              is the canonical Settings tab id (see tabPermissions.ts). */}
          <Link
            to={`/host/${admin.party.customUrl ?? admin.party.inviteCode}/details`}
            className="text-theme-text hover:text-[#E52828] hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {/* bruschetta-58291: strip "Global Pizza Party " so the city is
                visible. Same convention as PrepayQueueTable. */}
            {stripGppPrefix(admin.party.name)}
          </Link>
          {/* parmigiana-89172: inline "already paid" total per party so admins
              see prior payouts to this party before clicking Execute again.
              Includes the current row if its own status is paid — that's the
              intended behavior ("total sent to this party as of right now").
              Amber when the paid total has reached or exceeded the effective
              reimbursement cap. */}
          {admin.party.paidTotalCount != null &&
            admin.party.paidTotalCount > 0 && (
              <div
                className={`text-[11px] mt-0.5 ${
                  admin.party.effectiveReimbursementCapUsd != null &&
                  (admin.party.paidTotalUsd ?? 0) >=
                    admin.party.effectiveReimbursementCapUsd
                    ? 'text-amber-300'
                    : 'text-theme-text-muted'
                }`}
              >
                Already paid: ${(admin.party.paidTotalUsd ?? 0).toFixed(2)} (
                {admin.party.paidTotalCount})
              </div>
            )}
          {/* bruschetta-58291: country subtitle so admins can scan by region
              at a glance. Omitted when null to keep dense rows clean. */}
          {admin.party.country && (
            <div className="text-xs text-theme-text-muted">{admin.party.country}</div>
          )}
          {/* arugula-38633 v2 follow-up: planning vs actuals at a glance. */}
          <div
            className="text-xs text-theme-text-muted"
            title="Expected guests (host planning) vs confirmed RSVPs (direct submissions, excludes bulk invites)"
          >
            {admin.party.expectedGuests != null ? admin.party.expectedGuests : '—'}
            {' expected / '}
            {admin.party.rsvpCount}
            {' RSVPs'}
          </div>
          {/* arugula-38633 (cap-everywhere): show resolved reimbursement cap.
              montasio-49102: inline editor so admins can change the cap
              without bouncing to the underboss dashboard. Always rendered in
              admin mode so admins can set a cap on parties that don't have
              one yet. */}
          <div
            className="text-xs text-theme-text-muted mt-0.5 inline-flex items-center gap-1"
            title="Reimbursement cap (validated value or max numeric event_tag)"
            onClick={(e) => e.stopPropagation()}
          >
            <CapInlineEditor
              partyId={admin.party.id}
              currentCapUsd={admin.party.effectiveReimbursementCapUsd ?? null}
              onUpdated={() => onCapUpdated?.(admin.party.id)}
            />
            <span>cap</span>
          </div>
        </td>
      )}

      <td className="px-3 py-3 text-sm text-theme-text-secondary">
        <div title={submittedAbs}>{submittedRel}</div>
        <div className="text-xs text-theme-text-faint">{submittedAbs}</div>
      </td>

      <td className="px-3 py-3 text-sm text-theme-text">
        <div className="font-medium inline-flex items-center gap-1.5">
          {formatPayoutAmount(
            Number(payout.finalAmountUsd),
            Number(payout.originalAmount),
            payout.originalCurrency,
          )}
          {/* speck-89172: amber AlertTriangle when the payout's final amount
              exceeds the party's effective reimbursement cap. Additive to
              the parmigiana-89172 "Already paid" caption — this flags the
              individual row, that flags the cumulative paid total. */}
          {showAdminColumns &&
            admin.party?.effectiveReimbursementCapUsd != null &&
            Number(payout.finalAmountUsd) > admin.party.effectiveReimbursementCapUsd && (
              <span
                className="inline-flex items-center text-amber-500 shrink-0"
                title={`Submitted amount $${Number(payout.finalAmountUsd).toFixed(2)} exceeds the party's $${admin.party.effectiveReimbursementCapUsd.toFixed(2)} cap.`}
                aria-label="Amount exceeds party cap"
              >
                <AlertTriangle size={14} />
              </span>
            )}
        </div>
      </td>

      <td className="px-3 py-3">
        <PayoutMethodIcon method={payout.payoutMethod} />
      </td>

      <td className="px-3 py-3">
        <div className="inline-flex items-center gap-1.5">
          <PayoutStatusPill status={payout.status} />
          {/* argentina-92103: green Flag icon when a regional underboss (or
              admin) has marked the row "ready for payment". Tooltip carries
              the actor email + timestamp. Sticky until the row is paid /
              rejected / reverted. */}
          {showAdminColumns && admin.flaggedReady && (
            <Flag
              size={14}
              className="text-emerald-500 shrink-0"
              aria-label="Flagged ready for payment"
              title={
                `Flagged ready` +
                (admin.flaggedReadyBy ? ` by ${admin.flaggedReadyBy}` : '') +
                (admin.flaggedReadyAt
                  ? ` on ${new Date(admin.flaggedReadyAt).toLocaleString()}`
                  : '')
              }
            />
          )}
        </div>
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
