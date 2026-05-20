import React from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Users, Mail, Wallet, Award, Video, MousePointerClick, FileText } from 'lucide-react';
import { EventReport, PageViewStats, HostGoals, MomentumDelta } from '../../types';
import { GoalBar } from '../gpp-dashboard/GoalBar';

type StatsConfig = Record<string, { override?: number | null; hidden?: boolean }>;

// quattro-71244: optional gamification extras for the read-only branch.
export interface GamifiedExtras {
  goals: HostGoals;
  deltas: Record<string, MomentumDelta>;
  pulseKeys: Set<string>;
  onSetGoal: (statKey: string, newGoal: number | null) => void;
}

// Stat key → matching HostGoals key (subset that supports goals).
const STAT_TO_GOAL_KEY: Record<string, keyof HostGoals> = {
  totalRsvps: 'rsvps',
  attendees: 'attendees',
  newsletterSignups: 'newsletterSignups',
  walletAddresses: 'walletAddresses',
  poapMints: 'poapMints',
  pageViews: 'pageViews',
};

interface ReportKPIsProps {
  report: EventReport;
  onChange: (field: string, value: any) => void;
  editable?: boolean;
  pageViewStats?: PageViewStats | null;
  socialPostViews?: number;
  socialPostCount?: number;
  gamified?: GamifiedExtras;
}

interface StatItem {
  key: string;
  label: string;
  autoValue: number | null | undefined;
  icon: React.ElementType;
  color: string;
}

export function ReportKPIs({ report, onChange, editable = true, pageViewStats, socialPostViews, socialPostCount, gamified }: ReportKPIsProps) {
  const { t } = useTranslation('host');
  const config: StatsConfig = report.reportStatsConfig || {};

  const allStats: StatItem[] = [
    ...(pageViewStats ? [
      { key: 'pageViews', label: t('report.pageViews'), autoValue: pageViewStats.totalViews, icon: MousePointerClick, color: 'text-[#ff393a]' },
      { key: 'uniqueVisitors', label: t('report.uniqueVisitors'), autoValue: pageViewStats.uniqueViews, icon: Eye, color: 'text-[#ff393a]' },
    ] : []),
    { key: 'socialPostViews', label: t('report.socialPostViews'), autoValue: socialPostViews || null, icon: Eye, color: 'text-blue-400' },
    { key: 'socialPosts', label: t('report.socialPosts'), autoValue: socialPostCount || null, icon: FileText, color: 'text-blue-400' },
    { key: 'totalRsvps', label: t('report.totalRsvps'), autoValue: report.stats.totalRsvps, icon: Users, color: 'text-green-400' },
    { key: 'attendees', label: t('report.attendees'), autoValue: report.stats.approvedGuests, icon: Users, color: 'text-emerald-400' },
    { key: 'newsletterSignups', label: t('report.newsletterSignups'), autoValue: report.stats.mailingListSignups, icon: Mail, color: 'text-orange-400' },
    { key: 'walletAddresses', label: t('report.walletAddresses'), autoValue: report.stats.walletAddresses, icon: Wallet, color: 'text-cyan-400' },
    { key: 'poapMints', label: t('report.poapMints'), autoValue: report.poapMints, icon: Award, color: 'text-yellow-400' },
    { key: 'poapMoments', label: t('report.poapMoments'), autoValue: report.poapMoments, icon: Video, color: 'text-yellow-400' },
  ];

  function getDisplayValue(stat: StatItem): number | null {
    const cfg = config[stat.key];
    if (cfg?.override != null) return cfg.override;
    return stat.autoValue ?? null;
  }

  function isHidden(key: string): boolean {
    return config[key]?.hidden === true;
  }

  function updateConfig(key: string, patch: { override?: number | null; hidden?: boolean }) {
    const newConfig = { ...config };
    newConfig[key] = { ...newConfig[key], ...patch };
    // Clean up: remove entries that are default (no override, not hidden)
    if (newConfig[key].override == null && !newConfig[key].hidden) {
      delete newConfig[key];
    }
    onChange('reportStatsConfig', Object.keys(newConfig).length > 0 ? newConfig : null);
  }

  if (!editable) {
    // Read-only display mode for preview/public view
    const visibleStats = allStats.filter(s => !isHidden(s.key));
    // When `gamified` is provided, render zero-state tiles too — zeros are
    // motivating, and the gamified-dashboard wrapper expects the full grid.
    const hasAny = gamified
      ? visibleStats.length > 0
      : visibleStats.some(s => getDisplayValue(s) != null);
    if (!hasAny) return null;

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-theme-text">{t('report.stats')}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {visibleStats.map((stat) => {
            const value = getDisplayValue(stat);
            // In non-gamified mode, hide null tiles (legacy behavior).
            if (value === null && !gamified) return null;
            const Icon = stat.icon;
            const numericValue = value ?? 0;

            // quattro-71244: gamification extras (goals, deltas, pulse).
            const goalKey = gamified ? STAT_TO_GOAL_KEY[stat.key] : undefined;
            const goalValue = goalKey != null && gamified ? gamified.goals[goalKey] : undefined;
            const delta = gamified ? gamified.deltas[stat.key] : undefined;
            const pulse = gamified?.pulseKeys.has(stat.key) ?? false;

            return (
              <div
                key={stat.key}
                className={`card p-4 ${pulse ? 'animate-pulse-once' : ''}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={16} className={stat.color} />
                  <span className="text-xs text-theme-text-secondary">{stat.label}</span>
                </div>
                <div className="text-2xl font-bold text-theme-text">
                  {numericValue.toLocaleString()}
                </div>
                {gamified && goalKey != null && (
                  <GoalBar
                    value={numericValue}
                    goal={goalValue}
                    onSetGoal={(g) => gamified.onSetGoal(stat.key, g)}
                  />
                )}
                {gamified && delta && (delta.lastHour || delta.today || delta.busiestHourLabel) ? (
                  <div className="mt-2 text-[10px] text-theme-text-faint space-y-0.5">
                    {delta.lastHour != null && delta.lastHour > 0 && (
                      <div>{t('dashboard.kpis.deltaLastHour', { n: delta.lastHour })}</div>
                    )}
                    {delta.today != null && delta.today > 0 && (
                      <div>{t('dashboard.kpis.deltaToday', { n: delta.today })}</div>
                    )}
                    {delta.busiestHourLabel && (
                      <div>{t('dashboard.kpis.busiestHour', { label: delta.busiestHourLabel })}</div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-theme-text">Stats</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {allStats.map((stat) => {
          const Icon = stat.icon;
          const hidden = isHidden(stat.key);
          const cfg = config[stat.key];
          const hasOverride = cfg?.override != null;
          const displayValue = getDisplayValue(stat);

          if (displayValue === null && !hasOverride) return null;

          return (
            <div
              key={stat.key}
              className={`card p-4 transition-opacity ${hidden ? 'opacity-40' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon size={16} className={stat.color} />
                  <span className="text-xs text-theme-text-secondary truncate">{stat.label}</span>
                </div>
                <button
                  onClick={() => updateConfig(stat.key, { hidden: !hidden })}
                  className="text-theme-text-faint hover:text-theme-text-secondary transition-colors flex-shrink-0 ml-1"
                  title={hidden ? t('report.showInReport') : t('report.hideFromReport')}
                >
                  {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <input
                type="number"
                value={hasOverride ? cfg!.override! : (displayValue ?? '')}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || val === String(stat.autoValue)) {
                    updateConfig(stat.key, { override: null });
                  } else {
                    updateConfig(stat.key, { override: parseInt(val, 10) || 0 });
                  }
                }}
                placeholder={stat.autoValue != null ? String(stat.autoValue) : '0'}
                className="w-full bg-transparent text-2xl font-bold text-theme-text outline-none border-b border-theme-stroke focus:border-theme-stroke-hover transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              {hasOverride && (
                <button
                  onClick={() => updateConfig(stat.key, { override: null })}
                  className="text-[10px] text-theme-text-faint hover:text-theme-text-muted mt-1"
                >
                  {t('report.resetTo', { value: stat.autoValue?.toLocaleString() ?? '0' })}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
