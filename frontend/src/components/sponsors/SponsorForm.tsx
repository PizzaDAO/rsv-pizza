import React, { useState, useEffect, useRef } from 'react';
import { X, Building2, User, Mail, Phone, DollarSign, FileText, Calendar, Globe, Upload, Image } from 'lucide-react';
import { Sponsor, SponsorStatus, SponsorshipType } from '../../types';
import { CreateSponsorData } from '../../lib/api';
import { IconInput } from '../IconInput';
import { uploadSponsorLogo } from '../../lib/supabase';

// X (Twitter) icon component
const XIcon: React.FC<{ size: number; className?: string }> = ({ size, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

// Telegram icon component
const TelegramIcon: React.FC<{ size: number; className?: string }> = ({ size, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
  </svg>
);

interface SponsorFormProps {
  sponsor?: Sponsor | null;
  onSubmit: (data: CreateSponsorData) => Promise<void>;
  onClose: () => void;
  isLoading?: boolean;
}

const STATUS_OPTIONS: { value: SponsorStatus; label: string; color: string }[] = [
  { value: 'todo', label: 'To Do', color: 'bg-gray-500' },
  { value: 'asked', label: 'Asked', color: 'bg-orange-500' },
  { value: 'yes', label: 'Yes', color: 'bg-green-500' },
  { value: 'invoiced', label: 'Invoiced', color: 'bg-yellow-500' },
  { value: 'paid', label: 'Paid', color: 'bg-blue-500' },
  { value: 'stuck', label: 'Stuck', color: 'bg-red-500' },
  { value: 'alum', label: 'Alum', color: 'bg-purple-500' },
  { value: 'skip', label: 'Skip', color: 'bg-gray-700' },
];

const TYPE_OPTIONS: { value: SponsorshipType; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'in-kind', label: 'In-Kind' },
  { value: 'venue', label: 'Venue' },
  { value: 'pizza', label: 'Pizza' },
  { value: 'drinks', label: 'Drinks' },
  { value: 'other', label: 'Other' },
];

export function SponsorForm({ sponsor, onSubmit, onClose, isLoading }: SponsorFormProps) {
  const [formData, setFormData] = useState<CreateSponsorData>({
    name: '',
    website: '',
    brandTwitter: '',
    pointPerson: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    contactTwitter: '',
    telegram: '',
    status: 'todo',
    amount: null,
    amountReceived: null,
    sponsorshipType: null,
    productService: '',
    logoUrl: '',
    notes: '',
    lastContactedAt: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize form with sponsor data if editing
  useEffect(() => {
    if (sponsor) {
      setFormData({
        name: sponsor.name,
        website: sponsor.website || '',
        brandTwitter: sponsor.brandTwitter || '',
        pointPerson: sponsor.pointPerson || '',
        contactName: sponsor.contactName || '',
        contactEmail: sponsor.contactEmail || '',
        contactPhone: sponsor.contactPhone || '',
        contactTwitter: sponsor.contactTwitter || '',
        telegram: sponsor.telegram || '',
        status: sponsor.status,
        amount: sponsor.amount,
        amountReceived: sponsor.amountReceived,
        sponsorshipType: sponsor.sponsorshipType,
        productService: sponsor.productService || '',
        logoUrl: sponsor.logoUrl || '',
        notes: sponsor.notes || '',
        lastContactedAt: sponsor.lastContactedAt ? sponsor.lastContactedAt.split('T')[0] : null,
      });
      if (sponsor.logoUrl) {
        setLogoPreview(sponsor.logoUrl);
      }
    }
  }, [sponsor]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB');
      return;
    }

    setLogoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setLogoPreview(objectUrl);
    setError(null);
  };

  const removeLogo = () => {
    if (logoPreview && logoPreview.startsWith('blob:')) {
      URL.revokeObjectURL(logoPreview);
    }
    setLogoFile(null);
    setLogoPreview(null);
    handleChange('logoUrl', '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.name.trim()) {
      setError('Sponsor name is required');
      return;
    }

    try {
      let logoUrl = formData.logoUrl;

      // Upload logo if a new file was selected
      if (logoFile) {
        setUploadingLogo(true);
        const uploadedUrl = await uploadSponsorLogo(logoFile);
        if (uploadedUrl) {
          logoUrl = uploadedUrl;
        } else {
          setError('Failed to upload logo. Please try again.');
          setUploadingLogo(false);
          return;
        }
        setUploadingLogo(false);
      }

      await onSubmit({
        ...formData,
        name: formData.name.trim(),
        logoUrl,
        lastContactedAt: formData.lastContactedAt || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save sponsor');
    }
  };

  const handleChange = (field: keyof CreateSponsorData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1a2e] rounded-xl border border-white/10 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">
            {sponsor ? 'Edit Sponsor' : 'Add Sponsor'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-6">
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          {/* Sponsor Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
              <Building2 size={16} />
              Sponsor Info
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <IconInput
                icon={Building2}
                type="text"
                value={formData.name}
                onChange={e => handleChange('name', e.target.value)}
                placeholder="Sponsor Name *"
                required
              />
              <IconInput
                icon={Globe}
                type="url"
                value={formData.website || ''}
                onChange={e => handleChange('website', e.target.value)}
                placeholder="Website"
              />
              <IconInput
                customIcon={<XIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />}
                type="text"
                value={formData.brandTwitter || ''}
                onChange={e => handleChange('brandTwitter', e.target.value)}
                placeholder="Brand X Handle"
              />
            </div>
          </div>

          {/* Contact Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
              <User size={16} />
              Contact Info
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <IconInput
                icon={User}
                type="text"
                value={formData.pointPerson || ''}
                onChange={e => handleChange('pointPerson', e.target.value)}
                placeholder="Point Person (Your Team)"
              />
              <IconInput
                icon={User}
                type="text"
                value={formData.contactName || ''}
                onChange={e => handleChange('contactName', e.target.value)}
                placeholder="Contact Name"
              />
              <IconInput
                icon={Mail}
                type="email"
                value={formData.contactEmail || ''}
                onChange={e => handleChange('contactEmail', e.target.value)}
                placeholder="Email"
              />
              <IconInput
                icon={Phone}
                type="tel"
                value={formData.contactPhone || ''}
                onChange={e => handleChange('contactPhone', e.target.value)}
                placeholder="Phone"
              />
              <IconInput
                customIcon={<XIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />}
                type="text"
                value={formData.contactTwitter || ''}
                onChange={e => handleChange('contactTwitter', e.target.value)}
                placeholder="Contact X Handle"
              />
              <IconInput
                customIcon={<TelegramIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />}
                type="text"
                value={formData.telegram || ''}
                onChange={e => handleChange('telegram', e.target.value)}
                placeholder="Telegram"
              />
            </div>
          </div>

          {/* Pipeline */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
              <Calendar size={16} />
              Pipeline
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="relative">
                <Calendar size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                <select
                  value={formData.status}
                  onChange={e => handleChange('status', e.target.value as SponsorStatus)}
                  className="w-full !pl-14 bg-[#0d0d1a] border border-white/10 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-[#ff393a] appearance-none cursor-pointer"
                  style={{ colorScheme: 'dark' }}
                >
                  {STATUS_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value} className="bg-[#1a1a2e] text-white">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <IconInput
                icon={Calendar}
                type="date"
                value={formData.lastContactedAt || ''}
                onChange={e => handleChange('lastContactedAt', e.target.value || null)}
                placeholder="Last Contacted"
                style={{ colorScheme: 'dark' }}
              />
            </div>
          </div>

          {/* Fundraising */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
              <DollarSign size={16} />
              Fundraising
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <IconInput
                icon={DollarSign}
                type="number"
                min="0"
                step="0.01"
                value={formData.amount ?? ''}
                onChange={e => handleChange('amount', e.target.value ? parseFloat(e.target.value) : null)}
                placeholder="Amount Pledged"
              />
              <IconInput
                icon={DollarSign}
                type="number"
                min="0"
                step="0.01"
                value={formData.amountReceived ?? ''}
                onChange={e => handleChange('amountReceived', e.target.value ? parseFloat(e.target.value) : null)}
                placeholder="Amount Received"
              />
              <div className="relative">
                <DollarSign size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                <select
                  value={formData.sponsorshipType || ''}
                  onChange={e => handleChange('sponsorshipType', e.target.value as SponsorshipType || null)}
                  className="w-full !pl-14 bg-[#0d0d1a] border border-white/10 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-[#ff393a] appearance-none cursor-pointer"
                  style={{ colorScheme: 'dark' }}
                >
                  <option value="" className="bg-[#1a1a2e] text-white/50">Contribution Type</option>
                  {TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value} className="bg-[#1a1a2e] text-white">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <IconInput
                icon={FileText}
                type="text"
                value={formData.productService || ''}
                onChange={e => handleChange('productService', e.target.value)}
                placeholder="Product/Service (if non-monetary)"
              />
            </div>
          </div>

          {/* Logo Upload */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
              <Image size={16} />
              Logo
            </h3>
            {logoPreview ? (
              <div className="flex items-center gap-4">
                <img
                  src={logoPreview}
                  alt="Logo preview"
                  className="w-16 h-16 object-contain rounded-lg border border-white/10 bg-white/5"
                />
                <button
                  type="button"
                  onClick={removeLogo}
                  className="text-sm text-red-400 hover:text-red-300 transition-colors"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Upload size={16} />
                  Upload Logo
                </button>
                <div className="flex-1">
                  <IconInput
                    icon={Globe}
                    type="url"
                    value={formData.logoUrl || ''}
                    onChange={e => handleChange('logoUrl', e.target.value)}
                    placeholder="Or paste logo URL"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
              <FileText size={16} />
              Notes
            </h3>
            <IconInput
              icon={FileText}
              multiline
              rows={3}
              value={formData.notes || ''}
              onChange={e => handleChange('notes', (e.target as HTMLTextAreaElement).value)}
              placeholder="Communication history, meeting notes, etc."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end pt-4 border-t border-white/10">
            <button
              type="submit"
              disabled={isLoading || uploadingLogo}
              className="px-4 py-2 bg-[#ff393a] hover:bg-[#ff393a]/80 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading || uploadingLogo ? 'Saving...' : sponsor ? 'Update Sponsor' : 'Add Sponsor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
