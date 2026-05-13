import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { SponsorDashboardEvent } from '../../types';

type Metric = 'rsvps' | 'impressions' | 'clicks';

interface PartnerChartsProps {
  events: SponsorDashboardEvent[];
}

export default function PartnerCharts({ events }: PartnerChartsProps) {
  const { t } = useTranslation('partner');
  const [metric, setMetric] = useState<Metric>('rsvps');
  const [expanded, setExpanded] = useState(window.innerWidth >= 768);

  if (events.length < 2) {
    return (
      <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-6">
        <h3 className="text-white font-semibold text-lg">{t('charts.title')}</h3>
        <p className="text-white/50 mt-2">{t('charts.notEnoughData')}</p>
      </div>
    );
  }

  const getValue = (event: SponsorDashboardEvent): number => {
    switch (metric) {
      case 'rsvps': return event.rsvpCount;
      case 'impressions': return event.impressions?.totalViews || 0;
      case 'clicks': return event.clickStats?.totalClicks || 0;
    }
  };

  const chartData = [...events]
    .sort((a, b) => getValue(b) - getValue(a))
    .slice(0, 20)
    .map(e => ({
      name: e.name.length > 20 ? e.name.slice(0, 20) + '\u2026' : e.name,
      value: getValue(e),
    }));

  const metrics: { key: Metric; label: string }[] = [
    { key: 'rsvps', label: t('charts.rsvps') },
    { key: 'impressions', label: t('charts.impressions') },
    { key: 'clicks', label: t('charts.clicks') },
  ];

  return (
    <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left"
      >
        <h3 className="text-white font-semibold text-lg">{t('charts.title')}</h3>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-white/60" />
        ) : (
          <ChevronDown className="w-5 h-5 text-white/60" />
        )}
      </button>

      {expanded && (
        <div className="mt-4">
          {/* Metric toggle */}
          <div className="flex gap-1 mb-4 bg-white/5 rounded-lg p-1 w-fit">
            {metrics.map(m => (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  metric === m.key
                    ? 'bg-[#E52828] text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Bar chart */}
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  interval={0}
                  height={80}
                />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(0,0,0,0.85)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                  }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill="#E52828" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {events.length > 20 && (
            <p className="text-white/40 text-xs mt-2">
              Showing top 20 of {events.length} events
            </p>
          )}
        </div>
      )}
    </div>
  );
}
