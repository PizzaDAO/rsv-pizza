/**
 * marinara-61455: Anthropic (Claude) vision provider — Phase 2, DORMANT.
 *
 * A second-opinion provider, off by default. `available()` returns false unless
 * ANTHROPIC_API_KEY is set, and callers MUST skip it silently when unavailable
 * so Phase 1 ships with only OPENAI_API_KEY. The `@anthropic-ai/sdk` dependency
 * is declared in package.json but the provider stays inert until the key is set.
 *
 * The SDK client is lazily constructed inside `analyze()` (only when the key is
 * present), so a missing key never throws at import / startup time.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getLlmModels } from '../privateConfig.js';
import {
  VisionProvider,
  VisionResult,
  VisionContext,
  VISION_SYSTEM_PROMPT,
  visionUserPrompt,
  coerceVisionResult,
} from './types.js';

let client: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set — anthropic vision provider is dormant.');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** Split a `data:<mime>;base64,<data>` URL into its parts for the Anthropic API. */
function parseDataUrl(dataUrl: string): { mediaType: string; data: string } {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('anthropic vision expects a base64 data URL');
  }
  return { mediaType: match[1], data: match[2] };
}

export const anthropicVisionProvider: VisionProvider = {
  id: 'anthropic',

  available(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  },

  async analyze(imageDataUrl: string, ctx: VisionContext): Promise<VisionResult> {
    const { mediaType, data } = parseDataUrl(imageDataUrl);
    const secondOpinionModel = (await getLlmModels()).visionSecondOpinion;

    const response = await getAnthropic().messages.create({
      model: secondOpinionModel,
      max_tokens: 800,
      system: VISION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                // The SDK types accept the common image media types.
                media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data,
              },
            },
            {
              type: 'text',
              text: `${visionUserPrompt(ctx)}\n\nReturn ONLY the JSON object described in the system prompt.`,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    if (!text) {
      throw new Error('No text content from Anthropic vision');
    }

    // Claude may wrap JSON in prose / code fences — extract the first object.
    const jsonMatch = /\{[\s\S]*\}/.exec(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      throw new Error(`Anthropic vision returned non-JSON content: ${text.slice(0, 200)}`);
    }

    return { provider: 'anthropic', ...coerceVisionResult('anthropic', parsed) };
  },
};
