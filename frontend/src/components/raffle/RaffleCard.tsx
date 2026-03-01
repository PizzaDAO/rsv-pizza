import React from 'react';
import { Gift, Trash2, Edit2, Play, Trophy, CheckCircle, Circle, Plus, Users, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Raffle, RafflePrize, RaffleStatus } from '../../types';

interface RaffleCardProps {
  raffle: Raffle;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: RaffleStatus) => void;
  onAddPrize: () => void;
  onEditPrize: (prize: RafflePrize) => void;
  onDeletePrize: (prizeId: string) => void;
  onDraw: () => void;
  onToggleClaimed: (winnerId: string, currentlyClaimed: boolean) => void;
  isLoading?: boolean;
}

const statusColors: Record<RaffleStatus, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Draft' },
  open: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Open' },
  closed: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Closed' },
  drawn: { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'Drawn' },
};

export function RaffleCard({
  raffle,
  onEdit,
  onDelete,
  onStatusChange,
  onAddPrize,
  onEditPrize,
  onDeletePrize,
  onDraw,
  onToggleClaimed,
  isLoading,
}: RaffleCardProps) {
  const [expanded, setExpanded] = React.useState(true);
  const statusConfig = statusColors[raffle.status as RaffleStatus] || statusColors.draft;
  const entryCount = raffle._count?.entries ?? raffle.entries.length;
  const totalPrizes = raffle.prizes.reduce((sum, p) => sum + p.quantity, 0);

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 hover:bg-white/10 rounded transition-colors"
          >
            {expanded ? <ChevronUp size={18} className="text-white/60" /> : <ChevronDown size={18} className="text-white/60" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white truncate">{raffle.name}</h3>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusConfig.bg} ${statusConfig.text}`}>
                {statusConfig.label}
              </span>
            </div>
            {raffle.description && (
              <p className="text-sm text-white/60 truncate mt-0.5">{raffle.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4">
          {/* Stats */}
          <div className="flex items-center gap-3 mr-2 text-sm text-white/60">
            <span className="flex items-center gap-1">
              <Users size={14} />
              {entryCount}
            </span>
            <span className="flex items-center gap-1">
              <Gift size={14} />
              {totalPrizes}
            </span>
          </div>

          {/* Actions */}
          {raffle.status !== 'drawn' && (
            <>
              <button
                onClick={onEdit}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white"
                title="Edit raffle"
              >
                <Edit2 size={16} />
              </button>
              <button
                onClick={onDelete}
                className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-white/60 hover:text-red-400"
                title="Delete raffle"
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-white/10 p-4 space-y-4">
          {/* Status Controls */}
          {raffle.status !== 'drawn' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-white/60 mr-2">Status:</span>
              {(['draft', 'open', 'closed'] as RaffleStatus[]).map((status) => (
                <button
                  key={status}
                  onClick={() => onStatusChange(status)}
                  disabled={isLoading}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    raffle.status === status
                      ? `${statusColors[status].bg} ${statusColors[status].text} border border-current`
                      : 'bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  {statusColors[status].label}
                </button>
              ))}

              {/* Draw Button */}
              {raffle.status === 'closed' && raffle.entries.length > 0 && raffle.prizes.length > 0 && (
                <button
                  onClick={onDraw}
                  disabled={isLoading}
                  className="ml-auto flex items-center gap-2 px-4 py-1.5 bg-purple-500/20 text-purple-400 rounded-lg hover:bg-purple-500/30 transition-colors font-medium"
                >
                  {isLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Play size={16} />
                  )}
                  Draw Winners
                </button>
              )}
            </div>
          )}

          {/* Prizes Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-white/80">Prizes</h4>
              {raffle.status !== 'drawn' && (
                <button
                  onClick={onAddPrize}
                  className="text-xs text-[#ff393a] hover:text-[#ff5a5b] flex items-center gap-1"
                >
                  <Plus size={14} />
                  Add Prize
                </button>
              )}
            </div>

            {raffle.prizes.length === 0 ? (
              <p className="text-sm text-white/40 italic">No prizes added yet</p>
            ) : (
              <div className="space-y-2">
                {raffle.prizes.map((prize) => (
                  <div
                    key={prize.id}
                    className="flex items-center gap-3 p-3 bg-white/5 rounded-lg"
                  >
                    {prize.imageUrl ? (
                      <img
                        src={prize.imageUrl}
                        alt={prize.name}
                        className="w-12 h-12 object-cover rounded-lg"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-[#ff393a]/20 rounded-lg flex items-center justify-center">
                        <Gift className="w-6 h-6 text-[#ff393a]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white truncate">{prize.name}</p>
                      {prize.description && (
                        <p className="text-xs text-white/60 truncate">{prize.description}</p>
                      )}
                    </div>
                    <span className="text-sm text-white/60 px-2 py-1 bg-white/10 rounded">
                      x{prize.quantity}
                    </span>
                    {raffle.status !== 'drawn' && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onEditPrize(prize)}
                          className="p-1.5 hover:bg-white/10 rounded transition-colors text-white/60 hover:text-white"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => onDeletePrize(prize.id)}
                          className="p-1.5 hover:bg-red-500/20 rounded transition-colors text-white/60 hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Entries Section (only when open or has entries) */}
          {(raffle.status === 'open' || raffle.entries.length > 0) && raffle.status !== 'drawn' && (
            <div>
              <h4 className="text-sm font-medium text-white/80 mb-2">
                Entries ({entryCount})
              </h4>
              {raffle.entries.length === 0 ? (
                <p className="text-sm text-white/40 italic">No entries yet</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {raffle.entries.map((entry) => (
                    <span
                      key={entry.id}
                      className="px-3 py-1 bg-white/10 rounded-full text-sm text-white/80"
                    >
                      {entry.guest?.name || 'Guest'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Winners Section */}
          {raffle.status === 'drawn' && raffle.winners.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-white/80 mb-2 flex items-center gap-2">
                <Trophy size={16} className="text-yellow-500" />
                Winners
              </h4>
              <div className="space-y-2">
                {raffle.winners.map((winner) => (
                  <div
                    key={winner.id}
                    className="flex items-center gap-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg"
                  >
                    <button
                      onClick={() => onToggleClaimed(winner.id, !!winner.claimedAt)}
                      className={`p-1 rounded transition-colors ${
                        winner.claimedAt
                          ? 'text-green-400 hover:text-green-300'
                          : 'text-white/40 hover:text-white/60'
                      }`}
                      title={winner.claimedAt ? 'Mark as unclaimed' : 'Mark as claimed'}
                    >
                      {winner.claimedAt ? (
                        <CheckCircle size={20} />
                      ) : (
                        <Circle size={20} />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white">{winner.guest?.name || 'Guest'}</p>
                      <p className="text-xs text-white/60">Won: {winner.prize?.name || 'Prize'}</p>
                    </div>
                    {winner.claimedAt && (
                      <span className="text-xs text-green-400 bg-green-500/20 px-2 py-1 rounded">
                        Claimed
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
