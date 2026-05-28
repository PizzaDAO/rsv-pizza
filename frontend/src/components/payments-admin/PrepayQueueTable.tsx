import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Star } from 'lucide-react';
import type { PrepayCandidate, PrepayQueueRow } from '../../types';
import { PayoutMethodIcon, PAYOUT_METHOD_LABELS, CapInlineEditor } from '../payments-shared';

interface PrepayQueueTableProps {
  rows: PrepayQueueRow[];
  onCreatePrepayment: (row: PrepayQueueRow) => void;
  /**
   * siciliana-69183: open the read-only HostPaymentDetailsModal for the chosen
   * candidate. Parent (`PaymentsAdminPage`) owns the modal state — we just
   * surface the click event with the User.id.
   */
  onHostClick?: (userId: string) => void;
  /**
   * montasio-49102: parent refreshes the prepay queue after an inline cap
   * edit so the row reflects the new value (and any downstream "already paid
   * vs cap" indicators).
   */
  onPartyUpdated?: (partyId: string) => void;
  /**
   * argentina-92103: viewer role. Underbosses see the queue read-only — the
   * "Create prepayment" button is hidden because creating a prepayment is
   * a funds-sending operation reserved for admins.
   */
  viewerRole?: 'admin' | 'underboss';
}

/**
 * Strip the "Global Pizza Party " prefix from event names so the city stays
 * visible without burning column width. Same convention as item #14 of the
 * /payments dashboard polish (the partyName cell on PayoutRow).
 */
function stripGppPrefix(name: string): string {
  return name.replace(/^Global Pizza Party\s+/i, '');
}

/**
 * bismarck-92103: small chip rendered per candidate inside the Hosts cell.
 * Method icon comes from the shared PayoutMethodIcon. Primary host gets a
 * star prefix so the admin can distinguish them at a glance.
 *
 * siciliana-69183: becomes a button when `onClick` is supplied so the admin
 * can drill into the candidate's saved payment details.
 *
 * paesana-89172: when the candidate is the primary host AND the primary host
 * isn't in co_hosts, suffix an amber AlertTriangle. Means "this person
 * isn't shown on the event page — confirm before paying."
 */
const HostChip: React.FC<{
  candidate: PrepayCandidate;
  invisiblePrimaryHost?: boolean;
  onClick?: () => void;
}> = ({ candidate, invisiblePrimaryHost = false, onClick }) => {
  const displayName = candidate.name && candidate.name.trim()
    ? candidate.name
    : candidate.email;
  const showInvisibleWarning = candidate.isPrimaryHost && invisiblePrimaryHost;
  const titleSuffix = showInvisibleWarning
    ? ' · NOT VISIBLE on event page — confirm this is the right host'
    : '';
  const inner = (
    <>
      {candidate.isPrimaryHost && (
        <Star size={11} className="text-amber-500 shrink-0" aria-label="Primary host" />
      )}
      <PayoutMethodIcon method={candidate.method} size={12} />
      <span className="truncate max-w-[12rem]">{displayName}</span>
      {showInvisibleWarning && (
        <AlertTriangle
          size={12}
          className="text-amber-500 shrink-0"
          aria-label="Primary host is not visible on the event page"
        />
      )}
    </>
  );
  const baseClass =
    'inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-theme-surface-hover border border-theme-stroke text-xs text-theme-text';
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClass} hover:border-theme-stroke-hover hover:bg-theme-surface-active cursor-pointer`}
        title={`${displayName} — ${PAYOUT_METHOD_LABELS[candidate.method]} · click for payment details${titleSuffix}`}
      >
        {inner}
      </button>
    );
  }
  return (
    <span
      className={baseClass}
      title={`${displayName} — ${PAYOUT_METHOD_LABELS[candidate.method]}${titleSuffix}`}
    >
      {inner}
    </span>
  );
};

/**
 * regina-89172: shared "already paid" caption — rendered in both the desktop
 * table cell and the mobile card so behavior stays in lockstep.
 */
const AlreadyPaidCaption: React.FC<{ row: PrepayQueueRow }> = ({ row }) => {
  if (row.partyPaidCount <= 0) return null;
  const overCap =
    row.party.effectiveReimbursementCapUsd != null &&
    row.partyPaidUsd >= row.party.effectiveReimbursementCapUsd;
  return (
    <div
      className={`text-[11px] mt-0.5 ${overCap ? 'text-amber-300' : 'text-theme-text-muted'}`}
    >
      Already paid: ${row.partyPaidUsd.toFixed(2)} ({row.partyPaidCount})
    </div>
  );
};

export const PrepayQueueTable: React.FC<PrepayQueueTableProps> = ({
  rows,
  onCreatePrepayment,
  onHostClick,
  onPartyUpdated,
  viewerRole = 'admin',
}) => {
  // argentina-92103: hide the "Create prepayment" button for underbosses
  // — creating a prepayment is funds-sending and stays admin-only.
  const canCreatePrepayment = viewerRole === 'admin';
  return (
    <div className="bg-theme-surface border border-theme-stroke rounded-xl overflow-hidden">
      {/* regina-89172: mobile card list (<640px). Each row becomes a stacked
          block so 4–5 fields lay out cleanly without horizontal scroll. */}
      <ul className="sm:hidden divide-y divide-theme-stroke">
        {rows.map((row) => {
          const eventSlug = row.party.customUrl ?? row.party.id;
          return (
            <li key={row.party.id} className="p-3 space-y-2">
              <div>
                <div className="flex items-start gap-2">
                  <Link
                    to={`/host/${eventSlug}/details`}
                    className="font-medium text-theme-text hover:text-[#E52828] hover:underline break-words flex-1 min-w-0"
                  >
                    {stripGppPrefix(row.party.name)}
                  </Link>
                  {row.hasMultipleCandidates && (
                    <span
                      className="inline-flex items-center text-amber-500 shrink-0 mt-0.5"
                      title="Multiple hosts have payment methods — pick one when creating the prepayment"
                    >
                      <AlertTriangle size={14} />
                    </span>
                  )}
                </div>
                {row.party.country && (
                  <div className="text-xs text-theme-text-muted mt-0.5">
                    {row.party.country}
                  </div>
                )}
                <AlreadyPaidCaption row={row} />
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-wide text-theme-text-muted mb-1">
                  Host(s)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {row.candidates.map((c) => (
                    <HostChip
                      key={c.userId}
                      candidate={c}
                      invisiblePrimaryHost={row.party.primaryHostInCohosts === false}
                      onClick={onHostClick ? () => onHostClick(c.userId) : undefined}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-theme-text inline-flex items-center gap-1">
                  <span className="text-[11px] uppercase tracking-wide text-theme-text-muted">
                    Cap
                  </span>
                  <CapInlineEditor
                    partyId={row.party.id}
                    currentCapUsd={row.party.effectiveReimbursementCapUsd ?? null}
                    onUpdated={() => onPartyUpdated?.(row.party.id)}
                  />
                </div>
                {canCreatePrepayment && (
                  <button
                    type="button"
                    onClick={() => onCreatePrepayment(row)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium shrink-0"
                  >
                    Create prepayment
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Desktop table (≥640px). */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-theme-stroke text-theme-text-muted text-left">
              <th className="px-3 py-3 font-medium">Event</th>
              <th className="px-3 py-3 font-medium">Host(s)</th>
              <th className="px-3 py-3 font-medium">Cap</th>
              <th className="px-3 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              // siciliana-69183: event name links into the host dashboard's
              // Settings tab. Slug is `customUrl ?? id` to match user-facing
              // URLs. Tab id `'details'` is the canonical Settings tab (see
              // `frontend/src/lib/tabPermissions.ts`).
              const eventSlug = row.party.customUrl ?? row.party.id;
              return (
                <tr
                  key={row.party.id}
                  className="border-t border-theme-stroke hover:bg-theme-surface-hover"
                >
                  <td className="px-3 py-3 align-top">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/host/${eventSlug}/details`}
                        className="font-medium text-theme-text hover:text-[#E52828] hover:underline truncate"
                      >
                        {stripGppPrefix(row.party.name)}
                      </Link>
                      {row.hasMultipleCandidates && (
                        <span
                          className="inline-flex items-center text-amber-500"
                          title="Multiple hosts have payment methods — pick one when creating the prepayment"
                        >
                          <AlertTriangle size={14} />
                        </span>
                      )}
                    </div>
                    {row.party.country && (
                      <div className="text-xs text-theme-text-muted mt-0.5">
                        {row.party.country}
                      </div>
                    )}
                    {/* parmigiana-89172: inline "already paid" total so the
                        admin sees prior payouts to this party before clicking
                        Create prepayment again. Amber when the paid total has
                        reached or exceeded the effective cap. */}
                    <AlreadyPaidCaption row={row} />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex flex-wrap gap-1.5">
                      {row.candidates.map((c) => (
                        <HostChip
                          key={c.userId}
                          candidate={c}
                          // paesana-89172: pass through the party-level
                          // "primary host missing from co_hosts" flag so the
                          // chip can render the amber warning.
                          invisiblePrimaryHost={row.party.primaryHostInCohosts === false}
                          onClick={onHostClick ? () => onHostClick(c.userId) : undefined}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top text-theme-text">
                    {/* montasio-49102: inline edit so admins can change the
                        cap without bouncing to the underboss dashboard. */}
                    <CapInlineEditor
                      partyId={row.party.id}
                      currentCapUsd={row.party.effectiveReimbursementCapUsd ?? null}
                      onUpdated={() => onPartyUpdated?.(row.party.id)}
                    />
                  </td>
                  <td className="px-3 py-3 align-top text-right">
                    {canCreatePrepayment && (
                      <button
                        type="button"
                        onClick={() => onCreatePrepayment(row)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                      >
                        Create prepayment
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
