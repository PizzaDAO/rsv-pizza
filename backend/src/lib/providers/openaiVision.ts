/**
 * marinara-61455: OpenAI gpt-4o vision provider (Phase 1, active).
 *
 * Reuses `getOpenAI()` + the same gpt-4o vision call shape as the OCR service.
 * Always available when OPENAI_API_KEY is set (the same key OCR already uses).
 */

import { getOpenAI } from '../openai.js';
import { getLlmModels } from '../privateConfig.js';
import {
  VisionProvider,
  VisionResult,
  VisionContext,
  VISION_SYSTEM_PROMPT,
  visionUserPrompt,
  coerceVisionResult,
} from './types.js';

export const openaiVisionProvider: VisionProvider = {
  id: 'openai',

  available(): boolean {
    return !!process.env.OPENAI_API_KEY;
  },

  async analyze(imageDataUrl: string, ctx: VisionContext): Promise<VisionResult> {
    const visionModel = (await getLlmModels()).visionPrimary;
    const response = await getOpenAI().chat.completions.create({
      model: visionModel,
      messages: [
        { role: 'system', content: VISION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: visionUserPrompt(ctx) },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response content from OpenAI vision');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`OpenAI vision returned non-JSON content: ${content.slice(0, 200)}`);
    }

    return { provider: 'openai', ...coerceVisionResult('openai', parsed) };
  },
};
