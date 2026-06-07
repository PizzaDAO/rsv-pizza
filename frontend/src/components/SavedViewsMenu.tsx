import { useState, useCallback } from 'react';
import { Bookmark, ChevronDown, X, Loader2, Save } from 'lucide-react';
import { IconInput } from './IconInput';
import {
  listSavedViews,
  saveFilterView,
  deleteSavedView,
  type SavedView,
  type SavedViewScope,
} from '../lib/api';

// montanara-58497: compact "Views" dropdown shared by /payments + /underboss.
// Lists the caller's saved filter views (per-account, server-side), applies one
// on click, and lets the caller save the CURRENT params under a name. `params`
// is the page's serialized URL query string — fully page-agnostic here.
interface SavedViewsMenuProps {
  scope: SavedViewScope;
  currentParams: string;
  onApply: (params: string) => void;
}

export function SavedViewsMenu({ scope, currentParams, onApply }: SavedViewsMenuProps) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listSavedViews(scope);
      setViews(list);
    } catch (e: any) {
      setError(e?.message || 'Failed to load views');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  function toggleOpen() {
    setOpen((prev) => {
      const next = !prev;
      if (next) void refresh();
      return next;
    });
  }

  async function handleSave() {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveFilterView(scope, name, currentParams);
      setNewName('');
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to save view');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await deleteSavedView(id);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete view');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggleOpen}
        className="flex items-center gap-1.5 rounded-lg border border-theme-stroke bg-theme-surface px-3 py-1.5 text-sm text-theme-text-secondary transition-colors hover:border-theme-stroke-hover hover:text-theme-text"
      >
        <Bookmark size={14} />
        Views
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 z-50 mt-1 w-72 rounded-lg border border-theme-stroke bg-theme-header py-1 shadow-xl">
            {/* List */}
            <div className="max-h-72 overflow-y-auto">
              {loading ? (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-theme-text-faint">
                  <Loader2 size={14} className="animate-spin" /> Loading…
                </div>
              ) : views.length === 0 ? (
                <div className="px-3 py-3 text-sm text-theme-text-faint">No saved views</div>
              ) : (
                views.map((view) => (
                  <div
                    key={view.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-theme-surface"
                  >
                    <button
                      onClick={() => {
                        onApply(view.params);
                        setOpen(false);
                      }}
                      className="flex-1 truncate text-left text-sm text-theme-text"
                      title={view.name}
                    >
                      {view.name}
                    </button>
                    <button
                      onClick={() => handleDelete(view.id)}
                      disabled={deletingId === view.id}
                      className="shrink-0 p-0.5 text-theme-text-faint transition-colors hover:text-red-500 disabled:opacity-50"
                      aria-label={`Delete ${view.name}`}
                      title="Delete view"
                    >
                      {deletingId === view.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                    </button>
                  </div>
                ))
              )}
            </div>

            {error && (
              <div className="px-3 py-1.5 text-xs text-red-500">{error}</div>
            )}

            {/* Save current view */}
            <div className="mt-1 border-t border-theme-stroke px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <IconInput
                    icon={Save}
                    iconSize={13}
                    type="text"
                    value={newName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Enter') void handleSave();
                    }}
                    placeholder="Save current view…"
                    maxLength={80}
                    className="rounded-lg border border-theme-stroke bg-theme-surface !pl-9 pr-2 py-1.5 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
                  />
                </div>
                <button
                  onClick={() => void handleSave()}
                  disabled={!newName.trim() || saving}
                  className="shrink-0 rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
