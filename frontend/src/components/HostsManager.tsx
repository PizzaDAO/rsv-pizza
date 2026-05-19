import React, { useState, useEffect, useRef } from 'react';
import { User, UserPlus, X, Globe, Instagram, GripVertical, ChevronDown, ChevronUp, Send } from 'lucide-react';
import { CoHost } from '../types';
import { Checkbox } from './Checkbox';
import HostFormModal from './HostFormModal';
import { updateParty, addGuestByHost, proxyAvatarToStorage, uploadCoHostAvatar } from '../lib/supabase';
import { fetchXAvatarToSupabase, isAutoFilledXAvatar } from '../utils/avatarUtils';
import { uuid, normalizeUrl, stripToHandle } from '../lib/utils';
import { ALL_HOST_TABS } from '../lib/tabPermissions';

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
  // Helper: check if a co-host is protected (auto-added partner or underboss)
  const isProtected = (h: CoHost) => h.isUnderboss === true || h.isPartner === true;

  // Co-hosts state — includes ALL co-hosts (manual + protected)
  const [coHosts, setCoHosts] = useState<CoHost[]>(initialCoHosts);

  // Visible co-hosts: filter out protected entries (auto-added underboss/partner)
  // from the host's edit panel. Backend preserves them server-side on PATCH.
  const visibleCoHosts = React.useMemo(
    () => coHosts.filter(h => !isProtected(h)),
    [coHosts]
  );

  // Sync from props when enriched data arrives asynchronously
  useEffect(() => {
    setCoHosts(initialCoHosts);
  }, [initialCoHosts]);

  const [newCoHostName, setNewCoHostName] = useState('');
  const [newCoHostEmail, setNewCoHostEmail] = useState('');
  const [newCoHostWebsite, setNewCoHostWebsite] = useState('');
  const [newCoHostTwitter, setNewCoHostTwitter] = useState('');
  const [newCoHostInstagram, setNewCoHostInstagram] = useState('');
  const [newCoHostTelegram, setNewCoHostTelegram] = useState('');
  const [newCoHostAvatarUrl, setNewCoHostAvatarUrl] = useState('');
  const [newCoHostAvatarFile, setNewCoHostAvatarFile] = useState<File | null>(null);
  const [newCoHostShowOnEvent, setNewCoHostShowOnEvent] = useState(true);
  const [newCoHostCanEdit, setNewCoHostCanEdit] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [showAddHostModal, setShowAddHostModal] = useState(false);
  const [editingHostId, setEditingHostId] = useState<string | null>(null);
  const [editHostName, setEditHostName] = useState('');
  const [editHostEmail, setEditHostEmail] = useState('');
  const [editHostWebsite, setEditHostWebsite] = useState('');
  const [editHostTwitter, setEditHostTwitter] = useState('');
  const [editHostInstagram, setEditHostInstagram] = useState('');
  const [editHostTelegram, setEditHostTelegram] = useState('');
  const [editHostAvatarUrl, setEditHostAvatarUrl] = useState('');
  const [editHostAvatarFile, setEditHostAvatarFile] = useState<File | null>(null);
  const [savingHost, setSavingHost] = useState(false);
  const [expandedPermissionsId, setExpandedPermissionsId] = useState<string | null>(null);
  // Provenance: tracks the handle that produced the current avatar (null = user-set or unknown)
  const [editHostAvatarFromX, setEditHostAvatarFromX] = useState<string | null>(null);
  const [newCoHostAvatarFromX, setNewCoHostAvatarFromX] = useState<string | null>(null);
  const [editXAvatarFetching, setEditXAvatarFetching] = useState(false);
  const [newXAvatarFetching, setNewXAvatarFetching] = useState(false);

  const newAvatarInputRef = useRef<HTMLInputElement>(null);
  const editAvatarInputRef = useRef<HTMLInputElement>(null);

  // Manage object-URL preview for the locally-selected file (Add modal)
  const newAvatarFilePreview = React.useMemo(
    () => (newCoHostAvatarFile ? URL.createObjectURL(newCoHostAvatarFile) : null),
    [newCoHostAvatarFile]
  );
  useEffect(() => {
    return () => {
      if (newAvatarFilePreview) URL.revokeObjectURL(newAvatarFilePreview);
    };
  }, [newAvatarFilePreview]);

  // Manage object-URL preview for the locally-selected file (Edit modal)
  const editAvatarFilePreview = React.useMemo(
    () => (editHostAvatarFile ? URL.createObjectURL(editHostAvatarFile) : null),
    [editHostAvatarFile]
  );
  useEffect(() => {
    return () => {
      if (editAvatarFilePreview) URL.revokeObjectURL(editAvatarFilePreview);
    };
  }, [editAvatarFilePreview]);

  const handleNewAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) return;
    setNewCoHostAvatarFile(file);
    // Clear any URL-based avatar (file takes precedence)
    setNewCoHostAvatarUrl('');
    // User is taking ownership of the avatar slot — drop X provenance
    setNewCoHostAvatarFromX(null);
  };

  const handleEditAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) return;
    setEditHostAvatarFile(file);
    setEditHostAvatarUrl('');
    // User is taking ownership of the avatar slot — drop X provenance
    setEditHostAvatarFromX(null);
  };

  // Tabs available for permission assignment (exclude 'apps' which is always visible)
  const permissionTabs = ALL_HOST_TABS.filter(t => t.id !== 'apps');

  const getPermissionSummary = (coHost: CoHost): string => {
    if (!Array.isArray(coHost.allowedTabs)) return 'All tabs';
    if (coHost.allowedTabs.length === 0) return '0 of ' + permissionTabs.length + ' tabs';
    return `${coHost.allowedTabs.length} of ${permissionTabs.length} tabs`;
  };

  const toggleTabPermission = async (coHostId: string, tabId: string) => {
    const newCoHosts = coHosts.map(h => {
      if (h.id !== coHostId) return h;
      // If allowedTabs is undefined (all access), start with full list then remove the toggled tab
      const current = Array.isArray(h.allowedTabs) ? h.allowedTabs : permissionTabs.map(t => t.id);
      const updated = current.includes(tabId)
        ? current.filter(t => t !== tabId)
        : [...current, tabId];
      // If all tabs selected, clear to undefined (= all access, backward compat)
      if (updated.length >= permissionTabs.length) return { ...h, allowedTabs: undefined };
      return { ...h, allowedTabs: updated };
    });
    setCoHosts(newCoHosts);
    await saveCoHostsArray(newCoHosts);
  };

  const toggleAllTabs = async (coHostId: string) => {
    const coHost = coHosts.find(h => h.id === coHostId);
    if (!coHost) return;
    const hasAll = !Array.isArray(coHost.allowedTabs);
    const newCoHosts = coHosts.map(h => {
      if (h.id !== coHostId) return h;
      // If currently all tabs (undefined), restrict to empty; if restricted, give all (undefined)
      return { ...h, allowedTabs: hasAll ? [] : undefined };
    });
    setCoHosts(newCoHosts);
    await saveCoHostsArray(newCoHosts);
  };

  const saveCoHostsArray = async (coHostsToSave: CoHost[]) => {
    try {
      // Send full array including protected entries — backend respects ordering
      // and preserves protected entry data from DB
      const success = await updateParty(partyId, { co_hosts: coHostsToSave });
      if (success) {
        // Only add as guest for non-protected co-hosts with email
        for (const coHost of coHostsToSave) {
          if (coHost.email && !isProtected(coHost)) {
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
    if (savingHost) return;
    setSavingHost(true);

    try {
      // Upload local file first; otherwise proxy any external URL through storage
      let avatarUrl: string | undefined;
      if (newCoHostAvatarFile) {
        const uploaded = await uploadCoHostAvatar(newCoHostAvatarFile);
        if (uploaded) avatarUrl = uploaded;
      } else if (newCoHostAvatarUrl.trim()) {
        avatarUrl = await proxyAvatarToStorage(newCoHostAvatarUrl.trim());
      }

      const newCoHost: CoHost = {
        id: uuid(),
        name: newCoHostName.trim(),
        email: newCoHostEmail.trim().toLowerCase() || undefined,
        website: newCoHostWebsite.trim() || undefined,
        twitter: newCoHostTwitter.trim() || undefined,
        instagram: newCoHostInstagram.trim() || undefined,
        telegram: newCoHostTelegram.trim() ? stripToHandle(newCoHostTelegram.trim()) : undefined,
        avatar_url: avatarUrl,
        showOnEvent: newCoHostShowOnEvent,
        canEdit: newCoHostCanEdit || undefined,
      };

      const newCoHosts = [...coHosts, newCoHost];
      setCoHosts(newCoHosts);

      // Reset form and close modal
      setNewCoHostName('');
      setNewCoHostEmail('');
      setNewCoHostWebsite('');
      setNewCoHostTwitter('');
      setNewCoHostInstagram('');
      setNewCoHostTelegram('');
      setNewCoHostAvatarUrl('');
      setNewCoHostAvatarFile(null);
      setNewCoHostAvatarFromX(null);
      setNewXAvatarFetching(false);
      setNewCoHostShowOnEvent(true);
      setNewCoHostCanEdit(false);
      setShowAddHostModal(false);

      // Auto-save
      await saveCoHostsArray(newCoHosts);
    } finally {
      setSavingHost(false);
    }
  };

  const startEditingHost = (host: CoHost) => {
    setEditingHostId(host.id);
    setEditHostName(host.name);
    setEditHostEmail(host.email || '');
    setEditHostWebsite(host.website || '');
    setEditHostTwitter(host.twitter || '');
    setEditHostInstagram(host.instagram || '');
    setEditHostTelegram(host.telegram || '');
    setEditHostAvatarUrl(host.avatar_url || '');
    setEditHostAvatarFile(null);
    // Provenance of any saved avatar is unknown — treat as user-set
    setEditHostAvatarFromX(null);
  };

  const cancelEditingHost = () => {
    setEditingHostId(null);
    setEditHostName('');
    setEditHostEmail('');
    setEditHostWebsite('');
    setEditHostTwitter('');
    setEditHostInstagram('');
    setEditHostTelegram('');
    setEditHostAvatarUrl('');
    setEditHostAvatarFile(null);
    setEditHostAvatarFromX(null);
    setEditXAvatarFetching(false);
  };

  const saveHostEdit = async () => {
    if (!editHostName.trim()) return;
    if (savingHost) return;
    setSavingHost(true);

    try {
      // Upload local file first; otherwise proxy any external URL through storage
      let avatarUrl: string | undefined;
      if (editHostAvatarFile) {
        const uploaded = await uploadCoHostAvatar(editHostAvatarFile);
        if (uploaded) avatarUrl = uploaded;
      } else if (editHostAvatarUrl.trim()) {
        avatarUrl = await proxyAvatarToStorage(editHostAvatarUrl.trim());
      }

      const newCoHosts = coHosts.map(h =>
        h.id === editingHostId
          ? {
            ...h,
            name: editHostName.trim(),
            email: editHostEmail.trim().toLowerCase() || undefined,
            website: editHostWebsite.trim() || undefined,
            twitter: editHostTwitter.trim() || undefined,
            instagram: editHostInstagram.trim() || undefined,
            telegram: editHostTelegram.trim() ? stripToHandle(editHostTelegram.trim()) : undefined,
            avatar_url: avatarUrl,
          }
          : h
      );
      setCoHosts(newCoHosts);
      // Auto-save
      await saveCoHostsArray(newCoHosts);
      cancelEditingHost();
    } finally {
      setSavingHost(false);
    }
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
    const newCoHosts = coHosts.map(h => {
      if (h.id !== id) return h;
      const newCanEdit = !h.canEdit;
      // Clear allowedTabs and collapse permissions when turning off Editor
      if (!newCanEdit) {
        setExpandedPermissionsId(prev => prev === id ? null : prev);
        return { ...h, canEdit: false, allowedTabs: undefined };
      }
      return { ...h, canEdit: true };
    });
    setCoHosts(newCoHosts);
    // Auto-save
    await saveCoHostsArray(newCoHosts);
  };

  const handleDragStart = (id: string) => {
    const index = coHosts.findIndex(h => h.id === id);
    if (index === -1) return;
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    const index = coHosts.findIndex(h => h.id === id);
    if (index === -1) return;
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

        {/* Co-Hosts (visible only — protected/auto-added entries are hidden from host UI) */}
        {visibleCoHosts.map((coHost) => {
          const fullIndex = coHosts.findIndex(h => h.id === coHost.id);
          return (
          <div
            key={coHost.id}
            draggable
            onDragStart={() => handleDragStart(coHost.id)}
            onDragOver={(e) => handleDragOver(e, coHost.id)}
            onDragEnd={handleDragEnd}
            className={`p-3 bg-white/5 rounded-xl border border-white/10 transition-all cursor-move ${draggedIndex === fullIndex ? 'opacity-50' : 'opacity-100'
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
                <div className="flex items-center gap-2">
                  <p className="text-white font-medium truncate">{coHost.name}</p>
                </div>
                {coHost.email && (
                  <p className="text-white/50 text-xs truncate">{coHost.email}</p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  {coHost.website && (
                    <a href={normalizeUrl(coHost.website)} target="_blank" rel="noopener noreferrer" className="text-white/50 hover:text-white" onClick={(e) => e.stopPropagation()}>
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
                  {coHost.telegram && (
                    <a
                      href={`https://t.me/${coHost.telegram.replace(/^@/, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/50 hover:text-white"
                      onClick={(e) => e.stopPropagation()}
                      title="DM on Telegram"
                    >
                      <Send size={14} />
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

            {/* Tab permissions expander (only when canEdit is true) */}
            {coHost.canEdit && (
              <div className="mt-2 pl-9">
                <button
                  type="button"
                  onClick={() => setExpandedPermissionsId(expandedPermissionsId === coHost.id ? null : coHost.id)}
                  className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/70 transition-colors"
                >
                  {expandedPermissionsId === coHost.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  <span>Permissions: {getPermissionSummary(coHost)}</span>
                </button>

                {expandedPermissionsId === coHost.id && (
                  <div className="mt-2 p-3 bg-white/5 rounded-lg border border-white/10">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-white/60">Allowed tabs</span>
                      <button
                        type="button"
                        onClick={() => toggleAllTabs(coHost.id)}
                        className="text-xs text-[#ff393a] hover:text-[#ff5a5b]"
                      >
                        {!Array.isArray(coHost.allowedTabs) ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {permissionTabs.map(tab => {
                        const isAllowed = !Array.isArray(coHost.allowedTabs) || coHost.allowedTabs.includes(tab.id);
                        return (
                          <Checkbox
                            key={tab.id}
                            checked={isAllowed}
                            onChange={() => toggleTabPermission(coHost.id, tab.id)}
                            label={tab.label}
                            size={14}
                            labelClassName="text-xs text-white/60"
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          );
        })}
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
      <HostFormModal
        open={editingHostId !== null}
        mode="edit"
        name={editHostName}
        email={editHostEmail}
        website={editHostWebsite}
        twitter={editHostTwitter}
        instagram={editHostInstagram}
        telegram={editHostTelegram}
        avatarUrl={editHostAvatarUrl}
        avatarFilePreview={editAvatarFilePreview}
        showOnEvent={
          editingHostId
            ? (coHosts.find(h => h.id === editingHostId)?.showOnEvent !== false)
            : true
        }
        canEdit={
          editingHostId
            ? (coHosts.find(h => h.id === editingHostId)?.canEdit === true)
            : false
        }
        xAvatarFetching={editXAvatarFetching}
        onNameChange={setEditHostName}
        onEmailChange={setEditHostEmail}
        onWebsiteChange={setEditHostWebsite}
        onWebsiteBlur={() => setEditHostWebsite(normalizeUrl(editHostWebsite))}
        onTwitterChange={setEditHostTwitter}
        onTwitterBlur={async () => {
          const handle = stripToHandle(editHostTwitter);
          setEditHostTwitter(handle);
          if (!handle) return;
          // Skip partial-handle lookups that resolve to wrong users
          if (handle.length < 4) return;
          if (editHostAvatarFile) return;
          // Already current for this handle — no-op
          if (editHostAvatarFromX === handle) return;
          // First-time fetch: only auto-fill empty slot or legacy unavatar URL
          if (editHostAvatarFromX == null) {
            if (editHostAvatarUrl.trim() && !isAutoFilledXAvatar(editHostAvatarUrl)) return;
          }
          setEditXAvatarFetching(true);
          try {
            const fetched = await fetchXAvatarToSupabase(handle);
            if (fetched) {
              setEditHostAvatarUrl(fetched);
              setEditHostAvatarFromX(handle);
            }
          } finally {
            setEditXAvatarFetching(false);
          }
        }}
        onInstagramChange={setEditHostInstagram}
        onInstagramBlur={() => setEditHostInstagram(stripToHandle(editHostInstagram))}
        onTelegramChange={setEditHostTelegram}
        onTelegramBlur={() => setEditHostTelegram(stripToHandle(editHostTelegram))}
        onShowOnEventChange={() => { if (editingHostId) toggleCoHostShowOnEvent(editingHostId); }}
        onCanEditChange={() => { if (editingHostId) toggleCoHostCanEdit(editingHostId); }}
        fileInputRef={editAvatarInputRef}
        onAvatarFileChange={handleEditAvatarFileChange}
        onAvatarClear={() => { setEditHostAvatarFile(null); setEditHostAvatarUrl(''); setEditHostAvatarFromX(null); }}
        onCancel={cancelEditingHost}
        onSubmit={saveHostEdit}
        submitting={savingHost}
      />

      {/* Add Host Modal */}
      <HostFormModal
        open={showAddHostModal}
        mode="add"
        name={newCoHostName}
        email={newCoHostEmail}
        website={newCoHostWebsite}
        twitter={newCoHostTwitter}
        instagram={newCoHostInstagram}
        telegram={newCoHostTelegram}
        avatarUrl={newCoHostAvatarUrl}
        avatarFilePreview={newAvatarFilePreview}
        showOnEvent={newCoHostShowOnEvent}
        canEdit={newCoHostCanEdit}
        xAvatarFetching={newXAvatarFetching}
        onNameChange={setNewCoHostName}
        onEmailChange={setNewCoHostEmail}
        onWebsiteChange={setNewCoHostWebsite}
        onWebsiteBlur={() => setNewCoHostWebsite(normalizeUrl(newCoHostWebsite))}
        onTwitterChange={setNewCoHostTwitter}
        onTwitterBlur={async () => {
          const handle = stripToHandle(newCoHostTwitter);
          setNewCoHostTwitter(handle);
          if (!handle) return;
          // Skip partial-handle lookups that resolve to wrong users
          if (handle.length < 4) return;
          if (newCoHostAvatarFile) return;
          // Already current for this handle — no-op
          if (newCoHostAvatarFromX === handle) return;
          // First-time fetch: only auto-fill empty slot or legacy unavatar URL
          if (newCoHostAvatarFromX == null) {
            if (newCoHostAvatarUrl.trim() && !isAutoFilledXAvatar(newCoHostAvatarUrl)) return;
          }
          setNewXAvatarFetching(true);
          try {
            const fetched = await fetchXAvatarToSupabase(handle);
            if (fetched) {
              setNewCoHostAvatarUrl(fetched);
              setNewCoHostAvatarFromX(handle);
            }
          } finally {
            setNewXAvatarFetching(false);
          }
        }}
        onInstagramChange={setNewCoHostInstagram}
        onInstagramBlur={() => setNewCoHostInstagram(stripToHandle(newCoHostInstagram))}
        onTelegramChange={setNewCoHostTelegram}
        onTelegramBlur={() => setNewCoHostTelegram(stripToHandle(newCoHostTelegram))}
        onShowOnEventChange={() => setNewCoHostShowOnEvent(!newCoHostShowOnEvent)}
        onCanEditChange={() => setNewCoHostCanEdit(!newCoHostCanEdit)}
        fileInputRef={newAvatarInputRef}
        onAvatarFileChange={handleNewAvatarFileChange}
        onAvatarClear={() => { setNewCoHostAvatarFile(null); setNewCoHostAvatarUrl(''); setNewCoHostAvatarFromX(null); }}
        onCancel={() => setShowAddHostModal(false)}
        onSubmit={addCoHost}
        submitting={savingHost}
      />
    </div>
  );
};
