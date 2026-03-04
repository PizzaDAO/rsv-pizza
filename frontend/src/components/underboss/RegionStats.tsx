import React from 'react';
import { Users, MapPin, Wallet, Package, BarChart3, TrendingUp } from 'lucide-react';
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
    <div className="bg-white/5 rounded-xl p-4 border border-white/10">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={16} />
        </div>
        <span className="text-xs text-white/40 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {subValue && <div className="text-xs text-white/40 mt-1">{subValue}</div>}
    </div>
  );
}

function CompletionBar({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-white/50 w-16 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-green-500/60 rounded-full transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs text-white/60 w-10 text-right">{percent}%</span>
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
        <StatCard
          icon={Package}
          label="With Kit"
          value={stats.eventsWithKit}
          color="bg-pink-500/20 text-pink-400"
        />
      </div>

      {/* Completion rates */}
      <div className="bg-white/5 rounded-xl p-4 border border-white/10">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={14} className="text-white/40" />
          <span className="text-xs text-white/40 uppercase tracking-wider">Completion Rates</span>
        </div>
        <div className="space-y-3">
          <CompletionBar label="Venue" percent={stats.completionRate.venue} />
          <CompletionBar label="Budget" percent={stats.completionRate.budget} />
          <CompletionBar label="Party Kit" percent={stats.completionRate.partyKit} />
        </div>
      </div>
    </div>
  );
}
