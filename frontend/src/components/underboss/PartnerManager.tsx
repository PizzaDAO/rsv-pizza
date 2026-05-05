import React, { useState, useEffect, useCallback } from 'react';
import { Handshake, Plus, Edit2, Trash2, RefreshCw, Check, AlertCircle, GripVertical } from 'lucide-react';
import { fetchSponsorUsers, createSponsorUser, updateSponsorUser, deleteSponsorUser, reorderSponsorUsers } from '../../lib/api';
import { proxyAvatarToStorage } from '../../lib/supabase';
import type { SponsorUser } from '../../types';
import { PartnerForm } from '../sponsors/PartnerForm';
import type { PartnerFormData } from '../sponsors/PartnerForm';

interface PartnerManagerProps {
  onSyncComplete?: () => void;
  onFlyerRegenNeeded?: (tag: string) => void;
}

export function PartnerManager({ onSyncComplete, onFlyerRegenNeeded }: PartnerManagerProps) {
  const [partners, setPartners] = useState<SponsorUser[]>([]);
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

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

  const editingPartner = editingId ? partners.find(p => p.id === editingId) ?? null : null;

  const openCreateModal = () => {
    setEditingId(null);
    setSyncMessage(null);
    setShowModal(true);
  };

  const openEditModal = (partner: SponsorUser) => {
    setEditingId(partner.id);
    setSyncMessage(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setSyncMessage(null);
  };

  const handlePartnerSubmit = async (data: PartnerFormData) => {
    setSaving(true);
    setSyncMessage(null);

    try {
      // Proxy external avatar to storage
      const proxiedAvatarUrl = data.coHostAvatarUrl
        ? await proxyAvatarToStorage(data.coHostAvatarUrl)
        : undefined;

      const payload = {
        email: data.email,
        tag: data.tag,
        name: data.contactPersonName || undefined,
        notes: data.notes || undefined,
        coHostName: data.name || undefined,
        coHostWebsite: data.website || undefined,
        coHostTwitter: data.brandTwitter || undefined,
        coHostInstagram: data.brandInstagram || undefined,
        coHostAvatarUrl: proxiedAvatarUrl,
        coHostLogoUrl: data.logoUrl || undefined,
        autoCoHost: data.autoCoHost,
        autoSponsor: data.autoSponsor,
        coHostShowOnEvent: data.coHostShowOnEvent,
        coHostCanEdit: data.coHostCanEdit,
        coHostAllowedTabs: data.coHostAllowedTabs,
        category: data.category || undefined,
        brandDescription: data.brandDescription || undefined,
      };

      let newSyncMessage: string | null = null;

      if (editingId) {
        const result = await updateSponsorUser(editingId, payload);
        if (result.syncedCount > 0) {
          newSyncMessage = `Synced to ${result.syncedCount} event${result.syncedCount > 1 ? 's' : ''}`;
        }
      } else {
        const result = await createSponsorUser(payload);
        if (result.syncedCount > 0) {
          newSyncMessage = `Synced to ${result.syncedCount} event${result.syncedCount > 1 ? 's' : ''}`;
        }
      }

      if (newSyncMessage) {
        setSyncMessage(newSyncMessage);
        // Trigger flyer regen for events with this partner's tag
        onFlyerRegenNeeded?.(data.tag);
      }

      await loadPartners();
      onSyncComplete?.();

      if (!newSyncMessage) {
        closeModal();
      }
    } catch (err: any) {
      throw new Error(err.message || 'Failed to save partner');
    } finally {
      setSaving(false);
    }
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newPartners = [...partners];
    const draggedItem = newPartners[draggedIndex];
    newPartners.splice(draggedIndex, 1);
    newPartners.splice(index, 0, draggedItem);

    setPartners(newPartners);
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    setDraggedIndex(null);
    // Persist new order to backend
    try {
      await reorderSponsorUsers(partners.map(p => p.id));
    } catch (err) {
      console.error('Failed to save partner order:', err);
      // Reload to get correct order from server
      await loadPartners();
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
          {partners.map((partner, index) => (
            <div
              key={partner.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={`p-3 rounded-xl border transition-colors cursor-move ${
                partner.isActive
                  ? 'bg-theme-surface border-theme-stroke'
                  : 'bg-theme-surface/50 border-theme-stroke/50 opacity-60'
              } ${draggedIndex === index ? 'opacity-50' : 'opacity-100'}`}
            >
              <div className="flex items-start gap-3">
                {/* Drag handle */}
                <div className="cursor-grab active:cursor-grabbing text-white/30 hover:text-white/60 shrink-0 pt-1">
                  <GripVertical size={16} />
                </div>

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
      {showModal && (
        <PartnerForm
          mode="partner"
          partnerData={editingPartner}
          onSubmit={handlePartnerSubmit}
          onClose={closeModal}
          isLoading={saving}
          syncMessage={syncMessage}
        />
      )}
    </div>
  );
}
