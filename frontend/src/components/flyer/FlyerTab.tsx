import React from 'react';
import { useTranslation } from 'react-i18next';
import { FlyerGenerator } from './FlyerGenerator';
import { usePizza } from '../../contexts/PizzaContext';

export function FlyerTab() {
  const { t } = useTranslation('host');
  const { party } = usePizza();

  if (!party) return null;

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
      <FlyerGenerator />
    </div>
  );
}
