import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { fetchOptinABResults } from '../../lib/api';
import type { OptinABResults, OptinABArm } from '../../lib/api';

// MDE sample-size targets (per arm).
const N_10PP = 330;
const N_5PP = 1400;

// Two-proportion z-test (two-sided). Ported verbatim from
// scripts/check-optin-ab-results.js on the parmesan-98989 branch so CLI
// and UI cannot disagree.
function zScore(p1: number, n1: number, p2: number, n2: number): number {
  if (!n1 || !n2) return 0;
  const pPool = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (!se) return 0;
  return (p1 - p2) / se;
}

// Two-sided p-value via Abramowitz & Stegun 7.1.26 erf approximation.
function pValueFromZ(z: number): number {
  const abs = Math.abs(z);
  const t = 1 / (1 + 0.3275911 * (abs / Math.SQRT2));
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-((abs / Math.SQRT2) ** 2));
  const oneSided = 1 - 0.5 * (1 + erf);
  return 2 * oneSided;
}

function sigLabel(p: number): '***' | '**' | '*' | 'n.s.' {
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return 'n.s.';
}

function ArmBlock({ arm }: { arm: OptinABArm }) {
  const title = arm.arm === 'control' ? 'Control' : 'Variant';
  return (
    <div className="bg-theme-surface border border-theme-stroke rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h4 className="text-base font-semibold text-theme-text">{title}</h4>
        <span className="text-xs text-theme-text-muted">N = {arm.n.toLocaleString()}</span>
      </div>
      <div className="space-y-1 text-sm text-theme-text-secondary">
        <div>
          PizzaDAO opt-in:{' '}
          <span className="text-theme-text font-medium">
            {arm.pizzadaoOptins.toLocaleString()} ({arm.pizzadaoOptinPct}%)
          </span>
        </div>
        <div>
          SWC opt-in:{' '}
          <span className="text-theme-text font-medium">
            {arm.swcOptins.toLocaleString()} ({arm.swcOptinPct}%)
          </span>
        </div>
      </div>
    </div>
  );
}

function SampleSizeBar({ arm }: { arm: OptinABArm }) {
  const title = arm.arm === 'control' ? 'Control' : 'Variant';
  const pct = Math.min(arm.n / N_5PP, 1) * 100;
  const tickPct10 = (N_10PP / N_5PP) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1 text-xs text-theme-text-muted">
        <span>{title}</span>
        <span>
          {arm.n.toLocaleString()} / {N_5PP.toLocaleString()}
        </span>
      </div>
      <div className="relative h-3 bg-white/30 border border-theme-stroke rounded-full overflow-hidden">
        <div
          className="h-full bg-[#E52828] transition-all"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-0 bottom-0 border-l border-theme-text-muted/60"
          style={{ left: `${tickPct10}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-theme-text-faint mt-1">
        <span>0</span>
        <span style={{ marginLeft: `${tickPct10 - 6}%` }}>10pp MDE: {N_10PP}</span>
        <span>5pp MDE: {N_5PP.toLocaleString()}</span>
      </div>
    </div>
  );
}

export function OptinABTab() {
  const [data, setData] = useState<OptinABResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const result = await fetchOptinABResults();
    if (!result) {
      setError('Failed to load opt-in A/B results');
      setData(null);
    } else {
      setData(result);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const control = data?.arms.find((a) => a.arm === 'control');
  const variant = data?.arms.find((a) => a.arm === 'variant');

  let sigLine: string;
  if (!control || !variant || !control.n || !variant.n) {
    sigLine = 'Insufficient data';
  } else {
    const pC = control.pizzadaoOptins / control.n;
    const pV = variant.pizzadaoOptins / variant.n;
    const z = zScore(pC, control.n, pV, variant.n);
    const p = pValueFromZ(z);
    const deltaPp = (pV - pC) * 100;
    const sign = deltaPp >= 0 ? '+' : '';
    sigLine = `Variant vs. Control (PizzaDAO opt-in): ${sign}${deltaPp.toFixed(2)} pp, p = ${p.toFixed(4)} (${sigLabel(p)})`;
  }

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between mb-1 gap-3">
        <div>
          <h3 className="text-lg font-semibold text-theme-text">
            PizzaDAO + Partners Opt-in A/B (parmesan-98989)
          </h3>
          <p className="text-xs text-theme-text-muted mt-1">
            swc-tagged events, real RSVP submissions only
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/60 hover:bg-white/80 border border-theme-stroke text-sm text-theme-text-secondary disabled:opacity-50 transition-colors"
          title="Refresh"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      {loading && !data && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
        </div>
      )}

      {error && !loading && (
        <p className="text-theme-text-muted text-center py-8">{error}</p>
      )}

      {data && control && variant && (
        <div className="mt-4 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ArmBlock arm={control} />
            <ArmBlock arm={variant} />
          </div>

          <div className="text-sm text-theme-text-secondary border-t border-theme-stroke pt-4">
            {sigLine}
          </div>

          <div className="space-y-4">
            <SampleSizeBar arm={control} />
            <SampleSizeBar arm={variant} />
          </div>
        </div>
      )}
    </div>
  );
}
