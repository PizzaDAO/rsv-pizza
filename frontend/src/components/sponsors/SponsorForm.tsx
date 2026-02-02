import React, { useState, useEffect } from 'react';
import { X, Building2, User, Mail, Phone, Twitter, DollarSign, FileText, Calendar } from 'lucide-react';
import { Sponsor, SponsorStatus, SponsorshipType } from '../../types';
import { CreateSponsorData } from '../../lib/api';

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
    organization: '',
    website: '',
    pointPerson: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    twitter: '',
    status: 'todo',
    amount: null,
    amountReceived: null,
    sponsorshipType: null,
    logoUrl: '',
    notes: '',
    lastContactedAt: null,
  });
  const [error, setError] = useState<string | null>(null);

  // Initialize form with sponsor data if editing
  useEffect(() => {
    if (sponsor) {
      setFormData({
        name: sponsor.name,
        organization: sponsor.organization || '',
        website: sponsor.website || '',
        pointPerson: sponsor.pointPerson || '',
        contactName: sponsor.contactName || '',
        contactEmail: sponsor.contactEmail || '',
        contactPhone: sponsor.contactPhone || '',
        twitter: sponsor.twitter || '',
        status: sponsor.status,
        amount: sponsor.amount,
        amountReceived: sponsor.amountReceived,
        sponsorshipType: sponsor.sponsorshipType,
        logoUrl: sponsor.logoUrl || '',
        notes: sponsor.notes || '',
        lastContactedAt: sponsor.lastContactedAt ? sponsor.lastContactedAt.split('T')[0] : null,
      });
    }
  }, [sponsor]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.name.trim()) {
      setError('Sponsor name is required');
      return;
    }

    try {
      await onSubmit({
        ...formData,
        name: formData.name.trim(),
        lastContactedAt: formData.lastContactedAt || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save sponsor');
    }
  };

  const handleChange = (field: keyof CreateSponsorData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const isConfirmed = ['yes', 'invoiced', 'paid'].includes(formData.status || 'todo');

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
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
              <Building2 size={16} />
              Sponsor Info
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => handleChange('name', e.target.value)}
                  placeholder="Company or sponsor name"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Organization</label>
                <input
                  type="text"
                  value={formData.organization || ''}
                  onChange={e => handleChange('organization', e.target.value)}
                  placeholder="Parent organization"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-white/60 mb-1">Website</label>
                <input
                  type="url"
                  value={formData.website || ''}
                  onChange={e => handleChange('website', e.target.value)}
                  placeholder="https://example.com"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                />
              </div>
            </div>
          </div>

          {/* Contact Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
              <User size={16} />
              Contact Info
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Point Person (Your Team)</label>
                <input
                  type="text"
                  value={formData.pointPerson || ''}
                  onChange={e => handleChange('pointPerson', e.target.value)}
                  placeholder="Who's managing this?"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Contact Name</label>
                <input
                  type="text"
                  value={formData.contactName || ''}
                  onChange={e => handleChange('contactName', e.target.value)}
                  placeholder="Their contact person"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1 flex items-center gap-1">
                  <Mail size={14} />
                  Email
                </label>
                <input
                  type="email"
                  value={formData.contactEmail || ''}
                  onChange={e => handleChange('contactEmail', e.target.value)}
                  placeholder="contact@example.com"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1 flex items-center gap-1">
                  <Phone size={14} />
                  Phone
                </label>
                <input
                  type="tel"
                  value={formData.contactPhone || ''}
                  onChange={e => handleChange('contactPhone', e.target.value)}
                  placeholder="+1 555 123 4567"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-white/60 mb-1 flex items-center gap-1">
                  <Twitter size={14} />
                  Twitter
                </label>
                <input
                  type="text"
                  value={formData.twitter || ''}
                  onChange={e => handleChange('twitter', e.target.value)}
                  placeholder="@handle"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                />
              </div>
            </div>
          </div>

          {/* Pipeline */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
              <Calendar size={16} />
              Pipeline
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Status</label>
                <select
                  value={formData.status}
                  onChange={e => handleChange('status', e.target.value as SponsorStatus)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                >
                  {STATUS_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Last Contacted</label>
                <input
                  type="date"
                  value={formData.lastContactedAt || ''}
                  onChange={e => handleChange('lastContactedAt', e.target.value || null)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                />
              </div>
            </div>
          </div>

          {/* Fundraising */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
              <DollarSign size={16} />
              Fundraising
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-white/60 mb-1">Amount (Pledged)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.amount ?? ''}
                    onChange={e => handleChange('amount', e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="0.00"
                    className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Amount Received</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.amountReceived ?? ''}
                    onChange={e => handleChange('amountReceived', e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="0.00"
                    className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-1">Type</label>
                <select
                  value={formData.sponsorshipType || ''}
                  onChange={e => handleChange('sponsorshipType', e.target.value as SponsorshipType || null)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                >
                  <option value="">Select type...</option>
                  {TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Assets (only show if confirmed) */}
          {isConfirmed && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-white/80">Assets</h3>
              <div>
                <label className="block text-sm text-white/60 mb-1">Logo URL</label>
                <input
                  type="url"
                  value={formData.logoUrl || ''}
                  onChange={e => handleChange('logoUrl', e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
                />
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
              <FileText size={16} />
              Notes
            </h3>
            <textarea
              value={formData.notes || ''}
              onChange={e => handleChange('notes', e.target.value)}
              placeholder="Communication history, meeting notes, etc."
              rows={4}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#ff393a] resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-[#ff393a] hover:bg-[#ff393a]/80 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Saving...' : sponsor ? 'Update Sponsor' : 'Add Sponsor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
