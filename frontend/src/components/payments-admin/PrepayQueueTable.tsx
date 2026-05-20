import React from 'react';
import { AlertTriangle, Star } from 'lucide-react';
import type { PrepayCandidate, PrepayQueueRow } from '../../types';
import { PayoutMethodIcon, PAYOUT_METHOD_LABELS } from '../payments-shared';

interface PrepayQueueTableProps {
  rows: PrepayQueueRow[];
  onCreatePrepayment: (row: PrepayQueueRow) => void;
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
 */
const HostChip: React.FC<{ candidate: PrepayCandidate }> = ({ candidate }) => {
  const displayName = candidate.name && candidate.name.trim()
    ? candidate.name
    : candidate.email;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-theme-surface-hover border border-theme-stroke text-xs text-theme-text"
      title={`${displayName} — ${PAYOUT_METHOD_LABELS[candidate.method]}`}
    >
      {candidate.isPrimaryHost && (
        <Star size={11} className="text-amber-500 shrink-0" aria-label="Primary host" />
      )}
      <PayoutMethodIcon method={candidate.method} size={12} />
      <span className="truncate max-w-[12rem]">{displayName}</span>
    </span>
  );
};

export const PrepayQueueTable: React.FC<PrepayQueueTableProps> = ({
  rows,
  onCreatePrepayment,
}) => {
  return (
    <div className="bg-theme-surface border border-theme-stroke rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
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
              const cap = row.party.effectiveReimbursementCapUsd;
              return (
                <tr
                  key={row.party.id}
                  className="border-t border-theme-stroke hover:bg-theme-surface-hover"
                >
                  <td className="px-3 py-3 align-top">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-theme-text truncate">
                        {stripGppPrefix(row.party.name)}
                      </span>
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
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex flex-wrap gap-1.5">
                      {row.candidates.map((c) => (
                        <HostChip key={c.userId} candidate={c} />
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top text-theme-text">
                    {cap != null ? `$${cap.toLocaleString()}` : '—'}
                  </td>
                  <td className="px-3 py-3 align-top text-right">
                    <button
                      type="button"
                      onClick={() => onCreatePrepayment(row)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                    >
                      Create prepayment
                    </button>
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
