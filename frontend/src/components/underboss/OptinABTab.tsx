import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { fetchOptinABResults, fetchExperimentFlags, setExperimentFlag } from '../../lib/api';
import type { OptinABResults, OptinABRegion, OptinABArm, ExperimentFlag } from '../../lib/api';
import { Checkbox } from '../Checkbox';
import { REGIONAL_OPTIN_AB } from '../../lib/optinAbRegions';
import type { RegionalOptinAbConfig } from '../../lib/optinAbRegions';

const N_10PP = 330;
const N_5PP = 1400;

function zScore(p1: number, n1: number, p2: number, n2: number): number {
  if (!n1 || !n2) return 0;
  const pPool = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (!se) return 0;
  return (p1 - p2) / se;
}

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

function computeSigLine(control: OptinABArm | undefined, variant: OptinABArm | undefined): string {
  if (!control || !variant || !control.n || !variant.n) return 'Insufficient data';
  const pC = control.pizzadaoOptins / control.n;
  const pV = variant.pizzadaoOptins / variant.n;
  const z = zScore(pC, control.n, pV, variant.n);
  const p = pValueFromZ(z);
  const deltaPp = (pV - pC) * 100;
  const sign = deltaPp >= 0 ? '+' : '';
  return `Variant vs. Control (PizzaDAO opt-in): ${sign}${deltaPp.toFixed(2)} pp, p = ${p.toFixed(4)} (${sigLabel(p)})`;
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

function RegionAnalyticsPanel({ region }: { region: OptinABRegion }) {
  const control = region.arms.find((a) => a.arm === 'control');
  const variant = region.arms.find((a) => a.arm === 'variant');
  const sigLine = computeSigLine(control, variant);

  return (
    <div className="card p-6">
      <h4 className="text-base font-semibold text-theme-text mb-1">
        {region.label} <span className="text-xs text-theme-text-muted font-normal">({region.tag})</span>
      </h4>
      <p className="text-xs text-theme-text-muted mb-4">
        {region.tag}-tagged events, real RSVP submissions only
      </p>

      {control && variant && (
        <div className="space-y-6">
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

function RegionToggleRow({
  region,
  flag,
  flagLoading,
  flipping,
  onRequestFlip,
}: {
  region: RegionalOptinAbConfig;
  flag: ExperimentFlag | null;
  flagLoading: boolean;
  flipping: boolean;
  onRequestFlip: (nextEnabled: boolean) => void;
}) {
  return (
    <div className="p-4 border border-theme-stroke rounded-xl bg-theme-surface">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-theme-text">
            {region.label} <span className="text-xs text-theme-text-muted font-normal">({region.tag})</span>
          </div>
          <div className="text-xs text-theme-text-muted mt-1">
            {flagLoading ? 'Loading…' : flag?.description ?? 'Flag not found'}
          </div>
          {flag && (
            <div className="text-[11px] text-theme-text-faint mt-2">
              Last changed {new Date(flag.updatedAt).toLocaleString()}
              {flag.updatedBy ? ` by ${flag.updatedBy}` : ''}
            </div>
          )}
        </div>
        <Checkbox
          checked={!!flag?.enabled}
          onChange={() => {
            if (!flag || flagLoading || flipping) return;
            onRequestFlip(!flag.enabled);
          }}
          label={flag?.enabled ? 'ON' : 'OFF'}
          labelClassName={`text-sm font-semibold ${flag?.enabled ? 'text-[#E52828]' : 'text-theme-text-muted'}`}
          disabled={!flag || flagLoading || flipping}
        />
      </div>
    </div>
  );
}

export function OptinABTab() {
  const [data, setData] = useState<OptinABResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flagsByKey, setFlagsByKey] = useState<Map<string, ExperimentFlag>>(new Map());
  const [flagsLoading, setFlagsLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState<null | {
    region: RegionalOptinAbConfig;
    nextEnabled: boolean;
  }>(null);
  const [flipping, setFlipping] = useState(false);

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

  async function loadFlags() {
    setFlagsLoading(true);
    const flags = await fetchExperimentFlags();
    const map = new Map<string, ExperimentFlag>();
    if (flags) {
      for (const f of flags) map.set(f.key, f);
    }
    setFlagsByKey(map);
    setFlagsLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void loadFlags();
  }, []);

  const regionsByTag = new Map<string, OptinABRegion>();
  if (data) {
    for (const r of data.regions) regionsByTag.set(r.tag, r);
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-start justify-between mb-1 gap-3">
          <div>
            <h3 className="text-lg font-semibold text-theme-text">
              PizzaDAO + Partners Opt-in A/B — Experiment kill switches
            </h3>
            <p className="text-xs text-theme-text-muted mt-1">
              One toggle per SWC region. Variant arm starts receiving traffic when ON.
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

        <div className="mt-6 space-y-3">
          {REGIONAL_OPTIN_AB.map((region) => (
            <RegionToggleRow
              key={region.flagKey}
              region={region}
              flag={flagsByKey.get(region.flagKey) ?? null}
              flagLoading={flagsLoading}
              flipping={flipping}
              onRequestFlip={(nextEnabled) => setShowConfirm({ region, nextEnabled })}
            />
          ))}
        </div>
      </div>

      {showConfirm && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !flipping && setShowConfirm(null)}
        >
          <div className="card p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-theme-text mb-2">
              Turn {showConfirm.region.label} ({showConfirm.region.tag}) experiment{' '}
              {showConfirm.nextEnabled ? 'ON' : 'OFF'}?
            </h3>
            <p className="text-sm text-theme-text-secondary mb-4">
              {showConfirm.nextEnabled
                ? `Variant arm will start receiving traffic on ${showConfirm.region.label} (${showConfirm.region.tag}) RSVPs. ~50% of new RSVPs on ${showConfirm.region.tag}-tagged events will see the combined PizzaDAO + partners checkbox.`
                : `All ${showConfirm.region.label} (${showConfirm.region.tag}) RSVPs revert to the two-checkbox baseline. Existing variant-bucketed guests keep their assignment for edit-RSVP and analytics.`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConfirm(null)}
                disabled={flipping}
                className="px-4 py-2 text-sm text-theme-text-secondary hover:bg-white/40 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setFlipping(true);
                  const updated = await setExperimentFlag(
                    showConfirm.region.flagKey,
                    showConfirm.nextEnabled,
                  );
                  if (updated) {
                    setFlagsByKey((prev) => {
                      const next = new Map(prev);
                      next.set(updated.key, updated);
                      return next;
                    });
                  }
                  setFlipping(false);
                  setShowConfirm(null);
                }}
                disabled={flipping}
                className="px-4 py-2 text-sm font-medium bg-[#E52828] text-white rounded-lg hover:bg-[#CC2020] disabled:opacity-50"
              >
                {flipping ? 'Saving…' : `Turn ${showConfirm.nextEnabled ? 'ON' : 'OFF'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="card p-6 flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
        </div>
      )}

      {error && !loading && (
        <div className="card p-6">
          <p className="text-theme-text-muted text-center py-4">{error}</p>
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {REGIONAL_OPTIN_AB.map((region) => {
            const regionData =
              regionsByTag.get(region.tag) ??
              ({
                tag: region.tag,
                label: region.label,
                arms: [
                  { arm: 'control', n: 0, pizzadaoOptins: 0, pizzadaoOptinPct: 0, swcOptins: 0, swcOptinPct: 0 },
                  { arm: 'variant', n: 0, pizzadaoOptins: 0, pizzadaoOptinPct: 0, swcOptins: 0, swcOptinPct: 0 },
                ],
              } as OptinABRegion);
            return <RegionAnalyticsPanel key={region.tag} region={regionData} />;
          })}
        </div>
      )}
    </div>
  );
}
