import React from 'react';
import { Package, CheckCircle, Truck, MapPin, XCircle, AlertCircle, BarChart3 } from 'lucide-react';
import type { ShippingKitStats } from '../../types';

interface KitStatsProps {
  stats: ShippingKitStats;
  onStatusFilter?: (status: string | null) => void;
  activeStatus?: string | null;
}

const STAT_CARDS = [
  { key: 'pending', label: 'Pending', icon: Package, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  { key: 'approved', label: 'Approved', icon: CheckCircle, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  { key: 'shipped', label: 'Shipped', icon: Truck, color: 'text-purple-500', bg: 'bg-purple-500/10' },
  { key: 'delivered', label: 'Delivered', icon: MapPin, color: 'text-green-500', bg: 'bg-green-500/10' },
  { key: 'declined', label: 'Declined', icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
  { key: 'noRequest', label: 'No request', icon: AlertCircle, color: 'text-orange-500', bg: 'bg-orange-500/10' },
  { key: 'total', label: 'Total', icon: BarChart3, color: 'text-theme-text-secondary', bg: 'bg-theme-surface' },
] as const;

// Map STAT_CARDS `key` to the corresponding status filter value.
// Most keys match the filter value 1:1; `noRequest` maps to the pseudo-status
// `no_request`, and `total` clears the filter (null).
function keyToStatus(key: typeof STAT_CARDS[number]['key']): string | null {
  if (key === 'total') return null;
  if (key === 'noRequest') return 'no_request';
  return key;
}

export function KitStats({ stats, onStatusFilter, activeStatus }: KitStatsProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {STAT_CARDS.map(({ key, label, icon: Icon, color, bg }) => {
        const count = (stats[key as keyof ShippingKitStats] as number | undefined) ?? 0;
        const statusValue = keyToStatus(key);
        const isActive = activeStatus === statusValue;
        return (
          <button
            key={key}
            onClick={() => onStatusFilter?.(statusValue)}
            className={`rounded-xl p-4 text-left transition-all ${bg} ${
              isActive ? 'ring-2 ring-red-500 shadow-lg' : 'hover:shadow-md'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon size={16} className={color} />
              <span className="text-xs text-theme-text-muted">{label}</span>
            </div>
            <p className={`text-2xl font-bold ${color}`}>{count}</p>
          </button>
        );
      })}
    </div>
  );
}
