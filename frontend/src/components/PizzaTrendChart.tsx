import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PublicPizzaTrendPoint } from '../lib/api';
import { fmtUsd } from '../lib/pizzaIndexUtils';

/** Countries with fewer events than this are "early": their points are dimmed. */
const EARLY_BELOW = 3;
const LINE = '#f87171';
const AXIS = 'rgba(255,255,255,0.6)';
const GRID = 'rgba(255,255,255,0.12)';
const TOOLTIP_STYLE = { background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, color: '#fff', fontSize: 12 };

interface DotProps { cx?: number; cy?: number; payload?: PublicPizzaTrendPoint; selected?: number }

/** Hollow = estimated sizes; dimmed = early (fewer than 3 events); ringed = the year being viewed. */
function TrendDot({ cx, cy, payload, selected }: DotProps) {
  if (cx === undefined || cy === undefined || !payload) return null;
  const early = payload.nParties < EARLY_BELOW;
  return (
    <g opacity={early ? 0.45 : 1}>
      {payload.year === selected && <circle cx={cx} cy={cy} r={8} fill="none" stroke={LINE} strokeOpacity={0.4} />}
      <circle cx={cx} cy={cy} r={4} fill={payload.estimated ? 'transparent' : LINE} stroke={LINE} strokeWidth={2} />
    </g>
  );
}

/**
 * Price trend for one country: the 30 cm price (nominal USD, not inflation
 * adjusted) from each year's own index. Rendered only with 2+ points.
 */
export function PizzaTrendChart({ points, selectedYear }: { points: PublicPizzaTrendPoint[] | undefined; selectedYear: number }) {
  const data = useMemo(() => [...(points ?? [])].sort((a, b) => a.year - b.year), [points]);
  if (data.length < 2) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs text-theme-text-muted">Nominal USD, 30 cm pizza</div>
      <div className="h-[120px] w-full" role="img" aria-label={`Price of a 30 cm pizza by year: ${data.map((p) => `${p.year} ${fmtUsd(p.usd30)}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="year" type="number" domain={['dataMin', 'dataMax']} ticks={data.map((p) => p.year)} stroke={AXIS} tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis stroke={AXIS} tick={{ fontSize: 11 }} width={44} tickFormatter={(v: number) => `$${v.toFixed(0)}`} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v) => [fmtUsd(Number(v)), '30 cm']}
              labelFormatter={(y) => {
                const p = data.find((d) => d.year === Number(y));
                return `${y}${p ? ` · ${p.nParties} event${p.nParties === 1 ? '' : 's'}${p.estimated ? ' · estimated sizes' : ''}` : ''}`;
              }}
            />
            <Line
              type="monotone"
              dataKey="usd30"
              stroke={LINE}
              strokeWidth={2}
              isAnimationActive={false}
              dot={<TrendDot selected={selectedYear} />}
              activeDot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[10px] text-theme-text-faint">Hollow = estimated sizes · faded = early (fewer than {EARLY_BELOW} events)</div>
    </div>
  );
}
