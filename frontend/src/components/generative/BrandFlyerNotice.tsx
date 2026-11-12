import { BRAND } from '../../config/brand';

/**
 * Shown instead of GPP flyer art on white-label builds whose series has no flyer
 * template (flyerTemplateKey). Brand hosts must never get the Global Pizza Party
 * (or Avalanche GPP) poster by fallback.
 */
export function BrandFlyerNotice() {
  return (
    <div className="card p-8 text-center">
      <p className="text-theme-text-secondary">
        {BRAND.name} flyer templates are coming soon.
      </p>
    </div>
  );
}
