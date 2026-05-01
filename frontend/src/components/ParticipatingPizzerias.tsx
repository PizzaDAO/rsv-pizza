import { Star } from 'lucide-react';
import { Pizzeria } from '../types';
import { trackLinkClick } from '../lib/api';

interface ParticipatingPizzeriasProps {
  pizzerias: Pizzeria[];
  venueAddress?: string | null;
  eventSlug: string | undefined;
}

export function ParticipatingPizzerias({
  pizzerias,
  eventSlug,
}: ParticipatingPizzeriasProps) {
  if (!pizzerias || pizzerias.length === 0) return null;

  const sectionLabel = 'On the Menu';

  const handleLinkClick = (url: string, pizzeriaName: string) => {
    if (eventSlug) {
      trackLinkClick(eventSlug, url, 'pizzeria', pizzeriaName);
    }
  };

  return (
    <div className="border-t border-theme-stroke pt-6 mt-6 space-y-4">
      <h2 className="text-lg font-semibold text-theme-text">{sectionLabel}</h2>

      <div className="space-y-3">
        {pizzerias.map((pizzeria) => (
          <div
            key={pizzeria.id}
            className="flex items-start gap-3 p-3 bg-theme-surface rounded-xl border border-theme-stroke"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {pizzeria.url ? (
                  <a
                    href={pizzeria.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-theme-text font-medium truncate hover:text-[#ff393a] transition-colors"
                    onClick={() => handleLinkClick(pizzeria.url!, pizzeria.name)}
                  >
                    {pizzeria.name}
                  </a>
                ) : (
                  <p className="text-theme-text font-medium truncate">{pizzeria.name}</p>
                )}
                {pizzeria.rating && (
                  <span className="flex items-center gap-1 text-xs text-yellow-400">
                    <Star size={12} className="fill-yellow-400" />
                    {pizzeria.rating.toFixed(1)}
                  </span>
                )}
              </div>
              {pizzeria.description && (
                <p className="text-theme-text-muted text-xs mt-0.5">{pizzeria.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ParticipatingPizzerias;
