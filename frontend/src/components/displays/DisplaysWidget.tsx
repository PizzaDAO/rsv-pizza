import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Monitor, Loader2, AlertCircle } from 'lucide-react';
import { Display } from '../../types';
import { getPartyDisplays, createDisplay, updateDisplay, deleteDisplay } from '../../lib/api';
import { DisplayCard } from './DisplayCard';
import { DisplayForm, DisplayFormData } from './DisplayForm';

interface DisplaysWidgetProps {
  partyId: string;
}

export function DisplaysWidget({ partyId }: DisplaysWidgetProps) {
  const [displays, setDisplays] = useState<Display[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingDisplay, setEditingDisplay] = useState<Display | null>(null);
  const [saving, setSaving] = useState(false);

  const loadDisplays = useCallback(async () => {
    try {
      setError(null);
      const result = await getPartyDisplays(partyId);
      if (result) {
        setDisplays(result.displays);
      }
    } catch (err) {
      setError('Failed to load displays');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => {
    loadDisplays();
  }, [loadDisplays]);

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
    try {
      if (editingDisplay) {
        const result = await updateDisplay(partyId, editingDisplay.id, data);
        if (result) {
          setDisplays(displays.map(d => d.id === editingDisplay.id ? result.display : d));
        }
      } else {
        const result = await createDisplay(partyId, data);
        if (result) {
          setDisplays([...displays, result.display]);
        }
      }
      setShowForm(false);
      setEditingDisplay(null);
    } catch (err) {
      console.error('Error saving display:', err);
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

  if (loading) {
    return (
      <div className="card p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8">
        <div className="flex flex-col items-center text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
          <p className="text-red-400">{error}</p>
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
          }}
          isLoading={saving}
        />
      )}
    </div>
  );
}
