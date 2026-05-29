import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X, Users } from 'lucide-react';
import { IconInput } from '../IconInput';
import { usePizza } from '../../contexts/PizzaContext';
import { updateParty } from '../../lib/supabase';

interface EstimatedAttendanceModalProps {
  open: boolean;
  onClose: () => void;
  partyId: string;
  inviteCode: string;
  currentEstimate: number | null;
  onSaved?: () => void;
}

export const EstimatedAttendanceModal: React.FC<EstimatedAttendanceModalProps> = ({
  open,
  onClose,
  partyId,
  inviteCode,
  currentEstimate,
  onSaved,
}) => {
  const { t } = useTranslation('host');
  const { loadParty } = usePizza();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the input from the current estimate when the modal opens.
  useEffect(() => {
    if (open) {
      setValue(currentEstimate != null ? String(currentEstimate) : '');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    const trimmed = value.trim();
    const num = trimmed === '' ? null : Number(trimmed);
    if (num !== null && (!Number.isFinite(num) || num < 0)) {
      setError(t('attendance.modalError'));
      return;
    }
    setSaving(true);
    setError(null);
    const success = await updateParty(partyId, { estimated_attendance: num });
    setSaving(false);
    if (success) {
      await loadParty(inviteCode);
      onSaved?.();
      onClose();
    } else {
      setError(t('attendance.modalError'));
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl p-6 w-full max-w-md relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('checklist.cancel')}
          className="absolute right-4 top-4 text-theme-text-faint hover:text-theme-text transition-colors"
        >
          <X size={18} />
        </button>
        <h2 className="text-xl font-bold text-theme-text mb-5 pr-8">
          {t('attendance.modalTitle')}
        </h2>

        <IconInput
          icon={Users}
          type="number"
          min={0}
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('attendance.modalPlaceholder')}
          disabled={saving}
        />

        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 btn-secondary"
          >
            {t('checklist.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 btn-primary inline-flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {t('attendance.modalCta')}
          </button>
        </div>
      </div>
    </div>
  );
};
