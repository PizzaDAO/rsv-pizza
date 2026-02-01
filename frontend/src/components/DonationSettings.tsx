import React, { useState, useEffect } from 'react';
import { DollarSign, Target, MessageSquare, User, Plus, X, Loader2 } from 'lucide-react';
import { usePizza } from '../contexts/PizzaContext';
import { updateParty } from '../lib/supabase';
import { Checkbox } from './Checkbox';
import { IconInput } from './IconInput';

export const DonationSettings: React.FC = () => {
  const { party, loadParty } = usePizza();

  const [donationEnabled, setDonationEnabled] = useState(false);
  const [donationGoal, setDonationGoal] = useState('');
  const [donationMessage, setDonationMessage] = useState('');
  const [donationRecipient, setDonationRecipient] = useState('');
  const [suggestedAmounts, setSuggestedAmounts] = useState<number[]>([500, 1000, 2500, 5000]);
  const [newAmount, setNewAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);

  // Load party data
  useEffect(() => {
    if (party) {
      setDonationEnabled(party.donationEnabled || false);
      setDonationGoal(party.donationGoal ? String(party.donationGoal) : '');
      setDonationMessage(party.donationMessage || '');
      setDonationRecipient(party.donationRecipient || '');
      setSuggestedAmounts(party.suggestedAmounts || [500, 1000, 2500, 5000]);
    }
  }, [party]);

  const saveField = async (fieldName: string, updates: Record<string, any>) => {
    if (!party) return false;

    setSavingField(fieldName);

    try {
      const success = await updateParty(party.id, updates);
      if (success && party.inviteCode) {
        await loadParty(party.inviteCode);
      }
      return success;
    } catch (error) {
      console.error(`Error saving ${fieldName}:`, error);
      return false;
    } finally {
      setSavingField(null);
    }
  };

  const handleToggleDonations = async () => {
    const newValue = !donationEnabled;
    setDonationEnabled(newValue);
    await saveField('donationEnabled', { donation_enabled: newValue });
  };

  const handleGoalBlur = async () => {
    const goalValue = donationGoal ? parseFloat(donationGoal) : null;
    await saveField('donationGoal', { donation_goal: goalValue });
  };

  const handleMessageBlur = async () => {
    await saveField('donationMessage', { donation_message: donationMessage || null });
  };

  const handleRecipientBlur = async () => {
    await saveField('donationRecipient', { donation_recipient: donationRecipient || null });
  };

  const addSuggestedAmount = async () => {
    const amount = parseFloat(newAmount);
    if (isNaN(amount) || amount <= 0) return;

    const amountInCents = Math.round(amount * 100);
    if (suggestedAmounts.includes(amountInCents)) {
      setNewAmount('');
      return;
    }

    const newAmounts = [...suggestedAmounts, amountInCents].sort((a, b) => a - b);
    setSuggestedAmounts(newAmounts);
    setNewAmount('');
    await saveField('suggestedAmounts', { suggested_amounts: newAmounts });
  };

  const removeSuggestedAmount = async (amount: number) => {
    const newAmounts = suggestedAmounts.filter(a => a !== amount);
    setSuggestedAmounts(newAmounts);
    await saveField('suggestedAmounts', { suggested_amounts: newAmounts });
  };

  const formatAmount = (cents: number) => {
    return `$${(cents / 100).toFixed(0)}`;
  };

  if (!party) return null;

  return (
    <div className="space-y-4">
      {/* Enable Donations Toggle */}
      <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10">
        <div className="flex items-center gap-3">
          <DollarSign size={20} className="text-[#ff393a]" />
          <div>
            <p className="text-white font-medium">Accept Donations</p>
            <p className="text-white/50 text-sm">Allow guests to contribute to your event</p>
          </div>
        </div>
        <Checkbox
          checked={donationEnabled}
          onChange={handleToggleDonations}
          label=""
        />
      </div>

      {/* Donation Settings (only show when enabled) */}
      {donationEnabled && (
        <div className="space-y-3 border-l-2 border-[#ff393a]/30 pl-4 ml-2">
          {/* Recipient Name */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Recipient Name (optional)
            </label>
            <IconInput
              icon={User}
              type="text"
              value={donationRecipient}
              onChange={(e) => setDonationRecipient(e.target.value)}
              onBlur={handleRecipientBlur}
              placeholder="Who are donations going to?"
            />
            <p className="text-xs text-white/40 mt-1">Leave blank to use your name</p>
          </div>

          {/* Donation Goal */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Goal Amount (optional)
            </label>
            <IconInput
              icon={Target}
              type="number"
              min={0}
              step={1}
              value={donationGoal}
              onChange={(e) => setDonationGoal(e.target.value)}
              onBlur={handleGoalBlur}
              placeholder="e.g., 500"
            />
            <p className="text-xs text-white/40 mt-1">Set a fundraising goal in dollars</p>
          </div>

          {/* Custom Message */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Message to Donors (optional)
            </label>
            <div className="relative">
              <MessageSquare size={18} className="absolute left-3 top-3 text-white/40" />
              <textarea
                value={donationMessage}
                onChange={(e) => setDonationMessage(e.target.value)}
                onBlur={handleMessageBlur}
                placeholder="Thank you for supporting our event!"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 pl-10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a] min-h-[80px] resize-y"
              />
            </div>
          </div>

          {/* Suggested Amounts */}
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Suggested Amounts
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {suggestedAmounts.map((amount) => (
                <div
                  key={amount}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[#ff393a]/20 border border-[#ff393a]/30 rounded-lg"
                >
                  <span className="text-white text-sm font-medium">{formatAmount(amount)}</span>
                  <button
                    type="button"
                    onClick={() => removeSuggestedAmount(amount)}
                    className="text-white/50 hover:text-white ml-1"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addSuggestedAmount()}
                  placeholder="Add amount"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 pl-8 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#ff393a] focus:border-[#ff393a]"
                />
              </div>
              <button
                type="button"
                onClick={addSuggestedAmount}
                disabled={!newAmount}
                className="px-3 py-2 bg-[#ff393a] hover:bg-[#ff5a5b] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
