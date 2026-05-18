# forno-98845 — Avax print templates (Team1 poster + rollup)

**Priority:** P2
**Branch:** `forno-98845-avax-print`
**Origin:** Snax — provided `team1 poster.png` (5400×7200) and `team1 rollup.png` (10061×27392). Wants events tagged `avax` to use these as the poster + rollup templates in the print app.

## Decisions (locked in advance)
- **Override mode:** Replace — avax-tagged events render the Team1 templates instead of the default GPP ones (single poster + single rollup, not both).
- **Text overlay:** Reuse existing city/time/venue + sponsor box positions from `POSTER_CONFIG` / `ROLLUP_CONFIG` (full-res dimensions match, so coords work as-is). Snax will iterate on positions in a follow-up if the layout doesn't suit the new artwork.
- **Preview vs full-res:** Downscale to 1080×1440 (poster) and 1080×2940 (rollup) for the in-browser preview; ship the original full-res PNGs to the Supabase `templates` bucket for the hi-res download.

## Existing convention (already in repo)
`frontend/src/components/flyer/renderFlyer.ts:86` has:
```ts
export function getTemplateUrl(eventTags?: string[]): string {
  if (eventTags?.includes('avax')) return '/gpp-flyer-avax-template.png';
  return '/gpp-flyer-2026-template.png';
}
```
The flyer already swaps on `avax`. This plan extends the same pattern to poster + rollup.

## Files & changes

### Assets (already staged on this branch by the dispatcher)
- `frontend/public/gpp-poster-avax-template.png` — 1080×1440 preview (already committed by the seeding commit)
- `frontend/public/gpp-rollup-avax-template.png` — 1080×2940 preview (already committed)
- Supabase storage `templates/gpp-poster-avax-fullres.png` — 5400×7200 (uploaded outside this PR, see "Supabase upload" below)
- Supabase storage `templates/gpp-rollup-avax-fullres.png` — 10061×27392 (uploaded outside this PR)

### New code

**`frontend/src/components/generative/configs/avaxPosterConfig.ts`** (new file, ~10 lines)
```ts
import type { FormatConfig } from '../types';
import { POSTER_CONFIG } from './posterConfig';

export const AVAX_POSTER_CONFIG: FormatConfig = {
  ...POSTER_CONFIG,
  id: 'poster-avax',
  templatePath: '/gpp-poster-avax-template.png',
  fullResUrl: 'https://znpiwdvvsqaxuskpfleo.supabase.co/storage/v1/object/public/templates/gpp-poster-avax-fullres.png',
};
```

**`frontend/src/components/generative/configs/avaxRollupConfig.ts`** (new file, ~10 lines)
```ts
import type { FormatConfig } from '../types';
import { ROLLUP_CONFIG } from './rollupConfig';

export const AVAX_ROLLUP_CONFIG: FormatConfig = {
  ...ROLLUP_CONFIG,
  id: 'rollup-avax',
  templatePath: '/gpp-rollup-avax-template.png',
  fullResUrl: 'https://znpiwdvvsqaxuskpfleo.supabase.co/storage/v1/object/public/templates/gpp-rollup-avax-fullres.png',
};
```

Notes on the spread:
- Inherits `dbImageField: 'poster_image_url'` / `'rollup_image_url'` — fine, an event is either avax or not (mutually exclusive), so the cached render column is reused safely.
- Inherits `storageKey: (id) => 'poster-${id}'` — same reasoning; per-event localStorage is shared between variants (an event can't switch tag mid-edit in a way that would corrupt state).
- Inherits all `textFields` + `sponsorBox` — coords reused as-is.

**`frontend/src/components/generative/PosterGenerator.tsx`** (modify)
```tsx
import { usePizza } from '../../contexts/PizzaContext';
import { GenerativeCanvas } from './GenerativeCanvas';
import { POSTER_CONFIG } from './configs/posterConfig';
import { AVAX_POSTER_CONFIG } from './configs/avaxPosterConfig';

export function PosterGenerator() {
  const { party } = usePizza();
  const isAvax = party?.eventTags?.includes('avax');
  return <GenerativeCanvas config={isAvax ? AVAX_POSTER_CONFIG : POSTER_CONFIG} />;
}
```

**`frontend/src/components/generative/RollupGenerator.tsx`** (modify — mirror image)
```tsx
import { usePizza } from '../../contexts/PizzaContext';
import { GenerativeCanvas } from './GenerativeCanvas';
import { ROLLUP_CONFIG } from './configs/rollupConfig';
import { AVAX_ROLLUP_CONFIG } from './configs/avaxRollupConfig';

export function RollupGenerator() {
  const { party } = usePizza();
  const isAvax = party?.eventTags?.includes('avax');
  return <GenerativeCanvas config={isAvax ? AVAX_ROLLUP_CONFIG : ROLLUP_CONFIG} />;
}
```

**`frontend/src/components/generative/index.ts`** (add exports — optional, follow existing pattern)
```ts
export { AVAX_POSTER_CONFIG } from './configs/avaxPosterConfig';
export { AVAX_ROLLUP_CONFIG } from './configs/avaxRollupConfig';
```

## What stays the same
- `PrintTab.tsx`'s gate `party?.eventType === 'gpp'` is unchanged. Avax events in this repo are GPP events that have the `avax` tag (confirmed by `plans/mushroom-38004-partner-manager-clear-fields.md` — "16 avax-tagged GPP events" referenced). The poster/rollup sections will appear for those events, but with the Team1 artwork.
- `renderCanvas.ts` (download path) reads `config.fullResUrl` directly; no change needed.
- `autoRegenPrint.ts` consumes the same configs via the cache layer; no change needed.

## Supabase upload (out-of-band, before merge)
Full-res PNGs are staged in `.tmp-staging/` of this worktree (not committed). They need to be uploaded to the public `templates` bucket so the `fullResUrl` resolves on prod + previews. Done from the main session via Supabase MCP after Snax approves the plan. Paths inside the bucket:
- `templates/gpp-poster-avax-fullres.png`
- `templates/gpp-rollup-avax-fullres.png`

The bucket is already public read; existing GPP full-res PNGs use the same path scheme.

## Verification

1. **Vercel preview deploy succeeds** (`gh pr checks`).
2. Find an avax-tagged GPP event on the preview deploy (any of the 16 known avax events). Open the Print tab.
   - **Event Poster** section shows the Team1 artwork as preview.
   - **Roll-Up Banner** section shows the Team1 artwork.
   - "Download" (preview-size) and "Download Hi-Res" (full-res from Supabase) both produce the Team1 artwork with city/time/venue overlay.
3. Open a non-avax GPP event. Confirm the original GPP poster + rollup still render — no regression.
4. Open a non-GPP event. Confirm the Poster/Rollup sections are still hidden (`eventType === 'gpp'` gate intact).
5. Network tab: confirm `/gpp-poster-avax-template.png` (preview) and `znpiwdvvsqaxuskpfleo.supabase.co/.../gpp-poster-avax-fullres.png` (hi-res) both 200.

## Risk / known gotchas
- **Text positions may sit awkwardly on the Team1 design.** Decision was to ship existing coords; iterate after preview. If the city/venue lands over a logo or off-canvas, follow-up plan with custom `textFields` coords in the avax config.
- **Full-res Supabase upload happens outside the PR** — verify the bucket has both files before merging or the hi-res download will 404 on avax events.
- Memory tag [[architecture_generative_dual_render_paths]] — preview (`GenerativeCanvas.tsx`) and download (`renderCanvas.ts`) re-derive layout independently. Since we're only swapping the config (templatePath + fullResUrl) and not the rendering logic, this dual-path concern doesn't apply here.

## Out of scope
- Custom text-field coords for the avax template (separate task if needed).
- Adding "avax" to a tag picker UI (already exists; 16 events tagged in prod).
- Print materials beyond poster + rollup (stickers, flyers — flyer already handled by `renderFlyer.ts`).
