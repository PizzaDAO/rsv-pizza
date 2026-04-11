import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Building2, Globe, User, Mail, Phone, FileText, Upload, Image, MessageSquare, CheckCircle, AlertCircle, Loader2
} from 'lucide-react';
import { IconInput } from '../components/IconInput';
import { uploadSponsorLogo } from '../lib/supabase';
import { getPartnerIntake, submitPartnerIntake, PartnerIntakeData } from '../lib/api';
import { SponsorshipType } from '../types';

// X (Twitter) icon component
const XIcon: React.FC<{ size: number; className?: string }> = ({ size, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

// Telegram icon component
const TelegramIcon: React.FC<{ size: number; className?: string }> = ({ size, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);

const TYPE_OPTIONS: { value: SponsorshipType; label: string }[] = [
  { value: 'cash', label: 'Funds' },
  { value: 'in-kind', label: 'In-Kind' },
  { value: 'venue', label: 'Venue' },
  { value: 'pizza', label: 'Pizza' },
  { value: 'drinks', label: 'Drinks' },
  { value: 'other', label: 'Other' },
];

export function SponsorIntakePage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [eventName, setEventName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previouslySubmitted, setPreviouslySubmitted] = useState(false);

  const [formData, setFormData] = useState<PartnerIntakeData>({
    name: '',
    website: '',
    brandTwitter: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    contactTwitter: '',
    telegram: '',
    sponsorshipType: null,
    productService: '',
    logoUrl: '',
    sponsorMessage: '',
  });

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load sponsor data on mount
  useEffect(() => {
    if (!token) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    async function loadData() {
      const result = await getPartnerIntake(token!);
      if (!result) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setEventName(result.eventName);
      setPreviouslySubmitted(!!result.sponsor.intakeSubmittedAt);

      setFormData({
        name: result.sponsor.name || '',
        website: result.sponsor.website || '',
        brandTwitter: result.sponsor.brandTwitter || '',
        contactName: result.sponsor.contactName || '',
        contactEmail: result.sponsor.contactEmail || '',
        contactPhone: result.sponsor.contactPhone || '',
        contactTwitter: result.sponsor.contactTwitter || '',
        telegram: result.sponsor.telegram || '',
        sponsorshipType: (result.sponsor.sponsorshipType as SponsorshipType) || null,
        productService: result.sponsor.productService || '',
        logoUrl: result.sponsor.logoUrl || '',
        sponsorMessage: result.sponsor.sponsorMessage || '',
      });

      if (result.sponsor.logoUrl) {
        setLogoPreview(result.sponsor.logoUrl);
      }

      setLoading(false);
    }

    loadData();
  }, [token]);

  const handleChange = (field: keyof PartnerIntakeData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

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

    if (!formData.name?.trim()) {
      setError('Company/brand name is required');
      return;
    }

    setSubmitting(true);

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
          setSubmitting(false);
          return;
        }
        setUploadingLogo(false);
      }

      await submitPartnerIntake(token!, {
        ...formData,
        name: formData.name?.trim(),
        logoUrl,
      });

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-white/50" />
      </div>
    );
  }

  // Not found / invalid token
  if (notFound) {
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Link Not Found</h1>
          <p className="text-white/60">
            This sponsor intake link is invalid, has expired, or has been revoked. Please contact the event host for a new link.
          </p>
        </div>
      </div>
    );
  }

  // Success state
  if (submitted) {
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Thank You!</h1>
          <p className="text-white/60 mb-4">
            Your sponsor information for <span className="text-white font-medium">{eventName}</span> has been submitted successfully.
          </p>
          <p className="text-white/40 text-sm">
            You can revisit this link anytime to update your information.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e] py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">
            Thanks for partnering with {eventName}!
          </h1>
          <p className="text-white/60">
            {previouslySubmitted
              ? 'Update your sponsor information below.'
              : 'Please fill out the form below so we can feature your brand at the event.'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-[#16213e] rounded-xl border border-white/10 p-6 space-y-6">
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          {/* Company Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <Building2 size={16} />
              Company Info
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <IconInput
                icon={Building2}
                type="text"
                value={formData.name || ''}
                onChange={e => handleChange('name', e.target.value)}
                placeholder="Company / Brand Name"
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
                customIcon={<XIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />}
                type="text"
                value={formData.brandTwitter || ''}
                onChange={e => handleChange('brandTwitter', e.target.value)}
                placeholder="Brand X Handle"
              />
            </div>
          </div>

          {/* Contact Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <User size={16} />
              Your Contact Info
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                customIcon={<XIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />}
                type="text"
                value={formData.contactTwitter || ''}
                onChange={e => handleChange('contactTwitter', e.target.value)}
                placeholder="Contact X Handle"
              />
              <IconInput
                customIcon={<TelegramIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />}
                type="text"
                value={formData.telegram || ''}
                onChange={e => handleChange('telegram', e.target.value)}
                placeholder="Telegram"
              />
            </div>
          </div>

          {/* Sponsorship Details */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <FileText size={16} />
              Sponsorship Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="relative">
                <FileText size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />
                <select
                  value={formData.sponsorshipType || ''}
                  onChange={e => handleChange('sponsorshipType', e.target.value as SponsorshipType || null)}
                  className="w-full !pl-14 bg-theme-input border border-theme-stroke rounded-xl text-theme-text focus:outline-none focus:ring-1 focus:ring-[#ff393a] appearance-none cursor-pointer"
                  style={{ colorScheme: 'dark' }}
                >
                  <option value="" className="bg-[#16213e] text-white/50">Contribution Type</option>
                  {TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value} className="bg-[#16213e] text-white">
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
                placeholder="Product/Service Description"
              />
            </div>
          </div>

          {/* Logo Upload */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
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

          {/* Message to Host */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <MessageSquare size={16} />
              Message to Host
            </h3>
            <IconInput
              icon={MessageSquare}
              multiline
              rows={3}
              value={formData.sponsorMessage || ''}
              onChange={e => handleChange('sponsorMessage', (e.target as HTMLTextAreaElement).value)}
              placeholder="Any notes or special requests for the event organizer..."
            />
          </div>

          {/* Submit */}
          <div className="pt-4 border-t border-white/10">
            <button
              type="submit"
              disabled={submitting || uploadingLogo}
              className="w-full px-4 py-3 bg-[#ff393a] hover:bg-[#ff393a]/80 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting || uploadingLogo ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  {uploadingLogo ? 'Uploading Logo...' : 'Submitting...'}
                </>
              ) : previouslySubmitted ? (
                'Update Information'
              ) : (
                'Submit'
              )}
            </button>
          </div>
        </form>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-white/30 text-xs">
            Powered by <a href="https://rsv.pizza" className="text-white/40 hover:text-white/60 transition-colors">RSV.Pizza</a>
          </p>
        </div>
      </div>
    </div>
  );
}
