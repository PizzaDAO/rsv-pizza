import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, Loader2, Check, Clock, X, LogIn } from 'lucide-react';
import { Staff, StaffStatus, StaffStats } from '../../types';
import { getPartyStaff, getStaffStats, createStaff, updateStaff, deleteStaff } from '../../lib/api';
import { StaffCard } from './StaffCard';
import { StaffForm, StaffFormData } from './StaffForm';

interface StaffingWidgetProps {
  partyId: string;
}

type FilterOption = 'all' | StaffStatus;

const FILTER_OPTIONS: { value: FilterOption; label: string; icon?: React.ReactNode }[] = [
  { value: 'all', label: 'All' },
  { value: 'invited', label: 'Invited', icon: <Clock size={14} /> },
  { value: 'confirmed', label: 'Confirmed', icon: <Check size={14} /> },
  { value: 'declined', label: 'Declined', icon: <X size={14} /> },
  { value: 'checked_in', label: 'Checked In', icon: <LogIn size={14} /> },
];

export const StaffingWidget: React.FC<StaffingWidgetProps> = ({ partyId }) => {
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [stats, setStats] = useState<StaffStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<FilterOption>('all');

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await getPartyStaff(partyId, {
        status: filter === 'all' ? undefined : filter,
        limit: 100,
      });

      if (result) {
        setStaffList(result.staff);
      } else {
        setError('Failed to load staff');
      }
    } catch (err) {
      setError('Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, [partyId, filter]);

  const loadStats = useCallback(async () => {
    const result = await getStaffStats(partyId);
    if (result) {
      setStats(result);
    }
  }, [partyId]);

  // Initial load
  useEffect(() => {
    loadStaff();
    loadStats();
  }, [loadStaff, loadStats]);

  const handleAddClick = () => {
    setEditingStaff(null);
    setShowForm(true);
  };

  const handleEditClick = (staff: Staff) => {
    setEditingStaff(staff);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingStaff(null);
  };

  const handleSave = async (data: StaffFormData) => {
    setSaving(true);
    try {
      if (editingStaff) {
        // Update existing staff
        const result = await updateStaff(partyId, editingStaff.id, data);
        if (result) {
          setStaffList(prev =>
            prev.map(s => (s.id === editingStaff.id ? result.staff : s))
          );
          loadStats();
          handleCloseForm();
        }
      } else {
        // Create new staff
        const result = await createStaff(partyId, data);
        if (result) {
          setStaffList(prev => [result.staff, ...prev]);
          loadStats();
          handleCloseForm();
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (staffId: string) => {
    if (!confirm('Are you sure you want to remove this staff member?')) return;

    const success = await deleteStaff(partyId, staffId);
    if (success) {
      setStaffList(prev => prev.filter(s => s.id !== staffId));
      loadStats();
    }
  };

  const handleStatusChange = async (staffId: string, newStatus: StaffStatus) => {
    const result = await updateStaff(partyId, staffId, { status: newStatus });
    if (result) {
      setStaffList(prev =>
        prev.map(s => (s.id === staffId ? result.staff : s))
      );
      loadStats();
    }
  };

  if (loading) {
    return (
      <div className="card p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-[#ff393a] animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6">
        <div className="text-center py-12">
          <p className="text-red-400">{error}</p>
          <button
            onClick={loadStaff}
            className="mt-4 text-[#ff393a] hover:text-[#ff5a5b] font-medium"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="space-y-4">
        {/* Header with Stats and Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-theme-text flex items-center gap-2">
              <UserPlus size={20} className="text-[#ff393a]" />
              Staff
              {stats && stats.totalStaff > 0 && (
                <span className="text-theme-text-muted font-normal text-sm">
                  ({stats.totalStaff})
                </span>
              )}
            </h2>

            {stats && stats.byStatus.confirmed > 0 && (
              <div className="flex items-center gap-1 text-green-400 text-sm">
                <Check size={14} />
                <span>{stats.byStatus.confirmed} confirmed</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Filter */}
            {stats && stats.totalStaff > 0 && (
              <div className="flex items-center bg-theme-surface rounded-lg p-1 overflow-x-auto">
                {FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setFilter(option.value)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1 ${
                      filter === option.value
                        ? 'bg-[#ff393a] text-white'
                        : 'text-theme-text-secondary hover:text-theme-text'
                    }`}
                  >
                    {option.icon}
                    {option.label}
                  </button>
                ))}
              </div>
            )}

            {/* Add Staff Button */}
            <button
              onClick={handleAddClick}
              className="flex items-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <UserPlus size={16} />
              <span className="hidden sm:inline">Add Staff</span>
            </button>
          </div>
        </div>

        {/* Stats Summary */}
        {stats && stats.totalStaff > 0 && (
          <div className="grid grid-cols-4 gap-2 bg-theme-surface rounded-xl p-3">
            <div className="text-center">
              <div className="text-gray-400 text-lg font-semibold">{stats.byStatus.invited}</div>
              <div className="text-theme-text-muted text-xs">Invited</div>
            </div>
            <div className="text-center">
              <div className="text-green-400 text-lg font-semibold">{stats.byStatus.confirmed}</div>
              <div className="text-theme-text-muted text-xs">Confirmed</div>
            </div>
            <div className="text-center">
              <div className="text-red-400 text-lg font-semibold">{stats.byStatus.declined}</div>
              <div className="text-theme-text-muted text-xs">Declined</div>
            </div>
            <div className="text-center">
              <div className="text-blue-400 text-lg font-semibold">{stats.byStatus.checked_in}</div>
              <div className="text-theme-text-muted text-xs">Checked In</div>
            </div>
          </div>
        )}

        {/* Staff List */}
        {staffList.length === 0 ? (
          <div className="text-center py-12 bg-theme-surface rounded-xl">
            <UserPlus className="w-12 h-12 text-theme-text-faint mx-auto mb-3" />
            <p className="text-theme-text-secondary mb-4">
              {filter === 'all' ? 'No staff members yet' : `No ${filter.replace('_', ' ')} staff`}
            </p>
            {filter === 'all' && (
              <button
                onClick={handleAddClick}
                className="inline-flex items-center gap-2 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <UserPlus size={16} />
                Add First Staff Member
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {staffList.map((staff) => (
              <StaffCard
                key={staff.id}
                staff={staff}
                onEdit={handleEditClick}
                onDelete={handleDelete}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        )}

        {/* Staff Form Modal */}
        {showForm && (
          <StaffForm
            staff={editingStaff}
            onSave={handleSave}
            onClose={handleCloseForm}
            saving={saving}
          />
        )}
      </div>
    </div>
  );
};
