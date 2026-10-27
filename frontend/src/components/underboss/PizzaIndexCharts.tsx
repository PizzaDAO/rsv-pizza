import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import {
  fetchPizzaIndex,
  fetchPizzaIndexLines,
  type PizzaIndexGroup,
  type PizzaIndexLineRow,
} from '../../lib/api';
import { fmtPerCm2 } from '../../lib/pizzaIndexUtils';

/**
 * sfincione-40417: small charts for the internal Index sub-view.
 * (a) USD/cm^2 vs diameter scatter (lines, default policy, priciest 500),
 * (b) median USD/cm^2 by continent. Dark-theme colours throughout.
 */

const GRID = 'rgba(255,255,255,0.12)';
const AXIS = 'rgba(255,255,255,0.6)';
const VERIFIED = '#34d399';
const UNVERIFIED = '#60a5fa';
const BAR = '#f87171';
const TOOLTIP_STYLE = { background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, color: '#fff', fontSize: 12 };

interface ScatterPoint { x: number; y: number; name: string; party: string; verified: boolean }

export function PizzaIndexCharts({ verifiedOnly, includeBundles }: { verifiedOnly: boolean; includeBundles: boolean }) {
  const [lines, setLines] = useState<PizzaIndexLineRow[]>([]);
  const [total, setTotal] = useState(0);
  const [continents, setContinents] = useState<PizzaIndexGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchPizzaIndexLines({ verifiedOnly, includeBundles, limit: 500 }),
      fetchPizzaIndex({ level: 'continent', verifiedOnly, includeBundles }),
    ])
      .then(([l, c]) => {
        if (cancelled) return;
        setLines(l.lines);
        setTotal(l.total);
        setContinents(c.groups);
      })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Failed to load charts'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [verifiedOnly, includeBundles]);

  const points = useMemo<ScatterPoint[]>(
    () => lines
      .filter((l) => l.diameterCm && Number.isFinite(l.usdPerCm2))
      .map((l) => ({ x: Math.round(l.diameterCm! * 10) / 10, y: l.usdPerCm2, name: l.rawName, party: l.partyName, verified: l.isVerified })),
    [lines],
  );
  const verifiedPts = useMemo(() => points.filter((p) => p.verified), [points]);
  const otherPts = useMemo(() => points.filter((p) => !p.verified), [points]);
  const bars = useMemo(
    () => continents
      .filter((g) => g.usdPerCm2.median !== null)
      .map((g) => ({ name: g.label, value: g.usdPerCm2.median as number, parties: g.nParties, published: g.published }))
      .sort((a, b) => a.value - b.value),
    [continents],
  );

  if (loading) return <div className="py-6 flex justify-center"><Loader2 className="animate-spin" /></div>;
  if (error) return <div className="text-sm text-red-400">{error}</div>;
  if (points.length === 0 && bars.length === 0) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-theme-stroke bg-white/5 p-3">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 text-sm">
          <h3 className="font-semibold text-theme-text">USD/cm² vs diameter</h3>
          <span className="text-xs text-theme-text-muted">{points.length} of {total} lines (priciest 500 max)</span>
        </div>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: 0 }}>
              <CartesianGrid stroke={GRID} />
              <XAxis type="number" dataKey="x" name="Diameter" unit=" cm" stroke={AXIS} tick={{ fill: AXIS, fontSize: 11 }} domain={['auto', 'auto']} label={{ value: 'diameter (cm)', position: 'insideBottom', offset: -8, fill: AXIS, fontSize: 11 }} />
              <YAxis type="number" dataKey="y" name="USD/cm²" stroke={AXIS} tick={{ fill: AXIS, fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(3)} width={52} />
              <ZAxis range={[28, 28]} />
              <Tooltip
                cursor={{ strokeDasharray: '3 3', stroke: AXIS }}
                contentStyle={TOOLTIP_STYLE}
                itemStyle={{ color: '#fff' }}
                labelStyle={{ color: '#fff' }}
                content={({ active, payload }) => {
                  const p = active && payload?.[0]?.payload as ScatterPoint | undefined;
                  if (!p) return null;
                  return (
                    <div style={TOOLTIP_STYLE} className="px-2 py-1">
                      <div className="font-medium">{p.name}</div>
                      <div style={{ opacity: 0.7 }}>{p.party}</div>
                      <div>{p.x} cm · {fmtPerCm2(p.y)}/cm²{p.verified ? ' · verified' : ''}</div>
                    </div>
                  );
                }}
              />
              <Scatter name="Unverified" data={otherPts} fill={UNVERIFIED} fillOpacity={0.6} />
              <Scatter name="Verified" data={verifiedPts} fill={VERIFIED} fillOpacity={0.8} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 flex gap-4 text-xs text-theme-text-muted">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: VERIFIED }} /> verified</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: UNVERIFIED }} /> unverified</span>
        </div>
      </div>

      <div className="rounded-xl border border-theme-stroke bg-white/5 p-3">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 text-sm">
          <h3 className="font-semibold text-theme-text">Median USD/cm² by continent</h3>
          <span className="text-xs text-theme-text-muted">dimmed = below minimum parties</span>
        </div>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" stroke={AXIS} tick={{ fill: AXIS, fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(3)} />
              <YAxis type="category" dataKey="name" stroke={AXIS} tick={{ fill: AXIS, fontSize: 11 }} width={96} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.08)' }}
                content={({ active, payload }) => {
                  const p = active && payload?.[0]?.payload as { name: string; value: number; parties: number } | undefined;
                  if (!p) return null;
                  return (
                    <div style={TOOLTIP_STYLE} className="px-2 py-1">
                      <div className="font-medium">{p.name}</div>
                      <div>{fmtPerCm2(p.value)}/cm² · {p.parties} events</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {bars.map((b) => <Cell key={b.name} fill={BAR} fillOpacity={b.published ? 0.9 : 0.35} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
