import React, { useState, useEffect } from 'react';
import { Loader2, ExternalLink, Award } from 'lucide-react';
import { Sponsor, SponsorTier } from '../types';
import { getPartySponsors } from '../lib/api';

interface SponsorDisplayProps {
  partyId: string;
}

const tierColors: Record<SponsorTier, { bg: string; border: string; text: string }> = {
  gold: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
  },
  silver: {
    bg: 'bg-slate-300/10',
    border: 'border-slate-300/30',
    text: 'text-slate-300',
  },
  bronze: {
    bg: 'bg-orange-700/10',
    border: 'border-orange-700/30',
    text: 'text-orange-400',
  },
  partner: {
    bg: 'bg-white/5',
    border: 'border-white/10',
    text: 'text-white/60',
  },
};

// Group sponsors by tier
const tierOrder: SponsorTier[] = ['gold', 'silver', 'bronze', 'partner'];

export const SponsorDisplay: React.FC<SponsorDisplayProps> = ({ partyId }) => {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [sectionTitle, setSectionTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    async function loadSponsors() {
      try {
        const response = await getPartySponsors(partyId);
        if (response) {
          setSponsors(response.sponsors);
          setSectionTitle(response.sponsorSectionTitle);
          setEnabled(response.sponsorsEnabled);
        }
      } catch (error) {
        console.error('Error loading sponsors:', error);
      } finally {
        setLoading(false);
      }
    }
    loadSponsors();
  }, [partyId]);

  // Don't render if loading, not enabled, or no sponsors
  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-[#ff393a]" />
      </div>
    );
  }

  if (!enabled || sponsors.length === 0) {
    return null;
  }

  // Group sponsors by tier for display
  const sponsorsByTier = tierOrder.reduce((acc, tier) => {
    const tierSponsors = sponsors.filter((s) => s.tier === tier);
    if (tierSponsors.length > 0) {
      acc[tier] = tierSponsors;
    }
    return acc;
  }, {} as Record<SponsorTier, Sponsor[]>);

  return (
    <div className="border-t border-white/10 pt-6 mt-6">
      {/* Section Header */}
      <div className="flex items-center gap-2 mb-4">
        <Award size={18} className="text-[#ff393a]" />
        <h3 className="text-lg font-semibold text-white">
          {sectionTitle || 'Our Sponsors'}
        </h3>
      </div>

      {/* Sponsors Grid */}
      <div className="space-y-4">
        {Object.entries(sponsorsByTier).map(([tier, tierSponsors]) => (
          <div key={tier} className="space-y-2">
            {/* Render sponsors in a responsive grid */}
            <div className={`grid gap-3 ${
              tier === 'gold'
                ? 'grid-cols-1 md:grid-cols-2'
                : tier === 'silver'
                  ? 'grid-cols-2 md:grid-cols-3'
                  : 'grid-cols-2 md:grid-cols-4'
            }`}>
              {tierSponsors.map((sponsor) => {
                const colors = tierColors[sponsor.tier as SponsorTier];
                const isLargeTier = tier === 'gold' || tier === 'silver';

                return (
                  <a
                    key={sponsor.id}
                    href={sponsor.websiteUrl || undefined}
                    target={sponsor.websiteUrl ? '_blank' : undefined}
                    rel={sponsor.websiteUrl ? 'noopener noreferrer' : undefined}
                    className={`block p-4 rounded-xl border transition-all ${colors.bg} ${colors.border} ${
                      sponsor.websiteUrl ? 'hover:scale-[1.02] cursor-pointer' : ''
                    }`}
                  >
                    <div className={`flex ${isLargeTier ? 'items-start gap-4' : 'flex-col items-center text-center gap-2'}`}>
                      {/* Logo */}
                      {sponsor.logoUrl ? (
                        <div className={`flex-shrink-0 rounded-lg overflow-hidden bg-white/10 flex items-center justify-center ${
                          isLargeTier ? 'w-16 h-16' : 'w-12 h-12'
                        }`}>
                          <img
                            src={sponsor.logoUrl}
                            alt={`${sponsor.name} logo`}
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                      ) : (
                        <div className={`flex-shrink-0 rounded-lg border flex items-center justify-center ${colors.bg} ${colors.border} ${
                          isLargeTier ? 'w-16 h-16' : 'w-12 h-12'
                        }`}>
                          <span className={`font-bold ${colors.text} ${isLargeTier ? 'text-2xl' : 'text-lg'}`}>
                            {sponsor.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}

                      {/* Info */}
                      <div className={`${isLargeTier ? 'flex-1 min-w-0' : ''}`}>
                        <div className="flex items-center gap-1.5 justify-center md:justify-start">
                          <h4 className={`font-medium text-white ${isLargeTier ? '' : 'text-sm'} truncate`}>
                            {sponsor.name}
                          </h4>
                          {sponsor.websiteUrl && (
                            <ExternalLink size={12} className="text-white/40 flex-shrink-0" />
                          )}
                        </div>
                        {isLargeTier && sponsor.description && (
                          <p className="text-sm text-white/60 mt-1 line-clamp-2">
                            {sponsor.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
