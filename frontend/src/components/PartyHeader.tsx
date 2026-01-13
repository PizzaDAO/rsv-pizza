import React, { useState } from 'react';
import { usePizza } from '../contexts/PizzaContext';
import { PartyPopper, Link2, Copy, Check, X, Calendar, User, Loader2, Users, MapPin } from 'lucide-react';

export const PartyHeader: React.FC = () => {
  const { party, createParty, clearParty, getInviteLink, getHostLink } = usePizza();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState<'guest' | 'host' | null>(null);

  // Form state
  const [partyName, setPartyName] = useState('');
  const [hostName, setHostName] = useState('');
  const [partyDate, setPartyDate] = useState('');
  const [partyDuration, setPartyDuration] = useState('');
  const [expectedGuests, setExpectedGuests] = useState('');
  const [partyAddress, setPartyAddress] = useState('');

  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyName.trim()) return;
    setCreating(true);
    const guestCount = expectedGuests ? parseInt(expectedGuests, 10) : undefined;
    const duration = partyDuration ? parseFloat(partyDuration) : undefined;
    await createParty(partyName.trim(), hostName.trim() || undefined, partyDate || undefined, guestCount, partyAddress.trim() || undefined, [], duration);
    setCreating(false);
    setShowCreateModal(false);
    setShowShareModal(true);
    // Reset form
    setPartyName('');
    setHostName('');
    setPartyDate('');
    setPartyDuration('');
    setExpectedGuests('');
    setPartyAddress('');
  };

  const handleCopyLink = (type: 'guest' | 'host') => {
    const link = type === 'guest' ? getInviteLink() : getHostLink();
    navigator.clipboard.writeText(link).then(() => {
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const inviteLink = getInviteLink();
  const hostLink = getHostLink();

  return (
    <>
      {/* Party Status Bar */}
      <div className="card p-4 mb-6">
        {party ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#ff393a]/20 flex items-center justify-center">
                <PartyPopper className="w-5 h-5 text-[#ff393a]" />
              </div>
              <div>
                <h3 className="font-semibold text-white">{party.name}</h3>
                <p className="text-sm text-white/50">
                  {party.hostName && `Hosted by ${party.hostName} • `}
                  {party.maxGuests ? (
                    <span>
                      {party.guests.length} of {party.maxGuests} guests responded
                    </span>
                  ) : (
                    <span>{party.guests.length} guest{party.guests.length !== 1 ? 's' : ''}</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowShareModal(true)}
                className="btn-primary flex items-center gap-2"
              >
                <Link2 size={18} />
                Share Invite Link
              </button>
              <button
                onClick={clearParty}
                className="btn-secondary px-3"
                title="Start new party"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                <PartyPopper className="w-5 h-5 text-white/50" />
              </div>
              <div>
                <h3 className="font-semibold text-white/80">No Party Created</h3>
                <p className="text-sm text-white/50">
                  Create a party to generate a shareable invite link for guests
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary flex items-center gap-2"
            >
              <PartyPopper size={18} />
              Create Party
            </button>
          </div>
        )}
      </div>

      {/* Create Party Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Create Pizza Party</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-white/50 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  Party Name *
                </label>
                <input
                  type="text"
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  placeholder="e.g., Friday Night Pizza"
                  className="w-full"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  <User size={14} className="inline mr-1" />
                  Your Name (Host)
                </label>
                <input
                  type="text"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="e.g., John"
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  <Calendar size={14} className="inline mr-1" />
                  Party Date
                </label>
                <input
                  type="date"
                  value={partyDate}
                  onChange={(e) => setPartyDate(e.target.value)}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  <Calendar size={14} className="inline mr-1" />
                  Party Duration (hours)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="12"
                  value={partyDuration}
                  onChange={(e) => setPartyDuration(e.target.value)}
                  placeholder="e.g., 2.5"
                  className="w-full"
                />
                <p className="text-xs text-white/50 mt-1">
                  Duration in decimal hours (0.5 = 30 min, 2.5 = 2½ hours). For multi-wave ordering.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  <Users size={14} className="inline mr-1" />
                  Expected Guests *
                </label>
                <input
                  type="number"
                  min="1"
                  value={expectedGuests}
                  onChange={(e) => setExpectedGuests(e.target.value)}
                  placeholder="e.g., 12"
                  className="w-full"
                  required
                />
                <p className="text-xs text-white/50 mt-1">
                  Total people attending (we'll calculate extra pizza for those who don't RSVP)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                  <MapPin size={14} className="inline mr-1" />
                  Party Address
                </label>
                <input
                  type="text"
                  value={partyAddress}
                  onChange={(e) => setPartyAddress(e.target.value)}
                  placeholder="e.g., 123 Main St, New York, NY"
                  className="w-full"
                />
                <p className="text-xs text-white/50 mt-1">
                  Used to find nearby pizzerias for ordering
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn-secondary flex-1"
                  disabled={creating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                  disabled={creating}
                >
                  {creating ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Party'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share Link Modal */}
      {showShareModal && party && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Share Invite Link</h2>
              <button
                onClick={() => setShowShareModal(false)}
                className="text-white/50 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4 mb-6">
              {/* Guest Link */}
              <div>
                <p className="text-white/60 mb-2 text-sm font-medium">
                  Guest RSVP Link (share with guests):
                </p>
                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 overflow-hidden">
                      <code className="text-sm text-[#ff393a] break-all">{inviteLink}</code>
                    </div>
                    <button
                      onClick={() => handleCopyLink('guest')}
                      className={`flex-shrink-0 p-2 rounded-lg transition-all ${
                        copied === 'guest'
                          ? 'bg-[#39d98a] text-white'
                          : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      {copied === 'guest' ? <Check size={20} /> : <Copy size={20} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Host Link */}
              <div>
                <p className="text-white/60 mb-2 text-sm font-medium">
                  Host Dashboard Link (bookmark this):
                </p>
                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 overflow-hidden">
                      <code className="text-sm text-[#39d98a] break-all">{hostLink}</code>
                    </div>
                    <button
                      onClick={() => handleCopyLink('host')}
                      className={`flex-shrink-0 p-2 rounded-lg transition-all ${
                        copied === 'host'
                          ? 'bg-[#39d98a] text-white'
                          : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      {copied === 'host' ? <Check size={20} /> : <Copy size={20} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#ffb347]/10 border border-[#ffb347]/30 rounded-xl p-4 mb-6">
              <p className="text-sm text-[#ffb347]">
                Share the <strong>Guest RSVP Link</strong> with your guests. Bookmark the <strong>Host Dashboard Link</strong> to access your party from any device.
              </p>
            </div>

            <button
              onClick={() => setShowShareModal(false)}
              className="btn-primary w-full"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
};
