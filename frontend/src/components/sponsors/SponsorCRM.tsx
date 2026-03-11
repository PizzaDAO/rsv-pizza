import React, { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Sponsor, SponsorStats } from '../../types';
import {
  getSponsors,
  getSponsorStats,
  createSponsor,
  updateSponsor,
  deleteSponsor,
  updateFundraisingGoal,
  CreateSponsorData,
} from '../../lib/api';
import { SponsorPipeline } from './SponsorPipeline';
import { SponsorList } from './SponsorList';
import { SponsorForm } from './SponsorForm';

interface SponsorCRMProps {
  partyId: string;
}

export function SponsorCRM({ partyId }: SponsorCRMProps) {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [stats, setStats] = useState<SponsorStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingSponsor, setEditingSponsor] = useState<Sponsor | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle form submission
  const handleFormSubmit = async (data: CreateSponsorData) => {
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

      // Refresh stats
      const statsResult = await getSponsorStats(partyId);
      if (statsResult) setStats(statsResult);

      // Close form
      setShowForm(false);
      setEditingSponsor(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle sponsor deletion
  const handleDelete = async (sponsorId: string) => {
    const success = await deleteSponsor(partyId, sponsorId);
    if (success) {
      setSponsors(prev => prev.filter(s => s.id !== sponsorId));
      // Refresh stats
      const statsResult = await getSponsorStats(partyId);
      if (statsResult) setStats(statsResult);
    }
  };

  // Handle editing
  const handleEdit = (sponsor: Sponsor) => {
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
              Try Again
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
        <h2 className="text-lg font-semibold text-theme-text">Sponsor CRM</h2>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-3 py-2 bg-[#ff393a] hover:bg-[#ff393a]/80 text-white rounded-lg transition-colors"
        >
          <Plus size={18} />
          Add Sponsor
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
        onEdit={handleEdit}
        onDelete={handleDelete}
        isLoading={isRefreshing}
      />

      {/* Form Modal */}
      {showForm && (
        <SponsorForm
          sponsor={editingSponsor}
          onSubmit={handleFormSubmit}
          onClose={handleCloseForm}
          isLoading={isSubmitting}
        />
      )}
    </div>
  );
}
