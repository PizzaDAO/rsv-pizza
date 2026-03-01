import React, { useState } from 'react';
import { Share2, Globe, Mail } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { SocialComposer } from './SocialComposer';
import { PlatformPublisher } from './PlatformPublisher';
import { EmailOutreach } from './EmailOutreach';

type PromoSection = 'social' | 'publish' | 'email';

interface SectionConfig {
  id: PromoSection;
  label: string;
  description: string;
  icon: React.ElementType;
}

const SECTIONS: SectionConfig[] = [
  {
    id: 'social',
    label: 'Social Media',
    description: 'Share on X, Instagram, Facebook, LinkedIn',
    icon: Share2,
  },
  {
    id: 'publish',
    label: 'Publish Event',
    description: 'Create listings on Luma, Meetup, Eventbrite',
    icon: Globe,
  },
  {
    id: 'email',
    label: 'Email Guests',
    description: 'Send updates to your guest list',
    icon: Mail,
  },
];

export const PromoWidget: React.FC = () => {
  const { party, guests } = usePizza();
  const [expandedSection, setExpandedSection] = useState<PromoSection | null>('social');

  if (!party) {
    return (
      <div className="card p-6 text-white/60">
        No party loaded
      </div>
    );
  }

  const toggleSection = (section: PromoSection) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  return (
    <div className="space-y-3">
      {SECTIONS.map((section) => {
        const Icon = section.icon;
        const isExpanded = expandedSection === section.id;

        return (
          <div key={section.id} className="card overflow-hidden">
            {/* Section Header */}
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#ff393a]/10 flex items-center justify-center">
                  <Icon size={20} className="text-[#ff393a]" />
                </div>
                <div className="text-left">
                  <p className="text-white font-medium">{section.label}</p>
                  <p className="text-white/40 text-xs">{section.description}</p>
                </div>
              </div>
              <svg
                className={`w-5 h-5 text-white/40 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Section Content */}
            {isExpanded && (
              <div className="border-t border-white/10 p-4">
                {section.id === 'social' && <SocialComposer party={party} />}
                {section.id === 'publish' && <PlatformPublisher party={party} />}
                {section.id === 'email' && <EmailOutreach party={party} guests={guests} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
