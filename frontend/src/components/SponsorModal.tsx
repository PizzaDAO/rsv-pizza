import React, { useState, useEffect } from 'react';
import { X, Loader2, Image as ImageIcon, Globe, FileText } from 'lucide-react';
import { Sponsor, SponsorTier } from '../types';

interface SponsorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: SponsorFormData) => Promise<void>;
  sponsor?: Sponsor | null; // If provided, we're editing
  saving?: boolean;
}

export interface SponsorFormData {
  name: string;
  tier: SponsorTier;
  logoUrl: string;
  websiteUrl: string;
  description: string;
  visible: boolean;
}

const tierOptions: { value: SponsorTier; label: string; description: string }[] = [
  { value: 'gold', label: 'Gold', description: 'Top-tier sponsors' },
  { value: 'silver', label: 'Silver', description: 'Major sponsors' },
  { value: 'bronze', label: 'Bronze', description: 'Supporting sponsors' },
  { value: 'partner', label: 'Partner', description: 'Community partners' },
];

export const SponsorModal: React.FC<SponsorModalProps> = ({
  isOpen,
  onClose,
  onSave,
  sponsor,
  saving = false,
}) => {
  const [name, setName] = useState('');
  const [tier, setTier] = useState<SponsorTier>('partner');
  const [logoUrl, setLogoUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [description, setDescription] = useState('');
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens/closes or sponsor changes
  useEffect(() => {
    if (isOpen) {
      if (sponsor) {
        setName(sponsor.name);
        setTier(sponsor.tier);
        setLogoUrl(sponsor.logoUrl || '');
        setWebsiteUrl(sponsor.websiteUrl || '');
        setDescription(sponsor.description || '');
        setVisible(sponsor.visible);
      } else {
        setName('');
        setTier('partner');
        setLogoUrl('');
        setWebsiteUrl('');
        setDescription('');
        setVisible(true);
      }
      setError(null);
    }
  }, [isOpen, sponsor]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Sponsor name is required');
      return;
    }

    try {
      await onSave({
        name: name.trim(),
        tier,
        logoUrl: logoUrl.trim(),
        websiteUrl: websiteUrl.trim(),
        description: description.trim(),
        visible,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save sponsor');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            {sponsor ? 'Edit Sponsor' : 'Add Sponsor'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1.5">
              Sponsor Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Company or organization name"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              autoFocus
            />
          </div>

          {/* Tier */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1.5">
              Tier
            </label>
            <div className="grid grid-cols-2 gap-2">
              {tierOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTier(option.value)}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    tier === option.value
                      ? 'bg-[#ff393a]/20 border-[#ff393a]/50 text-white'
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                  }`}
                >
                  <div className="font-medium text-sm">{option.label}</div>
                  <div className="text-xs opacity-60">{option.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Logo URL */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1.5">
              <ImageIcon size={14} className="inline mr-1" />
              Logo URL
            </label>
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            />
            {logoUrl && (
              <div className="mt-2 p-2 bg-white/5 rounded-lg border border-white/10">
                <img
                  src={logoUrl}
                  alt="Logo preview"
                  className="max-h-16 max-w-full object-contain mx-auto"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            )}
          </div>

          {/* Website URL */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1.5">
              <Globe size={14} className="inline mr-1" />
              Website URL
            </label>
            <input
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1.5">
              <FileText size={14} className="inline mr-1" />
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the sponsor..."
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] resize-none"
            />
          </div>

          {/* Visibility Toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              className={`w-10 h-6 rounded-full p-0.5 transition-colors ${
                visible ? 'bg-[#ff393a]' : 'bg-white/20'
              }`}
              onClick={() => setVisible(!visible)}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white shadow-md transition-transform ${
                  visible ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </div>
            <span className="text-sm text-white/80">
              Show on event page
            </span>
          </label>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg text-sm bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a]">
              {error}
            </div>
          )}

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
              disabled={saving || !name.trim()}
              className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </>
              ) : sponsor ? (
                'Save Changes'
              ) : (
                'Add Sponsor'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
