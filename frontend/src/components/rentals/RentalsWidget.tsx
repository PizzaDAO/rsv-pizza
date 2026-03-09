import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, AlertCircle, Shapes } from 'lucide-react';
import { Rental } from '../../types';
import { getPartyRentals, createRental, updateRental, deleteRental, CreateRentalData } from '../../lib/api';
import { usePizza } from '../../contexts/PizzaContext';
import { FloorplanCanvas } from '../shared/FloorplanCanvas';
import { RentalCard } from './RentalCard';
import { RentalForm, RentalFormData } from './RentalForm';

interface RentalsWidgetProps {
  partyId: string;
}

export function RentalsWidget({ partyId }: RentalsWidgetProps) {
  const { party } = usePizza();
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRental, setEditingRental] = useState<Rental | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedRentalId, setSelectedRentalId] = useState<string | null>(null);
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);

  const floorplanUrl = party?.floorplanUrl || '';

  const loadRentals = useCallback(async () => {
    try {
      setLoadError(null);
      const result = await getPartyRentals(partyId);
      if (result) {
        setRentals(result.rentals);
      }
    } catch (err) {
      setLoadError('Failed to load rentals');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => {
    loadRentals();
  }, [loadRentals]);

  const handleCreate = () => {
    setEditingRental(null);
    setPendingPosition(null);
    setShowForm(true);
  };

  const handleEdit = (rental: Rental) => {
    setEditingRental(rental);
    setShowForm(true);
  };

  const handleSave = async (data: RentalFormData) => {
    setSaving(true);
    setSaveError(null);
    try {
      if (editingRental) {
        const result = await updateRental(partyId, editingRental.id, data);
        if (result) {
          setRentals(rentals.map(r => r.id === editingRental.id ? result.rental : r));
          setShowForm(false);
          setEditingRental(null);
        } else {
          setSaveError('Failed to update rental. Please try again.');
        }
      } else {
        const createData: CreateRentalData = {
          ...data,
          x: pendingPosition?.x ?? 50,
          y: pendingPosition?.y ?? 50,
        };
        const result = await createRental(partyId, createData);
        if (result) {
          setRentals([...rentals, result.rental]);
          setShowForm(false);
          setPendingPosition(null);
        } else {
          setSaveError('Failed to create rental. Please try again.');
        }
      }
    } catch (err) {
      console.error('Error saving rental:', err);
      setSaveError('Failed to save rental. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rental: Rental) => {
    if (!confirm(`Delete "${rental.name}"? This cannot be undone.`)) return;

    try {
      const success = await deleteRental(partyId, rental.id);
      if (success) {
        setRentals(rentals.filter(r => r.id !== rental.id));
        if (selectedRentalId === rental.id) setSelectedRentalId(null);
      }
    } catch (err) {
      console.error('Error deleting rental:', err);
    }
  };

  const handleCanvasClick = (x: number, y: number) => {
    setPendingPosition({ x, y });
    setEditingRental(null);
    setShowForm(true);
  };

  const handleShapeClick = (rentalId: string) => {
    setSelectedRentalId(selectedRentalId === rentalId ? null : rentalId);
  };

  const handleShapeMove = async (rentalId: string, x: number, y: number) => {
    // Optimistic update
    setRentals(prev => prev.map(r =>
      r.id === rentalId ? { ...r, x, y } : r
    ));
    // Persist
    await updateRental(partyId, rentalId, { x, y });
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
            onClick={loadRentals}
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
          <Shapes className="text-[#ff393a]" size={20} />
          <div>
            <h3 className="font-medium text-white">Rentals</h3>
            <p className="text-sm text-white/50">
              Manage rental spaces on your venue floorplan
            </p>
          </div>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 bg-[#ff393a] hover:bg-[#ff393a]/90 text-white rounded-lg transition-colors"
        >
          <Plus size={18} />
          New Rental
        </button>
      </div>

      {/* Floorplan with rental shapes */}
      {floorplanUrl ? (
        <div className="card p-4">
          <p className="text-xs text-white/40 mb-2">
            Click the floorplan to place a new rental. Drag shapes to reposition.
          </p>
          <FloorplanCanvas
            floorplanUrl={floorplanUrl}
            rentalShapes={rentals}
            mode="rental-shapes"
            onCanvasClick={handleCanvasClick}
            onShapeClick={handleShapeClick}
            onShapeMove={handleShapeMove}
            selectedRentalId={selectedRentalId}
            showDisplayPins={false}
            showRentalShapes={true}
            showLabels={true}
            showPrices={true}
            showStatus={true}
          />

          {/* Legend */}
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-white/50">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#39d98a]" /> Available
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#ffc107]" /> Reserved
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#ff393a]" /> Sold
            </span>
          </div>
        </div>
      ) : (
        <div className="card p-6 text-center">
          <p className="text-white/40 text-sm">
            Add a floorplan image in the Displays tab to place rental shapes on the venue map.
          </p>
        </div>
      )}

      {/* Rental List */}
      {rentals.length === 0 ? (
        <div className="card p-8 text-center">
          <Shapes className="w-12 h-12 text-white/20 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No rentals yet</h3>
          <p className="text-white/50 mb-4">
            Create rentable spaces like booths, tables, or areas for your event.
          </p>
          <button
            onClick={handleCreate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#ff393a] hover:bg-[#ff393a]/90 text-white rounded-lg transition-colors"
          >
            <Plus size={18} />
            Create Your First Rental
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {rentals.map((rental) => (
            <RentalCard
              key={rental.id}
              rental={rental}
              onEdit={handleEdit}
              onDelete={handleDelete}
              isSelected={selectedRentalId === rental.id}
              onSelect={handleShapeClick}
            />
          ))}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <RentalForm
          rental={editingRental}
          onSave={handleSave}
          onClose={() => {
            setShowForm(false);
            setEditingRental(null);
            setSaveError(null);
            setPendingPosition(null);
          }}
          isLoading={saving}
          error={saveError}
        />
      )}
    </div>
  );
}
