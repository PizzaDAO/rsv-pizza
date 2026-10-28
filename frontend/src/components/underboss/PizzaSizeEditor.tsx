import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Ruler, Store, Tag, Ban, Package, AlertTriangle, Hash, DollarSign, Camera, X } from 'lucide-react';
import {
  applyPizzaLineToMerchant,
  patchPizzaLine,
  type PizzaExcludedReason,
  type PizzaLineDto,
  type PizzaLinePatch,
  type PizzaPhotoEstimate,
  type PizzaQueueReceipt,
  type PizzaShape,
} from '../../lib/api';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import {
  IN_TO_CM,
  LADDER_SIZES,
  areaFromDims,
  fmtLocal,
  fmtPerCm2,
  fmtUsd,
  ladderFromPerCm2,
} from '../../lib/pizzaIndexUtils';

/**
 * sfincione-40417: right-hand pane of the ReceiptLightbox for the pizza-size
 * review queue. One receipt at a time; one selected line at a time.
 *
 * Keyboard (when focus is not in a text field, except Enter):
 *   Enter = verify current line and advance, Up/Down = move between lines,
 *   1-6 = 25/30/33/35/40/45 cm, 7-0 = 10/12/14/16 inch, P = use the photo
 *   estimate, N = next receipt
 *   (Left/Right arrows are handled by the lightbox itself).
 */

const QUICK_CM = [20, 25, 30, 33, 35, 40, 45];
// hotkeys: 1-6 = 25..45 cm (20 cm is click-only so existing muscle memory holds)
const CM_HOTKEY: Record<number, string> = { 25: '1', 30: '2', 33: '3', 35: '4', 40: '5', 45: '6' };
const QUICK_IN = [10, 12, 14, 16, 18];
const CM_KEYS = ['1', '2', '3', '4', '5', '6'];
const CM_BY_KEY: Record<string, number> = { '1': 25, '2': 30, '3': 33, '4': 35, '5': 40, '6': 45 };
const IN_KEYS = ['7', '8', '9', '0'];

const EXCLUDE_REASONS: Array<{ value: PizzaExcludedReason; label: string }> = [
  { value: 'not_pizza', label: 'Not a pizza' },
  { value: 'lump_sum', label: 'Lump sum' },
  { value: 'zero_price', label: 'Zero price' },
  { value: 'duplicate_line', label: 'Duplicate line' },
  { value: 'unreadable', label: 'Unreadable' },
  { value: 'other', label: 'Other' },
];

const SOURCE_STYLE: Record<string, string> = {
  parsed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  preset: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  llm: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  web: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  manual: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  none: 'bg-white/10 text-theme-text-muted border-theme-stroke',
};

interface Draft {
  shape: PizzaShape;
  diameter: string;
  length: string;
  width: string;
  fraction: string;
  sizeLabel: string;
  qty: string;
  price: string;
  excluded: boolean;
  excludedReason: PizzaExcludedReason;
  isBundle: boolean;
}

const numStr = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(Math.round(v * 100) / 100));
const toNum = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function draftFromLine(l: PizzaLineDto): Draft {
  return {
    shape: l.shape === 'rect' || l.shape === 'slice' ? l.shape : 'round',
    diameter: numStr(l.diameterCm),
    length: numStr(l.lengthCm),
    width: numStr(l.widthCm),
    fraction: numStr(l.sliceFraction),
    sizeLabel: l.sizeLabel ?? '',
    qty: String(l.qty),
    price: String(l.unitPriceList),
    excluded: l.excluded,
    excludedReason: l.excludedReason ?? 'not_pizza',
    isBundle: l.isBundle,
  };
}

function draftDims(d: Draft) {
  return {
    shape: d.shape,
    diameterCm: toNum(d.diameter),
    lengthCm: toNum(d.length),
    widthCm: toNum(d.width),
    sliceFraction: toNum(d.fraction),
  };
}

function fmtEstimate(e: PizzaPhotoEstimate): string {
  return e.shape === 'rect' ? `${Math.round(e.lengthCm ?? 0)}×${Math.round(e.widthCm ?? 0)} cm` : `${Math.round(e.diameterCm ?? 0)} cm`;
}

/** A suggestion worth showing: unverified line that still has no size. */
const openEstimate = (l: PizzaLineDto | undefined): PizzaPhotoEstimate | null =>
  l && !l.verifiedAt && l.areaCm2 === null ? l.photoEstimate ?? null : null;

function SourceBadge({ line }: { line: PizzaLineDto }) {
  const src = line.sizeSource ?? 'none';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide ${SOURCE_STYLE[src] ?? SOURCE_STYLE.none}`}>
      {src}
      {line.sizeConfidence !== null && <span className="opacity-70">{Math.round(line.sizeConfidence * 100)}%</span>}
    </span>
  );
}

interface PizzaSizeEditorProps {
  receipt: PizzaQueueReceipt;
  onLineUpdated: (line: PizzaLineDto) => void;
  /** `force` skips the unsaved-changes prompt (used right after a successful save). */
  onNextReceipt: (force?: boolean) => void;
  /** Reports whether the selected line has unsaved edits. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Called after apply-to-merchant so the parent can refresh the queue on close. */
  onMerchantApplied?: () => void;
}

export function PizzaSizeEditor({ receipt, onLineUpdated, onNextReceipt, onMerchantApplied, onDirtyChange }: PizzaSizeEditorProps) {
  const lines = receipt.lines;
  const firstTodo = Math.max(
    0,
    lines.findIndex((l) => !l.verifiedAt && !l.excluded),
  );
  const [selIdx, setSelIdx] = useState(firstTodo);
  const line: PizzaLineDto | undefined = lines[Math.min(selIdx, lines.length - 1)];
  const [draft, setDraft] = useState<Draft | null>(line ? draftFromLine(line) : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);

  const payoutPhotos = receipt.pizzaPhotoUrls;
  const eventPhotos = receipt.galleryPhotoUrls ?? [];
  const estimate = openEstimate(line);

  // Reset the draft whenever the selected line (or its saved state) changes.
  useEffect(() => {
    setDraft(line ? draftFromLine(line) : null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line?.id, line?.verifiedAt, line?.updatedBy, line?.areaCm2, line?.excluded, line?.isBundle]);

  // Open the photo the estimate was measured from when its line is selected.
  useEffect(() => {
    if (estimate?.photoUrl) setViewPhoto(estimate.photoUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line?.id]);

  const dirty = useMemo(
    () => !!line && !!draft && JSON.stringify(draft) !== JSON.stringify(draftFromLine(line)),
    [line, draft],
  );
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }, []);

  // ---- live preview ------------------------------------------------------
  const preview = useMemo(() => {
    if (!line || !draft) return null;
    const area = areaFromDims(draftDims(draft));
    const price = toNum(draft.price);
    const usd = price !== null ? price * line.fxRate : null;
    const perCm2 = area && usd !== null && usd > 0 ? usd / area : null;
    const localPer = area && price !== null && price > 0 ? price / area : null;
    const net = line.unitPriceNet !== null && area ? (line.unitPriceNet * line.fxRate) / area : null;
    return { area, usd, perCm2, localPer, ladder: ladderFromPerCm2(perCm2), netLadder: ladderFromPerCm2(net) };
  }, [line, draft]);

  const setCm = useCallback((cm: number) => {
    update({ shape: 'round', diameter: numStr(cm), length: '', width: '', fraction: '' });
  }, [update]);

  const applyEstimate = useCallback(() => {
    if (!estimate) return;
    if (estimate.shape === 'rect') {
      update({ shape: 'rect', diameter: '', length: numStr(estimate.lengthCm), width: numStr(estimate.widthCm), fraction: '' });
    } else if (estimate.diameterCm !== null) {
      setCm(estimate.diameterCm);
    }
  }, [estimate, update, setCm]);

  const nextTodoIdx = useCallback((from: number): number => {
    for (let i = from + 1; i < lines.length; i++) if (!lines[i].verifiedAt && !lines[i].excluded) return i;
    // wrap to earlier unverified lines before leaving the receipt
    for (let i = 0; i < from; i++) if (!lines[i].verifiedAt && !lines[i].excluded) return i;
    return -1;
  }, [lines]);

  // ---- save ---------------------------------------------------------------
  const buildPatch = useCallback((): { patch: PizzaLinePatch; needsSize: boolean } | { error: string } => {
    if (!line || !draft) return { error: 'No line' };
    const patch: PizzaLinePatch = { verify: true };
    if (draft.excluded) {
      patch.excluded = true;
      patch.excludedReason = draft.excludedReason;
    } else if (line.excluded) {
      patch.excluded = false;
    }
    if (draft.isBundle !== line.isBundle) patch.isBundle = draft.isBundle;

    const qty = toNum(draft.qty);
    if (qty !== null && qty !== line.qty) patch.qty = qty;
    const price = toNum(draft.price);
    if (price !== null && price !== line.unitPriceList) patch.unitPriceList = price;

    const dims = draftDims(draft);
    const cur = draftFromLine(line);
    const curDims = draftDims(cur);
    const sizeChanged =
      dims.shape !== curDims.shape ||
      dims.diameterCm !== curDims.diameterCm ||
      dims.lengthCm !== curDims.lengthCm ||
      dims.widthCm !== curDims.widthCm ||
      dims.sliceFraction !== curDims.sliceFraction ||
      line.areaCm2 === null;
    const label = draft.sizeLabel.trim() || null;
    if (label !== (line.sizeLabel ?? null)) patch.sizeLabel = label;

    const area = areaFromDims(dims);
    if (!draft.excluded && !draft.isBundle) {
      if (!area) return { error: 'Enter a size first (or exclude the line / mark it as a bundle).' };
      if (sizeChanged) {
        patch.shape = dims.shape;
        patch.diameterCm = dims.diameterCm;
        patch.lengthCm = dims.lengthCm;
        patch.widthCm = dims.widthCm;
        patch.sliceFraction = dims.sliceFraction;
      }
    } else if (area && sizeChanged) {
      patch.shape = dims.shape;
      patch.diameterCm = dims.diameterCm;
      patch.lengthCm = dims.lengthCm;
      patch.widthCm = dims.widthCm;
      patch.sliceFraction = dims.sliceFraction;
    }
    return { patch, needsSize: !draft.excluded && !draft.isBundle };
  }, [line, draft]);

  const save = useCallback(async (): Promise<PizzaLineDto | null> => {
    if (!line || saving) return null;
    const built = buildPatch();
    if ('error' in built) {
      setError(built.error);
      return null;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { line: saved } = await patchPizzaLine(line.id, built.patch);
      onLineUpdated(saved);
      return saved;
    } catch (e: any) {
      setError(e?.code === 'SIZE_REQUIRED' || e?.code === 'INVALID_SIZE' ? e.message : e?.message || 'Save failed');
      return null;
    } finally {
      setSaving(false);
    }
  }, [line, saving, buildPatch, onLineUpdated]);

  const verifyAndAdvance = useCallback(async () => {
    const saved = await save();
    if (!saved) return;
    const nxt = nextTodoIdx(selIdx);
    if (nxt >= 0) setSelIdx(nxt);
    else onNextReceipt(true);
  }, [save, nextTodoIdx, selIdx, onNextReceipt]);

  const unverify = useCallback(async () => {
    if (!line) return;
    setSaving(true);
    try {
      const { line: saved } = await patchPizzaLine(line.id, { unverify: true });
      onLineUpdated(saved);
    } catch (e: any) {
      setError(e?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  }, [line, onLineUpdated]);

  const applyToMerchant = useCallback(async () => {
    if (!line || !draft) return;
    const saved = await save();
    if (!saved) return;
    setSaving(true);
    try {
      const res = await applyPizzaLineToMerchant(saved.id, draft.sizeLabel.trim() || undefined);
      setNotice(`Saved preset "${res.preset.sizeLabel}" for this pizzeria; ${res.updatedLines} other line${res.updatedLines === 1 ? '' : 's'} updated.`);
      onMerchantApplied?.();
    } catch (e: any) {
      setError(e?.message || 'Apply failed');
    } finally {
      setSaving(false);
    }
  }, [line, draft, save, onMerchantApplied]);

  // ---- keyboard -----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      const editable = tag === 'input' || tag === 'textarea' || tag === 'select' || (t?.isContentEditable ?? false);
      if (e.key === 'Enter') {
        if (tag === 'textarea') return;
        // The editor's own verify button handles its click itself.
        if (t?.closest('[data-pizza-verify]')) return;
        e.preventDefault();
        void verifyAndAdvance();
        return;
      }
      if (editable) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelIdx((i) => Math.min(i + 1, lines.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        onNextReceipt(false);
      } else if (CM_KEYS.includes(e.key)) {
        e.preventDefault();
        setCm(CM_BY_KEY[e.key]);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        update({ shape: 'round' });
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        update({ shape: 'slice' });
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        update({ shape: 'rect' });
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        setDraft((d) => (d ? { ...d, excluded: !d.excluded } : d));
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        void applyToMerchant();
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        applyEstimate();
      } else if (IN_KEYS.includes(e.key)) {
        e.preventDefault();
        setCm(Math.round(QUICK_IN[IN_KEYS.indexOf(e.key)] * IN_TO_CM * 10) / 10);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [verifyAndAdvance, lines.length, onNextReceipt, setCm, update, applyToMerchant, applyEstimate]);

  if (!line || !draft) {
    return <div className="p-4 text-sm text-theme-text-muted">This receipt has no pizza lines.</div>;
  }

  const verifiedCount = lines.filter((l) => l.verifiedAt).length;
  const priceCur = line.currency;

  return (
    <div className="p-4 space-y-4 text-theme-text text-sm">
      {/* Header */}
      <div>
        <div className="font-semibold">{receipt.merchant || 'Unknown pizzeria'}</div>
        <div className="text-xs text-theme-text-muted">
          {receipt.party.name}
          {receipt.party.city ? ` · ${receipt.party.city}` : ''}
          {receipt.party.country ? `, ${receipt.party.country}` : ''}
          {' · '}
          {verifiedCount}/{lines.length} lines verified
        </div>
      </div>

      {/* Receipt-level discounts */}
      {receipt.receiptDiscounts.length > 0 && (
        <div className="rounded-lg border border-theme-stroke bg-white/5 p-2 text-xs">
          <div className="text-theme-text-muted mb-1">Receipt discounts (index uses list price)</div>
          {receipt.receiptDiscounts.map((d, i) => (
            <div key={i} className="flex justify-between">
              <span>{d.label}</span>
              <span>{fmtLocal(d.amount, receipt.currency)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Photos from this party: payout pizza photos first, event gallery as fallback */}
      {(payoutPhotos.length > 0 || eventPhotos.length > 0) && (
        <div className="space-y-2">
          {viewPhoto && (
            <div className="relative rounded-lg border border-theme-stroke bg-black/40">
              <img src={viewPhoto} alt="Selected party photo" className="w-full max-h-80 object-contain rounded-lg" />
              <div className="absolute top-1 right-1 flex gap-1">
                <a href={viewPhoto} target="_blank" rel="noreferrer" className="px-2 py-1 rounded bg-black/60 text-xs text-white hover:bg-black/80">
                  Full size
                </a>
                <button type="button" onClick={() => setViewPhoto(null)} aria-label="Close photo" className="p-1 rounded bg-black/60 text-white hover:bg-black/80">
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[...payoutPhotos.map((u) => ({ u, event: false })), ...eventPhotos.map((u) => ({ u, event: true }))].map(({ u, event }) => (
              <button
                key={u}
                type="button"
                onClick={() => setViewPhoto(viewPhoto === u ? null : u)}
                className={`relative flex-shrink-0 rounded-md border ${viewPhoto === u ? 'border-red-500' : 'border-theme-stroke'}`}
              >
                <img src={u} alt={event ? 'Event photo' : 'Pizza photo from this party'} loading="lazy" className="h-20 w-20 object-cover rounded-md" />
                {event && <span className="absolute bottom-0.5 left-0.5 px-1 rounded bg-black/60 text-[9px] text-white">event</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Line list */}
      <div className="space-y-1">
        {lines.map((l, i) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setSelIdx(i)}
            className={`w-full text-left rounded-lg border px-2 py-1.5 transition-colors ${
              i === selIdx ? 'border-red-500/60 bg-red-500/10' : 'border-theme-stroke bg-white/5 hover:bg-white/10'
            } ${l.excluded ? 'opacity-50' : ''}`}
          >
            <div className="flex items-center gap-2">
              {l.verifiedAt ? (
                <Check size={14} className="text-emerald-400 flex-shrink-0" />
              ) : (
                <span className="w-3.5 h-3.5 rounded-full border border-theme-stroke flex-shrink-0" />
              )}
              <span className="truncate flex-1">{l.rawName}</span>
              <span className="text-xs text-theme-text-muted whitespace-nowrap">
                {l.qty}× {fmtLocal(l.unitPriceList, l.currency)}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 pl-5 flex-wrap">
              <SourceBadge line={l} />
              {l.areaCm2 !== null && l.diameterCm !== null && l.shape === 'round' && (
                <span className="text-xs text-theme-text-muted">{Math.round(l.diameterCm)} cm</span>
              )}
              {l.isBundle && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400">bundle</span>}
              {l.excluded && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">excluded</span>}
              {l.outlierFlag && !l.verifiedAt && (
                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
                  <AlertTriangle size={10} /> outlier
                </span>
              )}
              {l.usdPerCm2 !== null && <span className="text-xs text-theme-text-muted">{fmtPerCm2(l.usdPerCm2)}/cm²</span>}
              {openEstimate(l) && (
                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400">
                  <Camera size={10} /> ~{fmtEstimate(openEstimate(l)!)}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Selected line editor */}
      <div className="rounded-xl border border-theme-stroke bg-white/5 p-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium break-words">{line.rawName}</div>
            <div className="text-xs text-theme-text-muted mt-0.5">
              {line.qty}× at {fmtLocal(line.unitPriceList, priceCur)} ({fmtUsd(line.unitPriceUsd)} USD)
              {line.unitPriceNet !== null && line.unitPriceNet !== line.unitPriceList && (
                <> · net {fmtLocal(line.unitPriceNet, priceCur)}{line.discountLabel ? ` (${line.discountLabel})` : ''}</>
              )}
            </div>
          </div>
          <SourceBadge line={line} />
        </div>

        {line.verifiedAt && (
          <div className="text-xs text-emerald-400">
            Verified{line.verifiedBy ? ` by ${line.verifiedBy}` : ''}.{' '}
            <button type="button" className="underline" onClick={unverify} disabled={saving}>Unverify</button>
          </div>
        )}

        {/* Photo-pass suggestion */}
        {estimate && (
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-2 text-xs space-y-1.5">
            <div className="flex items-center gap-1.5 text-cyan-300">
              <Camera size={14} />
              <span>
                Photo estimate: <b>~{fmtEstimate(estimate)}</b> {estimate.shape === 'rect' ? 'rectangle' : 'round'} ({Math.round(estimate.confidence * 100)}%)
              </span>
            </div>
            {estimate.note && <div className="text-theme-text-muted">{estimate.note}</div>}
            <div className="flex gap-2">
              <button type="button" onClick={applyEstimate} className="px-2 py-1 rounded-md border border-cyan-500/40 hover:bg-cyan-500/20">
                Use estimate <span className="text-theme-text-faint">[p]</span>
              </button>
              {estimate.photoUrl && (
                <button type="button" onClick={() => setViewPhoto(estimate.photoUrl)} className="px-2 py-1 rounded-md border border-theme-stroke hover:bg-white/10">
                  Show photo
                </button>
              )}
            </div>
            <div className="text-theme-text-faint">Rough guess from a photo. Check it against the photo before you verify.</div>
          </div>
        )}

        {/* Quick picks */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_CM.map((cm) => (
              <button
                key={cm}
                type="button"
                onClick={() => setCm(cm)}
                className={`px-2 py-1 rounded-md border text-xs ${
                  draft.shape === 'round' && Number(draft.diameter) === cm
                    ? 'border-red-500 bg-red-500/20'
                    : 'border-theme-stroke hover:bg-white/10'
                }`}
              >
                {cm} cm {CM_HOTKEY[cm] && <span className="text-theme-text-faint">[{CM_HOTKEY[cm]}]</span>}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_IN.map((inch, i) => {
              const cm = Math.round(inch * IN_TO_CM * 10) / 10;
              return (
                <button
                  key={inch}
                  type="button"
                  onClick={() => setCm(cm)}
                  className={`px-2 py-1 rounded-md border text-xs ${
                    draft.shape === 'round' && Number(draft.diameter) === cm
                      ? 'border-red-500 bg-red-500/20'
                      : 'border-theme-stroke hover:bg-white/10'
                  }`}
                >
                  {inch}″ {i < IN_KEYS.length && <span className="text-theme-text-faint">[{IN_KEYS[i]}]</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Shape toggle */}
        <div className="flex gap-1.5">
          {(['round', 'rect', 'slice'] as PizzaShape[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => update({ shape: s })}
              className={`flex-1 px-2 py-1 rounded-md border text-xs capitalize ${
                draft.shape === s ? 'border-red-500 bg-red-500/20' : 'border-theme-stroke hover:bg-white/10'
              }`}
            >
              {s === 'rect' ? 'Rectangle' : s}
            </button>
          ))}
        </div>

        {/* Dimensions */}
        <div className="grid grid-cols-2 gap-2">
          {(draft.shape === 'round' || draft.shape === 'slice') && (
            <IconInput
              icon={Ruler}
              type="number"
              inputMode="decimal"
              placeholder={draft.shape === 'slice' ? 'Whole pie diameter (cm)' : 'Diameter (cm)'}
              value={draft.diameter}
              onChange={(e) => update({ diameter: e.target.value })}
            />
          )}
          {draft.shape === 'rect' && (
            <>
              <IconInput icon={Ruler} type="number" inputMode="decimal" placeholder="Length (cm)" value={draft.length} onChange={(e) => update({ length: e.target.value })} />
              <IconInput icon={Ruler} type="number" inputMode="decimal" placeholder="Width (cm)" value={draft.width} onChange={(e) => update({ width: e.target.value })} />
            </>
          )}
          {draft.shape === 'slice' && (
            <IconInput icon={Ruler} type="number" inputMode="decimal" step="0.01" placeholder="Slice fraction (e.g. 0.125)" value={draft.fraction} onChange={(e) => update({ fraction: e.target.value })} />
          )}
          <IconInput icon={Tag} placeholder="Size label (e.g. large)" value={draft.sizeLabel} onChange={(e) => update({ sizeLabel: e.target.value })} />
          <IconInput icon={Hash} type="number" inputMode="decimal" placeholder="Qty" value={draft.qty} onChange={(e) => update({ qty: e.target.value })} />
          <IconInput icon={DollarSign} type="number" inputMode="decimal" placeholder={`Unit price (${priceCur})`} value={draft.price} onChange={(e) => update({ price: e.target.value })} />
        </div>

        {/* Live preview */}
        <div className="rounded-lg bg-black/20 p-2 text-xs space-y-1">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span>Area: <b>{preview?.area ? `${Math.round(preview.area)} cm²` : '-'}</b></span>
            <span>USD/cm²: <b>{fmtPerCm2(preview?.perCm2)}</b></span>
            <span>Local/cm²: <b>{preview?.localPer ? `${preview.localPer.toFixed(preview.localPer >= 1 ? 3 : 4)} ${priceCur}` : '-'}</b></span>
          </div>
          <div className="grid grid-cols-4 gap-1 text-center">
            {LADDER_SIZES.map((s) => (
              <div key={s} className="rounded bg-white/5 py-1">
                <div className="text-theme-text-faint">{s} cm</div>
                <div className="font-semibold">{fmtUsd(preview?.ladder?.[s])}</div>
                {preview?.netLadder && line.unitPriceNet !== null && line.unitPriceNet !== line.unitPriceList && (
                  <div className="text-[10px] text-theme-text-muted">net {fmtUsd(preview.netLadder[s])}</div>
                )}
              </div>
            ))}
          </div>
          {preview?.perCm2 !== null && preview?.perCm2 !== undefined && (preview.perCm2 < 0.002 || preview.perCm2 > 0.2) && (
            <div className="text-yellow-400 flex items-center gap-1">
              <AlertTriangle size={12} /> Outside the $0.002-$0.20/cm² sanity band. Check size, qty and price.
            </div>
          )}
        </div>

        {/* Flags */}
        <div className="space-y-2">
          <Checkbox checked={draft.isBundle} onChange={() => update({ isBundle: !draft.isBundle })} label="Bundle / deal (excluded from core medians)">
            <Package size={14} className="text-theme-text-muted" />
          </Checkbox>
          <Checkbox checked={draft.excluded} onChange={() => update({ excluded: !draft.excluded })} label="Exclude this line">
            <Ban size={14} className="text-theme-text-muted" />
          </Checkbox>
          {draft.excluded && (
            <select
              value={draft.excludedReason}
              onChange={(e) => update({ excludedReason: e.target.value as PizzaExcludedReason })}
              className="w-full"
              aria-label="Exclusion reason"
            >
              {EXCLUDE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          )}
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}
        {notice && <div className="text-xs text-emerald-400">{notice}</div>}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-pizza-verify
            onClick={verifyAndAdvance}
            disabled={saving}
            className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Verify &amp; next <span className="opacity-70 text-xs">[Enter]</span>
          </button>
          <button
            type="button"
            onClick={applyToMerchant}
            disabled={saving || !line.merchantKey || draft.excluded || draft.isBundle}
            title={line.merchantKey ? 'Save this size as a preset for this pizzeria and re-resolve its other unverified lines' : 'No pizzeria detected on this line'}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-theme-stroke hover:bg-white/10 disabled:opacity-40"
          >
            <Store size={16} /> Apply to this pizzeria
          </button>
        </div>
        <div className="text-[11px] text-theme-text-faint">
          Up/Down = line · 1-6 = cm sizes · 7-0 = 10/12/14/16″ · p = use photo estimate · r/s/x = round/slice/rect · e = exclude · m = apply to pizzeria · N or → = next receipt
        </div>
      </div>
    </div>
  );
}
