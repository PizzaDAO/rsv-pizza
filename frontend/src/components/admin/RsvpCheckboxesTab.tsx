// lasagna-49278: Admin UI for managing DB-driven RSVP opt-in checkboxes.
//
// Lists all global rows (party_id IS NULL) with inline editing of every field.
// "+ New checkbox" modal creates a new row (global by default; can target a
// party). Per-event override picker accepts a party ID and shows that event's
// override rows.
//
// Allowed `opt_in_fields` values are hardcoded here AND on the backend — this
// list must stay in sync with backend ALLOWED_OPT_IN_FIELDS and useRSVPForm's
// `setOptInByField` switch.
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, RefreshCw, Save, RotateCcw, X } from 'lucide-react';
import {
  listRsvpCheckboxes,
  createRsvpCheckbox,
  updateRsvpCheckbox,
  deleteRsvpCheckbox,
  type RsvpCheckboxAdminRow,
  type RsvpCheckboxAdminInput,
} from '../../lib/api';
import { Checkbox } from '../Checkbox';
import { IconInput } from '../IconInput';
import { FALLBACK_CONFIG, invalidateRsvpCheckboxConfigCache } from '../../hooks/useRsvpCheckboxConfig';

const ALLOWED_OPT_IN_FIELDS = [
  'mailingListOptIn',
  'swcOptIn',
  'swcCaOptIn',
  'swcAuOptIn',
  'swcEuOptIn',
  'swcUkOptIn',
  'swcBrOptIn',
  'ethconfOptIn',
] as const;

const ACCENT_COLORS = ['red', 'purple'] as const;

const SEEDED_GLOBAL_IDS = new Set(FALLBACK_CONFIG.map((r) => r.id));

interface EditState {
  position: string;
  active: boolean;
  required_tags: string;
  excluded_tags: string;
  always_show: boolean;
  opt_in_fields: string[];
  combined_group: string;
  label_i18n_key: string;
  label_default: string;
  label_overrides: string;
  info_modal_i18n_ns: string;
  info_modal_privacy_url: string;
  info_modal_terms_url: string;
  info_modal_terms_key: string;
  modal_overrides: string;
  accent_color: string;
}

function rowToEdit(row: RsvpCheckboxAdminRow): EditState {
  return {
    position: String(row.position ?? 0),
    active: !!row.active,
    required_tags: (row.required_tags || []).join(', '),
    excluded_tags: (row.excluded_tags || []).join(', '),
    always_show: !!row.always_show,
    opt_in_fields: [...(row.opt_in_fields || [])],
    combined_group: row.combined_group ?? '',
    label_i18n_key: row.label_i18n_key ?? '',
    label_default: row.label_default ?? '',
    label_overrides: JSON.stringify(row.label_overrides ?? {}, null, 2),
    info_modal_i18n_ns: row.info_modal_i18n_ns ?? '',
    info_modal_privacy_url: row.info_modal_privacy_url ?? '',
    info_modal_terms_url: row.info_modal_terms_url ?? '',
    info_modal_terms_key: row.info_modal_terms_key ?? '',
    modal_overrides: JSON.stringify(row.modal_overrides ?? {}, null, 2),
    accent_color: row.accent_color ?? 'red',
  };
}

function editToPayload(s: EditState): RsvpCheckboxAdminInput {
  const splitTags = (raw: string) =>
    raw.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
  let labelOverrides: Record<string, string> = {};
  let modalOverrides: Record<string, unknown> = {};
  try {
    if (s.label_overrides.trim()) labelOverrides = JSON.parse(s.label_overrides);
  } catch (e) {
    throw new Error(`label_overrides is not valid JSON: ${(e as Error).message}`);
  }
  try {
    if (s.modal_overrides.trim()) modalOverrides = JSON.parse(s.modal_overrides);
  } catch (e) {
    throw new Error(`modal_overrides is not valid JSON: ${(e as Error).message}`);
  }
  return {
    position: Number(s.position) || 0,
    active: s.active,
    required_tags: splitTags(s.required_tags),
    excluded_tags: splitTags(s.excluded_tags),
    always_show: s.always_show,
    opt_in_fields: s.opt_in_fields,
    combined_group: s.combined_group || null,
    label_i18n_key: s.label_i18n_key || null,
    label_default: s.label_default || null,
    label_overrides: labelOverrides,
    info_modal_i18n_ns: s.info_modal_i18n_ns || null,
    info_modal_privacy_url: s.info_modal_privacy_url || null,
    info_modal_terms_url: s.info_modal_terms_url || null,
    info_modal_terms_key: s.info_modal_terms_key || null,
    modal_overrides: modalOverrides,
    accent_color: s.accent_color,
  };
}

function emptyEdit(): EditState {
  return {
    position: '0',
    active: true,
    required_tags: '',
    excluded_tags: '',
    always_show: false,
    opt_in_fields: [],
    combined_group: '',
    label_i18n_key: '',
    label_default: '',
    label_overrides: '{}',
    info_modal_i18n_ns: '',
    info_modal_privacy_url: '',
    info_modal_terms_url: '',
    info_modal_terms_key: '',
    modal_overrides: '{}',
    accent_color: 'red',
  };
}

interface RowEditorProps {
  row: RsvpCheckboxAdminRow;
  onSaved: (row: RsvpCheckboxAdminRow) => void;
  onDeleted: (id: string, partyId: string | null) => void;
}

function RowEditor({ row, onSaved, onDeleted }: RowEditorProps) {
  const [edit, setEdit] = useState<EditState>(() => rowToEdit(row));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSeededGlobal = !row.party_id && SEEDED_GLOBAL_IDS.has(row.id);

  useEffect(() => setEdit(rowToEdit(row)), [row]);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const payload = editToPayload(edit);
      const updated = await updateRsvpCheckbox(row.id, row.party_id, payload);
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    if (!isSeededGlobal) return;
    const seed = FALLBACK_CONFIG.find((r) => r.id === row.id);
    if (!seed) return;
    setError(null);
    setSaving(true);
    try {
      const payload: RsvpCheckboxAdminInput = {
        position: seed.position,
        active: seed.active,
        required_tags: seed.required_tags,
        excluded_tags: seed.excluded_tags,
        always_show: seed.always_show,
        opt_in_fields: seed.opt_in_fields,
        combined_group: seed.combined_group,
        label_i18n_key: seed.label_i18n_key,
        label_default: seed.label_default,
        label_overrides: seed.label_overrides,
        info_modal_i18n_ns: seed.info_modal_i18n_ns,
        info_modal_privacy_url: seed.info_modal_privacy_url,
        info_modal_terms_url: seed.info_modal_terms_url,
        info_modal_terms_key: seed.info_modal_terms_key,
        modal_overrides: seed.modal_overrides,
        accent_color: seed.accent_color,
      };
      const updated = await updateRsvpCheckbox(row.id, null, payload);
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    setError(null);
    setSaving(true);
    try {
      await deleteRsvpCheckbox(row.id, row.party_id ?? undefined);
      onDeleted(row.id, row.party_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const toggleField = (field: string) => {
    setEdit((s) => ({
      ...s,
      opt_in_fields: s.opt_in_fields.includes(field)
        ? s.opt_in_fields.filter((f) => f !== field)
        : [...s.opt_in_fields, field],
    }));
  };

  return (
    <div className="border border-theme-stroke rounded-xl p-4 bg-theme-surface mb-3">
      <div className="flex items-center gap-3 mb-3">
        <span className="font-mono text-sm font-semibold text-theme-text">{row.id}</span>
        {row.party_id && (
          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">override · party {row.party_id.slice(0, 8)}</span>
        )}
        {isSeededGlobal && (
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">seeded</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Checkbox checked={edit.active} onChange={() => setEdit((s) => ({ ...s, active: !s.active }))} label="active" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-xs text-theme-text-muted">
          position
          <IconInput
            icon={Plus}
            type="number"
            value={edit.position}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, position: e.target.value }))}
            placeholder="0"
          />
        </label>
        <label className="block text-xs text-theme-text-muted">
          accent_color
          <select
            value={edit.accent_color}
            onChange={(e) => setEdit((s) => ({ ...s, accent_color: e.target.value }))}
            className="w-full text-sm bg-white/50 border border-theme-stroke rounded-lg px-3 py-2 text-theme-text"
          >
            {ACCENT_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block text-xs text-theme-text-muted">
          required_tags (comma-separated; OR semantics)
          <IconInput icon={Plus} type="text" value={edit.required_tags} placeholder="swc, ethconf"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, required_tags: e.target.value }))} />
        </label>
        <label className="block text-xs text-theme-text-muted">
          excluded_tags (comma-separated)
          <IconInput icon={Plus} type="text" value={edit.excluded_tags} placeholder=""
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, excluded_tags: e.target.value }))} />
        </label>
        <div className="block text-xs text-theme-text-muted col-span-full">
          always_show
          <div className="mt-1">
            <Checkbox checked={edit.always_show} onChange={() => setEdit((s) => ({ ...s, always_show: !s.always_show }))} label={edit.always_show ? 'yes — renders on every event' : 'no — only when required_tags match'} />
          </div>
        </div>
        <div className="block text-xs text-theme-text-muted col-span-full">
          opt_in_fields (1+ required — destination columns this checkbox writes)
          <div className="flex flex-wrap gap-2 mt-1">
            {ALLOWED_OPT_IN_FIELDS.map((f) => (
              <button
                type="button"
                key={f}
                onClick={() => toggleField(f)}
                className={`px-2 py-1 rounded text-xs font-mono ${edit.opt_in_fields.includes(f) ? 'bg-red-500/20 text-red-700 border border-red-500/30' : 'bg-theme-surface border border-theme-stroke text-theme-text-muted hover:bg-theme-surface-hover'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <label className="block text-xs text-theme-text-muted col-span-full">
          combined_group (group key — rows sharing one render as ONE combined checkbox)
          <IconInput icon={Plus} type="text" value={edit.combined_group} placeholder="pizzadao_partners"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, combined_group: e.target.value }))} />
        </label>
        <label className="block text-xs text-theme-text-muted">
          label_i18n_key
          <IconInput icon={Plus} type="text" value={edit.label_i18n_key} placeholder="step1.mailingList"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, label_i18n_key: e.target.value }))} />
        </label>
        <label className="block text-xs text-theme-text-muted">
          label_default (English literal)
          <IconInput icon={Plus} type="text" value={edit.label_default} placeholder="Sign me up"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, label_default: e.target.value }))} />
        </label>
        <label className="block text-xs text-theme-text-muted col-span-full">
          label_overrides (JSON: {`{"pt":"...","de":"..."}`})
          <IconInput icon={Plus} multiline rows={3} value={edit.label_overrides} placeholder="{}"
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEdit((s) => ({ ...s, label_overrides: e.target.value }))} />
        </label>
        <label className="block text-xs text-theme-text-muted">
          info_modal_i18n_ns
          <IconInput icon={Plus} type="text" value={edit.info_modal_i18n_ns} placeholder="swcModal"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, info_modal_i18n_ns: e.target.value }))} />
        </label>
        <label className="block text-xs text-theme-text-muted">
          info_modal_terms_key
          <select value={edit.info_modal_terms_key} onChange={(e) => setEdit((s) => ({ ...s, info_modal_terms_key: e.target.value }))}
            className="w-full text-sm bg-white/50 border border-theme-stroke rounded-lg px-3 py-2 text-theme-text">
            <option value="">—</option>
            <option value="termsConditions">termsConditions</option>
            <option value="termsOfService">termsOfService</option>
          </select>
        </label>
        <label className="block text-xs text-theme-text-muted">
          info_modal_privacy_url
          <IconInput icon={Plus} type="url" value={edit.info_modal_privacy_url} placeholder="https://…/privacy"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, info_modal_privacy_url: e.target.value }))} />
        </label>
        <label className="block text-xs text-theme-text-muted">
          info_modal_terms_url
          <IconInput icon={Plus} type="url" value={edit.info_modal_terms_url} placeholder="https://…/terms"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, info_modal_terms_url: e.target.value }))} />
        </label>
        <label className="block text-xs text-theme-text-muted col-span-full">
          modal_overrides (JSON: {`{"en":{"title":"...","description":"...","privacyUrl":"..."}}`})
          <IconInput icon={Plus} multiline rows={4} value={edit.modal_overrides} placeholder="{}"
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEdit((s) => ({ ...s, modal_overrides: e.target.value }))} />
        </label>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      )}

      <div className="flex items-center gap-2 mt-4">
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E52828] text-white text-sm font-medium hover:bg-[#CC2020] transition-colors disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </button>
        {isSeededGlobal && (
          <button onClick={resetToDefault} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/60 border border-theme-stroke text-sm font-medium hover:bg-white/80 transition-colors disabled:opacity-50">
            <RotateCcw size={14} />
            Reset to defaults
          </button>
        )}
        {(!isSeededGlobal || row.party_id) && (
          <button onClick={del} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-50 border border-red-300 text-red-700 text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-50">
            <Trash2 size={14} />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

interface NewRowModalProps {
  defaultPartyId?: string;
  onClose: () => void;
  onCreated: (row: RsvpCheckboxAdminRow) => void;
}

function NewRowModal({ defaultPartyId, onClose, onCreated }: NewRowModalProps) {
  const [newId, setNewId] = useState('');
  const [partyId, setPartyId] = useState(defaultPartyId ?? '');
  const [edit, setEdit] = useState<EditState>(emptyEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleField = (field: string) => {
    setEdit((s) => ({
      ...s,
      opt_in_fields: s.opt_in_fields.includes(field)
        ? s.opt_in_fields.filter((f) => f !== field)
        : [...s.opt_in_fields, field],
    }));
  };

  async function create() {
    setError(null);
    if (!newId.trim()) {
      setError('id is required');
      return;
    }
    if (edit.opt_in_fields.length === 0) {
      setError('opt_in_fields must include at least one entry');
      return;
    }
    setSaving(true);
    try {
      const payload = editToPayload(edit);
      const row = await createRsvpCheckbox({ ...payload, id: newId.trim(), party_id: partyId.trim() || null });
      onCreated(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 text-theme-text-muted hover:text-theme-text">
          <X size={20} />
        </button>
        <h3 className="text-lg font-bold text-theme-text mb-4">New checkbox</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-xs text-theme-text-muted">
            id (stable handle)
            <IconInput icon={Plus} type="text" value={newId} placeholder="my_partner_optin"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewId(e.target.value)} />
          </label>
          <label className="block text-xs text-theme-text-muted">
            party_id (leave blank for global)
            <IconInput icon={Plus} type="text" value={partyId} placeholder="UUID"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPartyId(e.target.value)} />
          </label>
          <label className="block text-xs text-theme-text-muted">
            position
            <IconInput icon={Plus} type="number" value={edit.position}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, position: e.target.value }))} />
          </label>
          <label className="block text-xs text-theme-text-muted">
            accent_color
            <select value={edit.accent_color} onChange={(e) => setEdit((s) => ({ ...s, accent_color: e.target.value }))}
              className="w-full text-sm bg-white/50 border border-theme-stroke rounded-lg px-3 py-2 text-theme-text">
              {ACCENT_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block text-xs text-theme-text-muted">
            required_tags
            <IconInput icon={Plus} type="text" value={edit.required_tags} placeholder="swc, ethconf"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, required_tags: e.target.value }))} />
          </label>
          <label className="block text-xs text-theme-text-muted">
            excluded_tags
            <IconInput icon={Plus} type="text" value={edit.excluded_tags}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, excluded_tags: e.target.value }))} />
          </label>
          <div className="col-span-full">
            <span className="block text-xs text-theme-text-muted mb-1">always_show</span>
            <Checkbox checked={edit.always_show} onChange={() => setEdit((s) => ({ ...s, always_show: !s.always_show }))} label="render on every event" />
          </div>
          <div className="col-span-full">
            <span className="block text-xs text-theme-text-muted mb-1">opt_in_fields</span>
            <div className="flex flex-wrap gap-2">
              {ALLOWED_OPT_IN_FIELDS.map((f) => (
                <button type="button" key={f} onClick={() => toggleField(f)}
                  className={`px-2 py-1 rounded text-xs font-mono ${edit.opt_in_fields.includes(f) ? 'bg-red-500/20 text-red-700 border border-red-500/30' : 'bg-theme-surface border border-theme-stroke text-theme-text-muted hover:bg-theme-surface-hover'}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <label className="block text-xs text-theme-text-muted col-span-full">
            combined_group
            <IconInput icon={Plus} type="text" value={edit.combined_group}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, combined_group: e.target.value }))} />
          </label>
          <label className="block text-xs text-theme-text-muted">
            label_i18n_key
            <IconInput icon={Plus} type="text" value={edit.label_i18n_key}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, label_i18n_key: e.target.value }))} />
          </label>
          <label className="block text-xs text-theme-text-muted">
            label_default
            <IconInput icon={Plus} type="text" value={edit.label_default}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEdit((s) => ({ ...s, label_default: e.target.value }))} />
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={create} disabled={saving} className="px-4 py-2 rounded-lg bg-[#E52828] text-white text-sm font-medium hover:bg-[#CC2020] transition-colors disabled:opacity-50">
            {saving ? 'Creating…' : 'Create'}
          </button>
          <button onClick={onClose} className="px-3 py-2 rounded-lg bg-white/60 border border-theme-stroke text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function RsvpCheckboxesTab() {
  const [globalRows, setGlobalRows] = useState<RsvpCheckboxAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  // Per-event override state.
  const [partyLookup, setPartyLookup] = useState('');
  const [activePartyId, setActivePartyId] = useState<string | null>(null);
  const [overrideRows, setOverrideRows] = useState<RsvpCheckboxAdminRow[]>([]);
  const [overridesLoading, setOverridesLoading] = useState(false);
  const [showNewForParty, setShowNewForParty] = useState(false);

  const reloadGlobal = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listRsvpCheckboxes();
      // Filter to global rows only — the override picker handles per-party.
      setGlobalRows(rows.filter((r) => !r.party_id).sort((a, b) => a.position - b.position));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadOverrides = useCallback(async (partyId: string) => {
    setOverridesLoading(true);
    try {
      const rows = await listRsvpCheckboxes(partyId);
      setOverrideRows(rows.sort((a, b) => a.position - b.position));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOverridesLoading(false);
    }
  }, []);

  useEffect(() => { reloadGlobal(); }, [reloadGlobal]);

  const handleSaved = (row: RsvpCheckboxAdminRow) => {
    invalidateRsvpCheckboxConfigCache();
    if (row.party_id) {
      setOverrideRows((prev) => prev.map((r) => r.id === row.id && r.party_id === row.party_id ? row : r));
    } else {
      setGlobalRows((prev) => prev.map((r) => r.id === row.id && !r.party_id ? row : r));
    }
  };

  const handleDeleted = (id: string, partyId: string | null) => {
    invalidateRsvpCheckboxConfigCache();
    if (partyId) {
      setOverrideRows((prev) => prev.filter((r) => !(r.id === id && r.party_id === partyId)));
    } else {
      setGlobalRows((prev) => prev.filter((r) => !(r.id === id && !r.party_id)));
    }
  };

  const handleCreated = (row: RsvpCheckboxAdminRow) => {
    invalidateRsvpCheckboxConfigCache();
    if (row.party_id) {
      setOverrideRows((prev) => [...prev, row].sort((a, b) => a.position - b.position));
    } else {
      setGlobalRows((prev) => [...prev, row].sort((a, b) => a.position - b.position));
    }
    setShowNew(false);
    setShowNewForParty(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-lg font-semibold text-theme-text">Global RSVP checkboxes ({globalRows.length})</h3>
        <button onClick={reloadGlobal} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/60 border border-theme-stroke text-sm hover:bg-white/80">
          <RefreshCw size={14} /> Refresh
        </button>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E52828] text-white text-sm font-medium hover:bg-[#CC2020]">
          <Plus size={14} /> New checkbox
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 rounded-lg text-sm bg-red-100 text-red-700 border border-red-300">
          {error}
        </div>
      )}

      <p className="text-sm text-theme-text-muted mb-4">
        These rows configure the opt-in checkboxes on the RSVP form. Per-event overrides below take precedence over the matching global row when a guest RSVPs to that event.
      </p>

      {globalRows.map((row) => (
        <RowEditor key={`${row.id}|global`} row={row} onSaved={handleSaved} onDeleted={handleDeleted} />
      ))}

      {/* Per-event override picker */}
      <div className="mt-8 border-t border-theme-stroke pt-6">
        <h3 className="text-lg font-semibold text-theme-text mb-3">Per-event overrides</h3>
        <p className="text-sm text-theme-text-muted mb-3">
          Paste a party id (UUID) and click Load. Overrides shown below replace the matching global row for that event only.
        </p>
        <div className="flex items-center gap-2 mb-4">
          <IconInput icon={Plus} type="text" value={partyLookup} placeholder="party UUID"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPartyLookup(e.target.value)} />
          <button
            onClick={() => {
              const trimmed = partyLookup.trim();
              if (!trimmed) return;
              setActivePartyId(trimmed);
              reloadOverrides(trimmed);
            }}
            className="px-4 py-2 rounded-lg bg-[#E52828] text-white text-sm font-medium hover:bg-[#CC2020]"
          >
            Load
          </button>
          {activePartyId && (
            <button
              onClick={() => setShowNewForParty(true)}
              className="px-3 py-2 rounded-lg bg-white/60 border border-theme-stroke text-sm font-medium hover:bg-white/80"
            >
              <Plus size={14} className="inline mr-1" />
              New override
            </button>
          )}
        </div>

        {overridesLoading ? (
          <Loader2 size={20} className="animate-spin text-theme-text-muted" />
        ) : (
          activePartyId && (
            <>
              {overrideRows.length === 0 ? (
                <p className="text-sm text-theme-text-faint">No override rows for party {activePartyId}.</p>
              ) : (
                overrideRows.map((row) => (
                  <RowEditor key={`${row.id}|${row.party_id}`} row={row} onSaved={handleSaved} onDeleted={handleDeleted} />
                ))
              )}
            </>
          )
        )}
      </div>

      {showNew && <NewRowModal onClose={() => setShowNew(false)} onCreated={handleCreated} />}
      {showNewForParty && activePartyId && (
        <NewRowModal defaultPartyId={activePartyId} onClose={() => setShowNewForParty(false)} onCreated={handleCreated} />
      )}
    </div>
  );
}
