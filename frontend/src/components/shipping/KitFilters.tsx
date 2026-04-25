import React from 'react';
import { Search, Download, Upload } from 'lucide-react';
import { IconInput } from '../IconInput';
import type { KitStatus } from '../../types';

const STATUS_OPTIONS: { value: KitStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'declined', label: 'Declined' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-600 border-yellow-500/30',
  approved: 'bg-blue-500/20 text-blue-600 border-blue-500/30',
  shipped: 'bg-purple-500/20 text-purple-600 border-purple-500/30',
  delivered: 'bg-green-500/20 text-green-600 border-green-500/30',
  declined: 'bg-red-500/20 text-red-600 border-red-500/30',
};

interface KitFiltersProps {
  statusFilter: string;
  onStatusFilter: (status: string) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  countryFilter: string;
  onCountryFilter: (country: string) => void;
  countries: string[];
  onExport: () => void;
  exporting?: boolean;
  onImport?: () => void;
}

export function KitFilters({
  statusFilter,
  onStatusFilter,
  searchTerm,
  onSearchChange,
  countryFilter,
  onCountryFilter,
  countries,
  onExport,
  exporting,
  onImport,
}: KitFiltersProps) {
  return (
    <div className="space-y-3">
      {/* Status pills */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map(({ value, label }) => {
          const isActive = statusFilter === value;
          const colorClass = value ? STATUS_COLORS[value] : '';
          return (
            <button
              key={value || 'all'}
              onClick={() => onStatusFilter(value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                isActive
                  ? value
                    ? colorClass
                    : 'bg-theme-text text-theme-card border-theme-text'
                  : 'bg-theme-surface text-theme-text-muted border-theme-stroke hover:border-theme-stroke-hover'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Search, country filter, export */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <IconInput
            icon={Search}
            placeholder="Search events, hosts, recipients, cities..."
            value={searchTerm}
            onChange={(e) => onSearchChange((e.target as HTMLInputElement).value)}
          />
        </div>

        <div className="relative">
          <select
            value={countryFilter}
            onChange={(e) => onCountryFilter(e.target.value)}
            className="appearance-none bg-theme-surface border border-theme-stroke rounded-lg px-4 py-2 pr-8 text-sm text-theme-text focus:outline-none focus:border-theme-stroke-hover min-w-[160px]"
          >
            <option value="">All Countries</option>
            {countries.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <button
          onClick={onExport}
          disabled={exporting}
          className="flex items-center gap-2 px-4 py-2 bg-theme-surface border border-theme-stroke rounded-lg text-sm text-theme-text hover:border-theme-stroke-hover transition-colors disabled:opacity-50"
        >
          <Download size={14} />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>

        {onImport && (
          <button
            onClick={onImport}
            className="flex items-center gap-2 px-4 py-2 bg-theme-surface border border-theme-stroke rounded-lg text-sm text-theme-text hover:border-theme-stroke-hover transition-colors"
          >
            <Upload size={14} />
            Import Tracking
          </button>
        )}
      </div>
    </div>
  );
}
