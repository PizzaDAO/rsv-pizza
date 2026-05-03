import React from 'react';
import { useTranslation } from 'react-i18next';
import { MousePointerClick, Users, ExternalLink } from 'lucide-react';
import { LinkClickStats as LinkClickStatsType } from '../../types';

interface LinkClickStatsProps {
  stats: LinkClickStatsType;
}

// Link type badge colors - labels are translation keys
const linkTypeBadge: Record<string, { labelKey: string; color: string }> = {
  description: { labelKey: 'report.description', color: 'bg-blue-500/20 text-blue-400' },
  host_social: { labelKey: 'report.hostSocial', color: 'bg-purple-500/20 text-purple-400' },
  donation: { labelKey: 'report.donation', color: 'bg-green-500/20 text-green-400' },
};

export function LinkClickStats({ stats }: LinkClickStatsProps) {
  const { t } = useTranslation('host');
  const maxDailyTotal = Math.max(...stats.dailyClicks.map(d => d.total), 1);

  // Format URL for display: strip protocol, trim trailing slash, truncate
  const formatUrl = (url: string): string => {
    try {
      const parsed = new URL(url);
      const display = parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '');
      return display.length > 45 ? display.substring(0, 42) + '...' : display;
    } catch {
      return url.length > 45 ? url.substring(0, 42) + '...' : url;
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-theme-text">{t('report.linkClicks')}</h3>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-theme-surface rounded-xl p-4 border border-theme-stroke">
          <div className="flex items-center gap-2 mb-2">
            <MousePointerClick size={16} className="text-[#ff393a]" />
            <span className="text-xs text-theme-text-secondary">{t('report.totalClicks')}</span>
          </div>
          <div className="text-2xl font-bold text-theme-text">
            {stats.totalClicks.toLocaleString()}
          </div>
        </div>
        <div className="bg-theme-surface rounded-xl p-4 border border-theme-stroke">
          <div className="flex items-center gap-2 mb-2">
            <Users size={16} className="text-[#ff393a]" />
            <span className="text-xs text-theme-text-secondary">{t('report.uniqueClickers')}</span>
          </div>
          <div className="text-2xl font-bold text-theme-text">
            {stats.uniqueClickers.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Per-link breakdown */}
      {stats.links.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-theme-text mb-3">{t('report.linksClicked')}</h4>
          <div className="bg-theme-surface rounded-xl border border-theme-stroke divide-y divide-theme-stroke">
            {stats.links.map((link, i) => {
              const badge = linkTypeBadge[link.linkType] || { labelKey: link.linkType, color: 'bg-gray-500/20 text-gray-400' };
              return (
                <div key={i} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <ExternalLink size={14} className="text-theme-text-faint flex-shrink-0" />
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-theme-text truncate hover:text-[#ff393a] transition-colors"
                        title={link.url}
                      >
                        {link.linkLabel || formatUrl(link.url)}
                      </a>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.color}`}>
                        {t(badge.labelKey)}
                      </span>
                      <span className="text-sm font-medium text-theme-text">
                        {link.totalClicks.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1 ml-6">
                    <span className="text-xs text-theme-text-muted">
                      {link.uniqueClicks.toLocaleString()} {t('report.unique')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Daily clicks chart (last 30 days) */}
      {stats.dailyClicks.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-theme-text mb-3">{t('report.dailyClicksLast30')}</h4>
          <div className="bg-theme-surface rounded-xl p-4 border border-theme-stroke">
            <div className="flex items-end gap-[2px] h-32">
              {stats.dailyClicks.map((day) => {
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
                        <div className="text-theme-text">{day.total} clicks</div>
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
                <span>{t('report.total')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(255, 57, 58, 0.7)' }} />
                <span>{t('report.unique')}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {stats.totalClicks === 0 && (
        <div className="text-center py-6">
          <MousePointerClick className="w-12 h-12 text-theme-text-faint mx-auto mb-3" />
          <p className="text-theme-text-muted text-sm">{t('report.noLinkClicksYet')}</p>
          <p className="text-theme-text-faint text-xs mt-1">{t('report.linkClicksTracked')}</p>
        </div>
      )}
    </div>
  );
}
