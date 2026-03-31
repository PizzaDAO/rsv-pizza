import React, { useState, useMemo } from 'react';
import { Shield, MapPin, ChevronDown, ArrowLeft, Globe } from 'lucide-react';
import { CandidateCard } from './CandidateCard';
import { OutreachDrafter } from './OutreachDrafter';
import {
  SWCCandidate,
  extractStateFromAddress,
  isUSAddress,
  getCandidatesByState,
  getAvailableStates,
  getStateName,
} from './swcUtils';

interface SWCWidgetProps {
  partyId: string;
  address: string | null;
  eventName: string;
  eventDate: string;
  eventLocation: string;
  rsvpUrl: string;
  hostName: string;
}

export const SWCWidget: React.FC<SWCWidgetProps> = ({
  address,
  eventName,
  eventDate,
  eventLocation,
  rsvpUrl,
  hostName,
}) => {
  // Auto-detect state from event address
  const detectedState = useMemo(
    () => (address ? extractStateFromAddress(address) : null),
    [address]
  );

  const isUS = useMemo(
    () => (address ? isUSAddress(address) : true), // Default to US if no address
    [address]
  );

  const availableStates = useMemo(() => getAvailableStates(), []);
  const [selectedState, setSelectedState] = useState<string>(detectedState || '');
  const [selectedCandidate, setSelectedCandidate] = useState<SWCCandidate | null>(null);

  // Use detected state as initial, but allow manual override
  const activeState = selectedState || detectedState || '';

  const candidates = useMemo(
    () => (activeState ? getCandidatesByState(activeState) : []),
    [activeState]
  );

  // Non-US address: show graceful message
  if (address && !isUS) {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-[#ff393a]/10 flex items-center justify-center">
            <Shield size={20} className="text-[#ff393a]" />
          </div>
          <div>
            <h3 className="text-theme-text font-medium">Stand With Crypto</h3>
            <p className="text-xs text-theme-text-muted">Candidate outreach for crypto-friendly politicians</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-theme-surface border border-theme-stroke">
          <Globe size={20} className="text-theme-text-faint flex-shrink-0" />
          <div>
            <p className="text-sm text-theme-text-secondary">
              Stand With Crypto races are US-only
            </p>
            <p className="text-xs text-theme-text-faint mt-0.5">
              This feature tracks US congressional representatives and their stance on crypto policy.
              Non-US events can still use other advocacy tools.
            </p>
          </div>
        </div>

        <a
          href="https://www.standwithcrypto.org"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-xs text-[#ff393a] hover:text-[#ff5a5b] transition-colors"
        >
          Visit standwithcrypto.org
          <Globe size={12} />
        </a>
      </div>
    );
  }

  // If we're in outreach drafting mode for a specific candidate
  if (selectedCandidate) {
    return (
      <div className="card p-6 space-y-4">
        {/* Back button */}
        <button
          type="button"
          onClick={() => setSelectedCandidate(null)}
          className="flex items-center gap-1.5 text-sm text-theme-text-muted hover:text-theme-text-secondary transition-colors"
        >
          <ArrowLeft size={16} />
          Back to candidates
        </button>

        <OutreachDrafter
          candidate={selectedCandidate}
          eventName={eventName}
          eventDate={eventDate}
          eventLocation={eventLocation}
          rsvpUrl={rsvpUrl}
          hostName={hostName}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-[#ff393a]/10 flex items-center justify-center">
            <Shield size={20} className="text-[#ff393a]" />
          </div>
          <div>
            <h3 className="text-theme-text font-medium">Stand With Crypto</h3>
            <p className="text-xs text-theme-text-muted">
              Invite crypto-friendly candidates to your pizza party
            </p>
          </div>
        </div>

        <p className="text-sm text-theme-text-secondary leading-relaxed mb-4">
          Find A- and B-rated candidates from{' '}
          <a
            href="https://www.standwithcrypto.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#ff393a] hover:text-[#ff5a5b] transition-colors"
          >
            Stand With Crypto
          </a>{' '}
          in your state and send them outreach to attend your event.
        </p>

        {/* State selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <MapPin size={14} className="text-theme-text-muted flex-shrink-0" />
            <div className="relative flex-1 max-w-[240px]">
              <select
                value={activeState}
                onChange={(e) => setSelectedState(e.target.value)}
                className="w-full appearance-none bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 pr-8 text-sm text-theme-text focus:outline-none focus:border-theme-stroke-hover"
              >
                <option value="">Select a state...</option>
                {availableStates.map((st) => (
                  <option key={st} value={st}>
                    {getStateName(st)} ({st})
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none"
              />
            </div>
          </div>

          {detectedState && (
            <span className="text-xs text-theme-text-faint">
              Detected: {getStateName(detectedState)}
            </span>
          )}
        </div>
      </div>

      {/* Candidates List */}
      {activeState && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-theme-text">
              Candidates in {getStateName(activeState)}
            </h4>
            <span className="text-xs text-theme-text-faint">
              {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}
            </span>
          </div>

          {candidates.length === 0 ? (
            <div className="py-8 text-center">
              <Shield size={24} className="mx-auto text-theme-text-faint mb-2" />
              <p className="text-sm text-theme-text-muted">
                No A/B-rated candidates found for {getStateName(activeState)}
              </p>
              <p className="text-xs text-theme-text-faint mt-1">
                Try selecting a different state, or visit{' '}
                <a
                  href={`https://www.standwithcrypto.org/races`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#ff393a] hover:text-[#ff5a5b]"
                >
                  standwithcrypto.org/races
                </a>{' '}
                for the full list.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  onSelect={(c) => setSelectedCandidate(c)}
                />
              ))}
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-theme-stroke">
            <p className="text-xs text-theme-text-faint">
              Grades from{' '}
              <a
                href="https://www.standwithcrypto.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#ff393a]/70 hover:text-[#ff393a]"
              >
                Stand With Crypto
              </a>
              . Click a candidate to draft an outreach email.
            </p>
          </div>
        </div>
      )}

      {!activeState && (
        <div className="card p-6">
          <div className="py-8 text-center">
            <MapPin size={24} className="mx-auto text-theme-text-faint mb-2" />
            <p className="text-sm text-theme-text-muted">
              Select a state to see crypto-friendly candidates
            </p>
            <p className="text-xs text-theme-text-faint mt-1">
              {address
                ? 'Could not detect a US state from your event address. Please select one above.'
                : 'Add an event address or select a state to get started.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
