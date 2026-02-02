import React, { useState } from 'react';
import { MapPin, Users, DollarSign, User, Phone, Mail, Globe, FileText, Building2, Pencil } from 'lucide-react';
import { Party, VenueStatus } from '../../types';
import { VenueForm } from './VenueForm';

interface VenueWidgetProps {
  party: Party;
  onUpdate: (updates: Record<string, any>) => Promise<boolean>;
}

// Status badge configuration
const statusConfig: Record<VenueStatus, { label: string; color: string }> = {
  researching: { label: 'Researching', color: 'bg-gray-500' },
  contacted: { label: 'Contacted', color: 'bg-orange-500' },
  negotiating: { label: 'Negotiating', color: 'bg-yellow-500' },
  confirmed: { label: 'Confirmed', color: 'bg-green-500' },
  deposit_paid: { label: 'Deposit Paid', color: 'bg-blue-500' },
  paid_in_full: { label: 'Paid in Full', color: 'bg-purple-500' },
};

export const VenueWidget: React.FC<VenueWidgetProps> = ({ party, onUpdate }) => {
  const [showForm, setShowForm] = useState(false);

  const hasVenueData = party.venueName || party.address || party.venueStatus;
  const hasContactInfo = party.venueContactName || party.venueContactEmail || party.venueContactPhone;

  // Format currency
  const formatCost = (cost: number | null) => {
    if (cost === null || cost === undefined) return null;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cost);
  };

  const handleSave = async (updates: Record<string, any>) => {
    const success = await onUpdate(updates);
    if (success) {
      setShowForm(false);
    }
    return success;
  };

  return (
    <>
      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <MapPin size={18} className="text-[#ff393a]" />
            <h3 className="font-semibold text-white">Venue</h3>
          </div>
          {party.venueStatus && (
            <span className={`text-xs font-medium px-2 py-1 rounded-full text-white ${statusConfig[party.venueStatus].color}`}>
              {statusConfig[party.venueStatus].label}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="p-4">
          {hasVenueData ? (
            <div className="space-y-3">
              {/* Venue Name & Address */}
              {(party.venueName || party.address) && (
                <div>
                  {party.venueName && (
                    <p className="text-white font-medium">{party.venueName}</p>
                  )}
                  {party.address && (
                    <p className="text-white/60 text-sm">{party.address}</p>
                  )}
                  {party.venueOrganization && (
                    <p className="text-white/50 text-xs mt-1 flex items-center gap-1">
                      <Building2 size={12} />
                      {party.venueOrganization}
                    </p>
                  )}
                </div>
              )}

              {/* Capacity & Cost */}
              {(party.venueCapacity || party.venueCost) && (
                <div className="flex items-center gap-4 text-sm">
                  {party.venueCapacity && (
                    <span className="flex items-center gap-1.5 text-white/70">
                      <Users size={14} className="text-white/40" />
                      {party.venueCapacity} capacity
                    </span>
                  )}
                  {party.venueCost && (
                    <span className="flex items-center gap-1.5 text-white/70">
                      <DollarSign size={14} className="text-white/40" />
                      {formatCost(party.venueCost)}
                    </span>
                  )}
                </div>
              )}

              {/* Point Person */}
              {party.venuePointPerson && (
                <div className="flex items-center gap-1.5 text-sm text-white/70">
                  <User size={14} className="text-white/40" />
                  <span>Point Person: {party.venuePointPerson}</span>
                </div>
              )}

              {/* Contact Info */}
              {hasContactInfo && (
                <div className="pt-2 border-t border-white/10">
                  <p className="text-xs text-white/40 mb-1.5">Venue Contact</p>
                  <div className="space-y-1">
                    {party.venueContactName && (
                      <p className="text-sm text-white/80">{party.venueContactName}</p>
                    )}
                    {party.venueContactEmail && (
                      <a
                        href={`mailto:${party.venueContactEmail}`}
                        className="flex items-center gap-1.5 text-sm text-[#ff393a] hover:text-[#ff5a5b] transition-colors"
                      >
                        <Mail size={12} />
                        {party.venueContactEmail}
                      </a>
                    )}
                    {party.venueContactPhone && (
                      <a
                        href={`tel:${party.venueContactPhone}`}
                        className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors"
                      >
                        <Phone size={12} />
                        {party.venueContactPhone}
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Website */}
              {party.venueWebsite && (
                <a
                  href={party.venueWebsite}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-[#ff393a] hover:text-[#ff5a5b] transition-colors"
                >
                  <Globe size={14} />
                  View Website
                </a>
              )}

              {/* Notes */}
              {party.venueNotes && (
                <div className="pt-2 border-t border-white/10">
                  <div className="flex items-start gap-1.5 text-sm text-white/60">
                    <FileText size={14} className="text-white/40 mt-0.5 flex-shrink-0" />
                    <p className="whitespace-pre-wrap">{party.venueNotes}</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-white/40 text-sm">No venue information yet</p>
          )}
        </div>

        {/* Edit Button */}
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white font-medium px-4 py-2.5 rounded-lg transition-colors text-sm"
          >
            <Pencil size={14} />
            {hasVenueData ? 'Edit Venue' : 'Add Venue Info'}
          </button>
        </div>
      </div>

      {/* Edit Modal */}
      {showForm && (
        <VenueForm
          party={party}
          onSave={handleSave}
          onClose={() => setShowForm(false)}
        />
      )}
    </>
  );
};
