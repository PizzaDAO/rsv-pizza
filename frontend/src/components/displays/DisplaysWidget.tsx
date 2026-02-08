import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Monitor, Loader2, AlertCircle, Map, Link } from 'lucide-react';
import { Display } from '../../types';
import { getPartyDisplays, createDisplay, updateDisplay, deleteDisplay } from '../../lib/api';
import { DisplayCard } from './DisplayCard';
import { DisplayForm, DisplayFormData } from './DisplayForm';
import { IconInput } from '../IconInput';

interface DisplaysWidgetProps {
  partyId: string;
}

export function DisplaysWidget({ partyId }: DisplaysWidgetProps) {
  const [displays, setDisplays] = useState<Display[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingDisplay, setEditingDisplay] = useState<Display | null>(null);
  const [saving, setSaving] = useState(false);

  // Floorplan state
  const [floorplanUrl, setFloorplanUrl] = useState('');
  const [floorplanInput, setFloorplanInput] = useState('');
  const [showFloorplanInput, setShowFloorplanInput] = useState(false);

  const loadDisplays = useCallback(async () => {
    try {
      setLoadError(null);
      const result = await getPartyDisplays(partyId);
      if (result) {
        setDisplays(result.displays);
      }
    } catch (err) {
      setLoadError('Failed to load displays');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => {
    loadDisplays();
  }, [loadDisplays]);

  // Load floorplan from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(`floorplan-${partyId}`);
    if (saved) {
      setFloorplanUrl(saved);
      setFloorplanInput(saved);
    }
  }, [partyId]);

  const handleCreate = () => {
    setEditingDisplay(null);
    setShowForm(true);
  };

  const handleEdit = (display: Display) => {
    setEditingDisplay(display);
    setShowForm(true);
  };

  const handleSave = async (data: DisplayFormData) => {
    setSaving(true);
    setSaveError(null);
    try {
      if (editingDisplay) {
        const result = await updateDisplay(partyId, editingDisplay.id, data);
        if (result) {
          setDisplays(displays.map(d => d.id === editingDisplay.id ? result.display : d));
          setShowForm(false);
          setEditingDisplay(null);
        } else {
          setSaveError('Failed to update display. Please try again.');
        }
      } else {
        const result = await createDisplay(partyId, data);
        if (result) {
          setDisplays([...displays, result.display]);
          setShowForm(false);
          setEditingDisplay(null);
        } else {
          setSaveError('Failed to create display. Please try again.');
        }
      }
    } catch (err) {
      console.error('Error saving display:', err);
      setSaveError('Failed to save display. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (display: Display) => {
    if (!confirm(`Delete "${display.name}"? This cannot be undone.`)) return;

    try {
      const success = await deleteDisplay(partyId, display.id);
      if (success) {
        setDisplays(displays.filter(d => d.id !== display.id));
      }
    } catch (err) {
      console.error('Error deleting display:', err);
    }
  };

  const handleToggleActive = async (display: Display) => {
    try {
      const result = await updateDisplay(partyId, display.id, { isActive: !display.isActive });
      if (result) {
        setDisplays(displays.map(d => d.id === display.id ? result.display : d));
      }
    } catch (err) {
      console.error('Error toggling display:', err);
    }
  };

  const handleSaveFloorplan = () => {
    const url = floorplanInput.trim();
    if (url) {
      localStorage.setItem(`floorplan-${partyId}`, url);
      setFloorplanUrl(url);
    } else {
      localStorage.removeItem(`floorplan-${partyId}`);
      setFloorplanUrl('');
    }
    setShowFloorplanInput(false);
  };

  if (loading) {
    return (
      <div className="card p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card p-8">
        <div className="flex flex-col items-center text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
          <p className="text-red-400">{loadError}</p>
          <button
            onClick={loadDisplays}
            className="mt-4 text-sm text-[#ff393a] hover:underline"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Monitor className="text-[#ff393a]" size={20} />
          <div>
            <h3 className="font-medium text-white">Displays</h3>
            <p className="text-sm text-white/50">
              Create screens for TVs, projectors, and tablets
            </p>
          </div>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 bg-[#ff393a] hover:bg-[#ff393a]/90 text-white rounded-lg transition-colors"
        >
          <Plus size={18} />
          New Display
        </button>
      </div>

      {/* Floorplan Section */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Map className="text-white/50" size={18} />
            <h3 className="font-medium text-white text-sm">Venue Floorplan</h3>
          </div>
          <button
            onClick={() => setShowFloorplanInput(!showFloorplanInput)}
            className="text-xs text-[#ff393a] hover:underline"
          >
            {floorplanUrl ? 'Change' : 'Add Floorplan'}
          </button>
        </div>

        {showFloorplanInput && (
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1">
              <IconInput
                icon={Link}
                type="url"
                value={floorplanInput}
                onChange={(e) => setFloorplanInput(e.target.value)}
                placeholder="Floorplan image URL"
              />
            </div>
            <button
              onClick={handleSaveFloorplan}
              className="px-3 py-2 bg-[#ff393a] hover:bg-[#ff393a]/90 text-white text-sm rounded-lg transition-colors whitespace-nowrap"
            >
              Save
            </button>
          </div>
        )}

        {floorplanUrl ? (
          <div className="relative rounded-lg overflow-hidden border border-white/10">
            <img
              src={floorplanUrl}
              alt="Venue Floorplan"
              className="w-full max-h-[300px] object-contain bg-black/30"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            {/* Display name overlays */}
            {displays.length > 0 && (
              <div className="absolute inset-0 flex flex-wrap items-start justify-start gap-2 p-3">
                {displays.map((d) => (
                  <div
                    key={d.id}
                    className={`px-2 py-1 rounded text-xs font-medium shadow-lg ${
                      d.isActive
                        ? 'bg-[#ff393a]/90 text-white'
                        : 'bg-white/20 text-white/60'
                    }`}
                  >
                    {d.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-white/30 text-center py-3">
            Add a floorplan image to see where displays are placed
          </p>
        )}
      </div>

      {/* Display List */}
      {displays.length === 0 ? (
        <div className="card p-8 text-center">
          <Monitor className="w-12 h-12 text-white/20 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No displays yet</h3>
          <p className="text-white/50 mb-4">
            Create displays for TVs, projectors, or tablets at your event.
          </p>
          <button
            onClick={handleCreate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#ff393a] hover:bg-[#ff393a]/90 text-white rounded-lg transition-colors"
          >
            <Plus size={18} />
            Create Your First Display
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {displays.map((display) => (
            <DisplayCard
              key={display.id}
              display={display}
              partyId={partyId}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleActive={handleToggleActive}
            />
          ))}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <DisplayForm
          display={editingDisplay}
          onSave={handleSave}
          onClose={() => {
            setShowForm(false);
            setEditingDisplay(null);
            setSaveError(null);
          }}
          isLoading={saving}
          error={saveError}
        />
      )}
    </div>
  );
}
