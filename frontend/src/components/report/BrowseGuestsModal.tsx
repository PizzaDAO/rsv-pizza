import React, { useState, useMemo, useEffect } from 'react';
import { X, Search, Loader2, Check } from 'lucide-react';
import { Guest } from '../../types';
import { IconInput } from '../IconInput';
import { addNotableAttendee, deleteNotableAttendeeByGuestId, getNotableGuestIds } from '../../lib/api';
import { extractEmailDomain, getDomainFaviconUrl, isEmailProvider } from '../../utils/emailUtils';

interface BrowseGuestsModalProps {
  isOpen: boolean;
  onClose: () => void;
  guests: Guest[];
  partyId: string;
  onChanged: () => void;
}

interface DomainGroup {
  domain: string;
  guests: Guest[];
}

function DomainFavicon({ domain, size = 20 }: { domain: string; size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className="rounded bg-white/10 flex items-center justify-center flex-shrink-0"
        style={{ width: size, height: size }}
      >
        <span className="text-[10px] font-bold text-white/60 uppercase">{domain.charAt(0)}</span>
      </div>
    );
  }

  return (
    <img
      src={getDomainFaviconUrl(domain, size * 2)}
      alt={domain}
      width={size}
      height={size}
      className="rounded flex-shrink-0"
      onError={() => setFailed(true)}
    />
  );
}

export function BrowseGuestsModal({ isOpen, onClose, guests, partyId, onChanged }: BrowseGuestsModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [notableGuestIds, setNotableGuestIds] = useState<Set<string>>(new Set());
  const [togglingDomain, setTogglingDomain] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch notable guest IDs when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    getNotableGuestIds(partyId).then(ids => {
      setNotableGuestIds(new Set(ids));
      setLoading(false);
    });
  }, [isOpen, partyId]);

  // Group guests by non-provider domain
  const domainGroups = useMemo(() => {
    const map = new Map<string, Guest[]>();

    for (const g of guests) {
      if (!g.email || !g.id) continue;
      const domain = extractEmailDomain(g.email);
      if (!domain || isEmailProvider(domain)) continue;
      const list = map.get(domain) || [];
      list.push(g);
      map.set(domain, list);
    }

    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([domain, domainGuests]): DomainGroup => ({ domain, guests: domainGuests }));
  }, [guests]);

  const filteredDomains = useMemo(() => {
    if (!searchQuery.trim()) return domainGroups;
    const q = searchQuery.toLowerCase().trim();
    return domainGroups.filter(g =>
      g.domain.toLowerCase().includes(q) ||
      g.guests.some(guest => guest.name.toLowerCase().includes(q))
    );
  }, [domainGroups, searchQuery]);

  // Check if a domain is fully selected (all its guests are notable)
  const isDomainSelected = (group: DomainGroup) =>
    group.guests.every(g => g.id && notableGuestIds.has(g.id));

  // Check if a domain is partially selected
  const isDomainPartial = (group: DomainGroup) =>
    group.guests.some(g => g.id && notableGuestIds.has(g.id)) && !isDomainSelected(group);

  const handleToggleDomain = async (group: DomainGroup) => {
    if (togglingDomain) return;
    setTogglingDomain(group.domain);

    const isSelected = isDomainSelected(group);

    // Optimistic update
    setNotableGuestIds(prev => {
      const next = new Set(prev);
      for (const g of group.guests) {
        if (!g.id) continue;
        if (isSelected) {
          next.delete(g.id);
        } else {
          next.add(g.id);
        }
      }
      return next;
    });

    try {
      if (isSelected) {
        // Remove all guests from this domain
        for (const g of group.guests) {
          if (g.id && notableGuestIds.has(g.id)) {
            await deleteNotableAttendeeByGuestId(partyId, g.id);
          }
        }
      } else {
        // Add all guests from this domain that aren't already notable
        for (const g of group.guests) {
          if (g.id && !notableGuestIds.has(g.id)) {
            await addNotableAttendee(partyId, { name: g.name, guestId: g.id });
          }
        }
      }
      onChanged();
    } catch {
      // Revert on error — re-fetch
      const ids = await getNotableGuestIds(partyId);
      setNotableGuestIds(new Set(ids));
    } finally {
      setTogglingDomain(null);
    }
  };

  const selectedCount = domainGroups.filter(g => isDomainSelected(g)).length;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#1a1a2e] rounded-2xl border border-white/10 w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Browse Organizations</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-4">
          <IconInput
            icon={Search}
            type="text"
            placeholder="Search by domain or guest name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Domain list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-white/40" />
            </div>
          ) : filteredDomains.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search size={36} className="text-white/20 mb-3" />
              <p className="text-white/50 text-sm">
                {searchQuery.trim() ? `No domains match "${searchQuery}"` : 'No organization domains found'}
              </p>
            </div>
          ) : (
            filteredDomains.map(group => {
              const selected = isDomainSelected(group);
              const partial = isDomainPartial(group);
              const isToggling = togglingDomain === group.domain;

              return (
                <button
                  key={group.domain}
                  onClick={() => handleToggleDomain(group)}
                  disabled={isToggling}
                  className="flex items-center gap-3 w-full py-2.5 px-2 -mx-2 rounded-lg hover:bg-white/5 transition-colors text-left"
                >
                  {/* Favicon */}
                  <DomainFavicon domain={group.domain} size={24} />

                  {/* Domain & count */}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-white">{group.domain}</span>
                    <span className="text-xs text-white/40 ml-2">
                      {group.guests.length} {group.guests.length === 1 ? 'RSVP' : 'RSVPs'}
                    </span>
                  </div>

                  {/* Selection indicator */}
                  {isToggling ? (
                    <Loader2 size={18} className="animate-spin text-white/40 flex-shrink-0" />
                  ) : (
                    <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      selected
                        ? 'bg-[#ff393a] border-[#ff393a]'
                        : partial
                          ? 'border-[#ff393a] bg-[#ff393a]/20'
                          : 'border-white/20'
                    }`}>
                      {(selected || partial) && <Check size={14} className="text-white" />}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer counter */}
        <div className="px-4 py-3 border-t border-white/10 text-center">
          <span className="text-sm text-white/50">
            {selectedCount} {selectedCount === 1 ? 'organization' : 'organizations'} selected
          </span>
        </div>
      </div>
    </div>
  );
}
