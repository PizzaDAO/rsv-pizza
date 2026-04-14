import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Package, MapPin, Truck, User, Calendar, FileText, ExternalLink } from 'lucide-react';
import { IconInput } from '../IconInput';
import type { ShippingKit, KitStatus, KitTier } from '../../types';
import { GPP_REGIONS } from '../../types';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-700',
  approved: 'bg-blue-500/20 text-blue-700',
  shipped: 'bg-purple-500/20 text-purple-700',
  delivered: 'bg-green-500/20 text-green-700',
  declined: 'bg-red-500/20 text-red-700',
};

const STATUS_OPTIONS: KitStatus[] = ['pending', 'approved', 'shipped', 'delivered', 'declined'];
const TIER_OPTIONS: KitTier[] = ['basic', 'large', 'deluxe'];

interface KitDetailModalProps {
  kit: ShippingKit;
  onClose: () => void;
  onUpdate: (kitId: string, data: { status?: string; allocatedTier?: string; trackingNumber?: string; trackingUrl?: string; adminNotes?: string }) => void;
}

export function KitDetailModal({ kit, onClose, onUpdate }: KitDetailModalProps) {
  const [status, setStatus] = useState(kit.status);
  const [allocatedTier, setAllocatedTier] = useState(kit.allocatedTier || kit.requestedTier);
  const [trackingNumber, setTrackingNumber] = useState(kit.trackingNumber || '');
  const [trackingUrl, setTrackingUrl] = useState(kit.trackingUrl || '');
  const [adminNotes, setAdminNotes] = useState(kit.adminNotes || '');
  const [saving, setSaving] = useState(false);

  const regionLabel = kit.region
    ? GPP_REGIONS.find((r) => r.id === kit.region)?.label || kit.region
    : '--';

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: any = {};
      if (status !== kit.status) updates.status = status;
      if (allocatedTier !== (kit.allocatedTier || kit.requestedTier)) updates.allocatedTier = allocatedTier;
      if (trackingNumber !== (kit.trackingNumber || '')) updates.trackingNumber = trackingNumber;
      if (trackingUrl !== (kit.trackingUrl || '')) updates.trackingUrl = trackingUrl;
      if (adminNotes !== (kit.adminNotes || '')) updates.adminNotes = adminNotes;

      if (Object.keys(updates).length > 0) {
        onUpdate(kit.id, updates);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-theme-card border border-theme-stroke rounded-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-theme-stroke">
          <div>
            <h3 className="text-lg font-semibold text-theme-text">{kit.partyName}</h3>
            <p className="text-sm text-theme-text-muted">Kit Request Details</p>
          </div>
          <button onClick={onClose} className="text-theme-text-faint hover:text-theme-text-secondary transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Event info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-theme-text-muted mb-1">Event</p>
              <p className="text-sm text-theme-text font-medium">{kit.partyName}</p>
            </div>
            <div>
              <p className="text-xs text-theme-text-muted mb-1">Region</p>
              <p className="text-sm text-theme-text">{regionLabel}</p>
            </div>
            <div>
              <p className="text-xs text-theme-text-muted mb-1">Event Date</p>
              <p className="text-sm text-theme-text">{formatDate(kit.eventDate)}</p>
            </div>
            <div>
              <p className="text-xs text-theme-text-muted mb-1">Host</p>
              <p className="text-sm text-theme-text">{kit.hostName || '--'}</p>
              {kit.hostEmail && <p className="text-xs text-theme-text-faint">{kit.hostEmail}</p>}
            </div>
            <div>
              <p className="text-xs text-theme-text-muted mb-1">Event Approved</p>
              <p className={`text-sm font-medium ${kit.underbossApproved ? 'text-green-500' : 'text-yellow-500'}`}>
                {kit.underbossApproved ? 'Yes' : 'Pending'}
              </p>
            </div>
          </div>

          {/* Event Location */}
          {(kit.eventVenue || kit.eventAddress) && (
            <div className="bg-theme-surface rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <MapPin size={16} className="text-theme-text-muted" />
                <p className="text-sm font-medium text-theme-text">Event Location</p>
              </div>
              <div className="text-sm text-theme-text space-y-0.5">
                {kit.eventVenue && <p className="font-medium">{kit.eventVenue}</p>}
                {kit.eventAddress && <p className="text-theme-text-muted">{kit.eventAddress}</p>}
              </div>
            </div>
          )}

          {/* Shipping address */}
          <div className="bg-theme-surface rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <MapPin size={16} className="text-theme-text-muted" />
              <p className="text-sm font-medium text-theme-text">Shipping Address</p>
            </div>
            <div className="text-sm text-theme-text space-y-0.5">
              <p className="font-medium">{kit.recipientName}</p>
              <p>{kit.addressLine1}</p>
              {kit.addressLine2 && <p>{kit.addressLine2}</p>}
              <p>{kit.city}{kit.state ? `, ${kit.state}` : ''} {kit.postalCode}</p>
              <p>{kit.country}</p>
              {kit.phone && <p className="text-theme-text-muted">Phone: {kit.phone}</p>}
            </div>
          </div>

          {/* Host notes */}
          {kit.notes && (
            <div>
              <p className="text-xs text-theme-text-muted mb-1">Host Notes</p>
              <p className="text-sm text-theme-text bg-theme-surface rounded-lg p-3">{kit.notes}</p>
            </div>
          )}

          {/* Editable fields */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-theme-text-muted mb-1">Status</p>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as KitStatus)}
                  className={`w-full appearance-none rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-red-500 capitalize ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-700'}`}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s} className="bg-white text-gray-900">{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-xs text-theme-text-muted mb-1">Allocated Tier</p>
                <select
                  value={allocatedTier}
                  onChange={(e) => setAllocatedTier(e.target.value as KitTier)}
                  className="w-full appearance-none bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text focus:outline-none focus:border-theme-stroke-hover capitalize"
                >
                  {TIER_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {kit.requestedTier !== allocatedTier && (
                  <p className="text-xs text-theme-text-faint mt-1">Requested: {kit.requestedTier}</p>
                )}
              </div>
            </div>

            <div>
              <IconInput
                icon={Truck}
                placeholder="Tracking number"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber((e.target as HTMLInputElement).value)}
              />
            </div>

            <div>
              <IconInput
                icon={ExternalLink}
                placeholder="Tracking URL"
                value={trackingUrl}
                onChange={(e) => setTrackingUrl((e.target as HTMLInputElement).value)}
              />
            </div>

            <div>
              <IconInput
                icon={FileText}
                placeholder="Admin notes (internal only)"
                value={adminNotes}
                onChange={(e) => setAdminNotes((e.target as HTMLInputElement).value)}
                multiline
                rows={3}
              />
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-theme-surface rounded-xl p-4">
            <p className="text-sm font-medium text-theme-text mb-3">Timeline</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-theme-text-muted">Requested</span>
                <span className="text-theme-text">{formatDate(kit.requestedAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-theme-text-muted">Approved</span>
                <span className="text-theme-text">{formatDate(kit.approvedAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-theme-text-muted">Shipped</span>
                <span className="text-theme-text">{formatDate(kit.shippedAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-theme-text-muted">Delivered</span>
                <span className="text-theme-text">{formatDate(kit.deliveredAt)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-theme-stroke">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
