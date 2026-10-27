import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Pencil, Plus, Trash2, X, Store, Globe, Ruler, Tag, StickyNote } from 'lucide-react';
import {
  createPizzaPreset,
  deletePizzaPreset,
  fetchPizzaPresets,
  updatePizzaPreset,
  type PizzaPresetDto,
  type PizzaPresetInput,
  type PizzaShape,
} from '../../lib/api';
import { IconInput } from '../IconInput';

/**
 * sfincione-40417: size-preset table. Presets resolve a receipt's size label
 * ("large") to real dimensions per pizzeria / chain / country / global.
 * Underbosses may only write MERCHANT-scope presets (backend enforces).
 */

interface FormState {
  id: string | null;
  scope: PizzaPresetDto['scope'];
  merchant: string;
  country: string;
  sizeLabel: string;
  shape: PizzaShape;
  diameter: string;
  length: string;
  width: string;
  fraction: string;
  notes: string;
}

const EMPTY: FormState = {
  id: null, scope: 'merchant', merchant: '', country: '', sizeLabel: '', shape: 'round',
  diameter: '', length: '', width: '', fraction: '', notes: '',
};

const num = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

function dimsText(p: PizzaPresetDto): string {
  if (p.shape === 'round') return `${p.diameterCm} cm`;
  if (p.shape === 'rect') return `${p.lengthCm}×${p.widthCm} cm`;
  return `${p.sliceFraction} of ${p.diameterCm} cm`;
}

export function PizzaPresetsView({ isAdmin }: { isAdmin: boolean }) {
  const [presets, setPresets] = useState<PizzaPresetDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPizzaPresets({ q: q.trim() || undefined, scope: scopeFilter || undefined });
      setPresets(res.presets);
    } catch (e: any) {
      setError(e?.message || 'Failed to load presets');
    } finally {
      setLoading(false);
    }
  }, [q, scopeFilter]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const canWrite = (p: PizzaPresetDto) => isAdmin || p.scope === 'merchant';

  const openEdit = (p: PizzaPresetDto) =>
    setForm({
      id: p.id, scope: p.scope, merchant: p.merchantKey ?? '', country: p.country ?? '', sizeLabel: p.sizeLabel,
      shape: p.shape, diameter: p.diameterCm?.toString() ?? '', length: p.lengthCm?.toString() ?? '',
      width: p.widthCm?.toString() ?? '', fraction: p.sliceFraction?.toString() ?? '', notes: p.notes ?? '',
    });

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setFormError(null);
    const body: PizzaPresetInput = {
      scope: form.scope,
      sizeLabel: form.sizeLabel.trim(),
      shape: form.shape,
      diameterCm: num(form.diameter),
      lengthCm: num(form.length),
      widthCm: num(form.width),
      sliceFraction: num(form.fraction),
      notes: form.notes.trim() || null,
    };
    if (form.scope === 'merchant' || form.scope === 'chain') body.merchantName = form.merchant.trim();
    if (form.scope === 'country') body.country = form.country.trim();
    try {
      if (form.id) await updatePizzaPreset(form.id, body);
      else await createPizzaPreset(body);
      setForm(null);
      await load();
    } catch (e: any) {
      setFormError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: PizzaPresetDto) => {
    if (!window.confirm(`Delete preset "${p.sizeLabel}" (${p.merchantKey ?? p.country ?? 'global'})?`)) return;
    try {
      await deletePizzaPreset(p.id);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    }
  };

  const th = 'px-2 py-2 text-left text-xs font-medium text-theme-text-muted whitespace-nowrap';
  const td = 'px-2 py-2 text-sm whitespace-nowrap';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-60">
          <IconInput icon={Store} placeholder="Search pizzeria, country or label" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} aria-label="Scope" className="text-sm">
          <option value="">All scopes</option>
          <option value="merchant">Pizzeria</option>
          <option value="chain">Chain</option>
          <option value="country">Country</option>
          <option value="global">Global</option>
        </select>
        <button
          type="button"
          onClick={() => { setFormError(null); setForm({ ...EMPTY }); }}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm"
        >
          <Plus size={14} /> Add preset
        </button>
      </div>
      {!isAdmin && <p className="text-xs text-theme-text-muted">You can add and edit pizzeria-level presets. Chain, country and global presets are admin-only.</p>}
      {error && <div className="text-sm text-red-400">{error}</div>}

      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-theme-stroke">
          <table className="w-full">
            <thead className="bg-white/5">
              <tr>
                <th className={th}>Scope</th><th className={th}>Pizzeria / country</th><th className={th}>Label</th>
                <th className={th}>Shape</th><th className={th}>Size</th><th className={th}>Area</th><th className={th}>Source</th><th className={th}>Notes</th><th className={th} />
              </tr>
            </thead>
            <tbody>
              {presets.map((p) => (
                <tr key={p.id} className="border-t border-theme-stroke hover:bg-white/5">
                  <td className={td}>{p.scope}</td>
                  <td className={`${td} max-w-[200px] truncate`}>{p.merchantKey ?? p.country ?? <Globe size={14} className="inline" />}</td>
                  <td className={td}>{p.sizeLabel}</td>
                  <td className={td}>{p.shape}</td>
                  <td className={td}>{dimsText(p)}</td>
                  <td className={td}>{p.areaCm2 ? `${Math.round(p.areaCm2)} cm²` : '-'}</td>
                  <td className={td}>{p.source}</td>
                  <td className={`${td} max-w-[200px] truncate text-theme-text-muted`} title={p.notes ?? ''}>{p.notes}</td>
                  <td className={`${td} text-right`}>
                    {canWrite(p) && (
                      <>
                        <button type="button" onClick={() => { setFormError(null); openEdit(p); }} className="p-1 text-theme-text-muted hover:text-theme-text" aria-label="Edit preset"><Pencil size={14} /></button>
                        <button type="button" onClick={() => remove(p)} className="p-1 text-theme-text-muted hover:text-red-400" aria-label="Delete preset"><Trash2 size={14} /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {presets.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-theme-text-muted">No presets.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {form && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setForm(null)}>
          <div className="bg-theme-card border border-theme-stroke rounded-2xl p-6 w-full max-w-md mx-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-theme-text">{form.id ? 'Edit preset' : 'Add preset'}</h3>
              <button type="button" onClick={() => setForm(null)} aria-label="Close" className="text-theme-text-muted hover:text-theme-text"><X size={18} /></button>
            </div>
            <select
              value={form.scope}
              disabled={!!form.id}
              onChange={(e) => setForm({ ...form, scope: e.target.value as PizzaPresetDto['scope'] })}
              className="w-full"
              aria-label="Scope"
            >
              <option value="merchant">Pizzeria (merchant)</option>
              {isAdmin && <option value="chain">Chain</option>}
              {isAdmin && <option value="country">Country</option>}
              {isAdmin && <option value="global">Global</option>}
            </select>
            {(form.scope === 'merchant' || form.scope === 'chain') && (
              <IconInput icon={Store} placeholder="Pizzeria / chain name" value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} />
            )}
            {form.scope === 'country' && (
              <IconInput icon={Globe} placeholder="Country (as stored on events)" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
            )}
            <IconInput icon={Tag} placeholder="Size label (e.g. large, family)" value={form.sizeLabel} onChange={(e) => setForm({ ...form, sizeLabel: e.target.value })} />
            <div className="flex gap-1.5">
              {(['round', 'rect', 'slice'] as PizzaShape[]).map((s) => (
                <button key={s} type="button" onClick={() => setForm({ ...form, shape: s })}
                  className={`flex-1 px-2 py-1 rounded-md border text-xs capitalize ${form.shape === s ? 'border-red-500 bg-red-500/20' : 'border-theme-stroke hover:bg-white/10'}`}>
                  {s === 'rect' ? 'Rectangle' : s}
                </button>
              ))}
            </div>
            {form.shape !== 'rect' && (
              <IconInput icon={Ruler} type="number" inputMode="decimal" placeholder="Diameter (cm)" value={form.diameter} onChange={(e) => setForm({ ...form, diameter: e.target.value })} />
            )}
            {form.shape === 'rect' && (
              <div className="grid grid-cols-2 gap-2">
                <IconInput icon={Ruler} type="number" inputMode="decimal" placeholder="Length (cm)" value={form.length} onChange={(e) => setForm({ ...form, length: e.target.value })} />
                <IconInput icon={Ruler} type="number" inputMode="decimal" placeholder="Width (cm)" value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} />
              </div>
            )}
            {form.shape === 'slice' && (
              <IconInput icon={Ruler} type="number" inputMode="decimal" step="0.01" placeholder="Slice fraction of the pie (e.g. 0.125)" value={form.fraction} onChange={(e) => setForm({ ...form, fraction: e.target.value })} />
            )}
            <IconInput icon={StickyNote} placeholder="Notes (source, link)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            {formError && <div className="text-sm text-red-400">{formError}</div>}
            <button
              type="button"
              onClick={save}
              disabled={saving || !form.sizeLabel.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium disabled:opacity-50"
            >
              {saving && <Loader2 size={16} className="animate-spin" />} Save preset
            </button>
            <p className="text-xs text-theme-text-faint">Saving re-resolves matching unverified lines in your scope.</p>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
