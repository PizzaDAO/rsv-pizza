import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Loader2, Users, Building2 } from 'lucide-react';
import { NotableAttendee, Guest } from '../../types';
import { BrowseGuestsModal } from './BrowseGuestsModal';
import { extractEmailDomain, getDomainFaviconUrl } from '../../utils/emailUtils';

interface NotableAttendeesListProps {
  attendees: NotableAttendee[];
  guests?: Guest[];
  partyId?: string;
  onAdd: (data: { name: string; link?: string; guestId?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefresh?: () => void;
  editable?: boolean;
}

interface OrgGroup {
  domain: string | null;
  attendees: NotableAttendee[];
}

function groupByOrg(attendees: NotableAttendee[]): OrgGroup[] {
  const map = new Map<string, NotableAttendee[]>();
  const independent: NotableAttendee[] = [];

  for (const a of attendees) {
    const domain = a.email ? extractEmailDomain(a.email, true) : null;
    if (domain) {
      const list = map.get(domain) || [];
      list.push(a);
      map.set(domain, list);
    } else {
      independent.push(a);
    }
  }

  // Sort orgs by member count descending
  const groups: OrgGroup[] = [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([domain, members]) => ({ domain, attendees: members }));

  if (independent.length > 0) {
    groups.push({ domain: null, attendees: independent });
  }

  return groups;
}

function DomainLogo({ domain, size = 20 }: { domain: string; size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className="rounded bg-white/10 flex items-center justify-center flex-shrink-0"
        style={{ width: size, height: size }}
      >
        <span className="text-[10px] font-bold text-white/60 uppercase">
          {domain.charAt(0)}
        </span>
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

function OrgCard({
  group,
  totalRsvps,
  editable,
  deletingId,
  onDelete,
}: {
  group: OrgGroup;
  totalRsvps: number;
  editable: boolean;
  deletingId: string | null;
  onDelete: (id: string) => void;
}) {
  const { domain, attendees } = group;

  return (
    <div className="inline-flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2 border border-white/10 group">
      {domain ? (
        <>
          <DomainLogo domain={domain} size={16} />
          <a
            href={`https://${domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-white/70 hover:text-white transition-colors"
          >
            {domain}
          </a>
          {totalRsvps > 1 && (
            <span className="text-xs text-white/40">({totalRsvps})</span>
          )}
        </>
      ) : (
        <>
          <Building2 size={14} className="text-white/40" />
          {attendees.map((a) => (
            <span key={a.id} className="text-sm text-white/70">{a.name}</span>
          ))}
        </>
      )}
      {editable && (
        <button
          onClick={() => attendees.forEach(a => onDelete(a.id))}
          disabled={attendees.some(a => deletingId === a.id)}
          className="p-0.5 text-white/0 group-hover:text-white/40 hover:!text-red-400 transition-colors"
        >
          {attendees.some(a => deletingId === a.id) ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Trash2 size={12} />
          )}
        </button>
      )}
    </div>
  );
}

export function NotableAttendeesList({ attendees, guests = [], partyId, onAdd, onDelete, onRefresh, editable = true }: NotableAttendeesListProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLink, setNewLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showBrowseModal, setShowBrowseModal] = useState(false);

  const orgGroups = groupByOrg(attendees);

  // Count total RSVPs per domain from the full guest list
  const domainRsvpCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of guests) {
      const domain = g.email ? extractEmailDomain(g.email, true) : null;
      if (domain) counts.set(domain, (counts.get(domain) || 0) + 1);
    }
    return counts;
  }, [guests]);

  const handleAdd = async () => {
    if (!newName.trim()) return;

    setLoading(true);
    try {
      await onAdd({
        name: newName.trim(),
        link: newLink.trim() || undefined,
      });
      setNewName('');
      setNewLink('');
      setIsAdding(false);
    } catch (error) {
      console.error('Failed to add notable attendee:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDelete(id);
    } catch (error) {
      console.error('Failed to delete notable attendee:', error);
    } finally {
      setDeletingId(null);
    }
  };

  // Read-only display
  if (!editable) {
    if (attendees.length === 0) return null;

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white">Industry RSVPs</h3>
        <div className="flex flex-wrap gap-2">
          {orgGroups.map((group) => (
            <OrgCard
              key={group.domain || '_independent'}
              group={group}
              totalRsvps={group.domain ? (domainRsvpCounts.get(group.domain) || group.attendees.length) : group.attendees.length}
              editable={false}
              deletingId={null}
              onDelete={() => {}}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Industry RSVPs</h3>
        <div className="flex items-center gap-2">
          {!isAdding && (
            <>
              {guests.length > 0 && partyId && (
                <button
                  onClick={() => setShowBrowseModal(true)}
                  className="flex items-center gap-1 text-sm text-white/60 hover:text-white transition-colors"
                >
                  <Users size={16} />
                  Browse All
                </button>
              )}
              <button
                onClick={() => setIsAdding(true)}
                className="flex items-center gap-1 text-sm text-white/60 hover:text-white transition-colors"
              >
                <Plus size={16} />
                Add Manually
              </button>
            </>
          )}
        </div>
      </div>

      {/* Browse All Guests Modal */}
      {partyId && (
        <BrowseGuestsModal
          isOpen={showBrowseModal}
          onClose={() => setShowBrowseModal(false)}
          guests={guests}
          partyId={partyId}
          onChanged={() => onRefresh?.()}
        />
      )}

      {/* Add new attendee form (manual) */}
      {isAdding && (
        <div className="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name or company"
            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
          />
          <input
            type="url"
            value={newLink}
            onChange={(e) => setNewLink(e.target.value)}
            placeholder="Link to profile or website (optional)"
            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={loading || !newName.trim()}
              className="flex-1 btn-primary text-sm py-2 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Add
            </button>
            <button
              onClick={() => {
                setIsAdding(false);
                setNewName('');
                setNewLink('');
              }}
              className="btn-secondary text-sm py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Org-grouped attendee cards */}
      {attendees.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {orgGroups.map((group) => (
            <OrgCard
              key={group.domain || '_independent'}
              group={group}
              totalRsvps={group.domain ? (domainRsvpCounts.get(group.domain) || group.attendees.length) : group.attendees.length}
              editable={true}
              deletingId={deletingId}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : (
        !isAdding && (
          <div className="bg-white/5 rounded-xl p-6 border border-white/10 text-center">
            <p className="text-white/40 text-sm">No industry RSVPs added yet</p>
            <p className="text-white/30 text-xs mt-1">Add VIPs, notable companies, or influencers who attended</p>
          </div>
        )
      )}
    </div>
  );
}
