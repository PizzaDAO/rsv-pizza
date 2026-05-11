import React from 'react';
import { FlyerGenerator } from './FlyerGenerator';
import { usePizza } from '../../contexts/PizzaContext';

export function FlyerTab({ sponsorLogoOnly }: { sponsorLogoOnly?: boolean } = {}) {
  const { party } = usePizza();

  if (!party) return null;

  // Only show for GPP events
  if (party.eventType !== 'gpp') {
    return (
      <div className="card p-8 text-center">
        <p className="text-theme-text-secondary">Custom flyers are currently available for Global Pizza Party events.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-bold text-theme-text">Event Flyer</h2>
        <p className="text-sm text-theme-text-secondary mt-1">
          Download a custom flyer with your event details
        </p>
      </div>
      <FlyerGenerator sponsorLogoOnly={sponsorLogoOnly} />
    </div>
  );
}
