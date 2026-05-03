import React from 'react';
import { useTranslation } from 'react-i18next';
import { Package, Truck, CheckCircle, Clock, XCircle, ExternalLink } from 'lucide-react';
import { PartyKit, KIT_TIERS, KitStatus } from '../../types';

interface KitStatusCardProps {
  kit: PartyKit;
  onCancel?: () => void;
  onEdit?: () => void;
}

export const KitStatusCard: React.FC<KitStatusCardProps> = ({ kit, onCancel, onEdit }) => {
  const { t } = useTranslation('host');

  const STATUS_CONFIG: Record<KitStatus, { color: string; bgColor: string; icon: React.ReactNode; label: string }> = {
    pending: {
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-500',
      icon: <Clock size={16} />,
      label: t('kit.statusPending'),
    },
    approved: {
      color: 'text-blue-500',
      bgColor: 'bg-blue-500',
      icon: <CheckCircle size={16} />,
      label: t('kit.statusApproved'),
    },
    shipped: {
      color: 'text-purple-500',
      bgColor: 'bg-purple-500',
      icon: <Truck size={16} />,
      label: t('kit.statusShipped'),
    },
    delivered: {
      color: 'text-green-500',
      bgColor: 'bg-green-500',
      icon: <CheckCircle size={16} />,
      label: t('kit.statusDelivered'),
    },
    declined: {
      color: 'text-red-500',
      bgColor: 'bg-red-500',
      icon: <XCircle size={16} />,
      label: t('kit.statusDeclined'),
    },
  };

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
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-theme-stroke">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-theme-surface-hover rounded-lg">
            <Package size={20} className="text-theme-text-secondary" />
          </div>
          <span className="font-medium text-theme-text">{t('kit.partyKit')}</span>
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
          <p className="text-sm text-theme-text-muted mb-1">{t('kit.kitTier')}</p>
          {allocatedTier ? (
            <p className="text-theme-text font-medium">{allocatedTier.name}</p>
          ) : (
            <p className="text-theme-text-secondary text-sm italic">
              {t('kit.tierAssignNote')}
            </p>
          )}
        </div>

        {/* Shipping Address */}
        <div>
          <p className="text-sm text-theme-text-muted mb-1">{t('kit.shippingTo')}</p>
          <p className="text-theme-text font-medium">{kit.recipientName}</p>
          {formatAddress().map((line, i) => (
            <p key={i} className="text-sm text-theme-text-secondary">{line}</p>
          ))}
          {kit.phone && <p className="text-sm text-theme-text-muted mt-1">{kit.phone}</p>}
        </div>

        {/* Tracking Info */}
        {kit.trackingNumber && (
          <div>
            <p className="text-sm text-theme-text-muted mb-1">{t('kit.tracking')}</p>
            <div className="flex items-center gap-2">
              <code className="text-sm text-theme-text bg-theme-surface-hover px-2 py-0.5 rounded">
                {kit.trackingNumber}
              </code>
              {kit.trackingUrl && (
                <a
                  href={kit.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#ff393a] hover:text-[#ff5a5b] flex items-center gap-1 text-sm"
                >
                  {t('kit.trackPackage')}
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Notes */}
        {kit.notes && (
          <div>
            <p className="text-sm text-theme-text-muted mb-1">{t('kit.yourNotes')}</p>
            <p className="text-sm text-theme-text-secondary">{kit.notes}</p>
          </div>
        )}

        {/* Timeline */}
        <div className="pt-2 border-t border-theme-stroke">
          <p className="text-xs text-theme-text-muted">
            {t('kit.requested', { date: new Date(kit.requestedAt).toLocaleDateString() })}
            {kit.approvedAt && ` | ${t('kit.approved', { date: new Date(kit.approvedAt).toLocaleDateString() })}`}
            {kit.shippedAt && ` | ${t('kit.shipped', { date: new Date(kit.shippedAt).toLocaleDateString() })}`}
            {kit.deliveredAt && ` | ${t('kit.delivered', { date: new Date(kit.deliveredAt).toLocaleDateString() })}`}
          </p>
        </div>
      </div>

      {/* Actions - only show if pending */}
      {kit.status === 'pending' && (onEdit || onCancel) && (
        <div className="flex gap-2 p-4 pt-0">
          {onEdit && (
            <button
              onClick={onEdit}
              className="flex-1 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text font-medium py-2 rounded-lg transition-colors text-sm"
            >
              {t('kit.editRequest')}
            </button>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium py-2 rounded-lg transition-colors text-sm"
            >
              {t('kit.cancelRequest')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
