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
      <h3 className="text-lg font-semibold text-theme-text">Page Views</h3>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-theme-surface rounded-xl p-4 border border-theme-stroke">
          <div className="flex items-center gap-2 mb-2">
            <Eye size={16} className="text-[#ff393a]" />
            <span className="text-xs text-theme-text-secondary">Total Views</span>
          </div>
          <div className="text-2xl font-bold text-theme-text">
            {stats.totalViews.toLocaleString()}
          </div>
        </div>
        <div className="bg-theme-surface rounded-xl p-4 border border-theme-stroke">
          <div className="flex items-center gap-2 mb-2">
            <Users size={16} className="text-[#ff393a]" />
            <span className="text-xs text-theme-text-secondary">Unique Visitors</span>
          </div>
          <div className="text-2xl font-bold text-theme-text">
            {stats.uniqueViews.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Daily views chart (last 30 days) */}
      {stats.dailyViews.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-theme-text mb-3">Daily Views (Last 30 Days)</h4>
          <div className="bg-theme-surface rounded-xl p-4 border border-theme-stroke">
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
                      <div className="bg-black/90 border border-theme-stroke-hover rounded-lg px-3 py-2 text-xs whitespace-nowrap">
                        <div className="text-theme-text font-medium mb-1">{label}</div>
                        <div className="text-theme-text">{day.total} views</div>
                        <div className="text-theme-text-secondary">{day.unique} unique</div>
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
            <div className="flex items-center gap-4 mt-3 text-xs text-theme-text-muted">
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
          <h4 className="text-sm font-medium text-theme-text mb-3">Top Referrers</h4>
          <div className="bg-theme-surface rounded-xl border border-theme-stroke divide-y divide-theme-stroke">
            {stats.topReferrers.map((ref, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <ExternalLink size={14} className="text-theme-text-faint flex-shrink-0" />
                  <span className="text-sm text-theme-text truncate">
                    {formatReferrer(ref.referrer)}
                  </span>
                </div>
                <span className="text-sm font-medium text-theme-text ml-3 flex-shrink-0">
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
          <Eye className="w-12 h-12 text-theme-text-faint mx-auto mb-3" />
          <p className="text-theme-text-muted text-sm">No page views recorded yet</p>
          <p className="text-theme-text-faint text-xs mt-1">Views are tracked when visitors load your event page</p>
        </div>
      )}
    </div>
  );
}
