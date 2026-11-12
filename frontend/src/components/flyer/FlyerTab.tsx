import { useTranslation } from 'react-i18next';
import { FlyerGenerator } from './FlyerGenerator';
import { usePizza } from '../../contexts/PizzaContext';
import { BrandFlyerNotice } from '../generative/BrandFlyerNotice';
import { IS_SERIES_SCOPED } from '../../config/brandScope';

export function FlyerTab({ sponsorLogoOnly }: { sponsorLogoOnly?: boolean } = {}) {
  const { t } = useTranslation('host');
  const { party } = usePizza();

  if (!party) return null;

  // White-label builds: FlyerGenerator renders GPP art only, so never show it here.
  if (IS_SERIES_SCOPED) return <BrandFlyerNotice />;

  // Only show for GPP events
  if (party.eventType !== 'gpp') {
    return (
      <div className="card p-8 text-center">
        <p className="text-theme-text-secondary">{t('flyer.gppOnly')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-bold text-theme-text">{t('flyer.eventFlyer')}</h2>
        <p className="text-sm text-theme-text-secondary mt-1">
          {t('flyer.downloadCustomFlyer')}
        </p>
      </div>
      <FlyerGenerator sponsorLogoOnly={sponsorLogoOnly} />
    </div>
  );
}
