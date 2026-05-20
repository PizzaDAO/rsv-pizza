import React from 'react';
import { Search, Mail, X } from 'lucide-react';
import { IconInput } from '../IconInput';
import type { AdminPayoutFilters, PayoutMethod, PayoutStatus } from '../../types';
import { PAYOUT_METHOD_LABELS } from '../payments-shared';

interface PayoutsFilterBarProps {
  filters: AdminPayoutFilters;
  onChange: (next: AdminPayoutFilters) => void;
  onReset: () => void;
  availableCurrencies: string[];
}

const STATUS_TABS: Array<{ value: PayoutStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'failed', label: 'Failed' },
];

const METHOD_OPTIONS: Array<{ value: PayoutMethod | 'all'; label: string }> = [
  { value: 'all', label: 'All methods' },
  { value: 'usdc_base', label: PAYOUT_METHOD_LABELS.usdc_base },
  { value: 'mercury_card', label: PAYOUT_METHOD_LABELS.mercury_card },
  { value: 'wire', label: PAYOUT_METHOD_LABELS.wire },
];

/**
 * Sticky filter bar at the top of the admin payouts dashboard. All updates are
 * pushed via `onChange` so the parent can refire `listAdminPayouts(filters)`.
 *
 * Cursor is intentionally NOT a prop here — when filters change the parent
 * should reset cursor to undefined.
 */
export const PayoutsFilterBar: React.FC<PayoutsFilterBarProps> = ({
  filters,
  onChange,
  onReset,
  availableCurrencies,
}) => {
  const update = (patch: Partial<AdminPayoutFilters>) => {
    onChange({ ...filters, ...patch, cursor: undefined });
  };

  return (
    <div className="sticky top-0 z-20 bg-theme-surface/95 backdrop-blur-sm border border-theme-stroke rounded-xl p-4 mb-4 shadow-sm">
      {/* Status tab strip */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {STATUS_TABS.map((tab) => {
          const active = (filters.status ?? 'all') === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => update({ status: tab.value })}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                active
                  ? 'bg-[#E52828] text-white'
                  : 'bg-theme-surface-hover text-theme-text-secondary hover:bg-theme-stroke'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-start">
        {/* Host search */}
        <div className="md:col-span-2">
          <IconInput
            icon={Mail}
            type="search"
            placeholder="Filter by host email"
            value={filters.hostEmail || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ hostEmail: e.target.value })}
          />
        </div>

        {/* Party ID search */}
        <div>
          <IconInput
            icon={Search}
            type="search"
            placeholder="Party ID"
            value={filters.partyId || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ partyId: e.target.value })}
          />
        </div>

        {/* Method dropdown */}
        <div>
          <select
            value={filters.payoutMethod ?? 'all'}
            onChange={(e) => update({ payoutMethod: e.target.value as PayoutMethod | 'all' })}
            className="w-full h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text"
            aria-label="Filter by payment method"
          >
            {METHOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Currency dropdown */}
        <div>
          <select
            value={filters.currency ?? 'all'}
            onChange={(e) => update({ currency: e.target.value })}
            className="w-full h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text"
            aria-label="Filter by currency"
          >
            <option value="all">All currencies</option>
            {availableCurrencies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-end gap-2 mt-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-theme-text-muted">From</label>
          <input
            type="date"
            value={filters.dateFrom || ''}
            onChange={(e) => update({ dateFrom: e.target.value })}
            className="h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text"
            aria-label="Date from"
          />
          <label className="text-xs text-theme-text-muted">To</label>
          <input
            type="date"
            value={filters.dateTo || ''}
            onChange={(e) => update({ dateTo: e.target.value })}
            className="h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text"
            aria-label="Date to"
          />
        </div>
        <button
          type="button"
          onClick={onReset}
          className="ml-auto inline-flex items-center gap-1 text-sm text-theme-text-muted hover:text-theme-text px-3 py-2 rounded-lg hover:bg-theme-surface-hover"
        >
          <X size={14} />
          Reset filters
        </button>
      </div>
    </div>
  );
};
