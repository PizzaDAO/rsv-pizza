import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share2, Globe, Mail, UserPlus } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { SocialComposer } from './SocialComposer';
import { PlatformPublisher } from './PlatformPublisher';
import { EmailOutreach } from './EmailOutreach';
import { BulkInvite } from './BulkInvite';

type PromoSection = 'social' | 'publish' | 'email' | 'invite';

interface SectionConfig {
  id: PromoSection;
  label: string;
  description: string;
  icon: React.ElementType;
}

const SECTIONS: SectionConfig[] = [
  {
    id: 'social',
    label: 'promo.socialMedia',
    description: 'promo.socialMediaDesc',
    icon: Share2,
  },
  {
    id: 'publish',
    label: 'promo.publishEvent',
    description: 'promo.publishEventDesc',
    icon: Globe,
  },
  {
    id: 'email',
    label: 'promo.emailGuests',
    description: 'promo.emailGuestsDesc',
    icon: Mail,
  },
  {
    id: 'invite',
    label: 'promo.inviteGuests',
    description: 'promo.inviteGuestsDesc',
    icon: UserPlus,
  },
];

export const PromoWidget: React.FC = () => {
  const { t } = useTranslation('host');
  const { party, guests } = usePizza();
  const [expandedSection, setExpandedSection] = useState<PromoSection | null>('social');

  if (!party) {
    return (
      <div className="card p-6 text-theme-text-secondary">
        {t('promo.noPartyLoaded')}
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
              className="w-full flex items-center justify-between p-4 hover:bg-theme-surface transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#ff393a]/10 flex items-center justify-center">
                  <Icon size={20} className="text-[#ff393a]" />
                </div>
                <div className="text-left">
                  <p className="text-theme-text font-medium">{t(section.label)}</p>
                  <p className="text-theme-text-muted text-xs">{t(section.description)}</p>
                </div>
              </div>
              <svg
                className={`w-5 h-5 text-theme-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Section Content */}
            {isExpanded && (
              <div className="border-t border-theme-stroke p-4">
                {section.id === 'social' && <SocialComposer party={party} />}
                {section.id === 'publish' && <PlatformPublisher />}
                {section.id === 'email' && <EmailOutreach party={party} guests={guests} />}
                {section.id === 'invite' && <BulkInvite party={party} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
