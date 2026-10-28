import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, ChevronLeft, Package } from 'lucide-react';
import {
  fetchPizzaIndex,
  fetchPizzaIndexLines,
  fetchPublicPizzaIndex,
  type PizzaIndexGroup,
  type PizzaIndexLevel,
  type PizzaIndexLineRow,
  type PizzaIndexResponse,
  type PizzaIndexParams,
} from '../../lib/api';
import { Checkbox } from '../Checkbox';
import { PizzaIndexCharts } from './PizzaIndexCharts';
import { ReceiptLightbox } from '../payments-shared/ReceiptLightbox';
import { LADDER_SIZES, downloadCsv, fmtLocalPerCm2, fmtPerCm2, fmtUsd } from '../../lib/pizzaIndexUtils';

/**
 * sfincione-40417 Phase 2: internal Index sub-view. Raw USD/cm^2 (median + IQR),
 * local/cm^2, the 25/30/35/40 cm price ladder, n, % verified. Unpublished groups
 * (fewer than minParties) are shown dimmed. Click a row to drill down to lines;
 * click a line to open its receipt in the lightbox.
 */

const LEVELS: Array<{ id: PizzaIndexLevel; label: string }> = [
  { id: 'global', label: 'Global' },
  { id: 'continent', label: 'Continent' },
  { id: 'country', label: 'Country' },
  { id: 'city', label: 'City' },
  { id: 'merchant', label: 'Pizzeria' },
];

function drillFilters(g: PizzaIndexGroup): PizzaIndexParams {
  switch (g.level) {
    case 'continent': return { continent: g.label };
    case 'country': return { country: g.label };
    case 'city': return { city: g.city ?? g.label, ...(g.country ? { country: g.country } : {}) };
    case 'merchant': return { merchantKey: g.key };
    default: return {};
  }
}

export function PizzaIndexView() {
  const [level, setLevel] = useState<PizzaIndexLevel>('country');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [includeBundles, setIncludeBundles] = useState(false);
  const [sortBy, setSortBy] = useState<'parties' | 'cheapest'>('parties');
  // Each year is its own index. Default to the latest year so the overall figure never mixes years;
  // 0 = all years (mixed, explicit opt-in). null = still resolving the latest year.
  const [year, setYear] = useState<number | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [data, setData] = useState<PizzaIndexResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drill, setDrill] = useState<PizzaIndexGroup | null>(null);
  const [drillLines, setDrillLines] = useState<PizzaIndexLineRow[]>([]);
  const [drillTotal, setDrillTotal] = useState(0);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  const [lightbox, setLightbox] = useState<{ url: string; fileName: string; mimeType: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPublicPizzaIndex()
      .then((d) => { if (!cancelled) { setYears(d.years); setYear((y) => y ?? d.year); } })
      .catch(() => { if (!cancelled) setYear((y) => y ?? 0); });
    return () => { cancelled = true; };
  }, []);

  const yearFilter = year ? year : undefined;

  const load = useCallback(async () => {
    if (year === null) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchPizzaIndex({ level, verifiedOnly, includeBundles, sort: sortBy, year: yearFilter }));
    } catch (e: any) {
      setError(e?.message || 'Failed to load index');
    } finally {
      setLoading(false);
    }
  }, [level, verifiedOnly, includeBundles, sortBy, year, yearFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => data?.groups ?? [], [data]);

  const openDrill = async (g: PizzaIndexGroup) => {
    if (g.level === 'global') return;
    setDrill(g);
    setDrillLines([]);
    setDrillTotal(0);
    setDrillError(null);
    setDrillLoading(true);
    try {
      const res = await fetchPizzaIndexLines({ ...drillFilters(g), verifiedOnly, includeBundles, year: yearFilter, limit: 300 });
      setDrillLines(res.lines);
      setDrillTotal(res.total);
    } catch (e: any) {
      setDrillError(e?.message || 'Failed to load lines');
    } finally {
      setDrillLoading(false);
    }
  };

  const openReceipt = (url: string | null, mimeType: string | null, label: string) => {
    if (!url) { setError('This receipt has no image on file.'); return; }
    setLightbox({ url, fileName: label, mimeType: mimeType ?? 'image/jpeg' });
  };

  const exportGroups = () => {
    const head = [
      'level', 'label', 'country', 'published', 'n_parties', 'n_lines', 'n_pizzas', 'pct_verified',
      'usd_per_cm2_median', 'usd_per_cm2_p25', 'usd_per_cm2_p75', 'local_currency', 'local_per_cm2',
      ...LADDER_SIZES.map((s) => `usd_${s}cm`), ...LADDER_SIZES.map((s) => `local_${s}cm`),
    ];
    downloadCsv(`pizza-index-${level}.csv`, [
      head,
      ...groups.map((g) => [
        g.level, g.label, g.country, g.published, g.nParties, g.nLines, g.nPizzas, Math.round(g.pctVerified * 100),
        g.usdPerCm2.median, g.usdPerCm2.p25, g.usdPerCm2.p75, g.localCurrency, g.localPerCm2,
        ...LADDER_SIZES.map((s) => g.ladderUsd[s]), ...LADDER_SIZES.map((s) => g.ladderLocal[s]),
      ]),
    ]);
  };

  const exportBundles = () => {
    downloadCsv('pizza-bundles.csv', [
      ['party', 'country', 'city', 'merchant', 'name', 'qty', 'currency', 'unit_price_list', 'total_usd', 'per_pizza_usd', 'size_known', 'usd_per_cm2', 'verified', 'year'],
      ...(data?.bundles ?? []).map((b) => [b.partyName, b.country, b.city, b.merchant, b.rawName, b.qty, b.currency, b.unitPriceList, b.totalUsd, b.perPizzaUsd, b.sizeKnown, b.usdPerCm2, b.verified, b.eventYear]),
    ]);
  };

  const exportDrill = () => {
    if (!drill) return;
    downloadCsv(`pizza-lines-${drill.label}.csv`, [
      ['party', 'country', 'city', 'merchant', 'name', 'qty', 'currency', 'unit_price_list', 'size_label', 'diameter_cm', 'area_cm2', 'usd_per_cm2', 'local_per_cm2', 'source', 'confidence', 'verified', 'outlier', 'year'],
      ...drillLines.map((l) => [l.partyName, l.country, l.city, l.merchant, l.rawName, l.qty, l.currency, l.unitPriceList, l.sizeLabel, l.diameterCm, l.areaCm2, l.usdPerCm2, l.localPerCm2, l.sizeSource, l.sizeConfidence, l.isVerified, l.outlierFlag, l.eventYear]),
    ]);
  };

  const th = 'px-2 py-2 text-left text-xs font-medium text-theme-text-muted whitespace-nowrap';
  const td = 'px-2 py-2 text-sm whitespace-nowrap';

  // ---------------- drill-down view ----------------
  if (drill) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setDrill(null)} className="flex items-center gap-1 text-sm text-theme-text-muted hover:text-theme-text">
            <ChevronLeft size={16} /> Back to {level}
          </button>
          <h3 className="font-semibold text-theme-text">{drill.label}</h3>
          <span className="text-xs text-theme-text-muted">{drillTotal} lines (showing {drillLines.length}, priciest first)</span>
          <button type="button" onClick={exportDrill} className="ml-auto flex items-center gap-1 text-sm text-red-500/80 hover:text-red-500">
            <Download size={14} /> CSV
          </button>
        </div>
        {drillError && <div className="text-sm text-red-400">{drillError}</div>}
        {drillLoading ? (
          <div className="py-10 flex justify-center"><Loader2 className="animate-spin" /></div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-theme-stroke">
            <table className="w-full">
              <thead className="bg-white/5">
                <tr>
                  <th className={th}>Line</th><th className={th}>Pizzeria</th><th className={th}>Event</th>
                  <th className={th}>Qty</th><th className={th}>Price</th><th className={th}>Size</th>
                  <th className={th}>USD/cm²</th>
                  {LADDER_SIZES.map((s) => <th key={s} className={th}>{s} cm</th>)}
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {drillLines.map((l) => (
                  <tr key={l.lineId} onClick={() => openReceipt(l.documentUrl, l.documentMimeType, l.rawName)} className="border-t border-theme-stroke hover:bg-white/5 cursor-pointer">
                    <td className={`${td} max-w-[220px] truncate`} title={l.rawName}>{l.rawName}</td>
                    <td className={`${td} max-w-[140px] truncate`}>{l.merchant ?? '-'}</td>
                    <td className={`${td} max-w-[160px] truncate`}>{l.partyName}</td>
                    <td className={td}>{l.qty}</td>
                    <td className={td}>{l.unitPriceList} {l.currency}</td>
                    <td className={td}>{l.diameterCm ? `${Math.round(l.diameterCm)} cm` : `${Math.round(l.areaCm2)} cm²`}</td>
                    <td className={td}>{fmtPerCm2(l.usdPerCm2)}</td>
                    {LADDER_SIZES.map((s) => <td key={s} className={td}>{fmtUsd(l.sizeLadderUsd?.[s])}</td>)}
                    <td className={td}>
                      {l.isVerified ? <span className="text-emerald-400">verified</span> : <span className="text-theme-text-muted">{l.sizeSource ?? '?'} {l.sizeConfidence !== null ? `${Math.round(l.sizeConfidence * 100)}%` : ''}</span>}
                      {l.outlierFlag && <span className="ml-1 text-yellow-400">outlier</span>}
                    </td>
                  </tr>
                ))}
                {drillLines.length === 0 && (
                  <tr><td colSpan={12} className="px-3 py-6 text-center text-sm text-theme-text-muted">No lines.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <ReceiptLightbox
          isOpen={!!lightbox}
          images={lightbox ? [lightbox] : []}
          onClose={() => setLightbox(null)}
        />
      </div>
    );
  }

  // ---------------- group table ----------------
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-theme-stroke p-0.5">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLevel(l.id)}
              className={`px-3 py-1 text-sm rounded-md ${level === l.id ? 'bg-red-500 text-white' : 'text-theme-text-muted hover:text-theme-text'}`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <Checkbox checked={verifiedOnly} onChange={() => setVerifiedOnly((v) => !v)} label="Verified only" />
        <Checkbox checked={includeBundles} onChange={() => setIncludeBundles((v) => !v)} label="Include bundles" />
        <select value={year ?? ''} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" className="text-sm">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
          <option value={0}>All years (mixed)</option>
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'parties' | 'cheapest')} aria-label="Sort" className="text-sm">
          <option value="parties">Sort: most parties</option>
          <option value="cheapest">Sort: cheapest first</option>
        </select>
        <button type="button" onClick={exportGroups} disabled={!groups.length} className="ml-auto flex items-center gap-1 text-sm text-red-500/80 hover:text-red-500 disabled:opacity-40">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {data && (
        <p className="text-xs text-theme-text-muted">
          {data.meta.rowsUsed} of {data.meta.rowsInView} lines used · {data.meta.excludedUnverifiedOutliers} unverified outliers and {data.meta.excludedLowConfidence} low-confidence lines left out. Groups with too few parties are dimmed ("n&lt;min"). Menu (list) prices; one vote per event.
        </p>
      )}
      {error && <div className="text-sm text-red-400">{error}</div>}

      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-theme-stroke">
          <table className="w-full">
            <thead className="bg-white/5">
              <tr>
                <th className={th}>{LEVELS.find((l) => l.id === level)?.label}</th>
                <th className={th}>Parties</th><th className={th}>Lines</th><th className={th}>Pizzas</th><th className={th}>% verified</th>
                <th className={th}>USD/cm² (median, IQR)</th>
                <th className={th}>Local/cm²</th>
                {LADDER_SIZES.map((s) => <th key={s} className={th}>{s} cm</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr
                  key={g.key}
                  onClick={() => openDrill(g)}
                  className={`border-t border-theme-stroke hover:bg-white/5 ${g.level !== 'global' ? 'cursor-pointer' : ''} ${g.published ? '' : 'opacity-45'}`}
                >
                  <td className={`${td} font-medium max-w-[220px] truncate`}>
                    {g.label}
                    {g.country && g.level !== 'country' && <span className="text-theme-text-muted font-normal"> · {g.country}</span>}
                    {!g.published && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-white/10">n&lt;{g.minParties}</span>}
                  </td>
                  <td className={td}>{g.nParties}</td>
                  <td className={td}>{g.nLines}</td>
                  <td className={td}>{g.nPizzas}</td>
                  <td className={td}>{Math.round(g.pctVerified * 100)}%</td>
                  <td className={td}>
                    {fmtPerCm2(g.usdPerCm2.median)}
                    <span className="text-theme-text-muted text-xs"> ({fmtPerCm2(g.usdPerCm2.p25)}-{fmtPerCm2(g.usdPerCm2.p75)})</span>
                  </td>
                  <td className={td}>{fmtLocalPerCm2(g.localPerCm2, g.localCurrency)}</td>
                  {LADDER_SIZES.map((s) => <td key={s} className={td}>{fmtUsd(g.ladderUsd[s])}</td>)}
                </tr>
              ))}
              {groups.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-8 text-center text-sm text-theme-text-muted">
                  No eligible lines yet. Run sync and the size passes (Ops), then verify sizes in Review.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <PizzaIndexCharts verifiedOnly={verifiedOnly} includeBundles={includeBundles} year={yearFilter} />

      {/* Bundles & deals (decision 12.4) */}
      {data && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-orange-400" />
            <h3 className="font-semibold text-theme-text">Bundles &amp; deals</h3>
            <span className="text-xs text-theme-text-muted">{data.bundles.length} lines, excluded from medians unless "Include bundles" is on</span>
            <button type="button" onClick={exportBundles} disabled={!data.bundles.length} className="ml-auto flex items-center gap-1 text-sm text-red-500/80 hover:text-red-500 disabled:opacity-40">
              <Download size={14} /> CSV
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-theme-stroke max-h-[420px]">
            <table className="w-full">
              <thead className="bg-white/5 sticky top-0">
                <tr>
                  <th className={th}>Deal</th><th className={th}>Pizzeria</th><th className={th}>Event</th><th className={th}>Country</th>
                  <th className={th}>Qty</th><th className={th}>Total (USD)</th><th className={th}>Per pizza (USD)</th><th className={th}>USD/cm²</th>
                </tr>
              </thead>
              <tbody>
                {data.bundles.map((b) => (
                  <tr key={b.lineId} onClick={() => openReceipt(b.documentUrl, b.documentMimeType, b.rawName)} className="border-t border-theme-stroke hover:bg-white/5 cursor-pointer">
                    <td className={`${td} max-w-[240px] truncate`} title={b.rawName}>{b.rawName}</td>
                    <td className={`${td} max-w-[140px] truncate`}>{b.merchant ?? '-'}</td>
                    <td className={`${td} max-w-[160px] truncate`}>{b.partyName}</td>
                    <td className={td}>{b.country ?? '-'}</td>
                    <td className={td}>{b.qty}</td>
                    <td className={td}>{fmtUsd(b.totalUsd)}</td>
                    <td className={td}>{fmtUsd(b.perPizzaUsd)}</td>
                    <td className={td}>{b.sizeKnown ? fmtPerCm2(b.usdPerCm2) : <span className="text-theme-text-muted">size unknown</span>}</td>
                  </tr>
                ))}
                {data.bundles.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-theme-text-muted">No bundles flagged yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ReceiptLightbox
        isOpen={!!lightbox}
        images={lightbox ? [lightbox] : []}
        onClose={() => setLightbox(null)}
      />
    </div>
  );
}
