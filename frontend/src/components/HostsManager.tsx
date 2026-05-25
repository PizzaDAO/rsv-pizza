import React, { useState, useEffect, useRef } from 'react';
import { User, UserPlus, X, Globe, Instagram, GripVertical, ChevronDown, ChevronUp, Send, ArrowRightLeft } from 'lucide-react';
import { CoHost } from '../types';
import { Checkbox } from './Checkbox';
import HostFormModal from './HostFormModal';
import { updateParty, addGuestByHost, proxyAvatarToStorage, uploadCoHostAvatar } from '../lib/supabase';
import { fetchXAvatarToSupabase, isAutoFilledXAvatar } from '../utils/avatarUtils';
import { uuid, normalizeUrl, stripToHandle } from '../lib/utils';
import { ALL_HOST_TABS } from '../lib/tabPermissions';
import { usePizza } from '../contexts/PizzaContext';
import { apiRequest, fetchPartyOwner } from '../lib/api';
import { useIsAdminOrUnderboss } from '../hooks/useIsAdminOrUnderboss';
import TransferOwnershipModal from './admin/TransferOwnershipModal';

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
  // burrata-72104 v2: merge co-host saves into party context in-place. We do
  // NOT pull loadParty here — that was v1's mistake and reintroduced the
  // tab-click-feels-like-reload pain. setParty(prev => ({...prev, coHosts}))
  // updates the context without a full refetch.
  // bresaola-49185: also read party.underbossStatus to gate the Payments
  // permission row in the cohost picker for unapproved parties.
  const { setParty, party } = usePizza();
  const isApproved = party?.underbossStatus === 'approved';

  // Helper: check if a co-host is protected (auto-added partner or underboss)
  const isProtected = (h: CoHost) => h.isUnderboss === true || h.isPartner === true;

  // gorgonzola-31204: `initialCoHosts` is read through Supabase, which strips
  // `email` via sanitizeCoHosts (PII protection for public reads). Use the
  // backend GET /api/parties/:partyId/cohosts/full endpoint as the
  // source-of-truth so the edit modal preloads emails and save handlers don't
  // silently wipe them.
  //
  // IMPORTANT: All hooks must stay above any conditional/early return
  // (see arugula-38633 incident in MEMORY).
  const [fullCoHosts, setFullCoHosts] = useState<CoHost[] | null>(null);

  // paesana-89172: primary host (parties.userId) info fetched from the same
  // endpoint. Used to render a synthetic "Owner" row when the owner's email
  // isn't in co_hosts yet — and to canonicalize them into co_hosts on first
  // save (toggle/edit/remove of any sibling). 37+ existing parties had their
  // owner invisible from this UI before the paesana-89172 backfill landed.
  const [primaryHost, setPrimaryHost] = useState<{
    userId: string | null;
    name: string | null;
    email: string;
    avatar_url: string | null;
  } | null>(null);

  // Co-hosts state — includes ALL co-hosts (manual + protected).
  // Prefer the unsanitized fetch when available; fall back to props otherwise.
  const [coHosts, setCoHosts] = useState<CoHost[]>(initialCoHosts);

  // Visible co-hosts: filter out protected entries (auto-added underboss/partner)
  // from the host's edit panel. Backend preserves them server-side on PATCH.
  const visibleCoHosts = React.useMemo(
    () => coHosts.filter(h => !isProtected(h)),
    [coHosts]
  );

  // paesana-89172: case-insensitive lookup of the primary host inside the
  // current cohosts array.
  const ownerEmail = primaryHost?.email?.toLowerCase() ?? null;
  const ownerCoHost = React.useMemo<CoHost | null>(() => {
    if (!ownerEmail) return null;
    return visibleCoHosts.find(h => (h.email ?? '').toLowerCase() === ownerEmail) ?? null;
  }, [visibleCoHosts, ownerEmail]);

  // paesana-89172: when the primary host is NOT yet in co_hosts (legacy
  // parties pre-backfill or any new path that forgets to auto-add), build a
  // synthetic row so they still render. Any change to the synthetic row
  // canonicalizes them into co_hosts via `canonicalizeOwnerIntoCoHosts`.
  const syntheticOwnerRow = React.useMemo<CoHost | null>(() => {
    if (!primaryHost || ownerCoHost) return null;
    return {
      id: `__owner_synthetic_${primaryHost.userId ?? primaryHost.email}`,
      name: primaryHost.name ?? primaryHost.email,
      email: primaryHost.email,
      avatar_url: primaryHost.avatar_url ?? undefined,
      showOnEvent: true,
      canEdit: true,
    };
  }, [primaryHost, ownerCoHost]);

  // The row id of "the owner" — synthetic or real — used to flag the Owner
  // badge + hide the X (remove) button on that row.
  const ownerRowId = syntheticOwnerRow?.id ?? ownerCoHost?.id ?? null;

  // Cohosts list as actually rendered: prepend the synthetic owner when one
  // exists; otherwise leave the list alone. The owner appears once either way.
  const renderedCoHosts = React.useMemo<CoHost[]>(() => {
    if (syntheticOwnerRow) return [syntheticOwnerRow, ...visibleCoHosts];
    return visibleCoHosts;
  }, [syntheticOwnerRow, visibleCoHosts]);

  /**
   * paesana-89172: if the owner row is synthetic (not yet in coHosts), inject
   * them into the array so the rest of the toggle/edit handlers can operate
   * on a real entry. Returns the updated array + the id the rest of the
   * handler should target (synthetic id is replaced with a real uuid).
   */
  const canonicalizeOwnerIntoCoHosts = React.useCallback(
    (current: CoHost[], targetId: string): { next: CoHost[]; resolvedId: string } => {
      if (!syntheticOwnerRow || targetId !== syntheticOwnerRow.id) {
        return { next: current, resolvedId: targetId };
      }
      const realEntry: CoHost = {
        ...syntheticOwnerRow,
        id: uuid(),
      };
      return { next: [...current, realEntry], resolvedId: realEntry.id };
    },
    [syntheticOwnerRow]
  );

  // Sync from props when enriched data arrives asynchronously — but only if
  // we don't have unsanitized data yet. Once `fullCoHosts` is populated, we
  // trust local state (which save handlers keep in sync) over the sanitized
  // props.
  useEffect(() => {
    if (fullCoHosts === null) {
      setCoHosts(initialCoHosts);
    }
  }, [initialCoHosts, fullCoHosts]);

  // Fetch the unsanitized cohosts (with email) on mount / partyId change.
  // Silent fallback on error — render falls back to sanitized props.
  // paesana-89172: also captures the primary host so we can render the
  // synthetic "Owner" row when their email isn't in co_hosts.
  useEffect(() => {
    if (!partyId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest<{
          coHosts: CoHost[];
          primaryHost?: {
            userId: string | null;
            name: string | null;
            email: string;
            avatar_url: string | null;
          } | null;
        }>(`/api/parties/${partyId}/cohosts/full`);
        if (cancelled) return;
        const next = Array.isArray(data.coHosts) ? data.coHosts : [];
        setFullCoHosts(next);
        setCoHosts(next);
        setPrimaryHost(data.primaryHost ?? null);
      } catch {
        // Silent fallback — keep sanitized props as source of truth.
      }
    })();
    return () => { cancelled = true; };
  }, [partyId]);

  // fontina-91827: admin-only "Transfer ownership" affordance under the
  // primary host row. The hook resolves to null while loading, then true/false.
  // The owner-info lookup is deferred until the admin actually opens the modal
  // so we don't hit the backend on every host page render.
  const isAdminCaller = useIsAdminOrUnderboss();
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [primaryOwner, setPrimaryOwner] = useState<{ email: string; name: string | null } | null>(null);
  const [primaryOwnerError, setPrimaryOwnerError] = useState<string | null>(null);
  const [loadingPrimaryOwner, setLoadingPrimaryOwner] = useState(false);

  const openTransferModal = async () => {
    setPrimaryOwnerError(null);
    if (primaryOwner) {
      setShowTransferModal(true);
      return;
    }
    // paesana-89172 already fetches the primary host into `primaryHost`; if
    // that's populated we don't need a second network call.
    if (primaryHost?.email) {
      setPrimaryOwner({ email: primaryHost.email, name: primaryHost.name });
      setShowTransferModal(true);
      return;
    }
    setLoadingPrimaryOwner(true);
    try {
      const data = await fetchPartyOwner(partyId);
      if (!data.ownerEmail) {
        setPrimaryOwnerError('This event has no primary owner on record.');
        return;
      }
      setPrimaryOwner({ email: data.ownerEmail, name: data.ownerName });
      setShowTransferModal(true);
    } catch (e) {
      setPrimaryOwnerError(e instanceof Error ? e.message : 'Failed to load owner');
    } finally {
      setLoadingPrimaryOwner(false);
    }
  };

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
  // bresaola-49185: also hide 'payments' from unapproved parties so cohost
  // permissions don't drift against the actual UI / backend gate.
  const permissionTabs = ALL_HOST_TABS.filter(t => t.id !== 'apps' && (isApproved || t.id !== 'payments'));

  const getPermissionSummary = (coHost: CoHost): string => {
    if (!Array.isArray(coHost.allowedTabs)) return 'All tabs';
    if (coHost.allowedTabs.length === 0) return '0 of ' + permissionTabs.length + ' tabs';
    return `${coHost.allowedTabs.length} of ${permissionTabs.length} tabs`;
  };

  const toggleTabPermission = async (coHostId: string, tabId: string) => {
    // paesana-89172: canonicalize synthetic owner before mutating permissions.
    const { next: canon, resolvedId } = canonicalizeOwnerIntoCoHosts(coHosts, coHostId);
    const newCoHosts = canon.map(h => {
      if (h.id !== resolvedId) return h;
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
    // Use the rendered list (incl. synthetic owner) for the lookup, then
    // canonicalize before applying — same pattern as toggleCoHostCanEdit.
    const coHost = renderedCoHosts.find(h => h.id === coHostId);
    if (!coHost) return;
    const hasAll = !Array.isArray(coHost.allowedTabs);
    const { next: canon, resolvedId } = canonicalizeOwnerIntoCoHosts(coHosts, coHostId);
    const newCoHosts = canon.map(h => {
      if (h.id !== resolvedId) return h;
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
        // gorgonzola-31204: keep the unsanitized source-of-truth in sync with
        // what we just wrote, so a subsequent sanitized-prop refresh doesn't
        // shadow it back to email-stripped data.
        setFullCoHosts(coHostsToSave);
        // Only add as guest for non-protected co-hosts with email
        for (const coHost of coHostsToSave) {
          if (coHost.email && !isProtected(coHost)) {
            await addGuestByHost(partyId, coHost.name, [], [], [], [], [], coHost.email);
          }
        }
        onCoHostsChange?.(coHostsToSave);
        // burrata-72104 v2: merge into party context in-place so sibling
        // components (HostPage avatars, etc.) see the update without forcing
        // a full party refetch / page-reload-feel.
        setParty(prev => prev ? { ...prev, coHosts: coHostsToSave } : prev);
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

      // paesana-89172: if the editing target is the synthetic owner row,
      // canonicalize into coHosts first so the field updates land on a real
      // entry that will persist through subsequent renders.
      const { next: canon, resolvedId } = canonicalizeOwnerIntoCoHosts(
        coHosts,
        editingHostId ?? '',
      );
      const newCoHosts = canon.map(h =>
        h.id === resolvedId
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
    // paesana-89172: canonicalize synthetic owner row → real cohost entry
    // before applying the toggle, so the change actually persists.
    const { next: canon, resolvedId } = canonicalizeOwnerIntoCoHosts(coHosts, id);
    const newCoHosts = canon.map(h =>
      h.id === resolvedId ? { ...h, showOnEvent: !h.showOnEvent } : h
    );
    setCoHosts(newCoHosts);
    // Auto-save
    await saveCoHostsArray(newCoHosts);
  };

  const toggleCoHostCanEdit = async (id: string) => {
    // paesana-89172: canonicalize synthetic owner row → real cohost entry.
    const { next: canon, resolvedId } = canonicalizeOwnerIntoCoHosts(coHosts, id);
    const newCoHosts = canon.map(h => {
      if (h.id !== resolvedId) return h;
      const newCanEdit = !h.canEdit;
      // Clear allowedTabs and collapse permissions when turning off Editor
      if (!newCanEdit) {
        setExpandedPermissionsId(prev => prev === resolvedId ? null : prev);
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
        {/* paesana-89172: the standalone "Primary" display row used to
            render here. The owner is now the first entry in
            `renderedCoHosts` below (with an "Owner" badge + editable
            toggles + non-removable), so rendering them here would
            duplicate them. Only render this legacy display row when we
            haven't yet loaded the primaryHost data (network fallback)
            AND the owner isn't already in the cohosts array. */}
        {hostName && !primaryHost && !ownerCoHost && (
          <div className="p-3 bg-white/5 rounded-xl border border-[#ff393a]/30 transition-all">
            <div className="flex items-center justify-between">
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
            {/* fontina-91827: admin-only Transfer ownership affordance even in
                the legacy/network-fallback render path. */}
            {isAdminCaller && (
              <div className="mt-2 pl-[52px] flex items-center gap-3">
                <button
                  type="button"
                  onClick={openTransferModal}
                  disabled={loadingPrimaryOwner}
                  className="text-xs text-white/50 hover:text-[#ff393a] transition-colors flex items-center gap-1 disabled:opacity-50"
                  title="Admin only — reassign event ownership to another registered user"
                >
                  <ArrowRightLeft size={12} />
                  {loadingPrimaryOwner ? 'Loading…' : 'Transfer ownership →'}
                </button>
                {primaryOwnerError && (
                  <span className="text-xs text-[#ff393a]">{primaryOwnerError}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Co-Hosts (visible only — protected/auto-added entries are hidden from host UI)
            paesana-89172: `renderedCoHosts` prepends a synthetic "Owner" row when
            the primary host isn't yet in co_hosts; on first toggle/edit the
            synthetic row is canonicalized into a real co_host entry. */}
        {renderedCoHosts.map((coHost) => {
          const fullIndex = coHosts.findIndex(h => h.id === coHost.id);
          const isOwnerRow = ownerRowId !== null && coHost.id === ownerRowId;
          // Owner row can't be dragged or removed (they can't be kicked off
          // their own event). Synthetic owner has no real index — render
          // without dnd handlers.
          const draggable = !isOwnerRow;
          return (
          <div
            key={coHost.id}
            draggable={draggable}
            onDragStart={draggable ? () => handleDragStart(coHost.id) : undefined}
            onDragOver={draggable ? (e) => handleDragOver(e, coHost.id) : undefined}
            onDragEnd={draggable ? handleDragEnd : undefined}
            className={`p-3 bg-white/5 rounded-xl border ${isOwnerRow ? 'border-[#ff393a]/30' : 'border-white/10'} transition-all ${draggable ? 'cursor-move' : ''} ${draggedIndex === fullIndex ? 'opacity-50' : 'opacity-100'
              }`}
          >
            {/* Top row: identity + remove button */}
            <div className="flex items-center gap-3">
              {isOwnerRow ? (
                // Owner row: no drag handle (can't be reordered before owner).
                <div className="w-[18px] shrink-0" />
              ) : (
                <div className="cursor-grab active:cursor-grabbing text-white/30 hover:text-white/60 shrink-0">
                  <GripVertical size={18} />
                </div>
              )}
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
                  {/* paesana-89172: "Owner" badge for the primary host row
                      (synthetic OR real). Mirrors the existing "Primary"
                      pill style used on the main host row. */}
                  {isOwnerRow && (
                    <span className="text-xs bg-[#ff393a]/20 text-[#ff393a] px-2 py-0.5 rounded-full shrink-0">
                      Owner
                    </span>
                  )}
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
              {/* paesana-89172: Owner row is non-removable — the primary host
                  can't be kicked from their own event. */}
              {!isOwnerRow && (
                <button
                  type="button"
                  onClick={() => removeCoHost(coHost.id)}
                  className="text-[#ff393a] hover:text-[#ff5a5b] shrink-0"
                >
                  <X size={18} />
                </button>
              )}
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
              {/* fontina-91827: admin-only Transfer-ownership affordance,
                  rendered next to Edit on the Owner row. Hidden for
                  non-admin callers and non-owner rows. */}
              {isOwnerRow && isAdminCaller && (
                <button
                  type="button"
                  onClick={openTransferModal}
                  disabled={loadingPrimaryOwner}
                  className="text-white/50 hover:text-[#ff393a] text-xs font-medium flex items-center gap-1 disabled:opacity-50"
                  title="Admin only — reassign event ownership to another registered user"
                >
                  <ArrowRightLeft size={12} />
                  {loadingPrimaryOwner ? 'Loading…' : 'Transfer ownership →'}
                </button>
              )}
            </div>
            {isOwnerRow && primaryOwnerError && (
              <div className="mt-1 pl-9 text-xs text-[#ff393a]">{primaryOwnerError}</div>
            )}

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
            ? (renderedCoHosts.find(h => h.id === editingHostId)?.showOnEvent !== false)
            : true
        }
        canEdit={
          editingHostId
            ? (renderedCoHosts.find(h => h.id === editingHostId)?.canEdit === true)
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

      {/* fontina-91827: admin-only ownership transfer modal */}
      {primaryOwner && (
        <TransferOwnershipModal
          isOpen={showTransferModal}
          partyId={partyId}
          currentOwnerName={primaryOwner.name}
          currentOwnerEmail={primaryOwner.email}
          candidateCoHosts={coHosts
            .filter(h => !!h.email)
            .map(h => ({ name: h.name, email: h.email as string }))}
          onClose={() => setShowTransferModal(false)}
          onTransferred={() => {
            // Hard reload — ownership change fundamentally rewires the host
            // session (the calling admin may have just lost edit power on
            // this party; the new owner needs the full host UI). Letting
            // the existing party context settle without a reload is risky.
            window.location.reload();
          }}
        />
      )}
    </div>
  );
};
