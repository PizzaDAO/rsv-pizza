import React, { useState, useEffect, useMemo } from 'react';
import { X, Loader2, User, Mail, Phone, FileText, Briefcase, DollarSign, Clock } from 'lucide-react';
import { IconInput } from '../IconInput';
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
  const [payType, setPayType] = useState<'hourly' | 'flat'>('hourly');
  const [hourlyRate, setHourlyRate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [flatFee, setFlatFee] = useState('');

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

  // Calculate total cost for hourly
  const totalCost = useMemo(() => {
    if (payType !== 'hourly' || !hourlyRate || !startTime || !endTime) return null;
    const rate = parseFloat(hourlyRate);
    if (isNaN(rate)) return null;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const diffMin = endMin > startMin ? endMin - startMin : (24 * 60 - startMin) + endMin;
    const hours = diffMin / 60;
    return (rate * hours).toFixed(2);
  }, [payType, hourlyRate, startTime, endTime]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !role.trim()) return;

    // Build pay info into notes
    let payNote = '';
    if (payType === 'hourly' && hourlyRate) {
      payNote = `Pay: $${hourlyRate}/hr`;
      if (startTime && endTime) payNote += ` (${startTime}–${endTime})`;
      if (totalCost) payNote += ` = $${totalCost}`;
    } else if (payType === 'flat' && flatFee) {
      payNote = `Pay: $${flatFee} flat fee`;
    }

    const fullNotes = [payNote, notes.trim()].filter(Boolean).join('\n');

    await onSave({
      name: name.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      role: role.trim(),
      status,
      notes: fullNotes || undefined,
    });
  };

  const filteredRoleSuggestions = ROLE_SUGGESTIONS.filter(
    (r) => r.toLowerCase().includes(role.toLowerCase()) && r.toLowerCase() !== role.toLowerCase()
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl max-w-md w-full p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-theme-text">
            {isEditing ? 'Edit Staff Member' : 'Add Staff Member'}
          </h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-2">
          {/* Name & Role row */}
          <div className="grid grid-cols-2 gap-2">
            <IconInput
              icon={User}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              required
            />
            <div className="relative">
              <IconInput
                icon={Briefcase}
                type="text"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setShowRoleSuggestions(true);
                }}
                onFocus={() => setShowRoleSuggestions(true)}
                onBlur={() => setTimeout(() => setShowRoleSuggestions(false), 200)}
                placeholder="Role"
                required
              />
              {showRoleSuggestions && filteredRoleSuggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-theme-header border border-theme-stroke-hover rounded-lg shadow-lg overflow-hidden">
                  {filteredRoleSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        setRole(suggestion);
                        setShowRoleSuggestions(false);
                      }}
                      className="w-full px-3 py-2 text-left text-theme-text hover:bg-theme-surface-hover text-sm"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Email & Phone row */}
          <div className="grid grid-cols-2 gap-2">
            <IconInput
              icon={Mail}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
            />
            <IconInput
              icon={Phone}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
            />
          </div>

          {/* Status */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StaffStatus)}
            className="w-full bg-theme-surface border border-theme-stroke rounded-xl px-4 py-3 text-theme-text text-sm focus:outline-none focus:border-[#ff393a]/50"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className="bg-theme-header text-theme-text">
                {option.label}
              </option>
            ))}
          </select>

          {/* Pay Type Toggle */}
          <div>
            <div className="flex rounded-xl overflow-hidden border border-theme-stroke">
              <button
                type="button"
                onClick={() => setPayType('hourly')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  payType === 'hourly'
                    ? 'bg-[#ff393a] text-white'
                    : 'bg-theme-surface text-theme-text-muted hover:text-theme-text'
                }`}
              >
                Hourly
              </button>
              <button
                type="button"
                onClick={() => setPayType('flat')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  payType === 'flat'
                    ? 'bg-[#ff393a] text-white'
                    : 'bg-theme-surface text-theme-text-muted hover:text-theme-text'
                }`}
              >
                Flat Fee
              </button>
            </div>

            {payType === 'hourly' ? (
              <div className="mt-2 space-y-2">
                <IconInput
                  icon={DollarSign}
                  type="number"
                  min="0"
                  step="0.01"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  placeholder="Hourly rate"
                />
                <div className="grid grid-cols-2 gap-2">
                  <IconInput
                    icon={Clock}
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    placeholder="Start time"
                  />
                  <IconInput
                    icon={Clock}
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    placeholder="End time"
                  />
                </div>
                {totalCost && (
                  <p className="text-xs text-[#39d98a] font-medium px-1">
                    Total: ${totalCost}
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-2">
                <IconInput
                  icon={DollarSign}
                  type="number"
                  min="0"
                  step="0.01"
                  value={flatFee}
                  onChange={(e) => setFlatFee(e.target.value)}
                  placeholder="Flat fee amount"
                />
              </div>
            )}
          </div>

          {/* Notes */}
          <IconInput
            icon={FileText}
            multiline
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
          />

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text font-medium py-2 rounded-xl transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim() || !role.trim()}
              className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
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
