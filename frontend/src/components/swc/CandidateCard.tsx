import React from 'react';
import { ExternalLink, User, MapPin } from 'lucide-react';
import { SWCCandidate, getGradeColor, getPartyName, getDistanceMiles } from './swcUtils';

interface CandidateCardProps {
  candidate: SWCCandidate;
  selected?: boolean;
  onSelect?: (candidate: SWCCandidate) => void;
  venueLat?: number;
  venueLng?: number;
}

export const CandidateCard: React.FC<CandidateCardProps> = ({
  candidate,
  selected = false,
  onSelect,
  venueLat,
  venueLng,
}) => {
  const gradeColor = getGradeColor(candidate.grade);
  const partyColor = candidate.party === 'D' ? 'text-blue-400' : candidate.party === 'R' ? 'text-red-400' : 'text-theme-text-muted';

  const distance = venueLat != null && venueLng != null
    ? Math.round(getDistanceMiles(venueLat, venueLng, candidate.districtLat, candidate.districtLng))
    : null;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(candidate)}
      className={`w-full text-left p-3 rounded-xl border transition-all ${
        selected
          ? 'border-[#ff393a]/40 bg-[#ff393a]/5'
          : 'border-theme-stroke hover:border-theme-stroke-hover bg-theme-surface'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Photo or placeholder */}
        <div className="w-10 h-10 rounded-full bg-theme-surface-hover flex items-center justify-center flex-shrink-0 overflow-hidden">
          {candidate.photoUrl ? (
            <img
              src={candidate.photoUrl}
              alt={candidate.name}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <User size={18} className="text-theme-text-faint" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-theme-text truncate">
              {candidate.name}
            </span>
            {/* Grade badge */}
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${gradeColor.bg} ${gradeColor.text}`}
            >
              {candidate.grade}
            </span>
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-xs font-medium ${partyColor}`}>
              {getPartyName(candidate.party)}
            </span>
            <span className="text-theme-text-faint text-[10px]">|</span>
            <span className="text-xs text-theme-text-muted truncate">
              {candidate.office}
            </span>
          </div>

          {/* District + distance row */}
          <div className="flex items-center gap-1.5 mt-1">
            <MapPin size={11} className="text-theme-text-faint flex-shrink-0" />
            <span className="text-xs text-theme-text-muted">
              {candidate.district
                ? `${candidate.state}-${candidate.district}`
                : `${candidate.state} (statewide)`}
            </span>
            {distance != null && (
              <>
                <span className="text-theme-text-faint text-[10px]">·</span>
                <span className="text-[10px] text-theme-text-faint">
                  ~{distance} mi from venue
                </span>
              </>
            )}
          </div>

          {candidate.incumbent && (
            <span className="text-[10px] text-theme-text-faint mt-0.5 block">
              Incumbent
            </span>
          )}
        </div>

        {/* SWC profile link */}
        <a
          href={candidate.swcProfileUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-1.5 rounded-lg text-theme-text-faint hover:text-theme-text-secondary hover:bg-theme-surface-hover transition-colors flex-shrink-0"
          title="View on Stand With Crypto"
        >
          <ExternalLink size={14} />
        </a>
      </div>

      {/* Selection indicator */}
      {selected && (
        <div className="mt-2 flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[#ff393a]" />
          <span className="text-[10px] text-[#ff393a] font-medium">Selected for outreach</span>
        </div>
      )}
    </button>
  );
};
