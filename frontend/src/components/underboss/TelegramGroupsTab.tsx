import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertCircle, Plus, Pencil, Trash2, X, Check, Search, Link2, Link2Off } from 'lucide-react';
import { IconInput } from '../IconInput';
import {
  fetchTelegramGroups,
  createTelegramGroup,
  updateTelegramGroup,
  deleteTelegramGroup,
  TelegramGroup,
  TelegramGroupInput,
} from '../../lib/telegram';
import type { UnderbossEvent } from '../../types';

/**
 * calzone-58481: admin/UB "Telegram Groups" tab. DB-backed CRUD for city
 * Telegram broadcast groups, with link/unlink to a GPP party. Replaces the
 * read-only Google-Sheet source. Uses placeholders (no labels) per CLAUDE.md.
 */

interface EditState {
  id: string | null; // null = creating
  chatId: string;
  chatUrl: string;
  city: string;
  country: string;
  region: string;
  underboss: string;
  partyId: string;
}

const EMPTY_EDIT: EditState = {
  id: null,
  chatId: '',
  chatUrl: '',
  city: '',
  country: '',
  region: '',
  underboss: '',
  partyId: '',
};

export function TelegramGroupsTab({ events }: { events?: UnderbossEvent[] }) {
  const [groups, setGroups] = useState<TelegramGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setGroups(await fetchTelegramGroups());
    } catch (err: any) {
      setError(err?.message || 'Failed to load Telegram groups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Party options for the link dropdown.
  const partyOptions = useMemo(() => {
    const opts = (events || []).map((e) => ({ id: e.id, label: e.city || e.name }));
    opts.sort((a, b) => a.label.localeCompare(b.label));
    return opts;
  }, [events]);

  const partyLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of partyOptions) m.set(o.id, o.label);
    return m;
  }, [partyOptions]);

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase().trim();
    return groups.filter(
      (g) =>
        g.city.toLowerCase().includes(q) ||
        g.country.toLowerCase().includes(q) ||
        g.underboss.toLowerCase().includes(q) ||
        g.groupId.includes(q)
    );
  }, [groups, search]);

  const handleSave = async () => {
    if (!edit) return;
    setSaving(true);
    setSaveError(null);
    try {
      const input: TelegramGroupInput = {
        chatId: edit.chatId.trim(),
        chatUrl: edit.chatUrl.trim() || undefined,
        city: edit.city.trim(),
        country: edit.country.trim(),
        region: edit.region.trim() || undefined,
        underboss: edit.underboss.trim() || undefined,
        partyId: edit.partyId || null,
      };
      if (edit.id) {
        const updated = await updateTelegramGroup(edit.id, input);
        setGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
      } else {
        const created = await createTelegramGroup(input);
        setGroups((prev) => [...prev, created]);
      }
      setEdit(null);
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (g: TelegramGroup) => {
    // Reversible-ish but destructive of a row; a single confirm is warranted.
    if (!window.confirm(`Delete the Telegram group for ${g.city}? This cannot be undone.`)) return;
    try {
      await deleteTelegramGroup(g.id);
      setGroups((prev) => prev.filter((x) => x.id !== g.id));
    } catch (err: any) {
      setError(err?.message || 'Failed to delete');
    }
  };

  const handleUnlink = async (g: TelegramGroup) => {
    try {
      const updated = await updateTelegramGroup(g.id, { partyId: null });
      setGroups((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err: any) {
      setError(err?.message || 'Failed to unlink');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 size={28} className="animate-spin text-theme-text-muted mb-3" />
        <p className="text-sm text-theme-text-muted">Loading Telegram groups…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertCircle size={28} className="text-red-400 mb-3" />
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <IconInput
            icon={Search}
            iconSize={14}
            type="text"
            placeholder="Search city, country, underboss, or chat ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => { setEdit({ ...EMPTY_EDIT }); setSaveError(null); }}
          className="flex items-center gap-2 bg-[#E52828] hover:bg-[#cc2222] text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors flex-shrink-0"
        >
          <Plus size={14} />
          Add group
        </button>
      </div>

      {/* List */}
      <div className="border border-theme-stroke rounded-xl overflow-hidden">
        <div className="max-h-[480px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-theme-text-faint">
              No Telegram groups found.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 px-4 py-2 bg-theme-surface border-b border-theme-stroke text-xs text-theme-text-faint font-medium sticky top-0">
                <div className="flex-1 grid grid-cols-5 gap-2">
                  <span>City</span>
                  <span>Country</span>
                  <span>Underboss</span>
                  <span>Chat ID</span>
                  <span>Linked event</span>
                </div>
                <div className="w-20 text-right">Actions</div>
              </div>
              {filtered.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center gap-3 px-4 py-2.5 border-b border-theme-stroke last:border-b-0"
                >
                  <div className="flex-1 grid grid-cols-5 gap-2 text-sm">
                    <span className="text-theme-text truncate">{g.city}</span>
                    <span className="text-theme-text-secondary truncate">{g.country}</span>
                    <span className="text-theme-text-faint truncate">{g.underboss || '—'}</span>
                    <span className="text-theme-text-faint truncate font-mono text-xs">{g.groupId}</span>
                    <span className="truncate">
                      {g.partyLinked ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/15 text-green-600">
                          <Link2 size={10} />
                          {partyLabelById.get(g.partyId || '') || 'Linked'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-theme-surface text-theme-text-faint">
                          <Link2Off size={10} />
                          Unlinked
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="w-20 flex items-center justify-end gap-2">
                    {g.partyLinked && (
                      <button
                        onClick={() => handleUnlink(g)}
                        className="text-theme-text-faint hover:text-yellow-600 transition-colors"
                        title="Unlink from event"
                      >
                        <Link2Off size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEdit({
                          id: g.id,
                          chatId: g.groupId,
                          chatUrl: g.chatUrl,
                          city: g.city,
                          country: g.country,
                          region: g.region,
                          underboss: g.underboss,
                          partyId: g.partyId || '',
                        });
                        setSaveError(null);
                      }}
                      className="text-theme-text-faint hover:text-red-500 transition-colors"
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(g)}
                      className="text-theme-text-faint hover:text-red-500 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Edit / Create modal */}
      {edit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !saving && setEdit(null)}
        >
          <div
            className="border border-theme-stroke rounded-2xl w-full max-w-md mx-4"
            style={{ background: 'var(--bg-main)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-theme-stroke">
              <h3 className="text-base font-semibold text-theme-text">
                {edit.id ? 'Edit Telegram group' : 'Add Telegram group'}
              </h3>
              <button onClick={() => !saving && setEdit(null)} className="text-theme-text-faint hover:text-theme-text-secondary">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <IconInput
                type="text"
                placeholder="City (e.g. Tokyo)"
                value={edit.city}
                onChange={(e) => setEdit({ ...edit, city: e.target.value })}
              />
              <IconInput
                type="text"
                placeholder="Country (e.g. Japan)"
                value={edit.country}
                onChange={(e) => setEdit({ ...edit, country: e.target.value })}
              />
              <IconInput
                type="text"
                placeholder="Telegram chat ID (e.g. -1001234567890)"
                value={edit.chatId}
                onChange={(e) => setEdit({ ...edit, chatId: e.target.value })}
              />
              <IconInput
                type="text"
                placeholder="Chat URL (optional, https://t.me/…)"
                value={edit.chatUrl}
                onChange={(e) => setEdit({ ...edit, chatUrl: e.target.value })}
              />
              <IconInput
                type="text"
                placeholder="Region (optional)"
                value={edit.region}
                onChange={(e) => setEdit({ ...edit, region: e.target.value })}
              />
              <IconInput
                type="text"
                placeholder="Underboss (optional)"
                value={edit.underboss}
                onChange={(e) => setEdit({ ...edit, underboss: e.target.value })}
              />
              <select
                value={edit.partyId}
                onChange={(e) => setEdit({ ...edit, partyId: e.target.value })}
                className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text focus:outline-none focus:border-theme-stroke-hover"
              >
                <option value="">— Not linked to an event —</option>
                {partyOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              <p className="text-xs text-theme-text-faint">
                Linking to an event lets broadcasts resolve the per-recipient
                {' '}<code className="text-red-500/80">{'{link}'}</code> and{' '}
                <code className="text-red-500/80">{'{appLink}'}</code> tokens.
              </p>
              {saveError && <p className="text-xs text-red-400">{saveError}</p>}
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-theme-stroke">
              <button
                onClick={() => setEdit(null)}
                disabled={saving}
                className="px-4 py-2 rounded-xl text-sm font-medium border border-theme-stroke text-theme-text-secondary hover:bg-theme-surface transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !edit.city.trim() || !edit.country.trim() || !edit.chatId.trim()}
                className="flex items-center gap-2 bg-[#E52828] hover:bg-[#cc2222] disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {edit.id ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
