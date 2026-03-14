import React from 'react';
import { Users, MapPin, Wallet, BarChart3, TrendingUp } from 'lucide-react';
import type { UnderbossStats } from '../../types';

interface RegionStatsProps {
  stats: UnderbossStats;
}

function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subValue?: string;
  color: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={16} />
        </div>
        <span className="text-xs text-theme-text-muted uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-theme-text">{value}</div>
      {subValue && <div className="text-xs text-theme-text-muted mt-1">{subValue}</div>}
    </div>
  );
}

function CompletionBar({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-theme-text-muted w-16 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-theme-surface rounded-full overflow-hidden">
        <div
          className="h-full bg-green-500/60 rounded-full transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs text-theme-text-secondary w-10 text-right">{percent}%</span>
    </div>
  );
}

export function RegionStats({ stats }: RegionStatsProps) {
  return (
    <div className="space-y-4">
      {/* Top stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          icon={BarChart3}
          label="Events"
          value={stats.totalEvents}
          color="bg-blue-500/20 text-blue-400"
        />
        <StatCard
          icon={Users}
          label="Total RSVPs"
          value={stats.totalRsvps}
          subValue={`~${stats.avgRsvpsPerEvent} per event`}
          color="bg-purple-500/20 text-purple-400"
        />
        <StatCard
          icon={Users}
          label="Approved"
          value={stats.totalApproved}
          color="bg-green-500/20 text-green-400"
        />
        <StatCard
          icon={MapPin}
          label="With Venue"
          value={stats.eventsWithVenue}
          color="bg-orange-500/20 text-orange-400"
        />
        <StatCard
          icon={Wallet}
          label="With Budget"
          value={stats.eventsWithBudget}
          color="bg-yellow-500/20 text-yellow-400"
        />
      </div>

      {/* Completion rates */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={14} className="text-theme-text-muted" />
          <span className="text-xs text-theme-text-muted uppercase tracking-wider">Completion Rates</span>
        </div>
        <div className="space-y-3">
          <CompletionBar label="Venue" percent={stats.completionRate.venue} />
          <CompletionBar label="Budget" percent={stats.completionRate.budget} />
        </div>
      </div>
    </div>
  );
}
