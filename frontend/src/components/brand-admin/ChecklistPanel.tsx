import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Calendar, Check, Loader2, Lock, Pencil, Plus, Trash2, X, ListChecks } from 'lucide-react';
import { IconInput } from '../IconInput';
import { InlineConfirm } from '../InlineConfirm';
import {
  addBrandChecklistItem, deleteBrandChecklistItem, fetchBrandChecklist, updateBrandChecklistItem,
  describeApiError, type BrandChecklistItem,
} from '../../lib/brandAdminApi';

/** Mirrors the backend's allowed link targets (lib/checklistLinkTabs.ts); the server re-validates. */
export const LINK_TAB_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'No link' },
  { value: 'details', label: 'Event details' }, { value: 'venue', label: 'Venue' }, { value: 'pizza', label: 'Pizza' },
  { value: 'guests', label: 'Guests' }, { value: 'photos', label: 'Photos' }, { value: 'partners', label: 'Partners' },
  { value: 'music', label: 'Music' }, { value: 'report', label: 'Report' }, { value: 'staff', label: 'Staff' },
  { value: 'displays', label: 'Displays' }, { value: 'raffle', label: 'Raffle' }, { value: 'budget', label: 'Budget' },
  { value: 'promo', label: 'Promo' }, { value: 'flyer', label: 'Flyer' }, { value: 'print', label: 'Print' },
  { value: 'party-guide', label: 'Party guide' }, { value: 'payments', label: 'Payments' }, { value: 'hackathon', label: 'Hackathon' },
  { value: 'attendance', label: 'Attendance' }, { value: 'social-post', label: 'Social post' },
];
const linkLabel = (v: string | null) => LINK_TAB_OPTIONS.find((o) => o.value === (v ?? ''))?.label ?? v ?? 'No link';
const dateOnly = (v: string | null) => (v ? String(v).slice(0, 10) : '');
const NAME_MAX = 120;

/**
 * The PATCHes (at most 2) that move item `index` one step. It swaps the two stored sortOrder values, so
 * the interleaved, 1-based seeded lists (with automatic items) never gain ties. If the two values are
 * equal, one item takes a free value on the correct side instead.
 */
export function planMove(list: BrandChecklistItem[], index: number, dir: -1 | 1): Array<{ id: string; sortOrder: number }> {
  const a = list[index];
  const b = list[index + dir];
  if (!a || !b || a.isAuto || b.isAuto) return [];
  if (a.sortOrder !== b.sortOrder) return [{ id: a.id, sortOrder: b.sortOrder }, { id: b.id, sortOrder: a.sortOrder }];
  const v = a.sortOrder;
  const used = new Set(list.map((i) => i.sortOrder));
  const below = () => { for (let x = v - 1; x >= 0; x--) if (!used.has(x)) return x; return null; };
  const above = () => { for (let x = v + 1; x <= 10000; x++) if (!used.has(x)) return x; return null; };
  // `lo` must end up before `hi`: the earlier item moves down to a free value, or the later one up.
  const [lo, hi] = dir === -1 ? [a, b] : [b, a];
  const l = below();
  if (l !== null) return [{ id: lo.id, sortOrder: l }];
  const h = above();
  return h !== null ? [{ id: hi.id, sortOrder: h }] : [];
}

export function validateItemName(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Give the item a name';
  if (n.length > NAME_MAX) return `Keep it to ${NAME_MAX} characters`;
  if (/[<>]/.test(n)) return "Names can't contain < or >";
  if (/[\u0000-\u001f\u007f]/.test(n)) return "Names can't contain control characters (such as tabs or line breaks)";
  return null;
}

const ItemRow: React.FC<{
  item: BrandChecklistItem;
  index: number;
  canUp: boolean;
  canDown: boolean;
  busy: boolean;
  onSave: (id: string, data: { name: string; dueDate: string | null; linkTab: string | null }) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  onMove: (index: number, dir: -1 | 1) => void;
}> = ({ item, index, canUp, canDown, busy, onSave, onDelete, onMove }) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [due, setDue] = useState(dateOnly(item.dueDate));
  const [tab, setTab] = useState(item.linkTab ?? '');
  const [confirming, setConfirming] = useState(false);
  const err = editing ? validateItemName(name) : null;

  const reset = () => { setName(item.name); setDue(dateOnly(item.dueDate)); setTab(item.linkTab ?? ''); setEditing(false); };

  if (item.isAuto) {
    return (
      <li className="flex items-center gap-3 px-3 py-2 rounded-lg bg-theme-surface" data-testid="checklist-auto-item">
        <Lock size={14} className="text-theme-text-muted shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-theme-text break-words">{item.name}</div>
          <div className="text-xs text-theme-text-muted">Automatic item, managed by PizzaDAO (read-only)</div>
        </div>
      </li>
    );
  }

  if (editing) {
    return (
      <li className="px-3 py-3 rounded-lg bg-theme-surface space-y-2" data-testid="checklist-edit-row">
        <IconInput type="text" icon={ListChecks} aria-label="Item name" placeholder="Item name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
        {err && <div className="text-xs text-[#E52828]">{err}</div>}
        <div className="grid gap-2 sm:grid-cols-2">
          <IconInput icon={Calendar} type="date" aria-label="Due date" placeholder="Due date" value={due} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDue(e.target.value)} />
          <select aria-label="Link to" className="w-full" value={tab} onChange={(e) => setTab(e.target.value)}>
            {LINK_TAB_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="text-xs text-theme-text-muted">Due date, then where the item links to. Changes also update this item on your existing events.</div>
        <div className="flex gap-2">
          <button type="button" className="btn-primary text-sm !px-3 !py-2 inline-flex items-center gap-1 disabled:opacity-50" disabled={!!err || busy}
            onClick={async () => { if (await onSave(item.id, { name: name.trim(), dueDate: due || null, linkTab: tab || null })) setEditing(false); }}>
            <Check size={14} />Save
          </button>
          <button type="button" className="btn-secondary text-sm !px-3 !py-2 inline-flex items-center gap-1" onClick={reset}><X size={14} />Cancel</button>
        </div>
      </li>
    );
  }

  return (
    <li className="px-3 py-2 rounded-lg bg-theme-surface" data-testid="checklist-item">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-theme-text break-words">{item.name}</div>
          {(item.dueDate || item.linkTab) && (
            <div className="text-xs text-theme-text-muted">
              {item.dueDate ? `Due ${dateOnly(item.dueDate)}` : ''}{item.dueDate && item.linkTab ? ' · ' : ''}{item.linkTab ? `Links to ${linkLabel(item.linkTab)}` : ''}
            </div>
          )}
        </div>
        <div className="flex items-center shrink-0">
          <button type="button" aria-label="Move up" disabled={busy || !canUp} onClick={() => onMove(index, -1)} className="p-2 text-theme-text-muted hover:text-theme-text disabled:opacity-30"><ArrowUp size={15} /></button>
          <button type="button" aria-label="Move down" disabled={busy || !canDown} onClick={() => onMove(index, 1)} className="p-2 text-theme-text-muted hover:text-theme-text disabled:opacity-30"><ArrowDown size={15} /></button>
          <button type="button" aria-label="Edit item" disabled={busy} onClick={() => setEditing(true)} className="p-2 text-theme-text-muted hover:text-theme-text disabled:opacity-30"><Pencil size={15} /></button>
          <button type="button" aria-label="Delete item" disabled={busy} onClick={() => setConfirming(true)} className="p-2 text-theme-text-muted hover:text-[#E52828] disabled:opacity-30"><Trash2 size={15} /></button>
        </div>
      </div>
      {confirming && (
        <div className="mt-2">
          <InlineConfirm message={`Delete "${item.name}" from the checklist?`} confirmLabel="Delete" cancelLabel="Keep it" busy={busy}
            onConfirm={async () => { await onDelete(item.id); setConfirming(false); }} onCancel={() => setConfirming(false)} />
        </div>
      )}
    </li>
  );
};

export const ChecklistPanel: React.FC<{ seriesId: string }> = ({ seriesId }) => {
  const [items, setItems] = useState<BrandChecklistItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetchBrandChecklist(seriesId);
      setItems([...res.items].sort((a, b) => a.sortOrder - b.sortOrder));
    } catch (e) {
      setLoadError(describeApiError(e));
    }
  }, [seriesId]);
  useEffect(() => { setItems(null); void load(); }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try { await fn(); } catch (e) { setMessage({ kind: 'error', text: describeApiError(e) }); } finally { setBusy(false); }
  };

  const add = () => run(async () => {
    const { item } = await addBrandChecklistItem(seriesId, { name: newName.trim() });
    setItems((cur) => [...(cur ?? []), item]);
    setNewName('');
  });

  const save = async (id: string, data: { name: string; dueDate: string | null; linkTab: string | null }) => {
    let ok = false;
    await run(async () => {
      const res = await updateBrandChecklistItem(seriesId, id, data);
      setItems((cur) => (cur ?? []).map((i) => (i.id === id ? res.item : i)));
      setMessage({ kind: 'ok', text: res.propagated ? `Saved, and updated on ${res.propagated} existing item${res.propagated === 1 ? '' : 's'}.` : 'Saved.' });
      ok = true;
    });
    return ok;
  };

  const remove = (id: string) => run(async () => {
    await deleteBrandChecklistItem(seriesId, id);
    setItems((cur) => (cur ?? []).filter((i) => i.id !== id));
  });

  const move = (index: number, dir: -1 | 1) => run(async () => {
    const patches = planMove(items ?? [], index, dir);
    try {
      for (const p of patches) await updateBrandChecklistItem(seriesId, p.id, { sortOrder: p.sortOrder });
    } finally {
      await load(); // the UI always shows the stored order, even if a PATCH failed part-way
    }
  });

  if (loadError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[#E52828]" role="alert">{loadError}</p>
        <button type="button" className="btn-secondary text-sm" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!items) return <div className="flex items-center gap-2 text-sm text-theme-text-muted"><Loader2 size={16} className="animate-spin" />Loading checklist…</div>;

  const nameErr = newName ? validateItemName(newName) : null;
  return (
    <div className="space-y-4" data-testid="checklist-panel">
      <p className="text-sm text-theme-text-muted">
        This is the checklist every host of your series sees. Automatic items are managed by PizzaDAO and can't be changed here.
      </p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <ItemRow key={item.id} item={item} index={i} canUp={i > 0 && !items[i - 1].isAuto} canDown={i < items.length - 1 && !items[i + 1].isAuto} busy={busy} onSave={save} onDelete={remove} onMove={move} />
        ))}
        {items.length === 0 && <li className="text-sm text-theme-text-muted">No items yet. Add the first one below.</li>}
      </ul>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <IconInput type="text" icon={Plus} aria-label="New checklist item" placeholder="New checklist item" value={newName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' && newName.trim() && !nameErr && !busy) void add(); }} />
          {nameErr && <div className="text-xs text-[#E52828] mt-1">{nameErr}</div>}
        </div>
        <button type="button" className="btn-primary text-sm !px-4 !py-3 disabled:opacity-50" disabled={!newName.trim() || !!nameErr || busy} onClick={add}>Add</button>
      </div>
      {message && <p className={`text-sm ${message.kind === 'ok' ? 'text-theme-text-muted' : 'text-[#E52828]'}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    </div>
  );
};
