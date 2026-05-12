import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchFunnelStats } from '../../lib/api';
import type { FunnelStats, FunnelEventStats } from '../../lib/api';

interface FunnelTabProps {
  regions: string[];
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className="text-sm text-white/70 w-24 text-right">{label}</span>
      <div className="flex-1 bg-white/10 rounded-full h-6 relative overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">
          {value.toLocaleString()} ({pct}%)
        </span>
      </div>
    </div>
  );
}

export function FunnelTab({ regions }: FunnelTabProps) {
  const [data, setData] = useState<FunnelStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Stabilize regions reference to prevent infinite re-renders
  const regionsKey = regions.join(',');

  useEffect(() => {
    setLoading(true);
    fetchFunnelStats(regions).then((result) => {
      setData(result);
      setLoading(false);
    }).catch(() => {
      setData(null);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionsKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-white/60" />
      </div>
    );
  }

  if (!data || !data.totals || !data.events) {
    return <p className="text-white/60 text-center py-8">Failed to load funnel data.</p>;
  }

  const { totals, events } = data;
  const maxVal = Math.max(totals.views || 0, 1);

  return (
    <div className="space-y-6">
      {/* Aggregate funnel */}
      <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Overall RSVP Funnel</h3>
        <FunnelBar label="Views" value={totals.views || 0} max={maxVal} color="bg-blue-500" />
        <FunnelBar label="Opened" value={totals.opened || 0} max={maxVal} color="bg-cyan-500" />
        <FunnelBar label="Step 1" value={totals.step1Complete || 0} max={maxVal} color="bg-amber-500" />
        <FunnelBar label="Submitted" value={totals.submitted || 0} max={maxVal} color="bg-green-500" />
        <div className="mt-3 text-xs text-white/50 flex gap-4">
          <span>Open rate: {totals.views > 0 ? Math.round((totals.opened / totals.views) * 100) : 0}%</span>
          <span>Completion: {totals.opened > 0 ? Math.round((totals.submitted / totals.opened) * 100) : 0}%</span>
        </div>
      </div>

      {/* Per-event table */}
      <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 overflow-x-auto">
        <h3 className="text-lg font-semibold text-white mb-4">Per-Event Breakdown</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-white/60 border-b border-white/10">
              <th className="text-left py-2 px-2">Event</th>
              <th className="text-left py-2 px-2">City</th>
              <th className="text-right py-2 px-2">Views</th>
              <th className="text-right py-2 px-2">Opened</th>
              <th className="text-right py-2 px-2">Step 1</th>
              <th className="text-right py-2 px-2">Submitted</th>
              <th className="text-right py-2 px-2">Conv %</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev: FunnelEventStats) => (
              <tr key={ev.eventId} className="border-b border-white/5 hover:bg-white/5">
                <td className="py-2 px-2 text-white/90 max-w-[200px] truncate">{ev.eventName}</td>
                <td className="py-2 px-2 text-white/70">{ev.city}</td>
                <td className="py-2 px-2 text-right text-white/80">{ev.views}</td>
                <td className="py-2 px-2 text-right text-white/80">{ev.opened}</td>
                <td className="py-2 px-2 text-right text-white/80">{ev.step1Complete}</td>
                <td className="py-2 px-2 text-right text-white/80">{ev.submitted}</td>
                <td className="py-2 px-2 text-right text-white/80">
                  {ev.views > 0 ? Math.round((ev.submitted / ev.views) * 100) : 0}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 0 && (
          <p className="text-center text-white/50 py-4">No funnel data yet.</p>
        )}
      </div>
    </div>
  );
}
