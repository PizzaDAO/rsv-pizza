import React, { useState, useMemo } from 'react';
import { CallRecordingPlayer } from './CallRecordingPlayer';
import { Phone, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';

interface AiCallRecord {
  callId: string;
  pizzeriaName: string;
  customerName: string;
  timestamp: string;
}

interface AiCallHistoryProps {
  partyId: string;
}

export const AiCallHistory: React.FC<AiCallHistoryProps> = ({ partyId }) => {
  const storageKey = `ai-calls-${partyId}`;
  const [calls, setCalls] = useState<AiCallRecord[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch {
      return [];
    }
  });
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  const sortedCalls = useMemo(
    () => [...calls].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [calls]
  );

  const handleRemoveCall = (callId: string) => {
    const updated = calls.filter(c => c.callId !== callId);
    setCalls(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
    if (expandedCallId === callId) setExpandedCallId(null);
  };

  if (sortedCalls.length === 0) return null;

  return (
    <div className="card p-6">
      <h2 className="text-lg font-bold text-theme-text mb-4 flex items-center gap-2">
        <Phone size={20} className="text-[#8b5cf6]" />
        AI Call History
      </h2>

      <div className="space-y-3">
        {sortedCalls.map((call) => {
          const isExpanded = expandedCallId === call.callId;
          const date = new Date(call.timestamp);
          const timeStr = date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });

          return (
            <div
              key={call.callId}
              className="bg-theme-surface border border-theme-stroke rounded-xl overflow-hidden"
            >
              <button
                onClick={() => setExpandedCallId(isExpanded ? null : call.callId)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-theme-surface transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-theme-text font-medium text-sm truncate">{call.pizzeriaName}</p>
                  <p className="text-theme-text-muted text-xs mt-0.5">
                    {timeStr} &middot; Ordered by {call.customerName}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveCall(call.callId);
                    }}
                    className="p-1 text-theme-text-faint hover:text-[#ff393a] transition-colors"
                    title="Remove from history"
                  >
                    <Trash2 size={14} />
                  </button>
                  {isExpanded ? (
                    <ChevronUp size={16} className="text-theme-text-muted" />
                  ) : (
                    <ChevronDown size={16} className="text-theme-text-muted" />
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4">
                  <CallRecordingPlayer
                    callId={call.callId}
                    pizzeriaName={call.pizzeriaName}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
