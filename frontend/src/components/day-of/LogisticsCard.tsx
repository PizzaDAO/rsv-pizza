import React from 'react';
import { MapPin, Wifi, Car, Phone, User, ExternalLink } from 'lucide-react';
import { Party } from '../../types';

interface LogisticsCardProps {
  party: Party;
}

/**
 * Day-of venue logistics: address with directions link, parking notes,
 * wifi info, host point-of-contact at venue. Tap-to-call on mobile via
 * `tel:` links.
 */
export const LogisticsCard: React.FC<LogisticsCardProps> = ({ party }) => {
  const address = party.address;
  const venueName = party.venueName;
  const wifi = party.wifiInfo;
  const parking = party.parkingNotes;
  const contactName = (party as any).venueContactName as string | null | undefined;
  const contactPhone = (party as any).venueContactPhone as string | null | undefined;

  const directionsUrl = address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
    : null;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <MapPin size={18} className="text-[#ff393a]" />
        <h3 className="text-lg font-semibold text-theme-text">Logistics</h3>
      </div>

      {(venueName || address) && (
        <div className="space-y-1">
          {venueName && <p className="text-theme-text font-medium">{venueName}</p>}
          {address && <p className="text-sm text-theme-text-secondary">{address}</p>}
          {directionsUrl && (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-[#ff393a] hover:underline mt-1"
            >
              Open in Maps
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      )}

      {parking && (
        <div className="flex items-start gap-2 pt-2 border-t border-white/10">
          <Car size={16} className="text-theme-text-muted mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs text-theme-text-muted uppercase tracking-wide">Parking</p>
            <p className="text-sm text-theme-text whitespace-pre-line">{parking}</p>
          </div>
        </div>
      )}

      {wifi && (
        <div className="flex items-start gap-2 pt-2 border-t border-white/10">
          <Wifi size={16} className="text-theme-text-muted mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs text-theme-text-muted uppercase tracking-wide">Wi-Fi</p>
            <p className="text-sm text-theme-text whitespace-pre-line">{wifi}</p>
          </div>
        </div>
      )}

      {(contactName || contactPhone) && (
        <div className="flex items-start gap-2 pt-2 border-t border-white/10">
          <User size={16} className="text-theme-text-muted mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-theme-text-muted uppercase tracking-wide">Venue contact</p>
            {contactName && <p className="text-sm text-theme-text">{contactName}</p>}
            {contactPhone && (
              <a
                href={`tel:${contactPhone}`}
                className="inline-flex items-center gap-1 text-sm text-[#ff393a] hover:underline"
              >
                <Phone size={14} />
                {contactPhone}
              </a>
            )}
          </div>
        </div>
      )}

      {!venueName && !address && !parking && !wifi && !contactName && !contactPhone && (
        <p className="text-sm text-theme-text-muted italic">
          Add venue details on the Venue tab so they show up here on event day.
        </p>
      )}
    </div>
  );
};
