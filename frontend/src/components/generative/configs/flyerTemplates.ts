import type { FormatConfig } from '../types';
import { POSTER_CONFIG } from './posterConfig';
import { ROLLUP_CONFIG } from './rollupConfig';
import { AVAX_POSTER_CONFIG } from './avaxPosterConfig';
import { AVAX_ROLLUP_CONFIG } from './avaxRollupConfig';
import { DOGE_POSTER_CONFIG } from './dogePosterConfig';
import { DOGE_ROLLUP_CONFIG } from './dogeRollupConfig';
import { TEAM1_POSTER_CONFIG } from './team1PosterConfig';
import { TEAM1_ROLLUP_CONFIG } from './team1RollupConfig';
import { SWC_POSTER_CONFIG } from './swcPosterConfig';
import { SWC_ROLLUP_CONFIG } from './swcRollupConfig';

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
  doge: { poster: DOGE_POSTER_CONFIG, rollup: DOGE_ROLLUP_CONFIG },
  team1: { poster: TEAM1_POSTER_CONFIG, rollup: TEAM1_ROLLUP_CONFIG },
  swc: { poster: SWC_POSTER_CONFIG, rollup: SWC_ROLLUP_CONFIG },
};

export const DEFAULT_FLYER_TEMPLATE: FlyerTemplate = FLYER_TEMPLATES.gpp;

export function resolveFlyerTemplate(key: string | null | undefined): FlyerTemplate | null {
  if (key && FLYER_TEMPLATES[key]) return FLYER_TEMPLATES[key];
  return null;
}
