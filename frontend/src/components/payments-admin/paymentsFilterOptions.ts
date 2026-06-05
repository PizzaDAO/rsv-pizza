// panuozzo-92114: canonical filter-option VALUE lists for the admin /payments
// filter bar. Extracted into a React-free module so both the rendering
// component (PayoutsFilterBar.tsx) and the URL-state (de)serializer
// (paymentsUrlState.ts) import the same source of truth — no duplicate-and-drift
// — and so the serializer's unit tests don't transitively pull in the
// payments-shared barrel (which imports pdfjs and needs a DOM).
//
// Display labels stay in PayoutsFilterBar.tsx / payments-shared because they're
// only needed at render time; the serializer only validates against the values.
import type { PayoutMethod, PayoutPurpose, PayoutStatus, AdminPayoutFilters } from '../../types';

// ciabatta-92110: `'closed'` is a party-level pseudo-status (filters on
// parties.payments_closed_at), so the tab value type widens beyond PayoutStatus.
export type StatusTabValue = PayoutStatus | 'all' | 'closed';

export const STATUS_TAB_VALUES: StatusTabValue[] = [
  'all',
  'pending',
  'approved',
  'queued',
  'paid',
  'rejected',
  'failed',
  'withdrawn',
  'completed',
  'closed',
];

export const METHOD_VALUES: Array<PayoutMethod | 'all'> = [
  'all',
  'usdc_base',
  'mercury_card',
  'wire',
];

export const PURPOSE_VALUES: Array<PayoutPurpose | 'all'> = ['all', 'event', 'shipping'];

export type SortValue = NonNullable<AdminPayoutFilters['sort']>;

export const SORT_VALUES: SortValue[] = [
  'created_desc',
  'created_asc',
  'amount_desc',
  'amount_asc',
  'activity_desc',
  'activity_asc',
  'paid_at_desc',
  'paid_at_asc',
  'name_asc',
  'name_desc',
];
