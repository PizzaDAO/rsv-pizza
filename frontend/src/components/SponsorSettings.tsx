import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, Award } from 'lucide-react';
import { Sponsor } from '../types';
import { SponsorCard } from './SponsorCard';
import { SponsorModal, SponsorFormData } from './SponsorModal';
import { Checkbox } from './Checkbox';
import {
  getPartySponsors,
  createSponsor,
  updateSponsor,
  deleteSponsor,
  reorderSponsors,
} from '../lib/api';
import { updateParty } from '../lib/supabase';

interface SponsorSettingsProps {
  partyId: string;
  onUpdate?: () => void;
}

export const SponsorSettings: React.FC<SponsorSettingsProps> = ({ partyId, onUpdate }) => {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [sponsorsEnabled, setSponsorsEnabled] = useState(false);
  const [sponsorSectionTitle, setSponsorSectionTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingSponsor, setEditingSponsor] = useState<Sponsor | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);

  // Load sponsors
  const loadSponsors = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getPartySponsors(partyId);
      if (response) {
        setSponsors(response.sponsors);
        setSponsorsEnabled(response.sponsorsEnabled);
        setSponsorSectionTitle(response.sponsorSectionTitle || '');
      }
    } catch (error) {
      console.error('Error loading sponsors:', error);
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => {
    loadSponsors();
  }, [loadSponsors]);

  // Toggle sponsors enabled
  const handleToggleEnabled = async () => {
    setSavingField('enabled');
    const newValue = !sponsorsEnabled;
    setSponsorsEnabled(newValue);
    try {
      await updateParty(partyId, { sponsors_enabled: newValue });
      onUpdate?.();
    } catch (error) {
      console.error('Error updating sponsors enabled:', error);
      setSponsorsEnabled(!newValue); // Revert on error
    } finally {
      setSavingField(null);
    }
  };

  // Save section title
  const handleSaveSectionTitle = async () => {
    setSavingField('title');
    try {
      await updateParty(partyId, { sponsor_section_title: sponsorSectionTitle.trim() || null });
      onUpdate?.();
    } catch (error) {
      console.error('Error updating section title:', error);
    } finally {
      setSavingField(null);
    }
  };

  // Create or update sponsor
  const handleSaveSponsor = async (data: SponsorFormData) => {
    setSaving(true);
    try {
      if (editingSponsor) {
        // Update existing sponsor
        const result = await updateSponsor(partyId, editingSponsor.id, {
          name: data.name,
          tier: data.tier,
          logoUrl: data.logoUrl || null,
          websiteUrl: data.websiteUrl || null,
          description: data.description || null,
          visible: data.visible,
        });
        if (result) {
          setSponsors((prev) =>
            prev.map((s) => (s.id === editingSponsor.id ? result.sponsor : s))
          );
        }
      } else {
        // Create new sponsor
        const result = await createSponsor(partyId, {
          name: data.name,
          tier: data.tier,
          logoUrl: data.logoUrl || undefined,
          websiteUrl: data.websiteUrl || undefined,
          description: data.description || undefined,
          visible: data.visible,
        });
        if (result) {
          setSponsors((prev) => [...prev, result.sponsor]);
        }
      }
      setShowModal(false);
      setEditingSponsor(null);
      onUpdate?.();
    } catch (error) {
      console.error('Error saving sponsor:', error);
      throw error;
    } finally {
      setSaving(false);
    }
  };

  // Delete sponsor
  const handleDeleteSponsor = async (sponsorId: string) => {
    try {
      const success = await deleteSponsor(partyId, sponsorId);
      if (success) {
        setSponsors((prev) => prev.filter((s) => s.id !== sponsorId));
        onUpdate?.();
      }
    } catch (error) {
      console.error('Error deleting sponsor:', error);
    } finally {
      setShowDeleteConfirm(null);
    }
  };

  // Toggle sponsor visibility
  const handleToggleVisibility = async (sponsor: Sponsor) => {
    const newVisible = !sponsor.visible;
    // Optimistic update
    setSponsors((prev) =>
      prev.map((s) => (s.id === sponsor.id ? { ...s, visible: newVisible } : s))
    );
    try {
      await updateSponsor(partyId, sponsor.id, { visible: newVisible });
      onUpdate?.();
    } catch (error) {
      console.error('Error toggling visibility:', error);
      // Revert on error
      setSponsors((prev) =>
        prev.map((s) => (s.id === sponsor.id ? { ...s, visible: !newVisible } : s))
      );
    }
  };

  // Drag and drop handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newSponsors = [...sponsors];
    const draggedItem = newSponsors[draggedIndex];
    newSponsors.splice(draggedIndex, 1);
    newSponsors.splice(index, 0, draggedItem);

    setSponsors(newSponsors);
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    if (draggedIndex !== null) {
      // Save new order to server
      const sponsorIds = sponsors.map((s) => s.id);
      await reorderSponsors(partyId, sponsorIds);
      onUpdate?.();
    }
    setDraggedIndex(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award size={18} className="text-[#ff393a]" />
          <h3 className="text-sm font-medium text-white/80">Sponsors</h3>
        </div>
        <Checkbox
          checked={sponsorsEnabled}
          onChange={handleToggleEnabled}
          label={savingField === 'enabled' ? 'Saving...' : 'Show on event page'}
          size={16}
          labelClassName="text-xs font-medium text-white/60"
        />
      </div>

      {sponsorsEnabled && (
        <>
          {/* Section Title */}
          <div className="relative">
            <input
              type="text"
              value={sponsorSectionTitle}
              onChange={(e) => setSponsorSectionTitle(e.target.value)}
              onBlur={handleSaveSectionTitle}
              placeholder="Section title (e.g., 'Thanks to our sponsors')"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            />
            {savingField === 'title' && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 size={14} className="animate-spin text-white/40" />
              </div>
            )}
          </div>

          {/* Sponsors List */}
          <div className="space-y-2">
            {sponsors.length === 0 ? (
              <div className="text-center py-6 text-white/40 text-sm">
                No sponsors yet. Add your first sponsor to display on the event page.
              </div>
            ) : (
              sponsors.map((sponsor, index) => (
                <SponsorCard
                  key={sponsor.id}
                  sponsor={sponsor}
                  isEditable
                  isDragging={draggedIndex === index}
                  onEdit={() => {
                    setEditingSponsor(sponsor);
                    setShowModal(true);
                  }}
                  onDelete={() => setShowDeleteConfirm(sponsor.id)}
                  onToggleVisibility={() => handleToggleVisibility(sponsor)}
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                />
              ))
            )}
          </div>

          {/* Add Sponsor Button */}
          <button
            type="button"
            onClick={() => {
              setEditingSponsor(null);
              setShowModal(true);
            }}
            className="w-full btn-secondary flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            Add Sponsor
          </button>
        </>
      )}

      {/* Sponsor Modal */}
      <SponsorModal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setEditingSponsor(null);
        }}
        onSave={handleSaveSponsor}
        sponsor={editingSponsor}
        saving={saving}
      />

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-white mb-3">Delete Sponsor?</h2>
            <p className="text-white/60 mb-6">
              This will permanently remove this sponsor from your event.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="flex-1 btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteSponsor(showDeleteConfirm)}
                className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium px-6 py-3 rounded-xl transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
