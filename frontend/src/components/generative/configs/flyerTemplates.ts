import type { FormatConfig } from '../types';
import { POSTER_CONFIG } from './posterConfig';
import { ROLLUP_CONFIG } from './rollupConfig';
import { AVAX_POSTER_CONFIG } from './avaxPosterConfig';
import { AVAX_ROLLUP_CONFIG } from './avaxRollupConfig';

/**
 * White-label flyer template registry (Phase 2c). A series picks its template by
 * key (EventSeries.flyerTemplateKey); the generators resolve poster/rollup config
 * from here. Adding a brand's own flyer is a code change (a new config object +
 * an entry here) — same as today, just no longer hardcoded to a tag check.
 */
export interface FlyerTemplate {
  poster: FormatConfig;
  rollup: FormatConfig;
}

export const FLYER_TEMPLATES: Record<string, FlyerTemplate> = {
  gpp: { poster: POSTER_CONFIG, rollup: ROLLUP_CONFIG },
  avax: { poster: AVAX_POSTER_CONFIG, rollup: AVAX_ROLLUP_CONFIG },
};

export const DEFAULT_FLYER_TEMPLATE: FlyerTemplate = FLYER_TEMPLATES.gpp;

export function resolveFlyerTemplate(key: string | null | undefined): FlyerTemplate | null {
  if (key && FLYER_TEMPLATES[key]) return FLYER_TEMPLATES[key];
  return null;
}
