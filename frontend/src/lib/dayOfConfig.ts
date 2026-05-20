// Centralised day-of config helpers.
//
// parmigiano-58729: ZOOM_URL / STREAMYARD_URL constants were removed. The
// URLs are now fetched from an approval-gated backend endpoint
// (`GET /api/parties/:partyId/broadcast-urls`) via `fetchBroadcastUrls`
// in lib/api.ts. Env vars `BROADCAST_ZOOM_URL` and `BROADCAST_STREAMYARD_URL`
// are set on the backend Vercel project.

export const isBroadcastUrlReady = (url: string | null | undefined): boolean =>
  !!url && !url.startsWith('TODO_') && url.length > 0;
