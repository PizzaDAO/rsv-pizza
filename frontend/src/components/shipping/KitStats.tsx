import React from 'react';
import { Package, CheckCircle, Truck, MapPin, XCircle, BarChart3 } from 'lucide-react';
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
  { key: 'total', label: 'Total', icon: BarChart3, color: 'text-theme-text-secondary', bg: 'bg-theme-surface' },
] as const;

export function KitStats({ stats, onStatusFilter, activeStatus }: KitStatsProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {STAT_CARDS.map(({ key, label, icon: Icon, color, bg }) => {
        const count = stats[key as keyof ShippingKitStats] as number;
        const isActive = activeStatus === (key === 'total' ? null : key);
        return (
          <button
            key={key}
            onClick={() => onStatusFilter?.(key === 'total' ? null : key)}
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
