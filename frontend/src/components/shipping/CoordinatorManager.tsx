import React, { useEffect, useState, useCallback } from 'react';
import { UserPlus, Shield, Trash2, Pencil, ToggleLeft, ToggleRight } from 'lucide-react';
import { CoordinatorModal } from './CoordinatorModal';
import { GPP_REGIONS } from '../../types';
import type { ShippingCoordinator } from '../../types';
import {
  fetchShippingCoordinators,
  createShippingCoordinator,
  updateShippingCoordinator,
  deactivateShippingCoordinator,
} from '../../lib/api';

export function CoordinatorManager() {
  const [coordinators, setCoordinators] = useState<ShippingCoordinator[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCoordinator, setEditingCoordinator] = useState<ShippingCoordinator | null>(null);

  const loadCoordinators = useCallback(async () => {
    try {
      const result = await fetchShippingCoordinators();
      setCoordinators(result.coordinators);
    } catch (err) {
      console.error('Failed to load coordinators:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCoordinators();
  }, [loadCoordinators]);

  const handleCreate = async (data: { name: string; email: string; regions: string[]; notes?: string }) => {
    await createShippingCoordinator(data);
    loadCoordinators();
  };

  const handleUpdate = async (data: { name: string; email: string; regions: string[]; notes?: string }) => {
    if (!editingCoordinator) return;
    await updateShippingCoordinator(editingCoordinator.id, data);
    setEditingCoordinator(null);
    loadCoordinators();
  };

  const handleToggleActive = async (coordinator: ShippingCoordinator) => {
    if (coordinator.isActive) {
      await deactivateShippingCoordinator(coordinator.id);
    } else {
      await updateShippingCoordinator(coordinator.id, { isActive: true });
    }
    loadCoordinators();
  };

  const regionLabels = (regions: string[]) =>
    regions
      .map((r) => GPP_REGIONS.find((g) => g.id === r)?.label || r)
      .join(', ');

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield size={18} className="text-red-500" />
          <h2 className="text-lg font-semibold text-theme-text">Manage Coordinators</h2>
        </div>
        <button
          onClick={() => { setEditingCoordinator(null); setShowModal(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <UserPlus size={14} />
          Add Coordinator
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-theme-text-muted py-4">Loading coordinators...</p>
      ) : coordinators.length === 0 ? (
        <p className="text-sm text-theme-text-muted py-4">No shipping coordinators yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-theme-stroke">
          <table className="w-full">
            <thead>
              <tr className="bg-theme-surface border-b border-theme-stroke">
                <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted">Regions</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-theme-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {coordinators.map((coord) => (
                <tr key={coord.id} className={`border-b border-theme-stroke ${!coord.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 text-sm text-theme-text font-medium">{coord.name}</td>
                  <td className="px-4 py-3 text-sm text-theme-text-secondary">{coord.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {coord.regions.map((r) => (
                        <span
                          key={r}
                          className="px-2 py-0.5 bg-blue-500/10 text-blue-600 rounded-full text-xs"
                        >
                          {GPP_REGIONS.find((g) => g.id === r)?.label || r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      coord.isActive
                        ? 'bg-green-500/10 text-green-600'
                        : 'bg-red-500/10 text-red-600'
                    }`}>
                      {coord.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => { setEditingCoordinator(coord); setShowModal(true); }}
                        className="p-1.5 rounded-lg hover:bg-theme-surface transition-colors text-theme-text-muted hover:text-theme-text"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleToggleActive(coord)}
                        className="p-1.5 rounded-lg hover:bg-theme-surface transition-colors text-theme-text-muted hover:text-theme-text"
                        title={coord.isActive ? 'Deactivate' : 'Reactivate'}
                      >
                        {coord.isActive ? <ToggleRight size={14} className="text-green-500" /> : <ToggleLeft size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Coordinator Modal */}
      {showModal && (
        <CoordinatorModal
          coordinator={editingCoordinator}
          onClose={() => { setShowModal(false); setEditingCoordinator(null); }}
          onSave={editingCoordinator ? handleUpdate : handleCreate}
        />
      )}
    </div>
  );
}
