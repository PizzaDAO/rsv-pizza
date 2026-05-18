import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  TooltipProps,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import {
  fetchSponsorEventsTimeSeries,
  type PartnerTimeSeriesRange,
  type PartnerTimeSeriesPoint,
} from '../../lib/api';

interface PartnerTimeSeriesChartProps {
  tag?: string | null;
}

const RANGES: PartnerTimeSeriesRange[] = ['6hr', '24hr', '3d', '7d'];

const COLORS = {
  rsvps: '#E52828',       // brand red
  impressions: '#3B82F6', // blue
  clicks: '#F59E0B',      // amber
};

function formatTickLabel(iso: string, range: PartnerTimeSeriesRange): string {
  const d = new Date(iso);
  if (range === '6hr' || range === '24hr') {
    // Show time of day
    return d.toLocaleTimeString(undefined, { hour: 'numeric', hour12: false });
  }
  // 3d / 7d: show short date + hour
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatFullTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || !payload.length || !label) return null;
  return (
    <div className="bg-theme-card border border-theme-stroke rounded-lg px-3 py-2 shadow-lg text-xs">
      <div className="text-theme-text-muted mb-1.5">{formatFullTimestamp(label as string)}</div>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey as string} className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-theme-text-secondary">{entry.name}:</span>
            <span className="text-theme-text font-semibold">
              {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type SeriesKey = 'impressions' | 'clicks' | 'rsvps';

export function PartnerTimeSeriesChart({ tag }: PartnerTimeSeriesChartProps) {
  const { t } = useTranslation('partner');
  const [range, setRange] = useState<PartnerTimeSeriesRange>('24hr');
  const [points, setPoints] = useState<PartnerTimeSeriesPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSponsorEventsTimeSeries(range, tag || undefined)
      .then((res) => {
        if (cancelled) return;
        setPoints(res.points || []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load time series:', err);
        setError(t('timeSeries.error'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, tag, t]);

  const hasData = useMemo(
    () => points.some((p) => p.rsvps > 0 || p.impressions > 0 || p.clicks > 0),
    [points]
  );

  const yMax = useMemo(() => {
    let max = 0;
    for (const row of points) {
      (['impressions', 'clicks', 'rsvps'] as const).forEach((k) => {
        if (!hidden.has(k)) max = Math.max(max, row[k]);
      });
    }
    return max || 1; // avoid degenerate [0,0] domain
  }, [points, hidden]);

  const toggleSeries = (e: any) => {
    const key = e?.dataKey as SeriesKey | undefined;
    if (!key) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="bg-theme-card border border-theme-stroke rounded-xl p-4 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-theme-text">{t('timeSeries.title')}</h2>
          <p className="text-xs text-theme-text-muted mt-0.5">{t('timeSeries.subtitle')}</p>
        </div>
        <div className="inline-flex items-center gap-1 bg-theme-input border border-theme-stroke rounded-lg p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                range === r
                  ? 'bg-theme-stroke text-theme-text font-semibold'
                  : 'text-theme-text-muted hover:text-theme-text'
              }`}
            >
              {t(`timeSeries.range.${r}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64 w-full">
        {loading ? (
          <div className="h-full w-full flex items-center justify-center text-theme-text-muted text-xs gap-2">
            <Loader2 size={14} className="animate-spin" />
            {t('timeSeries.loading')}
          </div>
        ) : error ? (
          <div className="h-full w-full flex items-center justify-center text-red-500/80 text-xs">
            {error}
          </div>
        ) : !hasData ? (
          <div className="h-full w-full flex items-center justify-center text-theme-text-muted text-xs">
            {t('timeSeries.empty')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis
                dataKey="timestamp"
                tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.6)' }}
                stroke="rgba(255,255,255,0.2)"
                tickFormatter={(v: string) => formatTickLabel(v, range)}
                minTickGap={20}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.6)' }}
                stroke="rgba(255,255,255,0.2)"
                width={36}
                domain={[0, yMax]}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12, cursor: 'pointer' }}
                iconType="circle"
                onClick={toggleSeries}
              />
              <Line
                type="monotone"
                dataKey="rsvps"
                name={t('timeSeries.rsvps')}
                stroke={COLORS.rsvps}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                hide={hidden.has('rsvps')}
              />
              <Line
                type="monotone"
                dataKey="impressions"
                name={t('timeSeries.impressions')}
                stroke={COLORS.impressions}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                hide={hidden.has('impressions')}
              />
              <Line
                type="monotone"
                dataKey="clicks"
                name={t('timeSeries.clicks')}
                stroke={COLORS.clicks}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                hide={hidden.has('clicks')}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default PartnerTimeSeriesChart;
