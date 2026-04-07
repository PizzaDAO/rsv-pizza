import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Handshake, Plus, X, Edit2, Trash2, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { fetchSponsorUsers, createSponsorUser, updateSponsorUser, deleteSponsorUser } from '../../lib/api';
import type { SponsorUser } from '../../types';

interface PartnerManagerProps {
  onSyncComplete?: () => void;
}

interface PartnerFormData {
  email: string;
  tag: string;
  name: string;
  notes: string;
  coHostName: string;
  coHostWebsite: string;
  coHostTwitter: string;
  coHostInstagram: string;
  coHostAvatarUrl: string;
  coHostLogoUrl: string;
  autoCoHost: boolean;
  autoSponsor: boolean;
}

const emptyForm: PartnerFormData = {
  email: '',
  tag: '',
  name: '',
  notes: '',
  coHostName: '',
  coHostWebsite: '',
  coHostTwitter: '',
  coHostInstagram: '',
  coHostAvatarUrl: '',
  coHostLogoUrl: '',
  autoCoHost: false,
  autoSponsor: false,
};

function sponsorUserToForm(su: SponsorUser): PartnerFormData {
  return {
    email: su.email,
    tag: su.tag,
    name: su.name || '',
    notes: su.notes || '',
    coHostName: su.coHostName || '',
    coHostWebsite: su.coHostWebsite || '',
    coHostTwitter: su.coHostTwitter || '',
    coHostInstagram: su.coHostInstagram || '',
    coHostAvatarUrl: su.coHostAvatarUrl || '',
    coHostLogoUrl: su.coHostLogoUrl || '',
    autoCoHost: su.autoCoHost,
    autoSponsor: su.autoSponsor,
  };
}

export function PartnerManager({ onSyncComplete }: PartnerManagerProps) {
  const [partners, setPartners] = useState<SponsorUser[]>([]);
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PartnerFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const loadPartners = useCallback(async () => {
    try {
      setLoading(true);
      const result = await fetchSponsorUsers();
      setPartners(result.sponsorUsers);
      setTagCounts(result.tagCounts);
    } catch (err: any) {
      setError(err.message || 'Failed to load partners');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPartners();
  }, [loadPartners]);

  const openCreateModal = () => {
    setForm(emptyForm);
    setEditingId(null);
    setSaveError(null);
    setSyncMessage(null);
    setShowModal(true);
  };

  const openEditModal = (partner: SponsorUser) => {
    setForm(sponsorUserToForm(partner));
    setEditingId(partner.id);
    setSaveError(null);
    setSyncMessage(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setForm(emptyForm);
    setSaveError(null);
    setSyncMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.tag) return;

    setSaving(true);
    setSaveError(null);
    setSyncMessage(null);

    try {
      if (editingId) {
        const result = await updateSponsorUser(editingId, {
          email: form.email,
          tag: form.tag,
          name: form.name || undefined,
          notes: form.notes || undefined,
          coHostName: form.coHostName || undefined,
          coHostWebsite: form.coHostWebsite || undefined,
          coHostTwitter: form.coHostTwitter || undefined,
          coHostInstagram: form.coHostInstagram || undefined,
          coHostAvatarUrl: form.coHostAvatarUrl || undefined,
          coHostLogoUrl: form.coHostLogoUrl || undefined,
          autoCoHost: form.autoCoHost,
          autoSponsor: form.autoSponsor,
        });
        if (result.syncedCount > 0) {
          setSyncMessage(`Synced to ${result.syncedCount} event${result.syncedCount > 1 ? 's' : ''}`);
        }
      } else {
        const result = await createSponsorUser({
          email: form.email,
          tag: form.tag,
          name: form.name || undefined,
          notes: form.notes || undefined,
          coHostName: form.coHostName || undefined,
          coHostWebsite: form.coHostWebsite || undefined,
          coHostTwitter: form.coHostTwitter || undefined,
          coHostInstagram: form.coHostInstagram || undefined,
          coHostAvatarUrl: form.coHostAvatarUrl || undefined,
          coHostLogoUrl: form.coHostLogoUrl || undefined,
          autoCoHost: form.autoCoHost,
          autoSponsor: form.autoSponsor,
        });
        if (result.syncedCount > 0) {
          setSyncMessage(`Synced to ${result.syncedCount} event${result.syncedCount > 1 ? 's' : ''}`);
        }
      }
      await loadPartners();
      onSyncComplete?.();
      if (!syncMessage) {
        closeModal();
      }
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save partner');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deactivate this partner? This will remove their co-host entries from all events.')) return;
    try {
      await deleteSponsorUser(id);
      await loadPartners();
      onSyncComplete?.();
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate partner');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw size={20} className="animate-spin text-theme-text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-red-400">
        <AlertCircle size={16} />
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Handshake size={18} className="text-theme-text-muted" />
          <h3 className="text-sm font-semibold text-theme-text">
            Partners ({partners.length})
          </h3>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-1.5 text-sm text-red-500/70 hover:text-red-500 transition-colors"
        >
          <Plus size={14} />
          Add Partner
        </button>
      </div>

      {/* Partners List */}
      {partners.length === 0 ? (
        <p className="text-sm text-theme-text-faint text-center py-8">
          No partners configured. Add a partner to auto-add them as co-hosts on tagged events.
        </p>
      ) : (
        <div className="space-y-2">
          {partners.map((partner) => (
            <div
              key={partner.id}
              className={`p-3 rounded-xl border transition-colors ${
                partner.isActive
                  ? 'bg-theme-surface border-theme-stroke'
                  : 'bg-theme-surface/50 border-theme-stroke/50 opacity-60'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Avatar */}
                {partner.coHostAvatarUrl ? (
                  <img
                    src={partner.coHostAvatarUrl}
                    alt={partner.coHostName || partner.name || ''}
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
                    <Handshake size={16} className="text-purple-400" />
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-theme-text truncate">
                      {partner.coHostName || partner.name || partner.email}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-purple-500/20 text-purple-400 border-purple-500/30">
                      {partner.tag}
                    </span>
                    {!partner.isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-red-500/20 text-red-400 border-red-500/30">
                        inactive
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-theme-text-faint truncate">{partner.email}</div>
                  <div className="flex items-center gap-3 mt-1">
                    {partner.autoCoHost && (
                      <span className="text-[10px] text-green-400 flex items-center gap-1">
                        <Check size={10} /> Auto co-host
                      </span>
                    )}
                    {partner.autoSponsor && (
                      <span className="text-[10px] text-blue-400 flex items-center gap-1">
                        <Check size={10} /> Auto sponsor
                      </span>
                    )}
                    <span className="text-[10px] text-theme-text-faint">
                      {tagCounts[partner.tag] || 0} event{(tagCounts[partner.tag] || 0) !== 1 ? 's' : ''} tagged
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEditModal(partner)}
                    className="p-1.5 text-theme-text-faint hover:text-theme-text-muted transition-colors"
                    title="Edit partner"
                  >
                    <Edit2 size={14} />
                  </button>
                  {partner.isActive && (
                    <button
                      onClick={() => handleDelete(partner.id)}
                      className="p-1.5 text-theme-text-faint hover:text-red-400 transition-colors"
                      title="Deactivate partner"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={closeModal}>
          <div className="bg-theme-card border border-theme-stroke rounded-2xl shadow-xl max-w-lg w-full p-5 my-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-theme-text">
                {editingId ? 'Edit Partner' : 'Add Partner'}
              </h3>
              <button onClick={closeModal} className="text-theme-text-faint hover:text-theme-text-secondary">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              {/* Basic Info */}
              <div className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-1">Account</div>
              <IconInput
                value={form.email}
                onChange={(v) => setForm({ ...form, email: v })}
                placeholder="Email *"
                type="email"
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <IconInput
                  value={form.tag}
                  onChange={(v) => setForm({ ...form, tag: v })}
                  placeholder="Event tag *"
                  required
                />
                <IconInput
                  value={form.name}
                  onChange={(v) => setForm({ ...form, name: v })}
                  placeholder="Contact name"
                />
              </div>

              {/* Co-Host Profile */}
              <div className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mt-4 mb-1">Co-Host Profile</div>
              <IconInput
                value={form.coHostName}
                onChange={(v) => setForm({ ...form, coHostName: v })}
                placeholder="Display name (shown on events)"
              />
              <div className="grid grid-cols-2 gap-3">
                <IconInput
                  value={form.coHostWebsite}
                  onChange={(v) => setForm({ ...form, coHostWebsite: v })}
                  placeholder="Website"
                />
                <IconInput
                  value={form.coHostAvatarUrl}
                  onChange={(v) => setForm({ ...form, coHostAvatarUrl: v })}
                  placeholder="Avatar URL"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <IconInput
                  value={form.coHostTwitter}
                  onChange={(v) => setForm({ ...form, coHostTwitter: v })}
                  placeholder="Twitter (no @)"
                />
                <IconInput
                  value={form.coHostInstagram}
                  onChange={(v) => setForm({ ...form, coHostInstagram: v })}
                  placeholder="Instagram (no @)"
                />
              </div>
              <IconInput
                value={form.coHostLogoUrl}
                onChange={(v) => setForm({ ...form, coHostLogoUrl: v })}
                placeholder="Logo URL (for sponsor records)"
              />

              {/* Avatar Preview */}
              {form.coHostAvatarUrl && (
                <div className="flex items-center gap-2">
                  <img
                    src={form.coHostAvatarUrl}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <span className="text-xs text-theme-text-faint">Avatar preview</span>
                </div>
              )}

              {/* Toggles */}
              <div className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mt-4 mb-1">Automation</div>
              <div className="space-y-2">
                <Checkbox
                  checked={form.autoCoHost}
                  onChange={() => setForm({ ...form, autoCoHost: !form.autoCoHost })}
                  label="Auto co-host: Add as co-host to all events with this tag"
                  labelClassName="text-sm text-theme-text-secondary"
                />
                <Checkbox
                  checked={form.autoSponsor}
                  onChange={() => setForm({ ...form, autoSponsor: !form.autoSponsor })}
                  label="Auto sponsor: Create sponsor record on tagged events"
                  labelClassName="text-sm text-theme-text-secondary"
                />
              </div>

              {/* Notes */}
              <IconInput
                value={form.notes}
                onChange={(v) => setForm({ ...form, notes: v })}
                placeholder="Notes"
                multiline
              />

              {/* Status messages */}
              {saveError && <p className="text-sm text-red-400">{saveError}</p>}
              {syncMessage && (
                <p className="text-sm text-green-400 flex items-center gap-1">
                  <Check size={14} /> {syncMessage}
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-3 mt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 bg-theme-surface hover:bg-theme-surface-hover text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !form.email || !form.tag}
                  className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
                >
                  {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Partner'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
