import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Gift, Loader2, Trash2, Edit2, Play, Trophy, CheckCircle, X } from 'lucide-react';
import { Raffle, RafflePrize } from '../../types';
import {
  getRaffles,
  createRaffle,
  updateRaffle,
  deleteRaffle,
  addRafflePrize,
  updateRafflePrize,
  deleteRafflePrize,
  drawRaffleWinners,
  claimRafflePrize,
  unclaimRafflePrize,
} from '../../lib/api';
import { RaffleForm } from './RaffleForm';
import { PrizeForm } from './PrizeForm';
import { RaffleCard } from './RaffleCard';
import { WinnerPicker } from './WinnerPicker';

interface RaffleWidgetProps {
  partyId: string;
}

export function RaffleWidget({ partyId }: RaffleWidgetProps) {
  const { t } = useTranslation('host');
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [showRaffleForm, setShowRaffleForm] = useState(false);
  const [editingRaffle, setEditingRaffle] = useState<Raffle | null>(null);
  const [showPrizeForm, setShowPrizeForm] = useState(false);
  const [prizeFormRaffleId, setPrizeFormRaffleId] = useState<string | null>(null);
  const [editingPrize, setEditingPrize] = useState<RafflePrize | null>(null);

  // Action loading states
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadRaffles = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getRaffles(partyId);
    if (result) {
      setRaffles(result.raffles);
    } else {
      setRaffles([]);
    }
    setLoading(false);
  }, [partyId]);

  useEffect(() => {
    loadRaffles();
  }, [loadRaffles]);

  const handleCreateRaffle = async (data: { name: string; description?: string; entriesPerGuest?: number }) => {
    setActionLoading('create');
    setError(null);
    const result = await createRaffle(partyId, data);
    if (result) {
      await loadRaffles();
      setShowRaffleForm(false);
    } else {
      setError(t('raffle.failedToCreate'));
    }
    setActionLoading(null);
  };

  const handleUpdateRaffle = async (raffleId: string, data: { name?: string; description?: string; status?: string }) => {
    setActionLoading(raffleId);
    const result = await updateRaffle(partyId, raffleId, data);
    if (result) {
      await loadRaffles();
      setEditingRaffle(null);
    }
    setActionLoading(null);
  };

  const handleDeleteRaffle = async (raffleId: string) => {
    if (!confirm(t('raffle.deleteConfirm'))) return;
    setActionLoading(raffleId);
    const success = await deleteRaffle(partyId, raffleId);
    if (success) {
      await loadRaffles();
    }
    setActionLoading(null);
  };

  const handleAddPrize = async (raffleId: string, data: { name: string; description?: string; imageUrl?: string; quantity?: number }) => {
    setActionLoading('prize');
    const result = await addRafflePrize(partyId, raffleId, data);
    if (result) {
      await loadRaffles();
      setShowPrizeForm(false);
      setPrizeFormRaffleId(null);
    }
    setActionLoading(null);
  };

  const handleUpdatePrize = async (raffleId: string, prizeId: string, data: { name?: string; description?: string; imageUrl?: string; quantity?: number }) => {
    setActionLoading(prizeId);
    const result = await updateRafflePrize(partyId, raffleId, prizeId, data);
    if (result) {
      await loadRaffles();
      setEditingPrize(null);
      setPrizeFormRaffleId(null);
    }
    setActionLoading(null);
  };

  const handleDeletePrize = async (raffleId: string, prizeId: string) => {
    if (!confirm(t('raffle.deletePrizeConfirm'))) return;
    setActionLoading(prizeId);
    const success = await deleteRafflePrize(partyId, raffleId, prizeId);
    if (success) {
      await loadRaffles();
    }
    setActionLoading(null);
  };

  const handleDrawWinners = async (raffleId: string) => {
    if (!confirm(t('raffle.drawConfirm'))) return;
    setActionLoading(raffleId);
    try {
      const result = await drawRaffleWinners(partyId, raffleId);
      if (result) {
        await loadRaffles();
      }
    } catch (err: any) {
      alert(err.message || 'Failed to draw winners');
    }
    setActionLoading(null);
  };

  const handleToggleClaimed = async (raffleId: string, winnerId: string, currentlyClaimed: boolean) => {
    setActionLoading(winnerId);
    if (currentlyClaimed) {
      await unclaimRafflePrize(partyId, raffleId, winnerId);
    } else {
      await claimRafflePrize(partyId, raffleId, winnerId);
    }
    await loadRaffles();
    setActionLoading(null);
  };

  const openPrizeForm = (raffleId: string, prize?: RafflePrize) => {
    setPrizeFormRaffleId(raffleId);
    setEditingPrize(prize || null);
    setShowPrizeForm(true);
  };

  if (loading) {
    return (
      <div className="card p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-[#ff393a]" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Random Winner Picker */}
      <WinnerPicker />

      {/* Header */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#ff393a]/20 rounded-full flex items-center justify-center">
              <Gift className="w-5 h-5 text-[#ff393a]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-theme-text">{t('raffle.raffles')}</h2>
              <p className="text-sm text-theme-text-secondary">{t('raffle.rafflesDesc')}</p>
            </div>
          </div>
          <button
            onClick={() => setShowRaffleForm(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={18} />
            {t('raffle.newRaffle')}
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        {raffles.length === 0 ? (
          <div className="text-center py-8 text-theme-text-muted">
            <Gift className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{t('raffle.noRafflesYet')}</p>
            <p className="text-sm mt-1">{t('raffle.noRafflesDesc')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {raffles.map((raffle) => (
              <RaffleCard
                key={raffle.id}
                raffle={raffle}
                onEdit={() => setEditingRaffle(raffle)}
                onDelete={() => handleDeleteRaffle(raffle.id)}
                onStatusChange={(status) => handleUpdateRaffle(raffle.id, { status })}
                onAddPrize={() => openPrizeForm(raffle.id)}
                onEditPrize={(prize) => openPrizeForm(raffle.id, prize)}
                onDeletePrize={(prizeId) => handleDeletePrize(raffle.id, prizeId)}
                onDraw={() => handleDrawWinners(raffle.id)}
                onToggleClaimed={(winnerId, claimed) => handleToggleClaimed(raffle.id, winnerId, claimed)}
                isLoading={actionLoading === raffle.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Raffle Modal */}
      {(showRaffleForm || editingRaffle) && (
        <RaffleForm
          raffle={editingRaffle}
          onSubmit={(data) => {
            if (editingRaffle) {
              handleUpdateRaffle(editingRaffle.id, data);
            } else {
              handleCreateRaffle(data);
            }
          }}
          onClose={() => {
            setShowRaffleForm(false);
            setEditingRaffle(null);
          }}
          isLoading={actionLoading === 'create' || actionLoading === editingRaffle?.id}
        />
      )}

      {/* Add/Edit Prize Modal */}
      {showPrizeForm && prizeFormRaffleId && (
        <PrizeForm
          prize={editingPrize}
          onSubmit={(data) => {
            if (editingPrize) {
              handleUpdatePrize(prizeFormRaffleId, editingPrize.id, data);
            } else {
              handleAddPrize(prizeFormRaffleId, data);
            }
          }}
          onClose={() => {
            setShowPrizeForm(false);
            setPrizeFormRaffleId(null);
            setEditingPrize(null);
          }}
          isLoading={actionLoading === 'prize' || actionLoading === editingPrize?.id}
        />
      )}
    </div>
  );
}
