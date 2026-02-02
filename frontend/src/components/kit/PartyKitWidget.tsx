import React, { useState, useEffect } from 'react';
import { Package, Gift, Loader2, AlertCircle } from 'lucide-react';
import { PartyKit } from '../../types';
import { getPartyKit, submitKitRequest, updateKitRequest, cancelKitRequest, KitRequestData } from '../../lib/api';
import { KitStatusCard } from './KitStatusCard';
import { KitRequestForm } from './KitRequestForm';

interface PartyKitWidgetProps {
  partyId: string;
}

export const PartyKitWidget: React.FC<PartyKitWidgetProps> = ({ partyId }) => {
  const [loading, setLoading] = useState(true);
  const [kit, setKit] = useState<PartyKit | null>(null);
  const [kitDeadline, setKitDeadline] = useState<string | null>(null);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);

  const loadKit = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getPartyKit(partyId);
      if (response) {
        setKit(response.kit);
        setKitDeadline(response.kitDeadline);
      }
    } catch (err) {
      console.error('Error loading kit:', err);
      setError('Failed to load kit status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKit();
  }, [partyId]);

  const handleSubmitRequest = async (data: KitRequestData) => {
    if (isEditing && kit) {
      const response = await updateKitRequest(partyId, data);
      if (response) {
        setKit(response.kit);
        setIsEditing(false);
      }
    } else {
      const response = await submitKitRequest(partyId, data);
      if (response) {
        setKit(response.kit);
      }
    }
  };

  const handleCancelRequest = async () => {
    if (!confirm('Are you sure you want to cancel your kit request?')) return;

    setCanceling(true);
    try {
      const success = await cancelKitRequest(partyId);
      if (success) {
        setKit(null);
      }
    } catch (err) {
      setError('Failed to cancel request');
    } finally {
      setCanceling(false);
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
    setShowRequestForm(true);
  };

  if (loading) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        <div className="flex items-center justify-center gap-2 text-white/60">
          <Loader2 size={20} className="animate-spin" />
          <span>Loading kit status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        <div className="flex items-center justify-center gap-2 text-red-400">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  // If kit exists, show status card
  if (kit) {
    return (
      <>
        <KitStatusCard
          kit={kit}
          onEdit={kit.status === 'pending' ? handleEdit : undefined}
          onCancel={kit.status === 'pending' ? handleCancelRequest : undefined}
        />
        <KitRequestForm
          isOpen={showRequestForm}
          onClose={() => {
            setShowRequestForm(false);
            setIsEditing(false);
          }}
          onSubmit={handleSubmitRequest}
          existingKit={isEditing ? kit : null}
          kitDeadline={kitDeadline}
        />
      </>
    );
  }

  // No kit request - show request button
  const isDeadlinePassed = kitDeadline && new Date(kitDeadline) < new Date();

  return (
    <>
      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-lg">
              <Package size={20} className="text-white/60" />
            </div>
            <span className="font-medium text-white">Party Kit</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="flex items-start gap-4">
            <div className="hidden sm:block p-3 bg-[#ff393a]/10 rounded-xl">
              <Gift size={32} className="text-[#ff393a]" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-white mb-1">
                Get Your Free Party Kit
              </h3>
              <p className="text-sm text-white/60 mb-4">
                Request a party kit with stickers, tablecloths, flyers, and more to make your pizza party amazing!
              </p>

              {kitDeadline && (
                <p className={`text-xs mb-3 ${isDeadlinePassed ? 'text-red-400' : 'text-white/50'}`}>
                  {isDeadlinePassed
                    ? 'Deadline has passed'
                    : `Request by ${new Date(kitDeadline).toLocaleDateString()}`
                  }
                </p>
              )}

              <button
                onClick={() => setShowRequestForm(true)}
                disabled={isDeadlinePassed}
                className="bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm flex items-center gap-2"
              >
                <Gift size={16} />
                Request Kit
              </button>
            </div>
          </div>
        </div>
      </div>

      <KitRequestForm
        isOpen={showRequestForm}
        onClose={() => setShowRequestForm(false)}
        onSubmit={handleSubmitRequest}
        kitDeadline={kitDeadline}
      />
    </>
  );
};
