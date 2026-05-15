import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { usePizza } from '../contexts/PizzaContext';
import { TableRow } from './TableRow';
import { Guest } from '../types';
import { UserRoundX, Users, Clock, Search, CheckCircle2, Download, Mail, Check, X, ArrowUpCircle, Loader2 } from 'lucide-react';
import { IconInput } from './IconInput';
import { Checkbox } from './Checkbox';
import { checkInGuest, getNotableGuestIds, addNotableAttendee, deleteNotableAttendeeByGuestId } from '../lib/api';

export const GuestList: React.FC = () => {
  const { t } = useTranslation('host');
  const { guests, removeGuest, approveGuest, declineGuest, promoteGuest, party, loadParty } = usePizza();
  const [searchQuery, setSearchQuery] = useState('');
  const [checkingInId, setCheckingInId] = useState<string | null>(null);
  const [notableGuestIds, setNotableGuestIds] = useState<Set<string>>(new Set());
  const [togglingNotableId, setTogglingNotableId] = useState<string | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionInProgress, setBulkActionInProgress] = useState(false);

  // Transient toast for check-in success/error
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllInSection = useCallback((sectionGuests: Guest[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      sectionGuests.forEach(g => { if (g.id) next.add(g.id); });
      return next;
    });
  }, []);

  const deselectAllInSection = useCallback((sectionGuests: Guest[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      sectionGuests.forEach(g => { if (g.id) next.delete(g.id); });
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const allInSectionSelected = useCallback((sectionGuests: Guest[]) => {
    if (sectionGuests.length === 0) return false;
    return sectionGuests.every(g => g.id && selectedIds.has(g.id));
  }, [selectedIds]);

  // Prune stale selections when guests change
  useEffect(() => {
    const guestIdSet = new Set(guests.map(g => g.id).filter(Boolean));
    setSelectedIds(prev => {
      const pruned = new Set([...prev].filter(id => guestIdSet.has(id)));
      if (pruned.size !== prev.size) return pruned;
      return prev;
    });
  }, [guests]);

  // Fetch notable guest IDs on mount and when party changes
  const fetchNotableIds = useCallback(async () => {
    if (!party?.id) return;
    try {
      const ids = await getNotableGuestIds(party.id);
      setNotableGuestIds(new Set(ids));
    } catch {
      // Silently fail - non-critical feature
    }
  }, [party?.id]);

  useEffect(() => {
    fetchNotableIds();
  }, [fetchNotableIds]);

  const handleToggleNotable = async (guestId: string) => {
    if (!party?.id || togglingNotableId) return;

    const isCurrentlyNotable = notableGuestIds.has(guestId);
    setTogglingNotableId(guestId);

    // Optimistic update
    setNotableGuestIds(prev => {
      const next = new Set(prev);
      if (isCurrentlyNotable) {
        next.delete(guestId);
      } else {
        next.add(guestId);
      }
      return next;
    });

    try {
      if (isCurrentlyNotable) {
        const success = await deleteNotableAttendeeByGuestId(party.id, guestId);
        if (!success) {
          // Revert
          setNotableGuestIds(prev => { const next = new Set(prev); next.add(guestId); return next; });
        }
      } else {
        const guest = guests.find(g => g.id === guestId);
        if (guest) {
          const result = await addNotableAttendee(party.id, { name: guest.name, guestId });
          if (!result) {
            // Revert
            setNotableGuestIds(prev => { const next = new Set(prev); next.delete(guestId); return next; });
          }
        }
      }
    } catch {
      // Revert on error
      setNotableGuestIds(prev => {
        const next = new Set(prev);
        if (isCurrentlyNotable) {
          next.add(guestId);
        } else {
          next.delete(guestId);
        }
        return next;
      });
    } finally {
      setTogglingNotableId(null);
    }
  };

  const filteredGuests = useMemo(() => {
    if (!searchQuery.trim()) return guests;
    const query = searchQuery.toLowerCase().trim();
    return guests.filter(guest =>
      guest.name.toLowerCase().includes(query) ||
      (guest.email && guest.email.toLowerCase().includes(query))
    );
  }, [guests, searchQuery]);

  if (guests.length === 0) {
    return (
      <div className="card p-6 flex flex-col items-center justify-center min-h-[200px] text-center">
        <UserRoundX size={48} className="text-theme-text-faint mb-4" />
        <h3 className="text-xl font-medium text-theme-text">{t('guests.noGuestsYet')}</h3>
        <p className="text-theme-text-muted mt-2">
          {t('guests.shareLink')}
        </p>
      </div>
    );
  }

  const requireApproval = party?.requireApproval || false;

  const exportCSV = () => {
    const headers = ['Name', 'Email', 'Status', 'RSVP Date', 'Dietary Restrictions', 'Liked Toppings', 'Disliked Toppings', 'Wallet Address'];
    const rows = guests.map(g => [
      g.name,
      g.email || '',
      g.status || 'CONFIRMED',
      g.submittedAt ? new Date(g.submittedAt).toLocaleDateString() : '',
      g.dietaryRestrictions.join('; '),
      g.toppings.join('; '),
      g.dislikedToppings.join('; '),
      g.ethereumAddress || '',
    ]);
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${party?.name || 'guests'}-guests.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Count checked-in guests
  const checkedInCount = guests.filter(g => g.checkedInAt).length;

  // Handle manual check-in
  const handleCheckIn = async (guestId: string) => {
    if (!party?.inviteCode || !guestId) return;

    setCheckingInId(guestId);
    try {
      const result = await checkInGuest(party.inviteCode, guestId);
      // Reload party data to get updated check-in status
      await loadParty(party.inviteCode);
      if (!result.alreadyCheckedIn) {
        showToast('success', result.message || 'Guest checked in');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check in guest';
      console.error('Failed to check in guest:', error);
      showToast('error', message);
    } finally {
      setCheckingInId(null);
    }
  };

  // Separate guests by status
  const invitedGuests = filteredGuests.filter(g => g.status === 'INVITED');
  const confirmedGuests = filteredGuests.filter(g => g.status !== 'WAITLISTED' && g.status !== 'INVITED');
  const waitlistedGuests = filteredGuests.filter(g => g.status === 'WAITLISTED')
    .sort((a, b) => (a.waitlistPosition || 0) - (b.waitlistPosition || 0));

  // Compute available bulk actions based on selected guests
  const bulkActions = useMemo(() => {
    if (selectedIds.size === 0) return null;
    const selected = guests.filter(g => g.id && selectedIds.has(g.id));
    return {
      canCheckIn: selected.some(g => (g.status === 'CONFIRMED' || g.status === 'INVITED') && !g.checkedInAt),
      canApprove: requireApproval && selected.some(g => g.approved === null),
      canDecline: requireApproval && selected.some(g => g.approved === null),
      canPromote: selected.some(g => g.status === 'WAITLISTED'),
    };
  }, [selectedIds, guests, requireApproval]);

  const handleBulkCheckIn = async () => {
    if (!party?.inviteCode) return;
    setBulkActionInProgress(true);
    let successCount = 0;
    const failures: string[] = [];
    try {
      const ids = [...selectedIds];
      const eligible = guests.filter(g => g.id && ids.includes(g.id) && (g.status === 'CONFIRMED' || g.status === 'INVITED') && !g.checkedInAt);
      for (const g of eligible) {
        if (!g.id) continue;
        try {
          await checkInGuest(party.inviteCode, g.id);
          successCount++;
        } catch (e) {
          failures.push(g.name);
          console.error(`Bulk check-in failed for ${g.name}:`, e);
        }
      }
      await loadParty(party.inviteCode);
      if (failures.length === 0 && successCount > 0) {
        showToast('success', `Checked in ${successCount} guest${successCount === 1 ? '' : 's'}`);
      } else if (failures.length > 0) {
        showToast('error', `Failed to check in ${failures.length} guest${failures.length === 1 ? '' : 's'}: ${failures.slice(0, 3).join(', ')}${failures.length > 3 ? '…' : ''}`);
      }
    } finally {
      clearSelection();
      setBulkActionInProgress(false);
    }
  };

  const handleBulkApprove = async () => {
    setBulkActionInProgress(true);
    try {
      const ids = [...selectedIds];
      const eligible = guests.filter(g => g.id && ids.includes(g.id) && g.approved === null);
      for (const g of eligible) {
        if (g.id) await approveGuest(g.id);
      }
    } catch (e) {
      console.error('Bulk approve failed:', e);
    } finally {
      clearSelection();
      setBulkActionInProgress(false);
    }
  };

  const handleBulkDecline = async () => {
    setBulkActionInProgress(true);
    try {
      const ids = [...selectedIds];
      const eligible = guests.filter(g => g.id && ids.includes(g.id) && g.approved === null);
      for (const g of eligible) {
        if (g.id) await declineGuest(g.id);
      }
    } catch (e) {
      console.error('Bulk decline failed:', e);
    } finally {
      clearSelection();
      setBulkActionInProgress(false);
    }
  };

  const handleBulkPromote = async () => {
    setBulkActionInProgress(true);
    try {
      const ids = [...selectedIds];
      const eligible = guests.filter(g => g.id && ids.includes(g.id) && g.status === 'WAITLISTED');
      for (const g of eligible) {
        if (g.id) await promoteGuest(g.id);
      }
    } catch (e) {
      console.error('Bulk promote failed:', e);
    } finally {
      clearSelection();
      setBulkActionInProgress(false);
    }
  };

  return (
    <>
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 text-sm font-medium px-4 py-2 rounded-xl shadow-lg animate-fade-in ${
            toast.type === 'success'
              ? 'bg-[#39d98a]/90 text-black'
              : 'bg-red-500/90 text-white'
          }`}
          role="status"
        >
          {toast.text}
        </div>
      )}
      <div className="space-y-6">
      {/* Confirmed Guests Section */}
      <div className="card p-6">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <Users size={20} className="text-theme-text-secondary" />
            <h2 className="text-xl font-bold text-theme-text">{t('guests.title')}</h2>
            <span className="bg-[#39d98a]/20 text-[#39d98a] text-sm font-medium px-3 py-1 rounded-full border border-[#39d98a]/30">
              {confirmedGuests.length}
              {party?.maxGuests && ` / ${party.maxGuests}`}
            </span>
            {invitedGuests.length > 0 && (
              <span className="bg-blue-500/20 text-blue-400 text-sm font-medium px-3 py-1 rounded-full border border-blue-500/30 flex items-center gap-1">
                <Mail size={14} />
                {invitedGuests.length} invited
              </span>
            )}
            {checkedInCount > 0 && (
              <span className="bg-green-500/20 text-green-400 text-sm font-medium px-3 py-1 rounded-full border border-green-500/30 flex items-center gap-1">
                <CheckCircle2 size={14} />
                {t('guests.checkedIn', { count: checkedInCount })}
              </span>
            )}
          </div>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 text-xs text-theme-text-muted hover:text-theme-text transition-colors"
          >
            <Download size={14} />
            {t('guests.exportCsv')}
          </button>
        </div>

        <div className="mb-4">
          <IconInput
            icon={Search}
            type="text"
            placeholder={t('guests.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="guest-search"
          />
        </div>

        {searchQuery.trim() && (
          <p className="text-sm text-theme-text-muted mb-3">
            {t('guests.showingOf', { filtered: filteredGuests.length, total: guests.length })}
          </p>
        )}

        {confirmedGuests.length === 0 ? (
          searchQuery.trim() ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Search size={36} className="text-theme-text-faint mb-3" />
              <p className="text-theme-text-muted">{t('guests.noMatch', { query: searchQuery })}</p>
            </div>
          ) : (
            <p className="text-theme-text-muted text-sm py-4">{t('guests.noConfirmed')}</p>
          )
        ) : (
          <>
            <div className="flex items-center py-2 -mx-2 px-2">
              <Checkbox
                checked={allInSectionSelected(confirmedGuests)}
                onChange={() => allInSectionSelected(confirmedGuests) ? deselectAllInSection(confirmedGuests) : selectAllInSection(confirmedGuests)}
                label={`Select all (${confirmedGuests.length})`}
                size={16}
                labelClassName="text-xs text-theme-text-muted"
              />
            </div>
            <div className="divide-y divide-theme-stroke">
              {confirmedGuests.map(guest => (
                <TableRow
                  key={guest.id}
                  guest={guest}
                  variant="basic"
                  requireApproval={requireApproval}
                  onApprove={approveGuest}
                  onDecline={declineGuest}
                  onRemove={removeGuest}
                  onCheckIn={handleCheckIn}
                  isCheckingIn={checkingInId === guest.id}
                  isNotable={guest.id ? notableGuestIds.has(guest.id) : false}
                  onToggleNotable={handleToggleNotable}
                  isTogglingNotable={togglingNotableId === guest.id}
                  isSelected={guest.id ? selectedIds.has(guest.id) : false}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Invited Section */}
      {invitedGuests.length > 0 && (
        <div className="card p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              <Mail size={20} className="text-theme-text-secondary" />
              <h2 className="text-xl font-bold text-theme-text">Invited</h2>
              <span className="bg-blue-500/20 text-blue-400 text-sm font-medium px-3 py-1 rounded-full border border-blue-500/30">
                {invitedGuests.length}
              </span>
            </div>
          </div>
          <div className="flex items-center py-2 -mx-2 px-2">
            <Checkbox
              checked={allInSectionSelected(invitedGuests)}
              onChange={() => allInSectionSelected(invitedGuests) ? deselectAllInSection(invitedGuests) : selectAllInSection(invitedGuests)}
              label={`Select all (${invitedGuests.length})`}
              size={16}
              labelClassName="text-xs text-theme-text-muted"
            />
          </div>
          <div className="divide-y divide-theme-stroke">
            {invitedGuests.map(guest => (
              <TableRow
                key={guest.id}
                guest={guest}
                variant="basic"
                onRemove={removeGuest}
                isSelected={guest.id ? selectedIds.has(guest.id) : false}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        </div>
      )}

      {/* Waitlist Section */}
      {waitlistedGuests.length > 0 && (
        <div className="card p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              <Clock size={20} className="text-theme-text-secondary" />
              <h2 className="text-xl font-bold text-theme-text">{t('guests.waitlist')}</h2>
              <span className="bg-[#ffc107]/20 text-[#ffc107] text-sm font-medium px-3 py-1 rounded-full border border-[#ffc107]/30">
                {waitlistedGuests.length}
              </span>
            </div>
          </div>

          <div className="flex items-center py-2 -mx-2 px-2">
            <Checkbox
              checked={allInSectionSelected(waitlistedGuests)}
              onChange={() => allInSectionSelected(waitlistedGuests) ? deselectAllInSection(waitlistedGuests) : selectAllInSection(waitlistedGuests)}
              label={`Select all (${waitlistedGuests.length})`}
              size={16}
              labelClassName="text-xs text-theme-text-muted"
            />
          </div>
          <div className="divide-y divide-theme-stroke">
            {waitlistedGuests.map(guest => (
              <TableRow
                key={guest.id}
                guest={guest}
                variant="waitlist"
                onPromote={promoteGuest}
                onRemove={removeGuest}
                isSelected={guest.id ? selectedIds.has(guest.id) : false}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        </div>
      )}

      {/* Floating Bulk Action Bar */}
      {bulkActions && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-theme-card border border-theme-stroke rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-3">
          <span className="text-sm font-semibold text-theme-text whitespace-nowrap">
            {selectedIds.size} selected
          </span>

          <div className="w-px h-6 bg-theme-stroke" />

          {bulkActionInProgress ? (
            <Loader2 size={18} className="animate-spin text-theme-text-muted" />
          ) : (
            <>
              {bulkActions.canCheckIn && (
                <button
                  onClick={handleBulkCheckIn}
                  className="flex items-center gap-1.5 text-green-400 hover:bg-green-500/10 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium whitespace-nowrap"
                >
                  <CheckCircle2 size={15} />
                  Check in
                </button>
              )}
              {bulkActions.canApprove && (
                <button
                  onClick={handleBulkApprove}
                  className="flex items-center gap-1.5 text-[#39d98a] hover:bg-[#39d98a]/10 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium whitespace-nowrap"
                >
                  <Check size={15} />
                  Approve
                </button>
              )}
              {bulkActions.canDecline && (
                <button
                  onClick={handleBulkDecline}
                  className="flex items-center gap-1.5 text-[#ff393a] hover:bg-[#ff393a]/10 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium whitespace-nowrap"
                >
                  <X size={15} />
                  Decline
                </button>
              )}
              {bulkActions.canPromote && (
                <button
                  onClick={handleBulkPromote}
                  className="flex items-center gap-1.5 text-[#39d98a] hover:bg-[#39d98a]/10 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium whitespace-nowrap"
                >
                  <ArrowUpCircle size={15} />
                  Promote
                </button>
              )}
            </>
          )}

          <div className="w-px h-6 bg-theme-stroke" />

          <button
            onClick={clearSelection}
            className="text-theme-text-muted hover:text-theme-text text-sm transition-colors whitespace-nowrap"
          >
            Cancel
          </button>
        </div>
      )}
      </div>
    </>
  );
};
