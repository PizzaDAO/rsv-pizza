import React, { useState } from 'react';
import { ExternalLink, Eye } from 'lucide-react';
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

interface KitRowProps {
  kit: ShippingKit;
  selected: boolean;
  onSelect: (id: string) => void;
  onStatusChange: (kitId: string, status: string) => void;
  onTierChange: (kitId: string, tier: string) => void;
  onTrackingChange: (kitId: string, trackingNumber: string, trackingUrl: string) => void;
  onViewDetail: (kit: ShippingKit) => void;
  showRegion?: boolean;
}

export function KitRow({
  kit,
  selected,
  onSelect,
  onStatusChange,
  onTierChange,
  onTrackingChange,
  onViewDetail,
  showRegion,
}: KitRowProps) {
  const [showTracking, setShowTracking] = useState(false);
  const [trackingNum, setTrackingNum] = useState(kit.trackingNumber || '');
  const [trackingLink, setTrackingLink] = useState(kit.trackingUrl || '');

  const regionLabel = kit.region
    ? GPP_REGIONS.find((r) => r.id === kit.region)?.label || kit.region
    : '--';

  const eventDate = kit.eventDate
    ? new Date(kit.eventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '--';

  const requestedDate = new Date(kit.requestedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const handleTrackingBlur = () => {
    if (trackingNum !== (kit.trackingNumber || '') || trackingLink !== (kit.trackingUrl || '')) {
      onTrackingChange(kit.id, trackingNum, trackingLink);
    }
  };

  return (
    <tr className="border-b border-theme-stroke hover:bg-theme-surface/50 transition-colors">
      {/* Checkbox */}
      <td className="px-3 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(kit.id)}
          className="rounded border-theme-stroke-hover"
        />
      </td>

      {/* Event */}
      <td className="px-3 py-3">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${kit.underbossApproved ? 'bg-green-500' : 'bg-yellow-500'}`}
            title={kit.underbossApproved ? 'Event Approved' : 'Pending Approval'}
          />
          <span className="text-sm font-medium text-theme-text truncate max-w-[168px]" title={kit.partyName}>
            {kit.partyName}
          </span>
        </div>
        <div className="text-xs text-theme-text-muted ml-3.5">{eventDate}</div>
      </td>

      {/* Region */}
      {showRegion && (
        <td className="px-3 py-3">
          <span className="text-xs text-theme-text-muted">{regionLabel}</span>
        </td>
      )}

      {/* Host */}
      <td className="px-3 py-3 hidden md:table-cell">
        <div className="text-sm text-theme-text truncate max-w-[140px]" title={kit.hostName || ''}>
          {kit.hostName || '--'}
        </div>
      </td>

      {/* Recipient + Location */}
      <td className="px-3 py-3">
        <div className="text-sm text-theme-text">{kit.recipientName}</div>
        <div className="text-xs text-theme-text-muted truncate max-w-[160px]">
          {kit.city}{kit.state ? `, ${kit.state}` : ''}, {kit.country}
        </div>
      </td>

      {/* Tier */}
      <td className="px-3 py-3 hidden lg:table-cell">
        <div className="relative">
          <select
            value={kit.allocatedTier || kit.requestedTier}
            onChange={(e) => onTierChange(kit.id, e.target.value)}
            className="appearance-none bg-theme-surface border border-theme-stroke rounded px-2 py-1 pr-6 text-xs text-theme-text focus:outline-none focus:border-theme-stroke-hover capitalize"
          >
            {TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        {kit.allocatedTier && kit.allocatedTier !== kit.requestedTier && (
          <div className="text-xs text-theme-text-faint mt-0.5">req: {kit.requestedTier}</div>
        )}
      </td>

      {/* Status */}
      <td className="px-3 py-3">
        <div className="relative">
          <select
            value={kit.status}
            onChange={(e) => onStatusChange(kit.id, e.target.value)}
            className={`appearance-none rounded-full px-3 py-1 pr-7 text-xs font-medium border-0 focus:outline-none focus:ring-1 focus:ring-red-500 cursor-pointer ${STATUS_COLORS[kit.status] || 'bg-gray-100 text-gray-700'}`}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s} className="bg-white text-gray-900 capitalize">{s}</option>
            ))}
          </select>
        </div>
      </td>

      {/* Tracking */}
      <td className="px-3 py-3 hidden xl:table-cell">
        {showTracking ? (
          <div className="space-y-1">
            <input
              type="text"
              value={trackingNum}
              onChange={(e) => setTrackingNum(e.target.value)}
              onBlur={handleTrackingBlur}
              placeholder="Tracking #"
              className="w-full bg-theme-surface border border-theme-stroke rounded px-2 py-1 text-xs text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
            />
            <input
              type="text"
              value={trackingLink}
              onChange={(e) => setTrackingLink(e.target.value)}
              onBlur={handleTrackingBlur}
              placeholder="Tracking URL"
              className="w-full bg-theme-surface border border-theme-stroke rounded px-2 py-1 text-xs text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
            />
          </div>
        ) : (
          <button
            onClick={() => setShowTracking(true)}
            className="text-xs text-theme-text-muted hover:text-theme-text transition-colors"
          >
            {kit.trackingNumber ? (
              <span className="flex items-center gap-1">
                {kit.trackingNumber.slice(0, 12)}...
                {kit.trackingUrl && <ExternalLink size={10} />}
              </span>
            ) : (
              '+ Add tracking'
            )}
          </button>
        )}
      </td>

      {/* Requested date */}
      <td className="px-3 py-3 hidden lg:table-cell">
        <span className="text-xs text-theme-text-muted">{requestedDate}</span>
      </td>

      {/* Actions */}
      <td className="px-3 py-3">
        <button
          onClick={() => onViewDetail(kit)}
          className="p-1.5 rounded-lg hover:bg-theme-surface transition-colors text-theme-text-muted hover:text-theme-text"
          title="View details"
        >
          <Eye size={16} />
        </button>
      </td>
    </tr>
  );
}
