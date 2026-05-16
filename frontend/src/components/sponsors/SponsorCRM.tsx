import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, GripVertical, FileText, Globe } from 'lucide-react';
import { Sponsor, SponsorStats, SponsorStatus, UnifiedPartner } from '../../types';
import {
  getSponsors,
  getSponsorStats,
  createSponsor,
  updateSponsor,
  deleteSponsor,
  updateFundraisingGoal,
  reorderSponsors,
  getUnifiedSponsors,
  ensureUnderbossSponsors,
  updateSponsorUser,
  fetchUnderbossMe,
} from '../../lib/api';
import { SponsorPipeline } from './SponsorPipeline';
import { SponsorList } from './SponsorList';
import { PartnerForm, extractSponsorData } from './PartnerForm';
import type { PartnerFormData } from './PartnerForm';
import { usePizza } from '../../contexts/PizzaContext';
import { triggerFlyerRegen, FLYER_SPONSOR_STATUSES } from '../flyer/autoRegenFlyer';
import { PartnerFlyerGenerator } from './PartnerFlyerGenerator';

interface SponsorCRMProps {
  partyId: string;
  onAddAsCoHost?: (data: { name: string; website: string; twitter: string; instagram: string; logoUrl: string; avatarUrl?: string }) => void;
}

export function SponsorCRM({ partyId, onAddAsCoHost }: SponsorCRMProps) {
  const { t } = useTranslation('host');
  const { party, loadParty } = usePizza();
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [stats, setStats] = useState<SponsorStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPrivileged, setIsPrivileged] = useState(false);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingSponsor, setEditingSponsor] = useState<Sponsor | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Unified description reorder state
  const [descDragIndex, setDescDragIndex] = useState<number | null>(null);
  const [unifiedPartners, setUnifiedPartners] = useState<UnifiedPartner[]>([]);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  // Build avatar URL map from unified partners for the sponsor table
  const sponsorAvatarUrls = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of unifiedPartners) {
      if (p.sponsorId && p.avatarUrl) {
        map[p.sponsorId] = p.avatarUrl;
      }
    }
    return map;
  }, [unifiedPartners]);

  // Load sponsors and stats
  const loadData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    setError(null);

    try {
      const [sponsorsResult, statsResult] = await Promise.all([
        getSponsors(partyId),
        getSponsorStats(partyId),
      ]);

      if (sponsorsResult) {
        setSponsors(sponsorsResult.sponsors);
      }
      if (statsResult) {
        setStats(statsResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sponsors');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [partyId]);

  // Load unified partners for description ordering
  const loadUnifiedPartners = useCallback(async () => {
    try {
      const result = await getUnifiedSponsors(partyId);
      if (result) {
        setUnifiedPartners(result.partners);
      }
    } catch (err) {
      console.error('Failed to load unified partners:', err);
      // Fall back silently — the old behavior still works via sponsors list
    }
  }, [partyId]);

  useEffect(() => {
    loadData();
    loadUnifiedPartners();
  }, [loadData, loadUnifiedPartners]);

  // Detect whether the current user can manage underboss-added partners
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchUnderbossMe();
        if (!cancelled) {
          setIsPrivileged(!!me?.isAdmin || !!me?.isUnderboss);
        }
      } catch {
        if (!cancelled) {
          setIsPrivileged(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reload unified partners when sponsors change
  useEffect(() => {
    loadUnifiedPartners();
  }, [sponsors, loadUnifiedPartners]);

  // Handle form submission
  const handleFormSubmit = async (formData: PartnerFormData, coHostData?: { name: string; website: string; twitter: string; instagram: string; logoUrl: string; avatarUrl?: string }) => {
    // Block edits to underboss-added partners for non-privileged users (belt-and-suspenders)
    if (editingSponsor?.addedByUnderboss && !isPrivileged) {
      setShowForm(false);
      setEditingSponsor(null);
      return;
    }
    const data = extractSponsorData(formData);
    // Capture pre-edit snapshot for flyer-regen decision (only matters when editing)
    const previousSponsor = editingSponsor;
    setIsSubmitting(true);
    try {
      if (editingSponsor) {
        // Update existing sponsor
        const result = await updateSponsor(partyId, editingSponsor.id, data);
        if (result) {
          setSponsors(prev =>
            prev.map(s => (s.id === editingSponsor.id ? result.sponsor : s))
          );
        }
      } else {
        // Create new sponsor
        const result = await createSponsor(partyId, data);
        if (result) {
          setSponsors(prev => [result.sponsor, ...prev]);
        }
      }

      // Add as co-host if requested — do this before closing the form
      if (coHostData && onAddAsCoHost) {
        await onAddAsCoHost(coHostData);
      }

      // Update partner avatar in SponsorUser table if avatar was set
      if (formData.coHostAvatarUrl) {
        const sponsorId = editingSponsor?.id;
        const match = sponsorId
          ? unifiedPartners.find(p => p.sponsorId === sponsorId)
          : null;
        if (match?.sponsorUserId) {
          try {
            await updateSponsorUser(match.sponsorUserId, {
              coHostAvatarUrl: formData.coHostAvatarUrl,
            });
          } catch (e) {
            console.error('Failed to update partner avatar:', e);
          }
        }
      }

      // Refresh stats
      const statsResult = await getSponsorStats(partyId);
      if (statsResult) setStats(statsResult);

      // Auto-regenerate flyer if the change affects the flyer:
      //  - new/edited sponsor with a flyer status + logo
      //  - existing sponsor transitioned into or out of flyer status
      //  - existing sponsor still on flyer AND its logoUrl changed
      if (party && data.status) {
        const willBeOnFlyer = FLYER_SPONSOR_STATUSES.has(data.status) && !!data.logoUrl;
        const wasOnFlyer = !!previousSponsor
          && FLYER_SPONSOR_STATUSES.has(previousSponsor.status)
          && !!previousSponsor.logoUrl;
        const logoChanged = !!previousSponsor
          && (previousSponsor.logoUrl || null) !== (data.logoUrl || null);

        if (willBeOnFlyer || wasOnFlyer !== willBeOnFlyer || (wasOnFlyer && logoChanged)) {
          if (party.inviteCode) await loadParty(party.inviteCode);
          triggerFlyerRegen(party, loadParty);
        }
      }

      // Close form
      setShowForm(false);
      setEditingSponsor(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle sponsor deletion
  const handleDelete = async (sponsorId: string) => {
    // Capture sponsor before removing it so we can check if flyer needs regen
    const deletedSponsor = sponsors.find(s => s.id === sponsorId);
    // Block deletes of underboss-added partners for non-privileged users (belt-and-suspenders)
    if (deletedSponsor?.addedByUnderboss && !isPrivileged) {
      return;
    }
    const success = await deleteSponsor(partyId, sponsorId);
    if (success) {
      setSponsors(prev => prev.filter(s => s.id !== sponsorId));
      // Refresh stats
      const statsResult = await getSponsorStats(partyId);
      if (statsResult) setStats(statsResult);

      // Auto-regenerate flyer if deleted sponsor was on the flyer
      if (party && deletedSponsor && FLYER_SPONSOR_STATUSES.has(deletedSponsor.status) && deletedSponsor.logoUrl) {
        if (party.inviteCode) await loadParty(party.inviteCode);
        triggerFlyerRegen(party, loadParty);
      }
    }
  };

  // Handle editing
  const handleEdit = (sponsor: Sponsor) => {
    // Block edits to underboss-added partners for non-privileged users (belt-and-suspenders)
    if (sponsor.addedByUnderboss && !isPrivileged) {
      return;
    }
    setEditingSponsor(sponsor);
    setShowForm(true);
  };

  // Handle fundraising goal update
  const handleUpdateGoal = async (goal: number | null) => {
    await updateFundraisingGoal(partyId, goal);
    // Refresh stats
    const statsResult = await getSponsorStats(partyId);
    if (statsResult) setStats(statsResult);
  };

  // Close form
  const handleCloseForm = () => {
    setShowForm(false);
    setEditingSponsor(null);
  };

  // Handle inline status change with optimistic update
  const handleStatusChange = async (sponsor: Sponsor, newStatus: SponsorStatus) => {
    // Block status changes on underboss-added partners for non-privileged users (belt-and-suspenders)
    if (sponsor.addedByUnderboss && !isPrivileged) {
      return;
    }
    const oldStatus = sponsor.status;

    // Optimistic update
    setSponsors(prev =>
      prev.map(s => (s.id === sponsor.id ? { ...s, status: newStatus } : s))
    );

    try {
      const result = await updateSponsor(partyId, sponsor.id, { status: newStatus });
      if (result) {
        // Use server response
        setSponsors(prev =>
          prev.map(s => (s.id === sponsor.id ? result.sponsor : s))
        );
      }
      // Refresh stats since status change affects pipeline counts
      const statsResult = await getSponsorStats(partyId);
      if (statsResult) setStats(statsResult);

      // Auto-regenerate flyer when a sponsor transitions to/from a flyer status
      if (party && (FLYER_SPONSOR_STATUSES.has(oldStatus) || FLYER_SPONSOR_STATUSES.has(newStatus))) {
        if (party.inviteCode) await loadParty(party.inviteCode);
        triggerFlyerRegen(party, loadParty);
      }
    } catch {
      // Revert on failure
      setSponsors(prev =>
        prev.map(s => (s.id === sponsor.id ? { ...s, status: oldStatus } : s))
      );
    }
  };

  // Description reorder handlers
  const handleDescDragStart = (index: number) => {
    setDescDragIndex(index);
  };

  const handleDescDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (descDragIndex === null || descDragIndex === index) return;

    const newOrder = [...unifiedPartners];
    const draggedItem = newOrder[descDragIndex];
    newOrder.splice(descDragIndex, 1);
    newOrder.splice(index, 0, draggedItem);

    setUnifiedPartners(newOrder);
    setDescDragIndex(index);
  };

  const handleDescDragEnd = async () => {
    setDescDragIndex(null);
    setIsSavingOrder(true);

    try {
      // Check if any underboss-only partners need Sponsor records created
      const underbossOnly = unifiedPartners.filter(
        p => p.source === 'underboss' && !p.sponsorId && p.sponsorUserId
      );

      let sponsorIdMap: Record<string, string> = {};

      if (underbossOnly.length > 0) {
        const result = await ensureUnderbossSponsors(
          partyId,
          underbossOnly.map(p => p.sponsorUserId!)
        );

        // Map sponsorUserIds to newly created sponsor IDs
        underbossOnly.forEach((p, i) => {
          if (result.createdSponsorIds[i]) {
            sponsorIdMap[p.id] = result.createdSponsorIds[i];
          }
        });
      }

      // Build the final sponsor IDs list for reorder
      const sponsorIds = unifiedPartners.map(p => {
        if (p.sponsorId) return p.sponsorId;
        // Use the newly created sponsor ID
        return sponsorIdMap[p.id] || p.id;
      });

      await reorderSponsors(partyId, sponsorIds);

      // Reload data to get fresh state
      await loadData();
    } catch (err) {
      console.error('Failed to save sponsor description order:', err);
      await loadData();
    } finally {
      setIsSavingOrder(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="card p-8 bg-theme-header border-theme-stroke">
          <div className="flex items-center justify-center">
            <RefreshCw className="w-6 h-6 animate-spin text-theme-text-muted" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="card p-6 bg-theme-header border-theme-stroke">
          <div className="text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={() => loadData()}
              className="btn-secondary"
            >
              {t('sponsors.tryAgain')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-theme-text">{t('sponsors.partners')}</h2>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-3 py-2 bg-[#ff393a] hover:bg-[#ff393a]/80 text-white rounded-lg transition-colors"
        >
          <Plus size={18} />
          {t('sponsors.addPartner')}
        </button>
      </div>

      {/* Pipeline Overview */}
      <SponsorPipeline
        stats={stats}
        onUpdateGoal={handleUpdateGoal}
        isLoading={isRefreshing}
      />

      {/* Sponsor List */}
      <SponsorList
        sponsors={sponsors}
        partyId={partyId}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onSponsorUpdate={(updated) => setSponsors(prev => prev.map(s => s.id === updated.id ? updated : s))}
        onStatusChange={handleStatusChange}
        isLoading={isRefreshing}
        avatarUrls={sponsorAvatarUrls}
        isPrivileged={isPrivileged}
      />

      {/* Brand Description Order (Unified) */}
      {unifiedPartners.length > 1 && (
        <div className="card bg-theme-header border-theme-stroke p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={16} className="text-theme-text-muted" />
            <h3 className="text-sm font-semibold text-theme-text">{t('sponsors.brandDescriptionOrder')}</h3>
            <span className="text-xs text-theme-text-faint">{t('sponsors.dragToReorder')}</span>
            {isSavingOrder && (
              <RefreshCw size={12} className="animate-spin text-theme-text-muted ml-auto" />
            )}
          </div>
          <div className="space-y-1.5">
            {unifiedPartners.map((partner, index) => (
              <div
                key={partner.id}
                draggable
                onDragStart={() => handleDescDragStart(index)}
                onDragOver={(e) => handleDescDragOver(e, index)}
                onDragEnd={handleDescDragEnd}
                className={`flex items-center gap-2 p-2 rounded-lg bg-theme-surface border border-theme-stroke cursor-move transition-opacity ${
                  descDragIndex === index ? 'opacity-50' : 'opacity-100'
                }`}
              >
                <div className="cursor-grab active:cursor-grabbing text-white/30 hover:text-white/60 shrink-0">
                  <GripVertical size={16} />
                </div>
                {(partner.avatarUrl || partner.logoUrl) && (
                  <img src={partner.avatarUrl || partner.logoUrl!} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                )}
                <span className="text-sm text-theme-text font-medium truncate">{partner.name}</span>
                {partner.source === 'underboss' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-purple-500/20 text-purple-400 border-purple-500/30 shrink-0 flex items-center gap-1">
                    <Globe size={10} />
                    {t('sponsors.global')}
                  </span>
                )}
                <span className="text-xs text-theme-text-faint truncate ml-auto max-w-[50%]">
                  {partner.brandDescription?.substring(0, 60)}...
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Partner Flyer Generator (GPP only) */}
      {party?.eventType === 'gpp' && (() => {
        const flyerSponsors = sponsors.filter(
          s => (s.status === 'yes' || s.status === 'paid' || s.status === 'billed') && s.logoUrl
        );
        const cityName = party.name?.replace(/^Global Pizza Party\s*/i, '').trim() || '';
        return flyerSponsors.length > 0 ? (
          <PartnerFlyerGenerator sponsors={flyerSponsors} cityName={cityName} />
        ) : null;
      })()}

      {/* Form Modal */}
      {showForm && (
        <PartnerForm
          sponsor={editingSponsor}
          partyId={partyId}
          onSponsorUpdate={(updated) => setSponsors(prev => prev.map(s => s.id === updated.id ? updated : s))}
          onSubmit={handleFormSubmit}
          onClose={handleCloseForm}
          isLoading={isSubmitting}
          onAddAsCoHost={onAddAsCoHost}
        />
      )}
    </div>
  );
}
