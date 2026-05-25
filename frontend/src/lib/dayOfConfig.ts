// Centralised day-of config helpers.
//
// parmigiano-58729: ZOOM_URL / STREAMYARD_URL constants were removed. The
// URLs are now fetched from an approval-gated backend endpoint
// (`GET /api/parties/:partyId/broadcast-urls`) via `fetchBroadcastUrls`
// in lib/api.ts. Env vars `BROADCAST_ZOOM_URL` and `BROADCAST_STREAMYARD_URL`
// are set on the backend Vercel project.

export const isBroadcastUrlReady = (url: string | null | undefined): boolean =>
  !!url && !url.startsWith('TODO_') && url.length > 0;

// porchetta-19384: public stream-viewing URLs for StreamOnScreenCard.
// Same security model as the existing mix.pizzadao.xyz link — no backend gating.
export const STREAM_YOUTUBE_URL = 'https://www.youtube.com/watch?v=H5JlCnxBVqQ';
export const STREAM_X_URL = 'https://x.com/i/broadcasts/1XxygmWevrYGM?s=20';
