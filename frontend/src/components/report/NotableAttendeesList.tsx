import React, { useState } from 'react';
import { Plus, Trash2, ExternalLink, Loader2, Users, Building2 } from 'lucide-react';
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
    .sort((a, b) => b[1].length - a[1].length)
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
  editable,
  deletingId,
  onDelete,
}: {
  group: OrgGroup;
  editable: boolean;
  deletingId: string | null;
  onDelete: (id: string) => void;
}) {
  const { domain, attendees } = group;

  return (
    <div className="bg-white/5 rounded-xl p-4 border border-white/10 space-y-2">
      {/* Org header */}
      <div className="flex items-center gap-2">
        {domain ? (
          <>
            <DomainLogo domain={domain} size={20} />
            <a
              href={`https://${domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-white/70 hover:text-white transition-colors"
            >
              {domain}
            </a>
          </>
        ) : (
          <>
            <Building2 size={16} className="text-white/40" />
            <span className="text-sm font-medium text-white/50">Independent</span>
          </>
        )}
      </div>

      {/* Members */}
      <div className="flex flex-wrap gap-1.5">
        {attendees.map((attendee) => (
          <div
            key={attendee.id}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white/5 rounded-lg group"
          >
            {attendee.link ? (
              <a
                href={attendee.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white hover:text-[#ff393a] transition-colors flex items-center gap-1"
              >
                {attendee.name}
                <ExternalLink size={11} className="text-white/30" />
              </a>
            ) : (
              <span className="text-sm text-white">{attendee.name}</span>
            )}
            {editable && (
              <button
                onClick={() => onDelete(attendee.id)}
                disabled={deletingId === attendee.id}
                className="p-0.5 text-white/0 group-hover:text-white/40 hover:!text-red-400 transition-colors"
              >
                {deletingId === attendee.id ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
              </button>
            )}
          </div>
        ))}
      </div>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {orgGroups.map((group) => (
            <OrgCard
              key={group.domain || '_independent'}
              group={group}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {orgGroups.map((group) => (
            <OrgCard
              key={group.domain || '_independent'}
              group={group}
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
