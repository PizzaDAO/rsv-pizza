import React, { useState, useMemo } from 'react';
import { ArrowUpDown, ChevronDown } from 'lucide-react';
import { KitRow } from './KitRow';
import type { ShippingKit, KitStatus, KitTier } from '../../types';

interface KitTableProps {
  kits: ShippingKit[];
  onStatusChange: (kitId: string, status: string) => void;
  onTierChange: (kitId: string, tier: string) => void;
  onTrackingChange: (kitId: string, trackingNumber: string, trackingUrl: string) => void;
  onViewDetail: (kit: ShippingKit) => void;
  onBulkUpdate: (kitIds: string[], updates: { status?: string; allocatedTier?: string }) => void;
  showRegion?: boolean;
  sortField: string;
  sortDir: 'asc' | 'desc';
  onSort: (field: string) => void;
}

export function KitTable({
  kits,
  onStatusChange,
  onTierChange,
  onTrackingChange,
  onViewDetail,
  onBulkUpdate,
  showRegion,
  sortField,
  sortDir,
  onSort,
}: KitTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState('');

  const allSelected = kits.length > 0 && selectedIds.size === kits.length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(kits.map((k) => k.id)));
    }
  };

  const handleBulkApply = () => {
    if (!bulkAction || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);

    if (['pending', 'approved', 'shipped', 'delivered', 'declined'].includes(bulkAction)) {
      onBulkUpdate(ids, { status: bulkAction });
    } else if (['basic', 'large', 'deluxe'].includes(bulkAction)) {
      onBulkUpdate(ids, { allocatedTier: bulkAction });
    }

    setSelectedIds(new Set());
    setBulkAction('');
  };

  const SortHeader = ({ field, children, className = '' }: { field: string; children: React.ReactNode; className?: string }) => (
    <th
      className={`px-3 py-3 text-left text-xs font-medium text-theme-text-muted cursor-pointer hover:text-theme-text transition-colors select-none ${className}`}
      onClick={() => onSort(field)}
    >
      <span className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <ArrowUpDown size={12} className={`${sortDir === 'desc' ? 'rotate-180' : ''} text-red-500`} />
        )}
      </span>
    </th>
  );

  return (
    <div>
      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 p-3 bg-red-500/10 rounded-xl border border-red-500/20">
          <span className="text-sm text-theme-text font-medium">
            {selectedIds.size} selected
          </span>
          <div className="relative">
            <select
              value={bulkAction}
              onChange={(e) => setBulkAction(e.target.value)}
              className="appearance-none bg-theme-surface border border-theme-stroke rounded-lg px-3 py-1.5 pr-8 text-sm text-theme-text focus:outline-none focus:border-theme-stroke-hover"
            >
              <option value="">Choose action...</option>
              <optgroup label="Set Status">
                <option value="approved">Approve</option>
                <option value="shipped">Mark Shipped</option>
                <option value="delivered">Mark Delivered</option>
                <option value="declined">Decline</option>
                <option value="pending">Reset to Pending</option>
              </optgroup>
              <optgroup label="Set Tier">
                <option value="basic">Tier: Basic</option>
                <option value="large">Tier: Large</option>
                <option value="deluxe">Tier: Deluxe</option>
              </optgroup>
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />
          </div>
          <button
            onClick={handleBulkApply}
            disabled={!bulkAction}
            className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            Apply
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-theme-text-muted hover:text-theme-text transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-theme-stroke">
        <table className="w-full">
          <thead>
            <tr className="bg-theme-surface border-b border-theme-stroke">
              <th className="px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="rounded border-theme-stroke-hover"
                />
              </th>
              <SortHeader field="eventDate">Event</SortHeader>
              {showRegion && <SortHeader field="region">Region</SortHeader>}
              <th className="px-3 py-3 text-left text-xs font-medium text-theme-text-muted hidden md:table-cell">Host</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-theme-text-muted">Recipient</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-theme-text-muted hidden lg:table-cell">Tier</th>
              <SortHeader field="status">Status</SortHeader>
              <th className="px-3 py-3 text-left text-xs font-medium text-theme-text-muted hidden xl:table-cell">Tracking</th>
              <SortHeader field="requestedAt" className="hidden lg:table-cell">Requested</SortHeader>
              <th className="px-3 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {kits.length === 0 ? (
              <tr>
                <td colSpan={showRegion ? 10 : 9} className="px-6 py-12 text-center text-theme-text-muted text-sm">
                  No kit requests found matching your filters.
                </td>
              </tr>
            ) : (
              kits.map((kit) => (
                <KitRow
                  key={kit.id}
                  kit={kit}
                  selected={selectedIds.has(kit.id)}
                  onSelect={toggleSelect}
                  onStatusChange={onStatusChange}
                  onTierChange={onTierChange}
                  onTrackingChange={onTrackingChange}
                  onViewDetail={onViewDetail}
                  showRegion={showRegion}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {kits.length > 0 && (
        <p className="text-xs text-theme-text-faint mt-2 text-right">
          Showing {kits.length} kit{kits.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}
