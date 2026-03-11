import React, { useState, useEffect, useCallback } from 'react';
import { MapPin, Users, DollarSign, Plus, Pencil, Trash2, Check, Globe, Loader2, Phone, Mail, Building2, ChevronDown, ChevronUp, Camera, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Venue, VenueStatus } from '../../types';
import { getVenues, createVenue, updateVenue, deleteVenue, selectVenue, deselectVenue, VenueCreateData } from '../../lib/api';
import { VenueForm } from './VenueForm';
import { VenuePhotoUpload } from './VenuePhotoUpload';
import { VenuePhotoGallery } from './VenuePhotoGallery';

interface VenueWidgetProps {
  partyId: string;
  onVenueSelect?: () => void; // Callback when a venue is selected (to refresh party data)
}

// Status badge configuration
const statusConfig: Record<VenueStatus, { label: string; color: string; bgColor: string }> = {
  researching: { label: 'Researching', color: 'text-gray-300', bgColor: 'bg-gray-500/20' },
  contacted: { label: 'Contacted', color: 'text-orange-300', bgColor: 'bg-orange-500/20' },
  negotiating: { label: 'Negotiating', color: 'text-yellow-300', bgColor: 'bg-yellow-500/20' },
  confirmed: { label: 'Confirmed', color: 'text-green-300', bgColor: 'bg-green-500/20' },
  deposit_paid: { label: 'Deposit Paid', color: 'text-blue-300', bgColor: 'bg-blue-500/20' },
  paid_in_full: { label: 'Paid in Full', color: 'text-purple-300', bgColor: 'bg-purple-500/20' },
  declined: { label: 'Declined', color: 'text-red-300', bgColor: 'bg-red-500/20' },
};

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

export const VenueWidget: React.FC<VenueWidgetProps> = ({ partyId, onVenueSelect }) => {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null);
  const [expandedVenue, setExpandedVenue] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Load venues
  const loadVenues = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getVenues(partyId);
      setVenues(data);
    } catch (error) {
      console.error('Error loading venues:', error);
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => {
    loadVenues();
  }, [loadVenues]);

  // Handle create venue
  const handleCreate = async (data: VenueCreateData) => {
    try {
      const venue = await createVenue(partyId, data);
      if (venue) {
        setVenues(prev => [venue, ...prev]);
        setShowForm(false);
      }
    } catch (error) {
      throw error;
    }
  };

  // Handle update venue
  const handleUpdate = async (data: VenueCreateData) => {
    if (!editingVenue) return;
    try {
      const venue = await updateVenue(partyId, editingVenue.id, data);
      if (venue) {
        setVenues(prev => prev.map(v => v.id === venue.id ? venue : v));
        setEditingVenue(null);
      }
    } catch (error) {
      throw error;
    }
  };

  // Handle delete venue
  const handleDelete = async (venueId: string) => {
    if (!confirm('Are you sure you want to delete this venue option?')) return;

    setActionLoading(venueId);
    try {
      const success = await deleteVenue(partyId, venueId);
      if (success) {
        setVenues(prev => prev.filter(v => v.id !== venueId));
      }
    } catch (error) {
      console.error('Error deleting venue:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle select venue
  const handleSelect = async (venueId: string) => {
    setActionLoading(venueId);
    try {
      const result = await selectVenue(partyId, venueId);
      if (result) {
        // Update local state
        setVenues(prev => prev.map(v => ({
          ...v,
          isSelected: v.id === venueId,
        })));
        // Notify parent to refresh party data
        onVenueSelect?.();
      }
    } catch (error) {
      console.error('Error selecting venue:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle deselect venue
  const handleDeselect = async (venueId: string) => {
    setActionLoading(venueId);
    try {
      await deselectVenue(partyId, venueId);
      // Update local state
      setVenues(prev => prev.map(v => ({
        ...v,
        isSelected: v.id === venueId ? false : v.isSelected,
      })));
    } catch (error) {
      console.error('Error deselecting venue:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // Toggle expanded venue
  const toggleExpanded = (venueId: string) => {
    setExpandedVenue(prev => prev === venueId ? null : venueId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin size={20} className="text-[#ff393a]" />
          <h2 className="text-lg font-semibold text-theme-text">Venue Options</h2>
          {venues.length > 0 && (
            <span className="text-sm text-theme-text-muted">({venues.length})</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 bg-[#ff393a] hover:bg-[#ff5a5b] text-white font-medium px-3 py-1.5 rounded-lg transition-colors text-sm"
        >
          <Plus size={16} />
          Add Venue
        </button>
      </div>

      {/* Venue List */}
      {venues.length === 0 ? (
        <div className="card p-8 text-center">
          <MapPin size={32} className="mx-auto mb-3 text-theme-text-faint" />
          <p className="text-theme-text-secondary mb-4">No venue options yet</p>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={18} />
            Add Your First Venue
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {venues.map((venue) => {
            const isExpanded = expandedVenue === venue.id;
            const isLoading = actionLoading === venue.id;
            const statusInfo = statusConfig[venue.status] || statusConfig.researching;
            const hasContactInfo = venue.contactName || venue.contactEmail || venue.contactPhone;

            return (
              <div
                key={venue.id}
                className={`card overflow-hidden transition-all ${
                  venue.isSelected
                    ? 'ring-2 ring-[#ff393a] border-[#ff393a]/50'
                    : 'border-theme-stroke'
                }`}
              >
                {/* Main Row */}
                <div
                  className="p-4 cursor-pointer hover:bg-theme-surface transition-colors"
                  onClick={() => toggleExpanded(venue.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
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
                      <h3 className="font-medium text-theme-text truncate">{venue.name}</h3>
                      {venue.address && (
                        <p className="text-sm text-theme-text-secondary truncate">{venue.address}</p>
                      )}

                      {/* Quick Stats */}
                      <div className="flex items-center gap-4 mt-2 text-xs">
                        {venue.capacity && (
                          <span className="flex items-center gap-1 text-theme-text-muted">
                            <Users size={12} />
                            {venue.capacity}
                          </span>
                        )}
                        {venue.cost && (
                          <span className="flex items-center gap-1 text-theme-text-muted">
                            <DollarSign size={12} />
                            {formatCost(venue.cost)}
                          </span>
                        )}
                        {venue.website && (
                          <a
                            href={venue.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 text-[#ff393a] hover:text-[#ff5a5b]"
                          >
                            <Globe size={12} />
                            Website
                          </a>
                        )}
                        {venue.photos && venue.photos.length > 0 && (
                          <span className="flex items-center gap-1 text-theme-text-muted">
                            <Camera size={12} />
                            {venue.photos.length}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Expand/Collapse Icon */}
                    <div className="flex-shrink-0 text-theme-text-muted">
                      {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-theme-stroke p-4 bg-theme-surface space-y-4">
                    {/* Organization */}
                    {venue.organization && (
                      <div className="flex items-center gap-2 text-sm text-theme-text-secondary">
                        <Building2 size={14} className="text-theme-text-muted" />
                        {venue.organization}
                      </div>
                    )}

                    {/* Point Person */}
                    {venue.pointPerson && (
                      <div className="text-sm">
                        <span className="text-theme-text-muted">Point Person: </span>
                        <span className="text-theme-text">{venue.pointPerson}</span>
                      </div>
                    )}

                    {/* Contact Info */}
                    {hasContactInfo && (
                      <div className="space-y-1">
                        <p className="text-xs text-theme-text-muted">Venue Contact</p>
                        {venue.contactName && (
                          <p className="text-sm text-theme-text">{venue.contactName}</p>
                        )}
                        {venue.contactEmail && (
                          <a
                            href={`mailto:${venue.contactEmail}`}
                            className="flex items-center gap-1.5 text-sm text-[#ff393a] hover:text-[#ff5a5b]"
                          >
                            <Mail size={12} />
                            {venue.contactEmail}
                          </a>
                        )}
                        {venue.contactPhone && (
                          <a
                            href={`tel:${venue.contactPhone}`}
                            className="flex items-center gap-1.5 text-sm text-theme-text-secondary hover:text-theme-text"
                          >
                            <Phone size={12} />
                            {venue.contactPhone}
                          </a>
                        )}
                      </div>
                    )}

                    {/* Pros & Cons */}
                    {(venue.pros || venue.cons) && (
                      <div className="grid grid-cols-2 gap-3">
                        {venue.pros && (
                          <div className="text-sm">
                            <p className="flex items-center gap-1 text-xs text-green-400/60 mb-1">
                              <ThumbsUp size={10} />
                              Pros
                            </p>
                            <p className="text-theme-text-secondary whitespace-pre-wrap text-xs">{venue.pros}</p>
                          </div>
                        )}
                        {venue.cons && (
                          <div className="text-sm">
                            <p className="flex items-center gap-1 text-xs text-red-400/60 mb-1">
                              <ThumbsDown size={10} />
                              Cons
                            </p>
                            <p className="text-theme-text-secondary whitespace-pre-wrap text-xs">{venue.cons}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Notes */}
                    {venue.notes && (
                      <div className="text-sm">
                        <p className="text-xs text-theme-text-muted mb-1">Notes</p>
                        <p className="text-theme-text-secondary whitespace-pre-wrap">{venue.notes}</p>
                      </div>
                    )}

                    {/* Photos */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-theme-text-muted flex items-center gap-1">
                          <Camera size={12} />
                          Photos {venue.photos && venue.photos.length > 0 && `(${venue.photos.length})`}
                        </p>
                      </div>
                      <VenuePhotoUpload
                        partyId={partyId}
                        venueId={venue.id}
                        onPhotoAdded={loadVenues}
                      />
                      {venue.photos && venue.photos.length > 0 && (
                        <VenuePhotoGallery
                          photos={venue.photos}
                          partyId={partyId}
                          venueId={venue.id}
                          onPhotoDeleted={loadVenues}
                        />
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t border-theme-stroke">
                      {!venue.isSelected ? (
                        <button
                          type="button"
                          onClick={() => handleSelect(venue.id)}
                          disabled={isLoading}
                          className="flex items-center gap-1.5 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded-lg transition-colors text-sm"
                        >
                          {isLoading ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Check size={14} />
                          )}
                          Select as Location
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleDeselect(venue.id)}
                          disabled={isLoading}
                          className="flex items-center gap-1.5 bg-theme-surface-hover hover:bg-theme-surface-hover disabled:opacity-50 text-theme-text font-medium px-3 py-1.5 rounded-lg transition-colors text-sm"
                        >
                          {isLoading ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            'Deselect'
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditingVenue(venue)}
                        className="flex items-center gap-1.5 bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text font-medium px-3 py-1.5 rounded-lg transition-colors text-sm"
                      >
                        <Pencil size={14} />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(venue.id)}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium px-3 py-1.5 rounded-lg transition-colors text-sm"
                      >
                        {isLoading ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {(showForm || editingVenue) && (
        <VenueForm
          venue={editingVenue || undefined}
          onSave={editingVenue ? handleUpdate : handleCreate}
          onClose={() => {
            setShowForm(false);
            setEditingVenue(null);
          }}
        />
      )}
    </div>
  );
};
