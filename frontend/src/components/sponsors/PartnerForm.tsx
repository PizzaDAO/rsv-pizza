import React, { useState, useEffect, useRef } from 'react';
import { X, Building2, User, Mail, Phone, DollarSign, FileText, Calendar, Globe, Upload, Image, Instagram, Settings, Check, MessageSquare, Loader2 } from 'lucide-react';
import { Sponsor, SponsorStatus, SponsorshipType, SponsorCategory, SPONSOR_CATEGORIES, SponsorUser } from '../../types';
import { CreateSponsorData, PartnerIntakeResponse } from '../../lib/api';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { uploadSponsorLogo } from '../../lib/supabase';
import { PartnerIntakeButton } from './PartnerIntakeButton';

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

/* ---------- Exported types ---------- */

export interface PartnerFormData {
  // Shared
  name: string;
  website: string;
  brandTwitter: string;
  brandInstagram: string;
  brandDescription: string;
  logoUrl: string;
  notes: string;

  // CRM + intake
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactTwitter: string;
  telegram: string;
  sponsorshipType: SponsorshipType | null;
  productService: string;
  sponsorMessage: string;

  // CRM-only
  pointPerson: string;
  status: SponsorStatus;
  amount: number | null;
  lastContactedAt: string | null;
  category: SponsorCategory | null;

  // Partner-only
  email: string;
  tag: string;
  contactPersonName: string;
  coHostAvatarUrl: string;
  autoCoHost: boolean;
  autoSponsor: boolean;
}

/** Extract CRM sponsor data from the unified form */
export function extractSponsorData(data: PartnerFormData): CreateSponsorData {
  return {
    name: data.name.trim(),
    website: data.website || undefined,
    brandTwitter: data.brandTwitter || undefined,
    brandInstagram: data.brandInstagram || undefined,
    brandDescription: data.brandDescription || undefined,
    pointPerson: data.pointPerson || undefined,
    contactName: data.contactName || undefined,
    contactEmail: data.contactEmail || undefined,
    contactPhone: data.contactPhone || undefined,
    contactTwitter: data.contactTwitter || undefined,
    telegram: data.telegram || undefined,
    status: data.status,
    amount: data.amount,
    sponsorshipType: data.sponsorshipType,
    productService: data.productService || undefined,
    logoUrl: data.logoUrl || undefined,
    notes: data.notes || undefined,
    lastContactedAt: data.lastContactedAt,
    category: data.category || undefined,
  };
}

/* ---------- Constants ---------- */

const STATUS_OPTIONS: { value: SponsorStatus; label: string; color: string }[] = [
  { value: 'todo', label: 'To Do', color: 'bg-gray-500' },
  { value: 'asked', label: 'Asked', color: 'bg-orange-500' },
  { value: 'yes', label: 'Yes', color: 'bg-green-500' },
  { value: 'billed', label: 'Billed', color: 'bg-yellow-500' },
  { value: 'paid', label: 'Paid', color: 'bg-blue-500' },
  { value: 'stuck', label: 'Stuck', color: 'bg-red-500' },
  { value: 'alum', label: 'Alum', color: 'bg-purple-500' },
  { value: 'skip', label: 'Skip', color: 'bg-gray-700' },
];

const TYPE_OPTIONS: { value: SponsorshipType; label: string }[] = [
  { value: 'cash', label: 'Funds' },
  { value: 'in-kind', label: 'In-Kind' },
  { value: 'venue', label: 'Venue' },
  { value: 'pizza', label: 'Pizza' },
  { value: 'drinks', label: 'Drinks' },
  { value: 'other', label: 'Other' },
];

/* ---------- Helpers ---------- */

function getDefaultFormData(): PartnerFormData {
  return {
    name: '', website: '', brandTwitter: '', brandInstagram: '', brandDescription: '',
    logoUrl: '', notes: '',
    contactName: '', contactEmail: '', contactPhone: '',
    contactTwitter: '', telegram: '',
    sponsorshipType: null, productService: '', sponsorMessage: '',
    pointPerson: '', status: 'todo' as SponsorStatus,
    amount: null, lastContactedAt: null, category: null,
    email: '', tag: '', contactPersonName: '', coHostAvatarUrl: '',
    autoCoHost: false, autoSponsor: false,
  };
}

function sponsorToFormData(s: Sponsor): PartnerFormData {
  return {
    ...getDefaultFormData(),
    name: s.name,
    website: s.website || '',
    brandTwitter: s.brandTwitter || '',
    brandInstagram: s.brandInstagram || '',
    brandDescription: s.brandDescription || '',
    logoUrl: s.logoUrl || '',
    notes: s.notes || '',
    pointPerson: s.pointPerson || '',
    contactName: s.contactName || '',
    contactEmail: s.contactEmail || '',
    contactPhone: s.contactPhone || '',
    contactTwitter: s.contactTwitter || '',
    telegram: s.telegram || '',
    status: s.status,
    amount: s.amount,
    sponsorshipType: s.sponsorshipType,
    productService: s.productService || '',
    sponsorMessage: s.sponsorMessage || '',
    lastContactedAt: s.lastContactedAt ? s.lastContactedAt.split('T')[0] : null,
    category: (s.category as SponsorCategory) || null,
  };
}

function sponsorUserToFormData(su: SponsorUser): PartnerFormData {
  return {
    ...getDefaultFormData(),
    email: su.email,
    tag: su.tag,
    contactPersonName: su.name || '',
    name: su.coHostName || '',
    website: su.coHostWebsite || '',
    brandTwitter: su.coHostTwitter || '',
    brandInstagram: su.coHostInstagram || '',
    coHostAvatarUrl: su.coHostAvatarUrl || '',
    logoUrl: su.coHostLogoUrl || '',
    autoCoHost: su.autoCoHost,
    autoSponsor: su.autoSponsor,
    notes: su.notes || '',
    category: (su.category as SponsorCategory) || null,
  };
}

function intakeDataToFormData(data: PartnerIntakeResponse['sponsor']): PartnerFormData {
  return {
    ...getDefaultFormData(),
    name: data.name || '',
    website: data.website || '',
    brandTwitter: data.brandTwitter || '',
    brandInstagram: data.brandInstagram || '',
    brandDescription: data.brandDescription || '',
    contactName: data.contactName || '',
    contactEmail: data.contactEmail || '',
    contactPhone: data.contactPhone || '',
    contactTwitter: data.contactTwitter || '',
    telegram: data.telegram || '',
    sponsorshipType: (data.sponsorshipType as SponsorshipType | null) || null,
    productService: data.productService || '',
    logoUrl: data.logoUrl || '',
    sponsorMessage: data.sponsorMessage || '',
  };
}

/* ---------- Props ---------- */

interface PartnerFormProps {
  mode?: 'crm' | 'partner' | 'intake';
  onSubmit: (data: PartnerFormData) => Promise<void>;
  onClose?: () => void;
  isLoading?: boolean;
  // CRM mode
  sponsor?: Sponsor | null;
  partyId?: string;
  onSponsorUpdate?: (sponsor: Sponsor) => void;
  // Partner mode
  partnerData?: SponsorUser | null;
  syncMessage?: string | null;
  // Intake mode
  intakeInitialData?: PartnerIntakeResponse['sponsor'] | null;
  eventName?: string;
  submitLabel?: string;
  wasPreviouslySubmitted?: boolean;
}

/* ---------- Component ---------- */

export function PartnerForm({
  mode = 'crm',
  onSubmit,
  onClose,
  isLoading,
  sponsor,
  partyId,
  onSponsorUpdate,
  partnerData,
  syncMessage,
  intakeInitialData,
  submitLabel,
  wasPreviouslySubmitted,
}: PartnerFormProps) {
  const isCrm = mode === 'crm';
  const isPartner = mode === 'partner';
  const isIntake = mode === 'intake';
  const isEditing = isCrm ? !!sponsor : isPartner ? !!partnerData : false;

  const [formData, setFormData] = useState<PartnerFormData>(() => {
    if (isCrm && sponsor) return sponsorToFormData(sponsor);
    if (isPartner && partnerData) return sponsorUserToFormData(partnerData);
    if (isIntake && intakeInitialData) return intakeDataToFormData(intakeInitialData);
    return getDefaultFormData();
  });
  const [error, setError] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(() => {
    if (isCrm && sponsor?.logoUrl) return sponsor.logoUrl;
    if (isIntake && intakeInitialData?.logoUrl) return intakeInitialData.logoUrl;
    if (isPartner && partnerData?.coHostLogoUrl) return partnerData.coHostLogoUrl;
    return null;
  });
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-initialize when sponsor changes (CRM mode)
  useEffect(() => {
    if (isCrm && sponsor) {
      setFormData(sponsorToFormData(sponsor));
      if (sponsor.logoUrl) setLogoPreview(sponsor.logoUrl);
    }
  }, [sponsor, isCrm]);

  // Re-initialize when partnerData changes (Partner mode)
  useEffect(() => {
    if (isPartner && partnerData) {
      setFormData(sponsorUserToFormData(partnerData));
      if (partnerData.coHostLogoUrl) setLogoPreview(partnerData.coHostLogoUrl);
    }
  }, [partnerData, isPartner]);

  // Re-initialize when intakeInitialData changes (Intake mode)
  useEffect(() => {
    if (isIntake && intakeInitialData) {
      setFormData(intakeDataToFormData(intakeInitialData));
      if (intakeInitialData.logoUrl) setLogoPreview(intakeInitialData.logoUrl);
    }
  }, [intakeInitialData, isIntake]);

  const handleChange = (field: keyof PartnerFormData, value: any) => {
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

    if ((isCrm || isIntake) && !formData.name.trim()) {
      setError(isIntake ? 'Company/brand name is required' : 'Partner name is required');
      return;
    }
    if (isPartner && (!formData.email || !formData.tag)) {
      setError('Email and tag are required');
      return;
    }

    try {
      let logoUrl = formData.logoUrl;

      // Upload logo if a new file was selected (CRM, intake, and partner modes)
      if ((isCrm || isIntake || isPartner) && logoFile) {
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
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  /* ---------- Form body (shared between modes) ---------- */

  const formBody = (
    <form onSubmit={handleSubmit} className="p-4 space-y-6">
      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Account — Partner mode only */}
      {isPartner && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-theme-text flex items-center gap-2">
            <Mail size={16} />
            Account
          </h3>
          <IconInput
            icon={Mail}
            type="email"
            value={formData.email}
            onChange={e => handleChange('email', e.target.value)}
            placeholder="Email"
            required
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <IconInput
              icon={FileText}
              type="text"
              value={formData.tag}
              onChange={e => handleChange('tag', e.target.value)}
              placeholder="Event tag"
              required
            />
            <IconInput
              icon={User}
              type="text"
              value={formData.contactPersonName}
              onChange={e => handleChange('contactPersonName', e.target.value)}
              placeholder="Contact name"
            />
          </div>
        </div>
      )}

      {/* Partner / Company Info — All modes */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-theme-text flex items-center gap-2">
          <Building2 size={16} />
          {isIntake ? 'Company Info' : 'Partner Info'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <IconInput
            icon={Building2}
            type="text"
            value={formData.name}
            onChange={e => handleChange('name', e.target.value)}
            placeholder={isPartner ? 'Display name (shown on events)' : isIntake ? 'Company / Brand Name' : 'Partner Name'}
            required={isCrm || isIntake}
          />
          <IconInput
            icon={Globe}
            type="url"
            value={formData.website}
            onChange={e => handleChange('website', e.target.value)}
            placeholder="Website"
          />
          <IconInput
            customIcon={<XIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />}
            type="text"
            value={formData.brandTwitter}
            onChange={e => handleChange('brandTwitter', e.target.value)}
            placeholder={isPartner ? 'Twitter (no @)' : 'Brand X Handle'}
          />
          {(isPartner || isCrm || isIntake) && (
            <IconInput
              icon={Instagram}
              type="text"
              value={formData.brandInstagram}
              onChange={e => handleChange('brandInstagram', e.target.value)}
              placeholder={isPartner ? 'Instagram (no @)' : 'Brand Instagram Handle'}
            />
          )}
        </div>
        {(isCrm || isIntake) && (
          <IconInput
            icon={FileText}
            multiline
            rows={2}
            value={formData.brandDescription}
            onChange={e => handleChange('brandDescription', (e.target as HTMLTextAreaElement).value)}
            placeholder="1-2 sentence description"
          />
        )}
      </div>

      {/* Co-Host Profile (avatar) — Partner mode only */}
      {isPartner && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-theme-text flex items-center gap-2">
            <User size={16} />
            Co-Host Profile
          </h3>
          <IconInput
            icon={Image}
            type="url"
            value={formData.coHostAvatarUrl}
            onChange={e => handleChange('coHostAvatarUrl', e.target.value)}
            placeholder="Avatar URL"
          />
          {formData.coHostAvatarUrl && (
            <div className="flex items-center gap-2">
              <img
                src={formData.coHostAvatarUrl}
                alt=""
                className="w-8 h-8 rounded-full object-cover"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <span className="text-xs text-theme-text-muted">Avatar preview</span>
            </div>
          )}
        </div>
      )}

      {/* Category — Partner mode */}
      {isPartner && (
        <div className="relative">
          <Building2 size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />
          <select
            value={formData.category || ''}
            onChange={e => handleChange('category', (e.target.value as SponsorCategory) || null)}
            className="w-full !pl-14 bg-theme-input border border-theme-stroke rounded-xl text-theme-text focus:outline-none focus:ring-1 focus:ring-[#ff393a] appearance-none cursor-pointer"
            style={{ colorScheme: 'dark' }}
          >
            <option value="" className="bg-theme-header text-theme-text-muted">Category</option>
            {SPONSOR_CATEGORIES.map(opt => (
              <option key={opt.id} value={opt.id} className="bg-theme-header text-theme-text">
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Contact Info — CRM + Intake */}
      {(isCrm || isIntake) && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-theme-text flex items-center gap-2">
            <User size={16} />
            Contact Info
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {isCrm && (
              <IconInput
                icon={User}
                type="text"
                value={formData.pointPerson}
                onChange={e => handleChange('pointPerson', e.target.value)}
                placeholder="Point Person (Your Team)"
              />
            )}
            <IconInput
              icon={User}
              type="text"
              value={formData.contactName}
              onChange={e => handleChange('contactName', e.target.value)}
              placeholder="Contact Name"
            />
            <IconInput
              icon={Mail}
              type="email"
              value={formData.contactEmail}
              onChange={e => handleChange('contactEmail', e.target.value)}
              placeholder="Email"
            />
            <IconInput
              icon={Phone}
              type="tel"
              value={formData.contactPhone}
              onChange={e => handleChange('contactPhone', e.target.value)}
              placeholder="Phone"
            />
            <IconInput
              customIcon={<XIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />}
              type="text"
              value={formData.contactTwitter}
              onChange={e => handleChange('contactTwitter', e.target.value)}
              placeholder="Contact X Handle"
            />
            <IconInput
              customIcon={<TelegramIcon size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />}
              type="text"
              value={formData.telegram}
              onChange={e => handleChange('telegram', e.target.value)}
              placeholder="Telegram"
            />
          </div>
        </div>
      )}

      {/* Pipeline — CRM mode only */}
      {isCrm && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-theme-text flex items-center gap-2">
            <Calendar size={16} />
            Pipeline
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="relative">
              <Calendar size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />
              <select
                value={formData.status}
                onChange={e => handleChange('status', e.target.value as SponsorStatus)}
                className="w-full !pl-14 bg-theme-input border border-theme-stroke rounded-xl text-theme-text focus:outline-none focus:ring-1 focus:ring-[#ff393a] appearance-none cursor-pointer"
                style={{ colorScheme: 'dark' }}
              >
                {STATUS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value} className="bg-theme-header text-theme-text">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative">
              <Building2 size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />
              <select
                value={formData.category || ''}
                onChange={e => handleChange('category', (e.target.value as SponsorCategory) || null)}
                className="w-full !pl-14 bg-theme-input border border-theme-stroke rounded-xl text-theme-text focus:outline-none focus:ring-1 focus:ring-[#ff393a] appearance-none cursor-pointer"
                style={{ colorScheme: 'dark' }}
              >
                <option value="" className="bg-theme-header text-theme-text-muted">Category</option>
                {SPONSOR_CATEGORIES.map(opt => (
                  <option key={opt.id} value={opt.id} className="bg-theme-header text-theme-text">
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
      )}

      {/* Fundraising — CRM mode only */}
      {isCrm && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-theme-text flex items-center gap-2">
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
              placeholder="Amount"
            />
            <div className="relative">
              <DollarSign size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />
              <select
                value={formData.sponsorshipType || ''}
                onChange={e => handleChange('sponsorshipType', e.target.value as SponsorshipType || null)}
                className="w-full !pl-14 bg-theme-input border border-theme-stroke rounded-xl text-theme-text focus:outline-none focus:ring-1 focus:ring-[#ff393a] appearance-none cursor-pointer"
                style={{ colorScheme: 'dark' }}
              >
                <option value="" className="bg-theme-header text-theme-text-muted">Contribution Type</option>
                {TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value} className="bg-theme-header text-theme-text">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <IconInput
              icon={FileText}
              type="text"
              value={formData.productService}
              onChange={e => handleChange('productService', e.target.value)}
              placeholder="Product/Service (if non-monetary)"
            />
          </div>
        </div>
      )}

      {/* Sponsorship Details — Intake mode only (CRM has it under Fundraising) */}
      {isIntake && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-theme-text flex items-center gap-2">
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
                <option value="" className="bg-theme-header text-theme-text-muted">Contribution Type</option>
                {TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value} className="bg-theme-header text-theme-text">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <IconInput
              icon={FileText}
              type="text"
              value={formData.productService}
              onChange={e => handleChange('productService', e.target.value)}
              placeholder="Product/Service Description"
            />
          </div>
        </div>
      )}

      {/* Sponsor Message (from intake form — CRM read-only) */}
      {isCrm && sponsor?.sponsorMessage && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-theme-text flex items-center gap-2">
            <FileText size={16} />
            Message from Sponsor
          </h3>
          <div className="p-3 bg-theme-surface rounded-lg border border-theme-stroke text-theme-text-secondary text-sm whitespace-pre-wrap">
            {sponsor.sponsorMessage}
          </div>
        </div>
      )}

      {/* Logo — file upload + URL fallback (shared across CRM, Intake, Partner) */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-theme-text flex items-center gap-2">
          <Image size={16} />
          Logo
        </h3>
        {logoPreview ? (
          <div className="flex items-center gap-4">
            <img
              src={logoPreview}
              alt="Logo preview"
              className="w-16 h-16 object-contain rounded-lg border border-theme-stroke bg-theme-surface"
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
              className="flex items-center gap-2 px-4 py-2 bg-theme-surface border border-theme-stroke rounded-lg text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover transition-colors"
            >
              <Upload size={16} />
              Upload Logo
            </button>
            <div className="flex-1">
              <IconInput
                icon={Globe}
                type="url"
                value={formData.logoUrl}
                onChange={e => handleChange('logoUrl', e.target.value)}
                placeholder="Or paste logo URL"
              />
            </div>
          </div>
        )}
      </div>

      {/* Message to Host — Intake mode only (writable) */}
      {isIntake && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-theme-text flex items-center gap-2">
            <MessageSquare size={16} />
            Message to Host
          </h3>
          <IconInput
            icon={MessageSquare}
            multiline
            rows={3}
            value={formData.sponsorMessage}
            onChange={e => handleChange('sponsorMessage', (e.target as HTMLTextAreaElement).value)}
            placeholder="Any notes or special requests for the event organizer..."
          />
        </div>
      )}

      {/* Automation — Partner mode only */}
      {isPartner && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-theme-text flex items-center gap-2">
            <Settings size={16} />
            Automation
          </h3>
          <div className="space-y-2">
            <Checkbox
              checked={formData.autoCoHost}
              onChange={() => handleChange('autoCoHost', !formData.autoCoHost)}
              label="Auto co-host: Add as co-host to all events with this tag"
              labelClassName="text-sm text-theme-text-secondary"
            />
            <Checkbox
              checked={formData.autoSponsor}
              onChange={() => handleChange('autoSponsor', !formData.autoSponsor)}
              label="Auto sponsor: Create sponsor record on tagged events"
              labelClassName="text-sm text-theme-text-secondary"
            />
          </div>
        </div>
      )}

      {/* Partner Intake Form — CRM mode, editing only */}
      {isCrm && sponsor && partyId && onSponsorUpdate && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-theme-text flex items-center gap-2">
            <FileText size={16} />
            Partner Intake Form
          </h3>
          <div className="flex items-center gap-3 p-3 bg-theme-surface rounded-lg border border-theme-stroke">
            <PartnerIntakeButton
              sponsor={sponsor}
              partyId={partyId}
              onUpdate={onSponsorUpdate}
            />
            <span className="text-xs text-theme-text-muted">
              {sponsor.intakeToken
                ? sponsor.intakeSubmittedAt
                  ? 'Partner has submitted their intake form'
                  : 'Waiting for partner to fill out intake form'
                : 'Generate a link for the partner to fill out their details'}
            </span>
          </div>
        </div>
      )}

      {/* Notes — CRM + Partner modes (not intake) */}
      {(isCrm || isPartner) && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-theme-text flex items-center gap-2">
            <FileText size={16} />
            Notes
          </h3>
          <IconInput
            icon={FileText}
            multiline
            rows={3}
            value={formData.notes}
            onChange={e => handleChange('notes', (e.target as HTMLTextAreaElement).value)}
            placeholder="Communication history, meeting notes, etc."
          />
        </div>
      )}

      {/* Sync message — Partner mode only */}
      {isPartner && syncMessage && (
        <p className="text-sm text-green-400 flex items-center gap-1">
          <Check size={14} /> {syncMessage}
        </p>
      )}

      {/* Actions */}
      {isIntake ? (
        <div className="pt-4 border-t border-theme-stroke">
          <button
            type="submit"
            disabled={isLoading || uploadingLogo}
            className="w-full px-4 py-3 bg-[#ff393a] hover:bg-[#ff393a]/80 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading || uploadingLogo ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                {uploadingLogo ? 'Uploading Logo...' : 'Submitting...'}
              </>
            ) : (
              submitLabel ?? (wasPreviouslySubmitted ? 'Update Information' : 'Submit Information')
            )}
          </button>
        </div>
      ) : (
        <div className={`flex ${isPartner ? 'gap-3' : 'justify-end'} pt-4 border-t border-theme-stroke`}>
          {isPartner && (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-theme-surface hover:bg-theme-surface-hover text-theme-text font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isLoading || uploadingLogo || (isPartner && (!formData.email || !formData.tag))}
            className={`${isPartner ? 'flex-1' : ''} px-4 py-2.5 bg-[#ff393a] hover:bg-[#ff393a]/80 text-white ${isPartner ? 'font-medium text-sm' : ''} rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isLoading || uploadingLogo
              ? 'Saving...'
              : isEditing
                ? (isPartner ? 'Save Changes' : 'Update Partner')
                : (isPartner ? 'Create Partner' : 'Add Partner')
            }
          </button>
        </div>
      )}
    </form>
  );

  /* ---------- Intake mode: non-modal plain form ---------- */

  if (isIntake) {
    return formBody;
  }

  /* ---------- CRM + Partner modes: modal wrapper ---------- */

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className={`bg-theme-header rounded-xl border border-theme-stroke w-full max-h-[90vh] overflow-y-auto ${
          isPartner ? 'max-w-lg' : 'max-w-2xl'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-theme-stroke">
          <h2 className="text-lg font-semibold text-theme-text">
            {isEditing ? 'Edit Partner' : 'Add Partner'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-theme-text-secondary hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        {formBody}
      </div>
    </div>
  );
}
