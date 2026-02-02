import React, { useState, useEffect, useCallback, useContext } from 'react';
import { Performer } from '../../types';
import { PizzaContext } from '../../contexts/PizzaContext';
import {
  getPerformers,
  addPerformer,
  updatePerformer,
  deletePerformer,
  reorderPerformers,
  CreatePerformerData,
  UpdatePerformerData,
} from '../../lib/api';
import { PerformerCard } from './PerformerCard';
import { PerformerForm, PerformerFormData } from './PerformerForm';
import { LineupOverview } from './LineupOverview';
import { Music, Plus, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

interface MusicWidgetProps {
  isHost?: boolean;
  partyId?: string; // Optional - if not provided, will use PizzaContext
}

export const MusicWidget: React.FC<MusicWidgetProps> = ({ isHost = false, partyId: propsPartyId }) => {
  // Try to use PizzaContext, but don't require it (useContext returns null if no Provider)
  const pizzaContext = useContext(PizzaContext);
  const contextPartyId = pizzaContext?.party?.id;
  const effectivePartyId = propsPartyId || contextPartyId;
  const [performers, setPerformers] = useState<Performer[]>([]);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [musicNotes, setMusicNotes] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form modal state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPerformer, setEditingPerformer] = useState<Performer | null>(null);
  const [saving, setSaving] = useState(false);

  // Expanded state
  const [isExpanded, setIsExpanded] = useState(true);

  // Drag state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Load performers
  const loadPerformers = useCallback(async () => {
    if (!effectivePartyId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await getPerformers(effectivePartyId);
      if (response) {
        setPerformers(response.performers);
        setMusicEnabled(response.musicEnabled);
        setMusicNotes(response.musicNotes);
      }
    } catch (err) {
      console.error('Error loading performers:', err);
      setError('Failed to load music lineup');
    } finally {
      setLoading(false);
    }
  }, [effectivePartyId]);

  useEffect(() => {
    loadPerformers();
  }, [loadPerformers]);

  // Handle add/edit performer
  const handleSavePerformer = async (formData: PerformerFormData) => {
    if (!effectivePartyId) return;

    setSaving(true);
    setError(null);

    try {
      const data: CreatePerformerData | UpdatePerformerData = {
        name: formData.name,
        type: formData.type,
        genre: formData.genre || undefined,
        setTime: formData.setTime || undefined,
        setDuration: formData.setDuration ? parseInt(formData.setDuration, 10) : undefined,
        contactName: formData.contactName || undefined,
        contactEmail: formData.contactEmail || undefined,
        contactPhone: formData.contactPhone || undefined,
        instagram: formData.instagram || undefined,
        soundcloud: formData.soundcloud || undefined,
        status: formData.status,
        equipmentProvided: formData.equipmentProvided,
        equipmentNotes: formData.equipmentNotes || undefined,
        fee: formData.fee ? parseFloat(formData.fee) : undefined,
        feePaid: formData.feePaid,
        notes: formData.notes || undefined,
      };

      if (editingPerformer) {
        // Update existing
        await updatePerformer(effectivePartyId, editingPerformer.id, data);
      } else {
        // Add new
        await addPerformer(effectivePartyId, data as CreatePerformerData);
      }

      // Reload performers
      await loadPerformers();

      // Close form
      setIsFormOpen(false);
      setEditingPerformer(null);
    } catch (err) {
      console.error('Error saving performer:', err);
      setError(err instanceof Error ? err.message : 'Failed to save performer');
    } finally {
      setSaving(false);
    }
  };

  // Handle delete performer
  const handleDeletePerformer = async (performerId: string) => {
    if (!effectivePartyId) return;

    if (!confirm('Are you sure you want to remove this performer?')) {
      return;
    }

    try {
      await deletePerformer(effectivePartyId, performerId);
      await loadPerformers();
    } catch (err) {
      console.error('Error deleting performer:', err);
      setError('Failed to delete performer');
    }
  };

  // Handle edit performer
  const handleEditPerformer = (performer: Performer) => {
    setEditingPerformer(performer);
    setIsFormOpen(true);
  };

  // Handle add new performer
  const handleAddPerformer = () => {
    setEditingPerformer(null);
    setIsFormOpen(true);
  };

  // Handle drag reorder
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newPerformers = [...performers];
    const draggedItem = newPerformers[draggedIndex];
    newPerformers.splice(draggedIndex, 1);
    newPerformers.splice(index, 0, draggedItem);

    setPerformers(newPerformers);
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null || !effectivePartyId) {
      setDraggedIndex(null);
      return;
    }

    setDraggedIndex(null);

    // Save new order
    try {
      const performerIds = performers.map((p) => p.id);
      await reorderPerformers(effectivePartyId, performerIds);
    } catch (err) {
      console.error('Error reordering performers:', err);
      setError('Failed to save order');
      // Reload to get correct order
      await loadPerformers();
    }
  };

  // Don't render if music is not enabled and user is not host
  if (!isHost && !musicEnabled) {
    return null;
  }

  // Don't render if no performers and not host
  if (!isHost && performers.length === 0) {
    return null;
  }

  return (
    <div className="card p-4 sm:p-6">
      {/* Header */}
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <Music size={20} className="text-[#ff393a]" />
          <h2 className="text-lg font-semibold text-white">Music</h2>
          {performers.length > 0 && (
            <span className="text-sm text-white/50">({performers.length})</span>
          )}
        </div>
        <button className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="mt-4 space-y-4">
          {/* Error */}
          {error && (
            <div className="p-3 rounded-xl text-sm bg-red-500/10 border border-red-500/30 text-red-400">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-white/50" />
            </div>
          ) : (
            <>
              {/* Lineup Overview (show if there are performers) */}
              {performers.length > 0 && !isHost && (
                <LineupOverview performers={performers} />
              )}

              {/* Host View - Editable List */}
              {isHost && (
                <>
                  {/* Performer Cards */}
                  {performers.length > 0 ? (
                    <div className="space-y-2">
                      {performers.map((performer, index) => (
                        <PerformerCard
                          key={performer.id}
                          performer={performer}
                          onEdit={handleEditPerformer}
                          onDelete={handleDeletePerformer}
                          isDragging={draggedIndex === index}
                          dragHandleProps={{
                            onDragStart: () => handleDragStart(index),
                            onDragOver: (e) => handleDragOver(e, index),
                            onDragEnd: handleDragEnd,
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-white/50">
                      <Music size={32} className="mx-auto mb-2 opacity-50" />
                      <p>No performers added yet</p>
                      <p className="text-sm">Add DJs, bands, or playlists to your event</p>
                    </div>
                  )}

                  {/* Lineup Overview (show below cards for host) */}
                  {performers.length > 0 && (
                    <LineupOverview performers={performers} />
                  )}

                  {/* Add Performer Button */}
                  <button
                    onClick={handleAddPerformer}
                    className="w-full btn-secondary flex items-center justify-center gap-2"
                  >
                    <Plus size={18} />
                    Add Performer
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Performer Form Modal */}
      <PerformerForm
        performer={editingPerformer}
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingPerformer(null);
        }}
        onSave={handleSavePerformer}
        saving={saving}
      />
    </div>
  );
};
