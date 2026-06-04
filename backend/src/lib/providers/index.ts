/**
 * marinara-61455: vision-provider registry.
 *
 * `openai` is the active primary. `anthropic` + `sightengine` are dormant
 * second-opinion providers — present in the registry but skipped at runtime by
 * `available()` unless their env vars are set. This lets Phase 1 run with only
 * OPENAI_API_KEY while Phase 2 lights up automatically once a key is configured.
 */

export * from './types.js';
import { openaiVisionProvider } from './openaiVision.js';
import { anthropicVisionProvider } from './anthropicVision.js';
import { sightengineProvider } from './sightengine.js';
import type { VisionProvider } from './types.js';

/** Primary provider — used for the headline verdict. */
export const primaryVisionProvider: VisionProvider = openaiVisionProvider;

/** Optional second-opinion providers, in priority order. Env-gated. */
export const secondOpinionProviders: VisionProvider[] = [
  anthropicVisionProvider,
  sightengineProvider,
];

export { openaiVisionProvider, anthropicVisionProvider, sightengineProvider };
