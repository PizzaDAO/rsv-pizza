import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Calendar, Check, Coins, ExternalLink, Globe, Hash, Loader2, MapPin, Plus, Ruler, ScanText, Store, Trash2, X, Pizza } from 'lucide-react';
import {
  approvePizzaSubmission,
  extractPizzaSubmission,
  fetchPizzaSubmissions,
  rejectPizzaSubmission,
  type PizzaSubmissionDraft,
  type PizzaSubmissionDraftLine,
  type PizzaSubmissionDto,
} from '../../lib/api';
import { IconInput } from '../IconInput';

/**
 * sfincione-40417 (submissions): full-admin review of receipts sent in through the public form.
 * Receipt files are only ever shown through short-lived signed URLs minted by the backend.
 * OCR ("Read receipt") runs only when an admin asks, so spam costs nothing until reviewed.
 * After approval the lines are sized in the normal Review queue (Source = Community submissions).
 */

type Status = 'pending' | 'approved' | 'rejected';

interface FormState {
  kind: 'itemized' | 'lump_sum' | 'not_pizza';
  currency: string;
  total: string;
  pizzaCount: string;
  merchant: string;
  city: string;
  country: string;
  receiptDate: string;
  fxRate: string;
  lines: Array<{ name: string; qty: string; unitPrice: string; sizeLabel: string }>;
}

const emptyLine = (sizeLabel = '') => ({ name: '', qty: '1', unitPrice: '', sizeLabel });

function initialForm(s: PizzaSubmissionDto): FormState {
  return {
    kind: s.kind ?? 'itemized',
    currency: s.currency ?? '',
    total: s.total != null ? String(s.total) : '',
    pizzaCount: s.pizzaCount != null ? String(s.pizzaCount) : '',
    merchant: s.merchant,
    city: s.city ?? '',
    country: s.country,
    receiptDate: s.receiptDate,
    fxRate: '',
    lines: [emptyLine(s.sizeNote ?? '')],
  };
}

function applyDraft(form: FormState, d: PizzaSubmissionDraft): FormState {
  return {
    ...form,
    kind: d.kind,
    currency: d.currency ?? form.currency,
    total: d.total != null ? String(d.total) : form.total,
    pizzaCount: d.pizzaCount != null ? String(d.pizzaCount) : form.pizzaCount,
    merchant: d.merchant?.trim() ? d.merchant : form.merchant,
    receiptDate: d.receiptDate && /^\d{4}-\d{2}-\d{2}$/.test(d.receiptDate) ? d.receiptDate : form.receiptDate,
    lines: d.lines.length
      ? d.lines.map((l: PizzaSubmissionDraftLine) => ({ name: l.name, qty: String(l.qty), unitPrice: String(l.unitPrice), sizeLabel: l.sizeLabel ?? '' }))
      : form.lines,
  };
}

const numOrNull = (v: string): number | null => {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
};

function SubmissionCard({ sub, onDone }: { sub: PizzaSubmissionDto; onDone: () => void }) {
  const [current, setCurrent] = useState(sub);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => initialForm(sub));
  const [busy, setBusy] = useState<null | 'ocr' | 'approve' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [needFx, setNeedFx] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const pending = current.status === 'pending';
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const setLine = (i: number, patch: Partial<FormState['lines'][number]>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const readReceipt = async () => {
    setBusy('ocr'); setError(null); setNote(null);
    try {
      const r = await extractPizzaSubmission(current.id);
      setCurrent(r.submission);
      if (r.draft) setForm((f) => applyDraft(f, r.draft!));
      else setNote('Nothing readable found. Fill the lines in by hand.');
    } catch (e: any) {
      setError(e?.message || 'Could not read the receipt');
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    setBusy('approve'); setError(null); setNote(null);
    try {
      const r = await approvePizzaSubmission(current.id, {
        kind: form.kind,
        currency: form.currency.trim() || null,
        total: numOrNull(form.total),
        pizzaCount: numOrNull(form.pizzaCount),
        merchant: form.merchant.trim() || null,
        city: form.city.trim() || null,
        country: form.country.trim() || null,
        receiptDate: form.receiptDate || null,
        fxRate: numOrNull(form.fxRate),
        lines: form.kind === 'itemized'
          ? form.lines.filter((l) => l.name.trim() || l.unitPrice.trim()).map((l) => ({
              name: l.name.trim(), qty: numOrNull(l.qty) ?? 0, unitPrice: numOrNull(l.unitPrice) ?? 0,
              sizeLabel: l.sizeLabel.trim() || null, diameterCm: null,
            }))
          : [],
      });
      setCurrent(r.submission);
      setNote(
        r.warnings.includes('no_size')
          ? `Approved, ${r.linesWritten} line(s). No size resolved yet: size them in Review (Source: Community submissions) before they count.`
          : `Approved, ${r.linesWritten} line(s). Size them in Review (Source: Community submissions).`,
      );
      onDone();
    } catch (e: any) {
      if (e?.code === 'FX_UNAVAILABLE') setNeedFx(true);
      setError(e?.message || 'Could not approve');
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    setBusy('reject'); setError(null);
    try {
      const r = await rejectPizzaSubmission(current.id, rejectReason.trim() || undefined);
      setCurrent(r.submission);
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Could not reject');
    } finally {
      setBusy(null);
    }
  };

  const isPdf = current.mimeType === 'application/pdf';
  const isHeic = current.mimeType === 'image/heic';
  const imageUrl = isPdf || isHeic ? current.previewUrl : current.receiptUrl;

  return (
    <div className="rounded-xl border border-theme-stroke bg-white/5">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="w-full text-left p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-theme-text truncate">{current.merchant}</div>
          <div className="text-xs text-theme-text-muted truncate">
            {current.city ? `${current.city}, ` : ''}{current.country} · {current.receiptDate} · sent {new Date(current.createdAt).toLocaleString()}
          </div>
        </div>
        {current.duplicateOfId && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 inline-flex items-center gap-1"><AlertTriangle size={10} />possible duplicate</span>}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${current.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400' : current.status === 'rejected' ? 'bg-red-500/15 text-red-400' : 'bg-white/10 text-theme-text-muted'}`}>
          {current.status}
        </span>
      </button>

      {open && (
        <div className="border-t border-theme-stroke p-3 grid gap-4 md:grid-cols-2">
          {/* Receipt */}
          <div className="space-y-2">
            {imageUrl ? (
              <a href={current.receiptUrl ?? imageUrl} target="_blank" rel="noreferrer">
                <img src={imageUrl} alt={`Receipt from ${current.merchant}`} className="w-full max-h-[70vh] object-contain rounded-lg border border-theme-stroke bg-black/30" />
              </a>
            ) : (
              <div className="rounded-lg border border-theme-stroke bg-black/20 p-6 text-center text-xs text-theme-text-muted">
                {isPdf || isHeic ? `${isPdf ? 'PDF' : 'HEIC'}: press "Read receipt" to render a preview, or open the file.` : 'No inline preview for this file type.'}
              </div>
            )}
            {current.receiptUrl && (
              <a href={current.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline">
                <ExternalLink size={12} />Open original (link expires in 30 min)
              </a>
            )}
            <div className="text-xs text-theme-text-muted space-y-0.5">
              <div>From: {current.submitterEmail ?? 'anonymous'}{current.submittedByUser ? ' (signed in)' : ''}{current.notify ? ' · wants to be told' : ''}</div>
              {current.sizeNote && <div>Size note: "{current.sizeNote}"</div>}
              {current.duplicateOfId && <div className="text-yellow-400">{current.duplicateReason} (see submission {current.duplicateOfId.slice(0, 8)})</div>}
              {current.reviewedBy && <div>Reviewed by {current.reviewedBy}{current.rejectReason ? `: ${current.rejectReason}` : ''}</div>}
              {current.fxSource && <div>FX: {current.fxRate} ({current.fxSource})</div>}
            </div>
          </div>

          {/* Draft */}
          <div className="space-y-3">
            {pending && (
              <button type="button" onClick={readReceipt} disabled={busy !== null} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-theme-stroke text-sm hover:bg-white/10 disabled:opacity-50">
                {busy === 'ocr' ? <Loader2 size={14} className="animate-spin" /> : <ScanText size={14} />}
                {current.ocrAt ? 'Read receipt again' : 'Read receipt (OCR)'}
              </button>
            )}
            {pending && (
              <>
                <div className="flex gap-2">
                  <select value={form.kind} onChange={(e) => set({ kind: e.target.value as FormState['kind'] })} aria-label="Receipt kind" className="text-sm">
                    <option value="itemized">Itemized pizzas</option>
                    <option value="lump_sum">Lump sum (total + pizza count)</option>
                    <option value="not_pizza">Not a pizza receipt</option>
                  </select>
                  {form.kind !== 'not_pizza' && (
                    <div className="w-32"><IconInput icon={Coins} placeholder="Currency (EUR)" value={form.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase().slice(0, 3) })} /></div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <IconInput icon={Store} placeholder="Pizzeria" value={form.merchant} onChange={(e) => set({ merchant: e.target.value })} />
                  <IconInput icon={Calendar} type="date" placeholder="Receipt date" value={form.receiptDate} onChange={(e) => set({ receiptDate: e.target.value })} />
                  <IconInput icon={MapPin} placeholder="City" value={form.city} onChange={(e) => set({ city: e.target.value })} />
                  <IconInput icon={Globe} placeholder="Country" value={form.country} onChange={(e) => set({ country: e.target.value })} />
                </div>
                {form.kind === 'lump_sum' && (
                  <div className="grid grid-cols-2 gap-2">
                    <IconInput icon={Coins} type="number" min="0" step="any" placeholder="Total on receipt" value={form.total} onChange={(e) => set({ total: e.target.value })} />
                    <IconInput icon={Hash} type="number" min="1" step="any" placeholder="Number of pizzas" value={form.pizzaCount} onChange={(e) => set({ pizzaCount: e.target.value })} />
                    <div className="col-span-2"><IconInput icon={Ruler} placeholder='Size, e.g. "12 inch" or "30 cm" (optional)' value={form.lines[0]?.sizeLabel ?? ''} onChange={(e) => setLine(0, { sizeLabel: e.target.value })} /></div>
                  </div>
                )}
                {form.kind === 'itemized' && (
                  <div className="space-y-2">
                    {form.lines.map((l, i) => (
                      <div key={i} className="grid grid-cols-[1fr_4rem_5.5rem_auto] gap-2 items-start">
                        <div className="col-span-4 sm:col-span-1"><IconInput icon={Pizza} placeholder="Pizza name" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} /></div>
                        <IconInput type="number" min="0" step="any" placeholder="Qty" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                        <IconInput type="number" min="0" step="any" placeholder="Unit price" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
                        <button type="button" aria-label="Remove line" onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))} className="p-2 text-theme-text-muted hover:text-red-400"><Trash2 size={16} /></button>
                        <div className="col-span-4"><IconInput icon={Ruler} placeholder='Size, e.g. "12 inch" (optional)' value={l.sizeLabel} onChange={(e) => setLine(i, { sizeLabel: e.target.value })} /></div>
                      </div>
                    ))}
                    <button type="button" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine(current.sizeNote ?? '')] }))} className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"><Plus size={12} />Add pizza line</button>
                  </div>
                )}
                {needFx && form.kind !== 'not_pizza' && (
                  <IconInput icon={Coins} type="number" min="0" step="any" placeholder={`Exchange rate: USD per 1 ${form.currency || 'unit'} on the receipt date`} value={form.fxRate} onChange={(e) => set({ fxRate: e.target.value })} />
                )}
              </>
            )}

            {error && <div className="text-xs text-red-400">{error}</div>}
            {note && <div className="text-xs text-emerald-400">{note}</div>}

            {pending && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={approve} disabled={busy !== null} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-50">
                  {busy === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Approve
                </button>
                <div className="flex-1 min-w-[10rem]"><IconInput placeholder="Reject reason (optional)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} /></div>
                <button type="button" onClick={reject} disabled={busy !== null} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm disabled:opacity-50">
                  {busy === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}Reject
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PizzaSubmissionsView({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<Status>('pending');
  const [subs, setSubs] = useState<PizzaSubmissionDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchPizzaSubmissions({ status, limit: 50 });
      setSubs(r.submissions);
      setTotal(r.total);
    } catch (e: any) {
      setError(e?.message || 'Failed to load submissions');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Status" className="text-sm">
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <span className="text-xs text-theme-text-muted">{total} {status}</span>
      </div>
      {loading && <div className="py-8 flex justify-center"><Loader2 className="animate-spin" /></div>}
      {error && <div className="text-sm text-red-400">{error}</div>}
      {!loading && !error && subs.length === 0 && <div className="text-sm text-theme-text-muted">Nothing here.</div>}
      {!loading && subs.map((s) => (
        <SubmissionCard key={s.id} sub={s} onDone={() => onChanged?.()} />
      ))}
    </div>
  );
}
