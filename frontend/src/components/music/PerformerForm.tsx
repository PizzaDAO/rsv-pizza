import React, { useState, useEffect } from 'react';
import { Performer, PerformerType, PerformerStatus } from '../../types';
import { X, Loader2 } from 'lucide-react';

interface PerformerFormProps {
  performer?: Performer | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: PerformerFormData) => Promise<void>;
  saving?: boolean;
}

export interface PerformerFormData {
  name: string;
  type: PerformerType;
  genre: string;
  setTime: string;
  setDuration: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  instagram: string;
  soundcloud: string;
  status: PerformerStatus;
  equipmentProvided: boolean;
  equipmentNotes: string;
  fee: string;
  feePaid: boolean;
  notes: string;
}

const defaultFormData: PerformerFormData = {
  name: '',
  type: 'dj',
  genre: '',
  setTime: '',
  setDuration: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  instagram: '',
  soundcloud: '',
  status: 'confirmed',
  equipmentProvided: false,
  equipmentNotes: '',
  fee: '',
  feePaid: false,
  notes: '',
};

const performerTypes: { value: PerformerType; label: string; icon: string }[] = [
  { value: 'dj', label: 'DJ', icon: '\uD83C\uDFA7' },
  { value: 'live_band', label: 'Live Band', icon: '\uD83C\uDFB8' },
  { value: 'solo', label: 'Solo Artist', icon: '\uD83C\uDFA4' },
  { value: 'playlist', label: 'Playlist', icon: '\uD83C\uDFB5' },
];

const statusOptions: { value: PerformerStatus; label: string; color: string }[] = [
  { value: 'confirmed', label: 'Confirmed', color: 'text-green-400' },
  { value: 'pending', label: 'Pending', color: 'text-yellow-400' },
  { value: 'cancelled', label: 'Cancelled', color: 'text-red-400' },
];

export const PerformerForm: React.FC<PerformerFormProps> = ({
  performer,
  isOpen,
  onClose,
  onSave,
  saving = false,
}) => {
  const [formData, setFormData] = useState<PerformerFormData>(defaultFormData);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Reset form when modal opens/closes or performer changes
  useEffect(() => {
    if (isOpen && performer) {
      setFormData({
        name: performer.name,
        type: performer.type,
        genre: performer.genre || '',
        setTime: performer.setTime || '',
        setDuration: performer.setDuration?.toString() || '',
        contactName: performer.contactName || '',
        contactEmail: performer.contactEmail || '',
        contactPhone: performer.contactPhone || '',
        instagram: performer.instagram || '',
        soundcloud: performer.soundcloud || '',
        status: performer.status,
        equipmentProvided: performer.equipmentProvided,
        equipmentNotes: performer.equipmentNotes || '',
        fee: performer.fee?.toString() || '',
        feePaid: performer.feePaid,
        notes: performer.notes || '',
      });
      // Show advanced if any advanced fields are filled
      setShowAdvanced(
        !!performer.contactName ||
        !!performer.contactEmail ||
        !!performer.contactPhone ||
        !!performer.equipmentNotes ||
        !!performer.fee ||
        !!performer.notes
      );
    } else if (isOpen) {
      setFormData(defaultFormData);
      setShowAdvanced(false);
    }
  }, [isOpen, performer]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(formData);
  };

  const handleChange = (field: keyof PerformerFormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  if (!isOpen) return null;

  const isEditing = !!performer;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-10 p-4 bg-black/70 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl max-w-lg w-full p-5 my-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? 'Edit Performer' : 'Add Performer'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name (required) */}
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="DJ Name or Artist"
              required
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            />
          </div>

          {/* Type & Status Row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Type</label>
              <select
                value={formData.type}
                onChange={(e) => handleChange('type', e.target.value as PerformerType)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              >
                {performerTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.icon} {type.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Status</label>
              <select
                value={formData.status}
                onChange={(e) => handleChange('status', e.target.value as PerformerStatus)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              >
                {statusOptions.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Genre */}
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Genre / Style</label>
            <input
              type="text"
              value={formData.genre}
              onChange={(e) => handleChange('genre', e.target.value)}
              placeholder="e.g., House, Techno, Hip Hop"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            />
          </div>

          {/* Schedule Row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Set Time</label>
              <input
                type="time"
                value={formData.setTime}
                onChange={(e) => handleChange('setTime', e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Duration (min)</label>
              <input
                type="number"
                value={formData.setDuration}
                onChange={(e) => handleChange('setDuration', e.target.value)}
                placeholder="e.g., 120"
                min="0"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              />
            </div>
          </div>

          {/* Social Links Row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Instagram</label>
              <input
                type="text"
                value={formData.instagram}
                onChange={(e) => handleChange('instagram', e.target.value)}
                placeholder="@username"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">SoundCloud</label>
              <input
                type="text"
                value={formData.soundcloud}
                onChange={(e) => handleChange('soundcloud', e.target.value)}
                placeholder="username or URL"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              />
            </div>
          </div>

          {/* Advanced Section Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors text-sm"
          >
            <span className="text-white/70">Contact & Payment Details</span>
            {showAdvanced ? (
              <svg className="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>

          {/* Advanced Fields */}
          {showAdvanced && (
            <div className="space-y-3 border-l-2 border-white/10 pl-4">
              {/* Contact Info */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1">Contact Name</label>
                <input
                  type="text"
                  value={formData.contactName}
                  onChange={(e) => handleChange('contactName', e.target.value)}
                  placeholder="Real name or booking contact"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.contactEmail}
                    onChange={(e) => handleChange('contactEmail', e.target.value)}
                    placeholder="contact@email.com"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={formData.contactPhone}
                    onChange={(e) => handleChange('contactPhone', e.target.value)}
                    placeholder="+1 555-123-4567"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                  />
                </div>
              </div>

              {/* Equipment */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="equipmentProvided"
                  checked={formData.equipmentProvided}
                  onChange={(e) => handleChange('equipmentProvided', e.target.checked)}
                  className="w-4 h-4 rounded border-white/30 bg-white/10 text-[#ff393a] focus:ring-[#ff393a] focus:ring-offset-0"
                />
                <label htmlFor="equipmentProvided" className="text-sm text-white/70">
                  Bringing their own equipment
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-white/70 mb-1">Equipment Notes</label>
                <input
                  type="text"
                  value={formData.equipmentNotes}
                  onChange={(e) => handleChange('equipmentNotes', e.target.value)}
                  placeholder="What equipment do they need?"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
              </div>

              {/* Fee */}
              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1">Fee ($)</label>
                  <input
                    type="number"
                    value={formData.fee}
                    onChange={(e) => handleChange('fee', e.target.value)}
                    placeholder="0"
                    min="0"
                    step="0.01"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                  />
                </div>
                <div className="flex items-center gap-3 pb-2">
                  <input
                    type="checkbox"
                    id="feePaid"
                    checked={formData.feePaid}
                    onChange={(e) => handleChange('feePaid', e.target.checked)}
                    className="w-4 h-4 rounded border-white/30 bg-white/10 text-[#ff393a] focus:ring-[#ff393a] focus:ring-offset-0"
                  />
                  <label htmlFor="feePaid" className="text-sm text-white/70">
                    Paid
                  </label>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  placeholder="Any additional notes..."
                  rows={2}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] resize-none"
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !formData.name.trim()}
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
                'Add Performer'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
