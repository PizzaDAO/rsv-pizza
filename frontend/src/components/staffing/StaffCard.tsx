import React from 'react';
import { User, Mail, Phone, FileText, X, Check, Clock, LogIn } from 'lucide-react';
import { Staff, StaffStatus } from '../../types';

interface StaffCardProps {
  staff: Staff;
  onEdit: (staff: Staff) => void;
  onDelete: (staffId: string) => void;
  onStatusChange: (staffId: string, status: StaffStatus) => void;
}

const STATUS_CONFIG: Record<StaffStatus, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  invited: {
    label: 'Invited',
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/20',
    icon: <Clock size={12} />,
  },
  confirmed: {
    label: 'Confirmed',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    icon: <Check size={12} />,
  },
  declined: {
    label: 'Declined',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    icon: <X size={12} />,
  },
  checked_in: {
    label: 'Checked In',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    icon: <LogIn size={12} />,
  },
};

export const StaffCard: React.FC<StaffCardProps> = ({
  staff,
  onEdit,
  onDelete,
  onStatusChange,
}) => {
  const statusConfig = STATUS_CONFIG[staff.status];

  return (
    <div className="flex items-start justify-between p-4 bg-theme-surface rounded-xl border border-theme-stroke hover:bg-theme-surface-hover transition-colors">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-[#ff393a]/20 flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-[#ff393a]" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-theme-text font-medium truncate">{staff.name}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full ${statusConfig.bgColor} ${statusConfig.color} flex items-center gap-1`}>
              {statusConfig.icon}
              {statusConfig.label}
            </span>
          </div>

          <p className="text-[#ff393a] text-sm mt-0.5">{staff.role}</p>

          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {staff.email && (
              <a
                href={`mailto:${staff.email}`}
                className="flex items-center gap-1 text-theme-text-muted hover:text-theme-text text-xs"
                onClick={(e) => e.stopPropagation()}
              >
                <Mail size={12} />
                <span className="truncate max-w-[150px]">{staff.email}</span>
              </a>
            )}
            {staff.phone && (
              <a
                href={`tel:${staff.phone}`}
                className="flex items-center gap-1 text-theme-text-muted hover:text-theme-text text-xs"
                onClick={(e) => e.stopPropagation()}
              >
                <Phone size={12} />
                <span>{staff.phone}</span>
              </a>
            )}
          </div>

          {staff.notes && (
            <div className="flex items-start gap-1 mt-2 text-theme-text-muted text-xs">
              <FileText size={12} className="flex-shrink-0 mt-0.5" />
              <span className="line-clamp-2">{staff.notes}</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
        {/* Quick status toggle */}
        {staff.status === 'invited' && (
          <button
            onClick={() => onStatusChange(staff.id, 'confirmed')}
            className="text-green-400 hover:text-green-300 text-xs font-medium px-2 py-1 rounded bg-green-500/10 hover:bg-green-500/20 transition-colors"
            title="Mark as confirmed"
          >
            Confirm
          </button>
        )}
        {staff.status === 'confirmed' && (
          <button
            onClick={() => onStatusChange(staff.id, 'checked_in')}
            className="text-blue-400 hover:text-blue-300 text-xs font-medium px-2 py-1 rounded bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
            title="Check in"
          >
            Check In
          </button>
        )}

        <button
          onClick={() => onEdit(staff)}
          className="text-theme-text-muted hover:text-theme-text text-sm font-medium"
        >
          Edit
        </button>
        <button
          onClick={() => onDelete(staff.id)}
          className="text-[#ff393a] hover:text-[#ff5a5b]"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
};
