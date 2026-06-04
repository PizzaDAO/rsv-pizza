/**
 * marinara-61455: Sightengine "AI-generated image" detector — Phase 2, DORMANT.
 *
 * A dedicated third-party detector usable as a tie-breaker on `suspicious`
 * verdicts. Off by default: `available()` returns false unless BOTH
 * SIGHTENGINE_API_USER and SIGHTENGINE_API_SECRET are set, and callers MUST
 * skip it silently when unavailable. No SDK — plain fetch against the public
 * REST endpoint. We pass the image as a public URL (Sightengine fetches it
 * itself) rather than uploading bytes, so callers should pass the original
 * Supabase object URL via the context, falling back to skipping if absent.
 */

import {
  VisionProvider,
  VisionResult,
  VisionContext,
  coerceVisionResult,
} from './types.js';

const ENDPOINT = 'https://api.sightengine.com/1.0/check.json';

export const sightengineProvider: VisionProvider = {
  id: 'sightengine',

  available(): boolean {
    return !!(process.env.SIGHTENGINE_API_USER && process.env.SIGHTENGINE_API_SECRET);
  },

  async analyze(imageDataUrl: string, _ctx: VisionContext): Promise<VisionResult> {
    void _ctx;
    const user = process.env.SIGHTENGINE_API_USER;
    const secret = process.env.SIGHTENGINE_API_SECRET;
    if (!user || !secret) {
      throw new Error('SIGHTENGINE_API_USER / SIGHTENGINE_API_SECRET not set — dormant.');
    }

    // Sightengine's check.json with models=genai expects a hosted image URL.
    // imageDataUrl is a base64 data URL; this provider only works when handed a
    // real https URL, so guard against the data-URL form and skip cleanly.
    if (imageDataUrl.startsWith('data:')) {
      throw new Error('sightengine provider requires a public image URL, not a data URL');
    }

    const params = new URLSearchParams({
      url: imageDataUrl,
      models: 'genai',
      api_user: user,
      api_secret: secret,
    });

    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`Sightengine HTTP ${res.status}`);
    }
    const json = (await res.json()) as Record<string, any>;

    // Sightengine returns type.ai_generated in [0,1]. Map to our tiers.
    const aiScore = Number(json?.type?.ai_generated);
    const pct = Number.isFinite(aiScore) ? Math.round(aiScore * 100) : 50;
    const verdict =
      pct >= 70 ? 'likely_fake' : pct >= 35 ? 'suspicious' : 'authentic';

    return {
      provider: 'sightengine',
      ...coerceVisionResult('sightengine', {
        verdict,
        confidence: pct,
        observations:
          pct >= 35
            ? [`Sightengine genai detector scored ${pct}% AI-generated.`]
            : [],
      }),
      raw: json,
    };
  },
};
