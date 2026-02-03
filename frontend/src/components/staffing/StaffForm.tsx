import React, { useState, useEffect } from 'react';
import { X, Loader2, User, Mail, Phone, FileText } from 'lucide-react';
import { Staff, StaffStatus } from '../../types';

interface StaffFormProps {
  staff?: Staff | null;
  onSave: (data: StaffFormData) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}

export interface StaffFormData {
  name: string;
  email?: string;
  phone?: string;
  role: string;
  status: StaffStatus;
  notes?: string;
}

const ROLE_SUGGESTIONS = [
  'Coordinator',
  'Door / Check-in',
  'Bar / Drinks',
  'DJ / Music',
  'Photography',
  'Decorations',
  'Setup / Teardown',
  'Pizza Pickup',
  'General Help',
];

const STATUS_OPTIONS: { value: StaffStatus; label: string }[] = [
  { value: 'invited', label: 'Invited' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'declined', label: 'Declined' },
  { value: 'checked_in', label: 'Checked In' },
];

export const StaffForm: React.FC<StaffFormProps> = ({
  staff,
  onSave,
  onClose,
  saving,
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState<StaffStatus>('invited');
  const [notes, setNotes] = useState('');
  const [showRoleSuggestions, setShowRoleSuggestions] = useState(false);

  const isEditing = !!staff;

  // Populate form when editing
  useEffect(() => {
    if (staff) {
      setName(staff.name);
      setEmail(staff.email || '');
      setPhone(staff.phone || '');
      setRole(staff.role);
      setStatus(staff.status);
      setNotes(staff.notes || '');
    }
  }, [staff]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !role.trim()) return;

    await onSave({
      name: name.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      role: role.trim(),
      status,
      notes: notes.trim() || undefined,
    });
  };

  const filteredRoleSuggestions = ROLE_SUGGESTIONS.filter(
    (r) => r.toLowerCase().includes(role.toLowerCase()) && r.toLowerCase() !== role.toLowerCase()
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/70" onClick={onClose}>
      <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? 'Edit Staff Member' : 'Add Staff Member'}
          </h2>
          <button onClick={onClose} className="text-white/50 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Name */}
          <div className="relative">
            <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name *"
              required
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] pl-10"
            />
          </div>

          {/* Role with suggestions */}
          <div className="relative">
            <div className="relative">
              <input
                type="text"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setShowRoleSuggestions(true);
                }}
                onFocus={() => setShowRoleSuggestions(true)}
                onBlur={() => setTimeout(() => setShowRoleSuggestions(false), 200)}
                placeholder="Role *"
                required
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              />
            </div>
            {showRoleSuggestions && filteredRoleSuggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-[#1a1a2e] border border-white/20 rounded-lg shadow-lg overflow-hidden">
                {filteredRoleSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      setRole(suggestion);
                      setShowRoleSuggestions(false);
                    }}
                    className="w-full px-3 py-2 text-left text-white/80 hover:bg-white/10 text-sm"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Status */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StaffStatus)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className="bg-[#1a1a2e]">
                {option.label}
              </option>
            ))}
          </select>

          {/* Email */}
          <div className="relative">
            <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email (optional)"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] pl-10"
            />
          </div>

          {/* Phone */}
          <div className="relative">
            <Phone size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone (optional)"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] pl-10"
            />
          </div>

          {/* Notes */}
          <div className="relative">
            <FileText size={18} className="absolute left-3 top-3 text-white/40" />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] pl-10 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-white/10 hover:bg-white/20 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim() || !role.trim()}
              className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </>
              ) : isEditing ? (
                'Save Changes'
              ) : (
                'Add Staff'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
