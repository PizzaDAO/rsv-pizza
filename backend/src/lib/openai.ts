import OpenAI from 'openai';

/**
 * OpenAI client singleton for the rsv.pizza backend.
 * Currently used by the payouts OCR service (arugula-38633).
 *
 * Reads OPENAI_API_KEY from the environment. Throws a clear error if missing
 * so configuration problems surface at first use rather than as cryptic 500s.
 */
let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is not set. Configure it on the backend Vercel project ' +
        '(prj_uxgTwR4ENIePs4qck5PQVMA2kzQB) before using OCR features.'
      );
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}
