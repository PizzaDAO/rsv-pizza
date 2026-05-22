import React from 'react';
import type { AdminPayoutTotals } from '../../types';
import { formatUsd } from '../payments-shared';

/**
 * parmigiana-58291: strip the "Global Pizza Party " prefix from event names so
 * the city stays visible on the /payments admin rollup. Same convention as
 * PayoutRow and PrepayQueueTable — inlined here intentionally (the three
 * callsites share the one-liner; we can DRY it later when a fourth appears).
 */
function stripGppPrefix(name: string): string {
  return name.replace(/^Global Pizza Party\s+/i, '');
}

interface PartyTotalsTableProps {
  rows: AdminPayoutTotals['byParty'];
}

/**
 * parmigiana-58291: small admin-only rollup table that shows total USD paid
 * per party. Rendered on /payments above the Prepay queue so admins see who's
 * received what before deciding on the next prepayment. Sorted descending by
 * `totalPaidUsd` (backend already sorts; we don't re-sort here).
 *
 * Renders nothing when `rows` is empty — the parent page already guards on
 * `totals.byParty.length === 0`, but we belt-and-suspenders here as well.
 */
export const PartyTotalsTable: React.FC<PartyTotalsTableProps> = ({ rows }) => {
  if (rows.length === 0) return null;

  return (
    <div className="bg-theme-surface border border-theme-stroke rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-theme-stroke text-theme-text-muted text-left">
              <th className="px-3 py-3 font-medium">Party</th>
              <th className="px-3 py-3 font-medium text-right">Payouts</th>
              <th className="px-3 py-3 font-medium text-right">Total Paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.partyId}
                className="border-t border-theme-stroke hover:bg-theme-surface-hover"
              >
                <td className="px-3 py-3 align-top">
                  <div className="font-medium text-theme-text">
                    {stripGppPrefix(row.partyName)}
                  </div>
                  {row.country && (
                    <div className="text-xs text-theme-text-muted mt-0.5">
                      {row.country}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 align-top text-right text-theme-text">
                  {row.payoutCount}
                </td>
                <td className="px-3 py-3 align-top text-right text-theme-text font-medium">
                  {formatUsd(row.totalPaidUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
