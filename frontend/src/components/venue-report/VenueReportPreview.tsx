import React, { useState } from 'react';
import { MapPin, Users, DollarSign, Globe, ThumbsUp, ThumbsDown, Check, ChevronLeft, ChevronRight, X, Camera } from 'lucide-react';
import { VenueReport, Venue, VenuePhoto } from '../../types';

interface VenueReportPreviewProps {
  report: VenueReport;
}

// Status badge configuration
const statusConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  researching: { label: 'Researching', color: 'text-gray-300', bgColor: 'bg-gray-500/20' },
  contacted: { label: 'Contacted', color: 'text-orange-300', bgColor: 'bg-orange-500/20' },
  negotiating: { label: 'Negotiating', color: 'text-yellow-300', bgColor: 'bg-yellow-500/20' },
  confirmed: { label: 'Confirmed', color: 'text-green-300', bgColor: 'bg-green-500/20' },
  deposit_paid: { label: 'Deposit Paid', color: 'text-blue-300', bgColor: 'bg-blue-500/20' },
  paid_in_full: { label: 'Paid in Full', color: 'text-purple-300', bgColor: 'bg-purple-500/20' },
  declined: { label: 'Declined', color: 'text-red-300', bgColor: 'bg-red-500/20' },
};

const formatCost = (cost: number | null) => {
  if (cost === null || cost === undefined) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cost);
};

// Simple photo carousel for venue cards
const PhotoCarousel: React.FC<{ photos: VenuePhoto[] }> = ({ photos }) => {
  const [current, setCurrent] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  if (photos.length === 0) return null;

  return (
    <>
      <div className="relative aspect-video bg-white/5 rounded-lg overflow-hidden">
        <img
          src={photos[current].url}
          alt={photos[current].caption || photos[current].fileName}
          className="w-full h-full object-cover cursor-pointer"
          onClick={() => setLightbox(true)}
        />

        {photos.length > 1 && (
          <>
            {current > 0 && (
              <button
                type="button"
                onClick={() => setCurrent(current - 1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-1 rounded-full"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            {current < photos.length - 1 && (
              <button
                type="button"
                onClick={() => setCurrent(current + 1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-1 rounded-full"
              >
                <ChevronRight size={16} />
              </button>
            )}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
              {photos.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCurrent(i)}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i === current ? 'bg-white' : 'bg-white/40'
                  }`}
                />
              ))}
            </div>
          </>
        )}

        {photos[current].caption && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6">
            <p className="text-xs text-white/90">{photos[current].caption}</p>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[60]"
          onClick={() => setLightbox(false)}
        >
          <button
            type="button"
            onClick={() => setLightbox(false)}
            className="absolute top-4 right-4 text-white/70 hover:text-white z-10"
          >
            <X size={24} />
          </button>

          {current > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCurrent(current - 1);
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white bg-black/30 hover:bg-black/50 p-2 rounded-full z-10"
            >
              <ChevronLeft size={24} />
            </button>
          )}

          {current < photos.length - 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCurrent(current + 1);
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white bg-black/30 hover:bg-black/50 p-2 rounded-full z-10"
            >
              <ChevronRight size={24} />
            </button>
          )}

          <div
            className="max-w-4xl max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={photos[current].url}
              alt={photos[current].caption || photos[current].fileName}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            {photos[current].caption && (
              <p className="text-white/80 text-sm mt-3 text-center">{photos[current].caption}</p>
            )}
            <p className="text-white/40 text-xs mt-1">{current + 1} of {photos.length}</p>
          </div>
        </div>
      )}
    </>
  );
};

// Individual venue card
const VenueCard: React.FC<{ venue: Venue }> = ({ venue }) => {
  const statusInfo = statusConfig[venue.status] || statusConfig.researching;

  return (
    <div className={`card overflow-hidden ${
      venue.isSelected ? 'ring-2 ring-[#ff393a] border-[#ff393a]/50' : 'border-white/10'
    }`}>
      {/* Photo carousel */}
      {venue.photos && venue.photos.length > 0 && (
        <div className="p-3 pb-0">
          <PhotoCarousel photos={venue.photos} />
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            {venue.isSelected && (
              <span className="flex items-center gap-1 text-xs font-medium text-[#ff393a] bg-[#ff393a]/20 px-2 py-0.5 rounded-full">
                <Check size={12} />
                Selected
              </span>
            )}
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusInfo.bgColor} ${statusInfo.color}`}>
              {statusInfo.label}
            </span>
          </div>
          <h3 className="font-semibold text-white text-lg">{venue.name}</h3>
          {venue.address && (
            <p className="text-sm text-white/60 flex items-center gap-1 mt-0.5">
              <MapPin size={12} />
              {venue.address}
            </p>
          )}
        </div>

        {/* Quick stats */}
        <div className="flex items-center gap-4 text-sm">
          {venue.capacity && (
            <span className="flex items-center gap-1 text-white/60">
              <Users size={14} />
              {venue.capacity} capacity
            </span>
          )}
          {venue.cost != null && (
            <span className="flex items-center gap-1 text-white/60">
              <DollarSign size={14} />
              {formatCost(venue.cost)}
            </span>
          )}
          {venue.website && (
            <a
              href={venue.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[#ff393a] hover:text-[#ff5a5b]"
            >
              <Globe size={14} />
              Website
            </a>
          )}
        </div>

        {/* Pros & Cons */}
        {(venue.pros || venue.cons) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {venue.pros && (
              <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3">
                <p className="flex items-center gap-1 text-xs font-medium text-green-400 mb-1">
                  <ThumbsUp size={12} />
                  Pros
                </p>
                <p className="text-sm text-white/70 whitespace-pre-wrap">{venue.pros}</p>
              </div>
            )}
            {venue.cons && (
              <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                <p className="flex items-center gap-1 text-xs font-medium text-red-400 mb-1">
                  <ThumbsDown size={12} />
                  Cons
                </p>
                <p className="text-sm text-white/70 whitespace-pre-wrap">{venue.cons}</p>
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        {venue.notes && (
          <div className="text-sm">
            <p className="text-xs text-white/40 mb-1">Notes</p>
            <p className="text-white/60 whitespace-pre-wrap">{venue.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export const VenueReportPreview: React.FC<VenueReportPreviewProps> = ({ report }) => {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-white">
          {report.title || `Venue Report: ${report.partyName}`}
        </h1>
        {report.notes && (
          <p className="text-white/60 max-w-2xl mx-auto whitespace-pre-wrap">{report.notes}</p>
        )}
        <p className="text-xs text-white/30">
          {report.venues.length} venue{report.venues.length !== 1 ? 's' : ''} compared
        </p>
      </div>

      {/* Venue Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {report.venues.map((venue) => (
          <VenueCard key={venue.id} venue={venue} />
        ))}
      </div>

      {/* No venues message */}
      {report.venues.length === 0 && (
        <div className="card p-8 text-center">
          <Building2 size={32} className="mx-auto mb-3 text-white/20" />
          <p className="text-white/60">No venues to display.</p>
        </div>
      )}
    </div>
  );
};
