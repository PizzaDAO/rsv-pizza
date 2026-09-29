import { useEffect, useState, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { Loader2, Shield, Plus, Trash2, Tag, Type, Image, Palette, Wallet, FileText, Calendar, Clock } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { IconInput } from '../components/IconInput';
import { Checkbox } from '../components/Checkbox';
import { useTheme } from '../contexts/ThemeContext';
import {
  fetchAdminMe,
  fetchEventSeriesList,
  createEventSeries,
  updateEventSeries,
  fetchSeriesChecklist,
  addSeriesChecklistDefault,
  deleteSeriesChecklistDefault,
  type EventSeries,
  type SeriesChecklistDefault,
  type SeriesInput,
} from '../lib/api';

/**
 * White-label admin: create/edit event series (like GPP) and manage each
 * series' host-checklist defaults. Super-admin only (the API enforces this too).
 */

const BLANK_FORM = {
  slug: '',
  name: '',
  displayName: '',
  description: '',
  themeClass: '',
  logoUrl: '',
  ogImageUrl: '',
  fundingWalletAddress: '',
  publicTags: '',
  eventDate: '',
  eventStartTime: '',
  eventEndTime: '',
  isActive: true,
  requireApproval: true,
  hideGuests: false,
  photosEnabled: true,
  photosPublic: true,
};
type FormState = typeof BLANK_FORM;

function seriesToForm(s: EventSeries): FormState {
  return {
    slug: s.slug,
    name: s.name,
    displayName: s.displayName,
    description: s.description ?? '',
    themeClass: s.themeClass ?? '',
    logoUrl: s.logoUrl ?? '',
    ogImageUrl: s.ogImageUrl ?? '',
    fundingWalletAddress: s.fundingWalletAddress ?? '',
    publicTags: (s.publicTags ?? []).join(', '),
    eventDate: s.eventDate ? s.eventDate.slice(0, 10) : '',
    eventStartTime: s.eventStartTime ?? '',
    eventEndTime: s.eventEndTime ?? '',
    isActive: s.isActive,
    requireApproval: s.requireApproval,
    hideGuests: s.hideGuests,
    photosEnabled: s.photosEnabled,
    photosPublic: s.photosPublic,
  };
}

function formToInput(f: FormState): SeriesInput {
  return {
    slug: f.slug.trim().toLowerCase(),
    name: f.name.trim(),
    displayName: f.displayName.trim() || f.name.trim(),
    description: f.description.trim() || null,
    themeClass: f.themeClass.trim() || null,
    logoUrl: f.logoUrl.trim() || null,
    ogImageUrl: f.ogImageUrl.trim() || null,
    fundingWalletAddress: f.fundingWalletAddress.trim() || null,
    publicTags: f.publicTags.split(',').map((t) => t.trim()).filter(Boolean),
    eventDate: f.eventDate || null,
    eventStartTime: f.eventStartTime.trim() || null,
    eventEndTime: f.eventEndTime.trim() || null,
    isActive: f.isActive,
    requireApproval: f.requireApproval,
    hideGuests: f.hideGuests,
    photosEnabled: f.photosEnabled,
    photosPublic: f.photosPublic,
  };
}

export function AdminSeriesPage() {
  const { themeClass, backgroundStyle } = useTheme();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');

  const [series, setSeries] = useState<EventSeries[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null); // null = "create new"
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const [checklist, setChecklist] = useState<SeriesChecklistDefault[]>([]);
  const [newItemName, setNewItemName] = useState('');

  const refreshSeries = useCallback(async () => {
    const res = await fetchEventSeriesList();
    setSeries(res.series);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await fetchAdminMe();
        if (!me.isAdmin || me.role !== 'super_admin') {
          setAllowed(false);
          setLoading(false);
          return;
        }
        setAllowed(true);
        await refreshSeries();
      } catch (e: any) {
        setError(e?.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshSeries]);

  const selectSeries = useCallback(async (s: EventSeries | null) => {
    setSaveMsg('');
    if (!s) {
      setSelectedId(null);
      setForm(BLANK_FORM);
      setChecklist([]);
      return;
    }
    setSelectedId(s.id);
    setForm(seriesToForm(s));
    try {
      const res = await fetchSeriesChecklist(s.id);
      setChecklist(res.items);
    } catch {
      setChecklist([]);
    }
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const input = formToInput(form);
      if (selectedId) {
        const { series: updated } = await updateEventSeries(selectedId, input);
        setSaveMsg(`Saved “${updated.name}”.`);
      } else {
        const { series: created } = await createEventSeries(input);
        setSaveMsg(`Created “${created.name}”.`);
        setSelectedId(created.id);
      }
      await refreshSeries();
    } catch (e: any) {
      setSaveMsg(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAddItem = async () => {
    if (!selectedId || !newItemName.trim()) return;
    try {
      const { item } = await addSeriesChecklistDefault(selectedId, { name: newItemName.trim() });
      setChecklist((c) => [...c, item]);
      setNewItemName('');
    } catch (e: any) {
      setSaveMsg(e?.message || 'Failed to add item');
    }
  };

  const handleDeleteItem = async (id: string) => {
    try {
      await deleteSeriesChecklistDefault(id);
      setChecklist((c) => c.filter((i) => i.id !== id));
    } catch (e: any) {
      setSaveMsg(e?.message || 'Failed to delete item');
    }
  };

  if (loading) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-theme-text-muted" />
        </div>
        <Footer />
      </div>
    );
  }

  if (!allowed || error) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-red-400/60 mb-4" />
          <h1 className="text-2xl font-bold mb-2 text-theme-text">Super admin only</h1>
          <p className="text-theme-text-muted text-center max-w-md">
            {error || 'You need super-admin access to manage event series.'}
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
      <Helmet><title>Event Series | Admin</title></Helmet>
      <Header />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-theme-text">Event Series</h1>
          <button
            type="button"
            onClick={() => selectSeries(null)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#E52828] text-white hover:bg-[#CC2020] text-sm"
          >
            <Plus size={16} /> New series
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6">
          {/* Series list */}
          <div className="space-y-1">
            {series.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => selectSeries(s)}
                className={`w-full text-left px-3 py-2 rounded-lg border ${
                  selectedId === s.id ? 'border-theme-accent bg-theme-surface' : 'border-theme-stroke hover:bg-theme-surface-hover'
                }`}
              >
                <div className="text-sm font-medium text-theme-text">{s.name}</div>
                <div className="text-xs text-theme-text-muted font-mono">
                  {s.slug}{s.isActive ? '' : ' · inactive'}
                </div>
              </button>
            ))}
            {series.length === 0 && (
              <p className="text-xs text-theme-text-muted px-1">No series yet.</p>
            )}
          </div>

          {/* Editor */}
          <div className="space-y-4">
            <div className="text-sm font-semibold text-theme-text">
              {selectedId ? 'Edit series' : 'Create a new series'}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <IconInput icon={Tag} placeholder="slug (e.g. acme-2026)" value={form.slug}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('slug', e.target.value)}
                disabled={!!selectedId} />
              <IconInput icon={Type} placeholder="Name (e.g. Acme Pizza Party 2026)" value={form.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('name', e.target.value)} />
              <IconInput icon={Type} placeholder="Display name (shown in UI)" value={form.displayName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('displayName', e.target.value)} />
              <IconInput icon={Palette} placeholder="Theme class (e.g. acme-theme)" value={form.themeClass}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('themeClass', e.target.value)} />
              <IconInput icon={Image} placeholder="Logo URL" value={form.logoUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('logoUrl', e.target.value)} />
              <IconInput icon={Image} placeholder="OG / social image URL" value={form.ogImageUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('ogImageUrl', e.target.value)} />
              <IconInput icon={Tag} placeholder="Public tags (comma-separated)" value={form.publicTags}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('publicTags', e.target.value)} />
              <IconInput icon={Wallet} placeholder="Reimbursement wallet (config only — no auto-send yet)" value={form.fundingWalletAddress}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('fundingWalletAddress', e.target.value)} />
              <IconInput icon={Calendar} type="date" placeholder="Event date" value={form.eventDate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('eventDate', e.target.value)} />
              <IconInput icon={Clock} placeholder="Start time (HH:MM)" value={form.eventStartTime}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('eventStartTime', e.target.value)} />
              <IconInput icon={Clock} placeholder="End time (HH:MM)" value={form.eventEndTime}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('eventEndTime', e.target.value)} />
            </div>

            <IconInput icon={FileText} multiline rows={5} placeholder="Description (shown on the series landing / event pages)"
              value={form.description}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('description', e.target.value)} />

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Checkbox checked={form.isActive} onChange={() => set('isActive', !form.isActive)} label="Active" size={16} labelClassName="text-sm text-theme-text-secondary" />
              <Checkbox checked={form.requireApproval} onChange={() => set('requireApproval', !form.requireApproval)} label="Require approval" size={16} labelClassName="text-sm text-theme-text-secondary" />
              <Checkbox checked={form.hideGuests} onChange={() => set('hideGuests', !form.hideGuests)} label="Hide guests" size={16} labelClassName="text-sm text-theme-text-secondary" />
              <Checkbox checked={form.photosEnabled} onChange={() => set('photosEnabled', !form.photosEnabled)} label="Photos enabled" size={16} labelClassName="text-sm text-theme-text-secondary" />
              <Checkbox checked={form.photosPublic} onChange={() => set('photosPublic', !form.photosPublic)} label="Photos public" size={16} labelClassName="text-sm text-theme-text-secondary" />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !form.slug.trim() || !form.name.trim()}
                className="px-4 py-2 rounded-lg bg-[#E52828] text-white hover:bg-[#CC2020] text-sm disabled:opacity-50"
              >
                {saving ? 'Saving…' : selectedId ? 'Save changes' : 'Create series'}
              </button>
              {saveMsg && <span className="text-sm text-theme-text-muted">{saveMsg}</span>}
            </div>

            {/* Per-series checklist */}
            {selectedId && (
              <div className="mt-6 border-t border-theme-stroke pt-4">
                <div className="text-sm font-semibold text-theme-text mb-1">Host checklist</div>
                <p className="text-xs text-theme-text-muted mb-3">
                  Items here override the global template for this series. Leave empty to use the global checklist.
                </p>
                <div className="space-y-1 mb-3">
                  {checklist.map((item) => (
                    <div key={item.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-theme-surface">
                      <span className="text-sm text-theme-text">{item.name}</span>
                      <button type="button" onClick={() => handleDeleteItem(item.id)}
                        className="text-theme-text-faint hover:text-[#E52828]" aria-label="Delete item">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  {checklist.length === 0 && (
                    <p className="text-xs text-theme-text-muted">No series-specific items — using the global template.</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <IconInput icon={Plus} placeholder="New checklist item name" value={newItemName}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewItemName(e.target.value)}
                      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') handleAddItem(); }} />
                  </div>
                  <button type="button" onClick={handleAddItem} disabled={!newItemName.trim()}
                    className="px-3 py-2 rounded-lg bg-theme-surface-hover text-theme-text text-sm disabled:opacity-50">
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default AdminSeriesPage;
