import React from 'react';
import { Package, Truck, CheckCircle, Clock, XCircle, ExternalLink } from 'lucide-react';
import { PartyKit, KIT_TIERS, KitStatus } from '../../types';

interface KitStatusCardProps {
  kit: PartyKit;
  onCancel?: () => void;
  onEdit?: () => void;
}

const STATUS_CONFIG: Record<KitStatus, { color: string; bgColor: string; icon: React.ReactNode; label: string }> = {
  pending: {
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500',
    icon: <Clock size={16} />,
    label: 'Pending',
  },
  approved: {
    color: 'text-blue-500',
    bgColor: 'bg-blue-500',
    icon: <CheckCircle size={16} />,
    label: 'Approved',
  },
  shipped: {
    color: 'text-purple-500',
    bgColor: 'bg-purple-500',
    icon: <Truck size={16} />,
    label: 'Shipped',
  },
  delivered: {
    color: 'text-green-500',
    bgColor: 'bg-green-500',
    icon: <CheckCircle size={16} />,
    label: 'Delivered',
  },
  declined: {
    color: 'text-red-500',
    bgColor: 'bg-red-500',
    icon: <XCircle size={16} />,
    label: 'Declined',
  },
};

export const KitStatusCard: React.FC<KitStatusCardProps> = ({ kit, onCancel, onEdit }) => {
  const statusConfig = STATUS_CONFIG[kit.status];
  const allocatedTier = kit.allocatedTier ? KIT_TIERS.find(t => t.id === kit.allocatedTier) : null;

  const formatAddress = () => {
    const parts = [
      kit.addressLine1,
      kit.addressLine2,
      `${kit.city}${kit.state ? `, ${kit.state}` : ''} ${kit.postalCode}`,
      kit.country !== 'USA' ? kit.country : null,
    ].filter(Boolean);
    return parts;
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-lg">
            <Package size={20} className="text-white/60" />
          </div>
          <span className="font-medium text-white">Party Kit</span>
        </div>
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full ${statusConfig.bgColor}/20 ${statusConfig.color}`}>
          {statusConfig.icon}
          <span className="text-sm font-medium">{statusConfig.label}</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Kit Tier */}
        <div>
          <p className="text-sm text-white/50 mb-1">Kit Tier</p>
          {allocatedTier ? (
            <p className="text-white font-medium">{allocatedTier.name}</p>
          ) : (
            <p className="text-white/70 text-sm italic">
              PizzaDAO will assign the appropriate tier for your event
            </p>
          )}
        </div>

        {/* Shipping Address */}
        <div>
          <p className="text-sm text-white/50 mb-1">Shipping to</p>
          <p className="text-white font-medium">{kit.recipientName}</p>
          {formatAddress().map((line, i) => (
            <p key={i} className="text-sm text-white/70">{line}</p>
          ))}
          {kit.phone && <p className="text-sm text-white/50 mt-1">{kit.phone}</p>}
        </div>

        {/* Tracking Info */}
        {kit.trackingNumber && (
          <div>
            <p className="text-sm text-white/50 mb-1">Tracking</p>
            <div className="flex items-center gap-2">
              <code className="text-sm text-white/80 bg-white/10 px-2 py-0.5 rounded">
                {kit.trackingNumber}
              </code>
              {kit.trackingUrl && (
                <a
                  href={kit.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#ff393a] hover:text-[#ff5a5b] flex items-center gap-1 text-sm"
                >
                  Track Package
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Notes */}
        {kit.notes && (
          <div>
            <p className="text-sm text-white/50 mb-1">Your Notes</p>
            <p className="text-sm text-white/70">{kit.notes}</p>
          </div>
        )}

        {/* Timeline */}
        <div className="pt-2 border-t border-white/10">
          <p className="text-xs text-white/40">
            Requested {new Date(kit.requestedAt).toLocaleDateString()}
            {kit.approvedAt && ` | Approved ${new Date(kit.approvedAt).toLocaleDateString()}`}
            {kit.shippedAt && ` | Shipped ${new Date(kit.shippedAt).toLocaleDateString()}`}
            {kit.deliveredAt && ` | Delivered ${new Date(kit.deliveredAt).toLocaleDateString()}`}
          </p>
        </div>
      </div>

      {/* Actions - only show if pending */}
      {kit.status === 'pending' && (onEdit || onCancel) && (
        <div className="flex gap-2 p-4 pt-0">
          {onEdit && (
            <button
              onClick={onEdit}
              className="flex-1 bg-white/10 hover:bg-white/20 text-white font-medium py-2 rounded-lg transition-colors text-sm"
            >
              Edit Request
            </button>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium py-2 rounded-lg transition-colors text-sm"
            >
              Cancel Request
            </button>
          )}
        </div>
      )}
    </div>
  );
};
