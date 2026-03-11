import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Performer, PerformerType, PerformerStatus } from '../../types';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { X, Loader2, User, Music, Clock, Hash, Instagram, Cloud, Mail, Phone, UserCircle, Wrench, DollarSign, FileText, ChevronDown, ChevronUp } from 'lucide-react';

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
  { value: 'dj', label: 'DJ', icon: '🌧' },
  { value: 'live_band', label: 'Live Band', icon: '🌸' },
  { value: 'solo', label: 'Solo Artist', icon: '🌤' },
  { value: 'playlist', label: 'Playlist', icon: '🎵' },
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
      setShowAdvanced(
        !!performer.contactName || !!performer.contactEmail || !!performer.contactPhone ||
        !!performer.equipmentNotes || !!performer.fee || !!performer.notes
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-theme-header border border-theme-stroke rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-theme-text">
            {isEditing ? 'Edit Performer' : 'Add Performer'}
          </h2>
          <button onClick={onClose} className="p-2 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <IconInput icon={User} type="text" value={formData.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="DJ Name or Artist" required />

          <div className="grid grid-cols-2 gap-3">
            <select
              value={formData.type}
              onChange={(e) => handleChange('type', e.target.value as PerformerType)}
              className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            >
              {performerTypes.map((type) => (
                <option key={type.value} value={type.value}>{type.icon} {type.label}</option>
              ))}
            </select>
            <select
              value={formData.status}
              onChange={(e) => handleChange('status', e.target.value as PerformerStatus)}
              className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-theme-text text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            >
              {statusOptions.map((status) => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
          </div>

          <IconInput icon={Music} type="text" value={formData.genre} onChange={(e) => handleChange('genre', e.target.value)} placeholder="e.g., House, Techno, Hip Hop" />

          <div className="grid grid-cols-2 gap-3">
            <IconInput icon={Clock} type="time" value={formData.setTime} onChange={(e) => handleChange('setTime', e.target.value)} style={{ colorScheme: 'dark' }} />
            <IconInput icon={Hash} type="number" value={formData.setDuration} onChange={(e) => handleChange('setDuration', e.target.value)} placeholder="Duration (min)" min="0" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <IconInput icon={Instagram} type="text" value={formData.instagram} onChange={(e) => handleChange('instagram', e.target.value)} placeholder="@username" />
            <IconInput icon={Cloud} type="text" value={formData.soundcloud} onChange={(e) => handleChange('soundcloud', e.target.value)} placeholder="username or URL" />
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between p-2 bg-theme-surface hover:bg-theme-surface-hover border border-theme-stroke rounded-xl transition-colors text-sm"
          >
            <span className="text-theme-text-secondary">Contact & Payment Details</span>
            {showAdvanced ? <ChevronUp size={18} className="text-theme-text-secondary" /> : <ChevronDown size={18} className="text-theme-text-secondary" />}
          </button>

          {showAdvanced && (
            <div className="space-y-3 border-l-2 border-theme-stroke pl-4">
              <IconInput icon={UserCircle} type="text" value={formData.contactName} onChange={(e) => handleChange('contactName', e.target.value)} placeholder="Real name or booking contact" />
              <div className="grid grid-cols-2 gap-3">
                <IconInput icon={Mail} type="email" value={formData.contactEmail} onChange={(e) => handleChange('contactEmail', e.target.value)} placeholder="contact@email.com" />
                <IconInput icon={Phone} type="tel" value={formData.contactPhone} onChange={(e) => handleChange('contactPhone', e.target.value)} placeholder="+1 555-123-4567" />
              </div>
              <Checkbox checked={formData.equipmentProvided} onChange={() => handleChange('equipmentProvided', !formData.equipmentProvided)} label="Bringing their own equipment" />
              <IconInput icon={Wrench} type="text" value={formData.equipmentNotes} onChange={(e) => handleChange('equipmentNotes', e.target.value)} placeholder="What equipment do they need?" />
              <div className="grid grid-cols-2 gap-3 items-center">
                <IconInput icon={DollarSign} type="number" value={formData.fee} onChange={(e) => handleChange('fee', e.target.value)} placeholder="Fee ($)" min="0" step="0.01" />
                <Checkbox checked={formData.feePaid} onChange={() => handleChange('feePaid', !formData.feePaid)} label="Paid" />
              </div>
              <IconInput icon={FileText} multiline rows={2} value={formData.notes} onChange={(e) => handleChange('notes', e.target.value)} placeholder="Any additional notes..." />
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={saving} className="flex-1 bg-theme-surface-hover hover:bg-theme-surface-hover disabled:opacity-50 text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving || !formData.name.trim()} className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2">
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </>
              ) : isEditing ? 'Save Changes' : 'Add Performer'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
