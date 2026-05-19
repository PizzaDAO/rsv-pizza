import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Search, X } from 'lucide-react';
import { IconInput } from '../IconInput';
import {
  searchPartiesForOutreach,
  updateOutreachAttempt,
  type OutreachPartySearchResult,
} from '../../lib/api';

interface OutreachLinkPartyModalProps {
  attemptId: string;
  communityName: string;
  onClose: () => void;
  onLinked: () => void;
}

export function OutreachLinkPartyModal({
  attemptId,
  communityName,
  onClose,
  onLinked,
}: OutreachLinkPartyModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OutreachPartySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const rows = await searchPartiesForOutreach(query.trim());
        setResults(rows);
      } catch (e: any) {
        setError(e?.message || 'Search failed');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handlePick = async (party: OutreachPartySearchResult) => {
    setLinking(true);
    setError(null);
    try {
      await updateOutreachAttempt(attemptId, { convertedPartyId: party.id });
      onLinked();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to link party');
      setLinking(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-theme-card border border-theme-stroke rounded-2xl p-6 w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-theme-text">Link converted party</h3>
            <p className="text-sm text-theme-text-muted mt-1">
              Outreach to <span className="text-theme-text">{communityName}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-theme-text-faint hover:text-theme-text-secondary"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <IconInput
          icon={Search}
          placeholder="Search by event name or custom URL..."
          value={query}
          onChange={(e: any) => setQuery(e.target.value)}
          autoFocus
        />

        <div className="mt-4 min-h-[120px]">
          {searching && (
            <div className="flex items-center justify-center py-6 text-theme-text-muted">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <div className="text-center py-6 text-sm text-theme-text-muted">
              No matching events. Try a different search.
            </div>
          )}
          {!searching && query.trim().length < 2 && (
            <div className="text-center py-6 text-sm text-theme-text-muted">
              Type at least 2 characters to search.
            </div>
          )}
          {results.length > 0 && (
            <ul className="divide-y divide-theme-stroke">
              {results.map((party) => (
                <li key={party.id}>
                  <button
                    type="button"
                    disabled={linking}
                    onClick={() => handlePick(party)}
                    className="w-full text-left px-3 py-3 hover:bg-theme-surface rounded-lg disabled:opacity-50"
                  >
                    <div className="font-medium text-theme-text">{party.name}</div>
                    <div className="text-xs text-theme-text-muted mt-0.5 flex items-center gap-2">
                      {party.city && <span>{party.city}</span>}
                      {party.customUrl && (
                        <span className="text-theme-text-faint">rsv.pizza/{party.customUrl}</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-500">
            {error}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
