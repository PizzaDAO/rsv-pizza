import type { PartyPayoutsRow } from '../../types';

/**
 * stracci-58471: the Approved / Paid / Outstanding money math for one by-city
 * row, shared by the table cells (PayoutsByPartyTable) and the page-level sort
 * comparators (PaymentsAdminPage) so a column and the sort behind its header
 * can never disagree.
 *
 * bresaola-49340: the completed contribution is proof-gated — proofless
 * completed rows (never-sent close-outs) are excluded from BOTH the committed
 * (Approved) and Paid sums, which leaves Outstanding unchanged.
 */
export function computePartyTotals(row: PartyPayoutsRow): {
  approvedUsd: number;
  paidUsd: number;
  outstandingUsd: number;
} {
  const completedProvenUsd =
    (row.aggregates.completedUsd ?? 0) - (row.aggregates.completedNoProofUsd ?? 0);
  const approvedUsd =
    row.aggregates.approvedUsd + row.aggregates.paidUsd + completedProvenUsd;
  const paidUsd = row.aggregates.paidUsd + completedProvenUsd;
  const outstandingUsd = Math.max(0, approvedUsd - paidUsd);
  return { approvedUsd, paidUsd, outstandingUsd };
}
