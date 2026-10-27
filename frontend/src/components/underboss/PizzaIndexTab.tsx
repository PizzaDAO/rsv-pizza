import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Loader2, Package, Search, Store, Globe } from 'lucide-react';
import {
  fetchPizzaQueue,
  type PizzaLineDto,
  type PizzaQueueParams,
  type PizzaQueueResponse,
} from '../../lib/api';
import { ReceiptLightbox, type ReceiptLightboxImage } from '../payments-shared/ReceiptLightbox';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { PizzaSizeEditor } from './PizzaSizeEditor';
import { PizzaIndexView } from './PizzaIndexView';
import { PizzaPresetsView } from './PizzaPresetsView';
import { PizzaOpsView } from './PizzaOpsView';

/**
 * sfincione-40417: Underboss dashboard "Pizza Index" tab. Visible to admins,
 * payment admins and underbosses (decision 12.3); the backend scopes
 * underbosses to their own regions/cities. Ops is full-admin only.
 */

type SubView = 'review' | 'index' | 'presets' | 'ops';
const PAGE_SIZE = 20;

interface Filters {
  status: NonNullable<PizzaQueueParams['status']>;
  country: string;
  merchant: string;
  source: string;
  outlier: boolean;
  excluded: boolean;
  bundles: NonNullable<PizzaQueueParams['bundles']>;
}

const DEFAULT_FILTERS: Filters = {
  status: 'unverified', country: '', merchant: '', source: '', outlier: false, excluded: false, bundles: 'include',
};

function ProgressBar({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex-1 min-w-[220px]">
      <div className="flex justify-between text-xs text-theme-text-muted mb-1">
        <span>{label}</span>
        <span>{done} / {total} ({pct}%)</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ReviewView() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<PizzaQueueResponse | null>(null);
  const [receipts, setReceipts] = useState<PizzaQueueResponse['receipts']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [startIndex, setStartIndex] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);

  const total = data?.total ?? 0;
  const dirtyRef = useRef(false);
  const resetIdxAfterLoad = useRef(false);
  const onDirtyChange = useCallback((d: boolean) => { dirtyRef.current = d; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: PizzaQueueParams = {
        status: applied.status,
        country: applied.country.trim() || undefined,
        merchant: applied.merchant.trim() || undefined,
        source: applied.source || undefined,
        outlier: applied.outlier || undefined,
        excluded: applied.excluded || undefined,
        bundles: applied.bundles,
        limit: PAGE_SIZE,
        offset,
      };
      const res = await fetchPizzaQueue(params);
      setData(res);
      setReceipts(res.receipts);
      if (resetIdxAfterLoad.current) {
        resetIdxAfterLoad.current = false;
        setStartIndex(0);
        setCurrentIdx(0);
        if (res.receipts.length === 0) setLightboxOpen(false);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, [applied, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const images: ReceiptLightboxImage[] = useMemo(
    () => receipts.map((r) => ({
      url: r.document.url,
      fileName: r.document.fileName,
      mimeType: r.document.mimeType,
      caption: `${r.merchant ?? 'Unknown pizzeria'} · ${r.party.name}${r.party.country ? ` · ${r.party.country}` : ''}`,
    })),
    [receipts],
  );

  const onLineUpdated = useCallback((line: PizzaLineDto) => {
    setReceipts((rs) => rs.map((r) => (r.document.id === line.documentId
      ? { ...r, lines: r.lines.map((l) => (l.id === line.id ? line : l)) }
      : r)));
  }, []);

  const goTo = useCallback((i: number) => {
    setStartIndex(i);
    setCurrentIdx(i);
  }, []);

  const confirmDiscard = useCallback((): boolean => {
    return !dirtyRef.current || window.confirm('Discard unsaved changes to this line?');
  }, []);

  // The parent owns the receipt index (the lightbox follows `initialIndex`).
  const nextReceipt = useCallback((force?: boolean) => {
    if (!force && !confirmDiscard()) return;
    if (currentIdx + 1 < receipts.length) {
      goTo(currentIdx + 1);
      return;
    }
    // End of the page: reload the unverified queue, or move to the next page.
    resetIdxAfterLoad.current = true;
    if (applied.status === 'unverified') {
      if (offset !== 0) setOffset(0);
      else void load();
    } else if (offset + PAGE_SIZE < total) {
      setOffset(offset + PAGE_SIZE);
    } else {
      resetIdxAfterLoad.current = false;
      setLightboxOpen(false);
    }
  }, [confirmDiscard, currentIdx, receipts.length, goTo, applied.status, offset, total, load]);

  const onBeforeNavigate = useCallback(() => confirmDiscard(), [confirmDiscard]);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    dirtyRef.current = false;
    if (offset !== 0) setOffset(0);
    else void load();
  }, [load, offset]);

  // Pull sibling lines updated by "apply to this pizzeria" without disturbing the list.
  const refreshMerchant = useCallback(async () => {
    const m = receipts[currentIdx]?.merchant;
    if (!m) return;
    try {
      const res = await fetchPizzaQueue({ status: 'all', merchant: m, limit: 100 });
      const byDoc = new Map(res.receipts.map((r) => [r.document.id, r]));
      setReceipts((rs) => rs.map((r) => {
        const f = byDoc.get(r.document.id);
        return f ? { ...r, lines: f.lines } : r;
      }));
    } catch {
      /* non-fatal: list refreshes on close */
    }
  }, [receipts, currentIdx]);

  const current = receipts[currentIdx];
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const applyFilters = () => {
    setOffset(0);
    setApplied(filters);
  };


  return (
    <div className="space-y-4">
      {/* Progress */}
      {data && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-4">
            <ProgressBar label="Verified lines" done={data.progress.verifiedLines} total={data.progress.totalLines} />
            <ProgressBar label="Verified pizzas" done={Math.round(data.progress.verifiedPizzas)} total={Math.round(data.progress.totalPizzas)} />
          </div>
          <div className="text-xs text-theme-text-muted">
            {data.progress.unresolvedLines} lines without a size · {data.progress.outlierLines} unverified outliers · {data.progress.bundleLines} bundle lines
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={filters.status} onChange={(e) => set({ status: e.target.value as Filters['status'] })} aria-label="Status" className="text-sm">
          <option value="unverified">Unverified</option>
          <option value="verified">Verified</option>
          <option value="all">All</option>
        </select>
        <select value={filters.source} onChange={(e) => set({ source: e.target.value })} aria-label="Size source" className="text-sm">
          <option value="">Any source</option>
          <option value="none">No size yet</option>
          <option value="parsed">Parsed</option>
          <option value="preset">Preset</option>
          <option value="llm">LLM</option>
          <option value="web">Web</option>
          <option value="manual">Manual</option>
        </select>
        <select value={filters.bundles} onChange={(e) => set({ bundles: e.target.value as Filters['bundles'] })} aria-label="Bundles" className="text-sm">
          <option value="include">Bundles: include</option>
          <option value="exclude">Bundles: hide</option>
          <option value="only">Bundles: only</option>
        </select>
        <div className="w-44"><IconInput icon={Globe} placeholder="Country" value={filters.country} onChange={(e) => set({ country: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && applyFilters()} /></div>
        <div className="w-44"><IconInput icon={Store} placeholder="Pizzeria" value={filters.merchant} onChange={(e) => set({ merchant: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && applyFilters()} /></div>
        <Checkbox checked={filters.outlier} onChange={() => set({ outlier: !filters.outlier })} label="Outliers only" />
        <Checkbox checked={filters.excluded} onChange={() => set({ excluded: !filters.excluded })} label="Show excluded" />
        <button type="button" onClick={applyFilters} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm">
          <Search size={14} /> Apply
        </button>
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}

      {/* Queue */}
      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin" /></div>
      ) : receipts.length === 0 ? (
        <div className="py-10 text-center text-sm text-theme-text-muted">
          Nothing to review with these filters. If this is a fresh install, an admin needs to run sync and the size passes first (Ops).
        </div>
      ) : (
        <div className="space-y-2">
          {receipts.map((r, i) => {
            const verified = r.lines.filter((l) => l.verifiedAt).length;
            const flagged = r.lines.some((l) => l.outlierFlag && !l.verifiedAt);
            const bundles = r.lines.filter((l) => l.isBundle).length;
            return (
              <button
                key={r.document.id}
                type="button"
                onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); goTo(i); setLightboxOpen(true); }}
                className="w-full text-left rounded-xl border border-theme-stroke bg-white/5 hover:bg-white/10 p-3 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-theme-text truncate">{r.merchant ?? 'Unknown pizzeria'}</div>
                    <div className="text-xs text-theme-text-muted truncate">
                      {r.party.name}{r.party.city ? ` · ${r.party.city}` : ''}{r.party.country ? `, ${r.party.country}` : ''}
                      {r.party.date ? ` · ${new Date(r.party.date).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs flex-shrink-0">
                    {flagged && <span className="px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400">outlier</span>}
                    {bundles > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400"><Package size={10} />{bundles}</span>}
                    {r.receiptDiscounts.length > 0 && <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">discount</span>}
                    <span className={verified === r.lines.length ? 'text-emerald-400 inline-flex items-center gap-1' : 'text-theme-text-muted'}>
                      {verified === r.lines.length && <Check size={12} />}{verified}/{r.lines.length} lines
                    </span>
                  </div>
                </div>
                <div className="mt-1.5 text-xs text-theme-text-muted truncate">
                  {r.lines.slice(0, 4).map((l) => l.rawName).join(' · ')}{r.lines.length > 4 ? ' …' : ''}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 text-sm text-theme-text-muted">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="p-1 disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={18} /></button>
          <span>{offset + 1}-{Math.min(offset + PAGE_SIZE, total)} of {total} receipts</span>
          <button type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)} className="p-1 disabled:opacity-30" aria-label="Next page"><ChevronRight size={18} /></button>
        </div>
      )}

      <ReceiptLightbox
        isOpen={lightboxOpen}
        images={images}
        initialIndex={startIndex}
        onClose={closeLightbox}
        onIndexChange={goTo}
        onBeforeNavigate={onBeforeNavigate}
        editorPane={
          lightboxOpen && current ? (
            <PizzaSizeEditor
              key={current.document.id}
              receipt={current}
              onLineUpdated={onLineUpdated}
              onNextReceipt={nextReceipt}
              onDirtyChange={onDirtyChange}
              onMerchantApplied={refreshMerchant}
            />
          ) : null
        }
      />
    </div>
  );
}

export function PizzaIndexTab({ isAdmin }: { isAdmin: boolean }) {
  const [view, setView] = useState<SubView>('review');
  const tabs: Array<{ id: SubView; label: string }> = [
    { id: 'review', label: 'Review' },
    { id: 'index', label: 'Index' },
    { id: 'presets', label: 'Presets' },
    ...(isAdmin ? [{ id: 'ops' as SubView, label: 'Ops' }] : []),
  ];
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-theme-stroke p-0.5 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
            className={`px-4 py-1.5 text-sm rounded-md ${view === t.id ? 'bg-red-500 text-white' : 'text-theme-text-muted hover:text-theme-text'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {view === 'review' && <ReviewView />}
      {view === 'index' && <PizzaIndexView />}
      {view === 'presets' && <PizzaPresetsView isAdmin={isAdmin} />}
      {view === 'ops' && isAdmin && <PizzaOpsView />}
    </div>
  );
}
