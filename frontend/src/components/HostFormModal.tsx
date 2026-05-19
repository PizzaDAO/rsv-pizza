import React from 'react';
import { createPortal } from 'react-dom';
import { User, Mail, Globe, Instagram, Send, Upload, UserPlus, Loader2 } from 'lucide-react';
import { Checkbox } from './Checkbox';
import { IconInput } from './IconInput';

// X (Twitter) icon component
const XIcon: React.FC<{ size?: number; className?: string }> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

export interface HostFormModalProps {
  open: boolean;
  mode: 'add' | 'edit';
  name: string;
  email: string;
  website: string;
  twitter: string;
  instagram: string;
  telegram: string;
  avatarUrl: string;
  avatarFilePreview: string | null;
  showOnEvent: boolean;
  canEdit: boolean;
  xAvatarFetching: boolean;
  onNameChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onWebsiteChange: (v: string) => void;
  onWebsiteBlur: () => void;
  onTwitterChange: (v: string) => void;
  onTwitterBlur: () => void | Promise<void>;
  onInstagramChange: (v: string) => void;
  onInstagramBlur: () => void;
  onTelegramChange: (v: string) => void;
  onTelegramBlur: () => void;
  onShowOnEventChange: () => void;
  onCanEditChange: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onAvatarFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAvatarClear: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
}

const HostFormModal: React.FC<HostFormModalProps> = ({
  open,
  mode,
  name,
  email,
  website,
  twitter,
  instagram,
  telegram,
  avatarUrl,
  avatarFilePreview,
  showOnEvent,
  canEdit,
  xAvatarFetching,
  onNameChange,
  onEmailChange,
  onWebsiteChange,
  onWebsiteBlur,
  onTwitterChange,
  onTwitterBlur,
  onInstagramChange,
  onInstagramBlur,
  onTelegramChange,
  onTelegramBlur,
  onShowOnEventChange,
  onCanEditChange,
  fileInputRef,
  onAvatarFileChange,
  onAvatarClear,
  onCancel,
  onSubmit,
  submitting,
}) => {
  if (!open) return null;

  const title = mode === 'add' ? 'Add Host' : 'Edit Host';
  const submitLabel = submitting
    ? mode === 'add' ? 'Adding...' : 'Saving...'
    : mode === 'add' ? 'Add Host' : 'Save';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/70"
      onClick={onCancel}
    >
      <div
        className="bg-theme-header border border-theme-stroke rounded-2xl shadow-xl max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-theme-text mb-4">{title}</h2>

        <div className="space-y-3">
          {/* Avatar upload */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onAvatarFileChange}
              className="hidden"
            />
            <div className="flex items-center gap-3">
              {(avatarFilePreview || avatarUrl) ? (
                <img
                  src={avatarFilePreview || avatarUrl}
                  alt=""
                  className="w-10 h-10 rounded-full object-cover border border-white/20 shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-theme-surface border border-theme-stroke shrink-0" />
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 bg-theme-surface border border-theme-stroke rounded-lg text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover transition-colors text-sm"
              >
                <Upload size={16} />
                Upload avatar
              </button>
              {(avatarFilePreview || avatarUrl) && (
                <button
                  type="button"
                  onClick={onAvatarClear}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <IconInput
            icon={User}
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Name"
            required
          />

          <IconInput
            icon={Mail}
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="Email (required to edit event)"
          />

          <IconInput
            icon={Globe}
            type="url"
            value={website}
            onChange={(e) => onWebsiteChange(e.target.value)}
            onBlur={onWebsiteBlur}
            placeholder="Website"
          />

          <div className="relative">
            <IconInput
              customIcon={<XIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />}
              type="text"
              value={twitter}
              onChange={(e) => onTwitterChange(e.target.value)}
              onBlur={onTwitterBlur}
              disabled={xAvatarFetching}
              placeholder="Twitter (no @)"
            />
            {xAvatarFetching && (
              <Loader2
                size={14}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted animate-spin pointer-events-none"
              />
            )}
          </div>

          <IconInput
            icon={Instagram}
            type="text"
            value={instagram}
            onChange={(e) => onInstagramChange(e.target.value)}
            onBlur={onInstagramBlur}
            placeholder="Instagram (no @)"
          />

          <IconInput
            icon={Send}
            type="text"
            value={telegram}
            onChange={(e) => onTelegramChange(e.target.value)}
            onBlur={onTelegramBlur}
            placeholder="Telegram (no @)"
          />
        </div>

        <div className="flex items-center gap-4 mt-3">
          <Checkbox
            checked={showOnEvent}
            onChange={onShowOnEventChange}
            label="Show on event"
            size={16}
            labelClassName="text-xs font-medium text-white/60"
          />
          <Checkbox
            checked={canEdit}
            onChange={onCanEditChange}
            label="Editor"
            size={16}
            labelClassName="text-xs font-medium text-white/60"
          />
        </div>

        <div className="flex gap-3 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!name.trim() || submitting}
            className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
          >
            <UserPlus size={16} />
            {submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default HostFormModal;
