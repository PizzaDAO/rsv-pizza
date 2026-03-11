import React, { useState, useEffect } from 'react';
import { User, UserPlus, X, Globe, Instagram, GripVertical } from 'lucide-react';
import { CoHost } from '../types';
import { Checkbox } from './Checkbox';
import { updateParty, addGuestByHost } from '../lib/supabase';
import { getXAvatarUrl, isAutoFilledXAvatar } from '../utils/avatarUtils';
import { uuid } from '../lib/utils';

interface HostsManagerProps {
  partyId: string;
  hostName: string;
  initialCoHosts: CoHost[];
  onCoHostsChange?: (coHosts: CoHost[]) => void;
}

export const HostsManager: React.FC<HostsManagerProps> = ({
  partyId,
  hostName,
  initialCoHosts,
  onCoHostsChange,
}) => {
  // Co-hosts state
  const [coHosts, setCoHosts] = useState<CoHost[]>(initialCoHosts);

  // Sync from props when enriched data arrives asynchronously
  useEffect(() => {
    setCoHosts(initialCoHosts);
  }, [initialCoHosts]);

  const [newCoHostName, setNewCoHostName] = useState('');
  const [newCoHostEmail, setNewCoHostEmail] = useState('');
  const [newCoHostWebsite, setNewCoHostWebsite] = useState('');
  const [newCoHostTwitter, setNewCoHostTwitter] = useState('');
  const [newCoHostInstagram, setNewCoHostInstagram] = useState('');
  const [newCoHostAvatarUrl, setNewCoHostAvatarUrl] = useState('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [showAddHostModal, setShowAddHostModal] = useState(false);
  const [editingHostId, setEditingHostId] = useState<string | null>(null);
  const [editHostName, setEditHostName] = useState('');
  const [editHostEmail, setEditHostEmail] = useState('');
  const [editHostWebsite, setEditHostWebsite] = useState('');
  const [editHostTwitter, setEditHostTwitter] = useState('');
  const [editHostInstagram, setEditHostInstagram] = useState('');
  const [editHostAvatarUrl, setEditHostAvatarUrl] = useState('');

  const saveCoHostsArray = async (coHostsToSave: CoHost[]) => {
    try {
      const success = await updateParty(partyId, { co_hosts: coHostsToSave });
      if (success) {
        for (const coHost of coHostsToSave) {
          if (coHost.email) {
            await addGuestByHost(partyId, coHost.name, [], [], [], [], [], coHost.email);
          }
        }
        onCoHostsChange?.(coHostsToSave);
      }
    } catch (error) {
      console.error('Error saving co-hosts:', error);
    }
  };

  const addCoHost = async () => {
    if (!newCoHostName.trim()) return;

    const newCoHost: CoHost = {
      id: uuid(),
      name: newCoHostName.trim(),
      email: newCoHostEmail.trim().toLowerCase() || undefined,
      website: newCoHostWebsite.trim() || undefined,
      twitter: newCoHostTwitter.trim() || undefined,
      instagram: newCoHostInstagram.trim() || undefined,
      avatar_url: newCoHostAvatarUrl.trim() || undefined,
      showOnEvent: true,
    };

    const newCoHosts = [...coHosts, newCoHost];
    setCoHosts(newCoHosts);

    // Reset form and close modal
    setNewCoHostName('');
    setNewCoHostEmail('');
    setNewCoHostWebsite('');
    setNewCoHostTwitter('');
    setNewCoHostInstagram('');
    setNewCoHostAvatarUrl('');
    setShowAddHostModal(false);

    // Auto-save
    await saveCoHostsArray(newCoHosts);
  };

  const startEditingHost = (host: CoHost) => {
    setEditingHostId(host.id);
    setEditHostName(host.name);
    setEditHostEmail(host.email || '');
    setEditHostWebsite(host.website || '');
    setEditHostTwitter(host.twitter || '');
    setEditHostInstagram(host.instagram || '');
    setEditHostAvatarUrl(host.avatar_url || '');
  };

  const cancelEditingHost = () => {
    setEditingHostId(null);
    setEditHostName('');
    setEditHostEmail('');
    setEditHostWebsite('');
    setEditHostTwitter('');
    setEditHostInstagram('');
    setEditHostAvatarUrl('');
  };

  const saveHostEdit = async () => {
    if (!editHostName.trim()) return;

    const newCoHosts = coHosts.map(h =>
      h.id === editingHostId
        ? {
          ...h,
          name: editHostName.trim(),
          email: editHostEmail.trim().toLowerCase() || undefined,
          website: editHostWebsite.trim() || undefined,
          twitter: editHostTwitter.trim() || undefined,
          instagram: editHostInstagram.trim() || undefined,
          avatar_url: editHostAvatarUrl.trim() || undefined,
        }
        : h
    );
    setCoHosts(newCoHosts);
    // Auto-save
    await saveCoHostsArray(newCoHosts);
    cancelEditingHost();
  };

  const removeCoHost = async (id: string) => {
    const newCoHosts = coHosts.filter(h => h.id !== id);
    setCoHosts(newCoHosts);
    // Auto-save
    await saveCoHostsArray(newCoHosts);
  };

  const toggleCoHostShowOnEvent = async (id: string) => {
    const newCoHosts = coHosts.map(h =>
      h.id === id ? { ...h, showOnEvent: !h.showOnEvent } : h
    );
    setCoHosts(newCoHosts);
    // Auto-save
    await saveCoHostsArray(newCoHosts);
  };

  const toggleCoHostCanEdit = async (id: string) => {
    const newCoHosts = coHosts.map(h =>
      h.id === id ? { ...h, canEdit: !h.canEdit } : h
    );
    setCoHosts(newCoHosts);
    // Auto-save
    await saveCoHostsArray(newCoHosts);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newCoHosts = [...coHosts];
    const draggedItem = newCoHosts[draggedIndex];
    newCoHosts.splice(draggedIndex, 1);
    newCoHosts.splice(index, 0, draggedItem);

    setCoHosts(newCoHosts);
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    setDraggedIndex(null);
    // Auto-save after reordering
    await saveCoHostsArray(coHosts);
  };

  return (
    <div>
      <div className="mb-3">
        <label className="block text-sm font-medium text-white/80">
          <User size={16} className="inline mr-2" />
          Hosts
        </label>
      </div>

      {/* Hosts List (Main Host + Co-Hosts) */}
      <div className="space-y-2 mb-3">
        {/* Main Host (display only - name comes from user account) */}
        {hostName && (
          <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-[#ff393a]/30 transition-all">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-10 h-10 rounded-full bg-[#ff393a]/20 flex items-center justify-center">
                <User className="w-5 h-5 text-[#ff393a]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-white font-medium truncate">{hostName}</p>
                  <span className="text-xs bg-[#ff393a]/20 text-[#ff393a] px-2 py-0.5 rounded-full">Primary</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Co-Hosts */}
        {coHosts.map((coHost, index) => (
          <div
            key={coHost.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className={`p-3 bg-white/5 rounded-xl border border-white/10 transition-all cursor-move ${draggedIndex === index ? 'opacity-50' : 'opacity-100'
              }`}
          >
            {/* Top row: identity + remove button */}
            <div className="flex items-center gap-3">
              <div className="cursor-grab active:cursor-grabbing text-white/30 hover:text-white/60 shrink-0">
                <GripVertical size={18} />
              </div>
              {coHost.avatar_url ? (
                <img src={coHost.avatar_url} alt={coHost.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-[#ff393a]/20 flex items-center justify-center shrink-0">
                  <User className="w-5 h-5 text-[#ff393a]" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium truncate">{coHost.name}</p>
                {coHost.email && (
                  <p className="text-white/50 text-xs truncate">{coHost.email}</p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  {coHost.website && (
                    <a href={coHost.website} target="_blank" rel="noopener noreferrer" className="text-white/50 hover:text-white" onClick={(e) => e.stopPropagation()}>
                      <Globe size={14} />
                    </a>
                  )}
                  {coHost.twitter && (
                    <a href={`https://twitter.com/${coHost.twitter}`} target="_blank" rel="noopener noreferrer" className="text-white/50 hover:text-white" onClick={(e) => e.stopPropagation()}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                    </a>
                  )}
                  {coHost.instagram && (
                    <a href={`https://instagram.com/${coHost.instagram}`} target="_blank" rel="noopener noreferrer" className="text-white/50 hover:text-white" onClick={(e) => e.stopPropagation()}>
                      <Instagram size={14} />
                    </a>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeCoHost(coHost.id)}
                className="text-[#ff393a] hover:text-[#ff5a5b] shrink-0"
              >
                <X size={18} />
              </button>
            </div>
            {/* Bottom row: controls */}
            <div className="flex items-center gap-3 mt-2 pl-9">
              <Checkbox
                checked={coHost.showOnEvent !== false}
                onChange={() => toggleCoHostShowOnEvent(coHost.id)}
                label="Show"
                size={16}
                labelClassName="text-xs font-medium text-white/60"
              />
              <Checkbox
                checked={coHost.canEdit === true}
                onChange={() => toggleCoHostCanEdit(coHost.id)}
                label="Editor"
                size={16}
                labelClassName="text-xs font-medium text-white/60"
              />
              <button
                type="button"
                onClick={() => startEditingHost(coHost)}
                className="text-white/50 hover:text-white text-sm font-medium"
              >
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Host Button */}
      <button
        type="button"
        onClick={() => setShowAddHostModal(true)}
        className="w-full btn-secondary flex items-center justify-center gap-2"
      >
        <UserPlus size={16} />
        Add Host
      </button>

      {/* Host Edit Modal */}
      {editingHostId && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/70" onClick={cancelEditingHost}>
          <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">Edit Host</h2>

            <div className="space-y-3">
              <input
                type="text"
                value={editHostName}
                onChange={(e) => setEditHostName(e.target.value)}
                placeholder="Name *"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              />

              <input
                type="email"
                value={editHostEmail}
                onChange={(e) => setEditHostEmail(e.target.value)}
                placeholder="Email (required to edit event)"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              />

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="url"
                  value={editHostWebsite}
                  onChange={(e) => setEditHostWebsite(e.target.value)}
                  placeholder="Website"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
                <input
                  type="url"
                  value={editHostAvatarUrl}
                  onChange={(e) => setEditHostAvatarUrl(e.target.value)}
                  placeholder="Avatar URL"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={editHostTwitter}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditHostTwitter(val);
                    if (!editHostAvatarUrl.trim() || isAutoFilledXAvatar(editHostAvatarUrl)) {
                      const avatarUrl = getXAvatarUrl(val);
                      if (avatarUrl) setEditHostAvatarUrl(avatarUrl);
                    }
                  }}
                  placeholder="Twitter (no @)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
                <input
                  type="text"
                  value={editHostInstagram}
                  onChange={(e) => setEditHostInstagram(e.target.value)}
                  placeholder="Instagram (no @)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
              </div>
            </div>

            {/* Avatar Preview */}
            {editHostAvatarUrl && (
              <div className="flex items-center gap-2 mt-2">
                <img
                  src={editHostAvatarUrl}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <span className="text-xs text-white/40">Avatar preview</span>
              </div>
            )}

            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={cancelEditingHost}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveHostEdit}
                disabled={!editHostName.trim()}
                className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Host Modal */}
      {showAddHostModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/70" onClick={() => setShowAddHostModal(false)}>
          <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">Add Host</h2>

            <div className="space-y-3">
              <input
                type="text"
                value={newCoHostName}
                onChange={(e) => setNewCoHostName(e.target.value)}
                placeholder="Name *"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              />

              <input
                type="email"
                value={newCoHostEmail}
                onChange={(e) => setNewCoHostEmail(e.target.value)}
                placeholder="Email (required to edit event)"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
              />

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="url"
                  value={newCoHostWebsite}
                  onChange={(e) => setNewCoHostWebsite(e.target.value)}
                  placeholder="Website"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
                <input
                  type="url"
                  value={newCoHostAvatarUrl}
                  onChange={(e) => setNewCoHostAvatarUrl(e.target.value)}
                  placeholder="Avatar URL"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={newCoHostTwitter}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewCoHostTwitter(val);
                    if (!newCoHostAvatarUrl.trim() || isAutoFilledXAvatar(newCoHostAvatarUrl)) {
                      const avatarUrl = getXAvatarUrl(val);
                      if (avatarUrl) setNewCoHostAvatarUrl(avatarUrl);
                    }
                  }}
                  placeholder="Twitter (no @)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
                <input
                  type="text"
                  value={newCoHostInstagram}
                  onChange={(e) => setNewCoHostInstagram(e.target.value)}
                  placeholder="Instagram (no @)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
              </div>
            </div>

            {/* Avatar Preview */}
            {newCoHostAvatarUrl && (
              <div className="flex items-center gap-2 mt-2">
                <img
                  src={newCoHostAvatarUrl}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <span className="text-xs text-white/40">Avatar preview</span>
              </div>
            )}

            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => setShowAddHostModal(false)}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addCoHost}
                disabled={!newCoHostName.trim()}
                className="flex-1 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
              >
                <UserPlus size={16} />
                Add Host
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
