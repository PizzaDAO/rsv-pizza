import React, { useState, useMemo } from 'react';
import { Plus, Trash2, ExternalLink, Loader2, Star, Search, UserPlus } from 'lucide-react';
import { NotableAttendee, Guest } from '../../types';

interface NotableAttendeesListProps {
  attendees: NotableAttendee[];
  guests?: Guest[];
  onAdd: (data: { name: string; link?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  editable?: boolean;
}

export function NotableAttendeesList({ attendees, guests = [], onAdd, onDelete, editable = true }: NotableAttendeesListProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLink, setNewLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [guestSearch, setGuestSearch] = useState('');
  const [showGuestSearch, setShowGuestSearch] = useState(false);

  // Filter guests by search query, excluding already-added attendees
  const filteredGuests = useMemo(() => {
    if (!guestSearch.trim()) return [];
    const q = guestSearch.toLowerCase();
    const existingNames = new Set(attendees.map(a => a.name.toLowerCase()));
    return guests
      .filter(g => g.name.toLowerCase().includes(q) && !existingNames.has(g.name.toLowerCase()))
      .slice(0, 8);
  }, [guestSearch, guests, attendees]);

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

  const handleAddFromGuest = async (guest: Guest) => {
    setLoading(true);
    try {
      await onAdd({
        name: guest.name,
      });
      setGuestSearch('');
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
        <h3 className="text-lg font-semibold text-white">Notable Attendees</h3>
        <div className="flex flex-wrap gap-2">
          {attendees.map((attendee) => (
            <div key={attendee.id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg border border-white/10">
              <Star size={14} className="text-yellow-400" />
              {attendee.link ? (
                <a
                  href={attendee.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-white hover:text-[#ff393a] transition-colors"
                >
                  {attendee.name}
                </a>
              ) : (
                <span className="text-sm text-white">{attendee.name}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Notable Attendees</h3>
        <div className="flex items-center gap-2">
          {!isAdding && !showGuestSearch && (
            <>
              {guests.length > 0 && (
                <button
                  onClick={() => setShowGuestSearch(true)}
                  className="flex items-center gap-1 text-sm text-white/60 hover:text-white transition-colors"
                >
                  <Search size={16} />
                  Search Guests
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

      {/* Search existing guests */}
      {showGuestSearch && (
        <div className="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
          <input
            type="text"
            value={guestSearch}
            onChange={(e) => setGuestSearch(e.target.value)}
            placeholder="Search guests by name..."
            autoFocus
            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a]"
          />
          {filteredGuests.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {filteredGuests.map((guest) => (
                <button
                  key={guest.id}
                  onClick={() => handleAddFromGuest(guest)}
                  disabled={loading}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-left"
                >
                  <UserPlus size={14} className="text-white/40 shrink-0" />
                  <span className="text-sm text-white truncate">{guest.name}</span>
                  {guest.email && (
                    <span className="text-xs text-white/30 truncate ml-auto">{guest.email}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {guestSearch.trim() && filteredGuests.length === 0 && (
            <p className="text-xs text-white/30">No matching guests found</p>
          )}
          <button
            onClick={() => {
              setShowGuestSearch(false);
              setGuestSearch('');
            }}
            className="btn-secondary text-sm py-2 w-full"
          >
            Cancel
          </button>
        </div>
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

      {/* List of attendees */}
      {attendees.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attendees.map((attendee) => (
            <div
              key={attendee.id}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg border border-white/10 group"
            >
              <Star size={14} className="text-yellow-400" />
              {attendee.link ? (
                <a
                  href={attendee.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-white hover:text-[#ff393a] transition-colors flex items-center gap-1"
                >
                  {attendee.name}
                  <ExternalLink size={12} className="text-white/40" />
                </a>
              ) : (
                <span className="text-sm text-white">{attendee.name}</span>
              )}
              <button
                onClick={() => handleDelete(attendee.id)}
                disabled={deletingId === attendee.id}
                className="p-0.5 text-white/0 group-hover:text-white/40 hover:!text-red-400 transition-colors"
              >
                {deletingId === attendee.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </div>
          ))}
        </div>
      ) : (
        !isAdding && !showGuestSearch && (
          <div className="bg-white/5 rounded-xl p-6 border border-white/10 text-center">
            <p className="text-white/40 text-sm">No notable attendees added yet</p>
            <p className="text-white/30 text-xs mt-1">Add VIPs, notable companies, or influencers who attended</p>
          </div>
        )
      )}
    </div>
  );
}
