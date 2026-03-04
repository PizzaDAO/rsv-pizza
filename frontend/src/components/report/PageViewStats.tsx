import React from 'react';
import { Eye, Users, ExternalLink } from 'lucide-react';
import { PageViewStats as PageViewStatsType } from '../../types';

interface PageViewStatsProps {
  stats: PageViewStatsType;
}

export function PageViewStats({ stats }: PageViewStatsProps) {
  const maxDailyTotal = Math.max(...stats.dailyViews.map(d => d.total), 1);

  // Format referrer for display: strip protocol, trim trailing slash
  const formatReferrer = (ref: string): string => {
    try {
      const url = new URL(ref);
      const display = url.hostname + (url.pathname !== '/' ? url.pathname : '');
      return display.length > 50 ? display.substring(0, 47) + '...' : display;
    } catch {
      return ref.length > 50 ? ref.substring(0, 47) + '...' : ref;
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-white">Page Views</h3>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <div className="flex items-center gap-2 mb-2">
            <Eye size={16} className="text-[#ff393a]" />
            <span className="text-xs text-white/60">Total Views</span>
          </div>
          <div className="text-2xl font-bold text-white">
            {stats.totalViews.toLocaleString()}
          </div>
        </div>
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <div className="flex items-center gap-2 mb-2">
            <Users size={16} className="text-[#ff393a]" />
            <span className="text-xs text-white/60">Unique Visitors</span>
          </div>
          <div className="text-2xl font-bold text-white">
            {stats.uniqueViews.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Daily views chart (last 30 days) */}
      {stats.dailyViews.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-white/80 mb-3">Daily Views (Last 30 Days)</h4>
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-end gap-[2px] h-32">
              {stats.dailyViews.map((day) => {
                const heightPercent = (day.total / maxDailyTotal) * 100;
                const uniquePercent = (day.unique / maxDailyTotal) * 100;
                const dateObj = new Date(day.date + 'T00:00:00');
                const label = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                return (
                  <div
                    key={day.date}
                    className="flex-1 flex flex-col items-center justify-end h-full group relative"
                  >
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-2 hidden group-hover:block z-10 pointer-events-none">
                      <div className="bg-black/90 border border-white/20 rounded-lg px-3 py-2 text-xs whitespace-nowrap">
                        <div className="text-white/80 font-medium mb-1">{label}</div>
                        <div className="text-white">{day.total} views</div>
                        <div className="text-white/60">{day.unique} unique</div>
                      </div>
                    </div>
                    {/* Bar — total (outer) and unique (inner overlay) */}
                    <div
                      className="w-full rounded-t-sm relative"
                      style={{
                        height: `${Math.max(heightPercent, 2)}%`,
                        backgroundColor: 'rgba(255, 57, 58, 0.3)',
                      }}
                    >
                      <div
                        className="absolute bottom-0 left-0 right-0 rounded-t-sm"
                        style={{
                          height: `${Math.max((uniquePercent / Math.max(heightPercent, 2)) * 100, 0)}%`,
                          backgroundColor: 'rgba(255, 57, 58, 0.7)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 mt-3 text-xs text-white/40">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(255, 57, 58, 0.3)' }} />
                <span>Total</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(255, 57, 58, 0.7)' }} />
                <span>Unique</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top referrers */}
      {stats.topReferrers.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-white/80 mb-3">Top Referrers</h4>
          <div className="bg-white/5 rounded-xl border border-white/10 divide-y divide-white/5">
            {stats.topReferrers.map((ref, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <ExternalLink size={14} className="text-white/30 flex-shrink-0" />
                  <span className="text-sm text-white/80 truncate">
                    {formatReferrer(ref.referrer)}
                  </span>
                </div>
                <span className="text-sm font-medium text-white ml-3 flex-shrink-0">
                  {ref.count.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {stats.totalViews === 0 && (
        <div className="text-center py-6">
          <Eye className="w-12 h-12 text-white/10 mx-auto mb-3" />
          <p className="text-white/40 text-sm">No page views recorded yet</p>
          <p className="text-white/30 text-xs mt-1">Views are tracked when visitors load your event page</p>
        </div>
      )}
    </div>
  );
}
