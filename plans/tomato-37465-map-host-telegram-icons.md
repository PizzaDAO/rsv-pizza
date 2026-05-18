# tomato-37465 — /map InfoWindow: host Telegram icons (mods only)

## Problem
On `/map`, admins and underbosses cannot DM the host from the event card. The current "Telegram →" link in the InfoWindow points to the **group chat** (city/per-event group), not the host's personal Telegram. Mods need a quick DM path to the people running each event.

## Scope
Add up to **two** Telegram DM icons to the `/map` InfoWindow, alongside the existing group-chat link, **only when the viewer is a moderator** (admin or underboss):

1. **Primary host** — from `parties.user.telegram`
2. **First cohost** with a telegram handle — from `parties.coHosts[0..n].telegram`, picking the first entry that has a non-empty handle

If neither exists, render nothing (no broken icons, no placeholder).

Visibility is mods-only because telegram handles are PII; the public `/api/gpp/events` response is CDN-cached, so the new fields must only appear in moderator-authenticated requests.

## Files to change

### 1. Backend — gate new fields on moderator auth
`backend/src/routes/gpp.routes.ts`

The endpoint already has a moderator-auth path for `?statuses=all`. Mirror that pattern. Add a `hostTelegram` + `coHostTelegrams` block to the response only when caller is admin/underboss.

**1a. Add fields to the select** (around line 630, `gppEventSelect`):
```ts
const gppEventSelect = {
  // ...existing fields...
  coHosts: true,                          // NEW — raw JSON array of cohosts
  user: {
    select: { name: true, telegram: true } // ADD telegram
  },
} as const;
```

**1b. Decide moderator-mode once per request** in the list endpoint (the same block that resolves `includeAllStatuses` near line 750-770). Extract that JWT-decode/`isAdmin`||`isUnderboss` check into a small local helper or reuse the existing `includeAllStatuses` value as the gate — they share the same auth requirement.

Recommended: compute `const callerIsModerator = includeAllStatuses` (or rename the local variable to make the dual use explicit, e.g., `const callerIsModerator = await resolveCallerIsModerator(req)` and pass it into `formatGppEvent`).

**1c. Update `formatGppEvent`** to accept a moderator flag and conditionally return the new fields:
```ts
function formatGppEvent(event: any, callerIsModerator = false) {
  // ...existing return object...
  const base = {
    // ...existing fields...
  };

  if (!callerIsModerator) return base;

  // Pick first cohost with a non-empty telegram handle.
  // coHosts is JSON: an array of { id, name, telegram?, twitter?, ... }
  const cohostArr: any[] = Array.isArray(event.coHosts) ? event.coHosts : [];
  const firstCohostTelegram = cohostArr
    .map((c) => (c && typeof c.telegram === 'string' ? c.telegram.trim() : ''))
    .find((t) => t.length > 0) || null;

  const hostTelegramRaw = event.user?.telegram?.trim() || null;

  return {
    ...base,
    hostTelegram: hostTelegramRaw || null,
    coHostTelegrams: firstCohostTelegram ? [firstCohostTelegram] : [],
  };
}
```

Use a `coHostTelegrams` **array** (not a scalar) so we can lift the "first cohost only" cap later without another API change. The frontend caps at 1 today.

**1d. Pass the moderator flag through** at each `formatGppEvent` callsite. There are 3:
- `GET /api/gpp/events` (list) — pass `callerIsModerator`
- `GET /api/gpp/events/:slug` (single by slug)
- `GET /api/gpp/events/by-city/:citySlug` (single by city)

For the two single-event endpoints, perform the same JWT/admin/underboss resolution (or extract a helper used by all three). Pass `false` if you want to keep them strictly public for now — the map only uses the list endpoint, so it's fine to land the single-event variants as `false` and revisit later. **For this task: do all three for consistency**, since `EventPage` may eventually want the same data.

**1e. Disable CDN caching when the response includes host telegrams**. The list endpoint sets `Cache-Control: public, max-age=300`. If `callerIsModerator` is true, switch to:
```ts
res.set('Cache-Control', 'private, no-store');
```
This prevents Vercel's edge from caching a moderator-flavored response and serving it to a public visitor on the next request.

### 2. Frontend API types
`frontend/src/lib/api.ts`

In `GPPEventApiResponse` (around line 3377):
```ts
hostTelegram?: string | null;
coHostTelegrams?: string[];
```

In `GPPEventMapItem` (around line 3361):
```ts
hostTelegram?: string | null;
coHostTelegrams?: string[];
```

In `fetchGppEventsForMap` mapper (around line 3417):
```ts
hostTelegram: e.hostTelegram ?? null,
coHostTelegrams: e.coHostTelegrams ?? [],
```

### 3. Frontend map — render icons in InfoWindow
`frontend/src/components/GPPEventsMap.tsx`

The InfoWindow content is built as a raw HTML string in `buildInfoContent`. The lucide `Send` icon used elsewhere isn't usable as a React component here — inline an SVG that visually matches it.

**3a. Inline SVG constant** at the top of the file (after imports, outside the component):
```ts
// Lucide "send" icon SVG, inlined for use inside the InfoWindow HTML string.
// Keep stroke + viewBox in sync with HostsManager.tsx (Send size={14}).
const SEND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`;
```

**3b. Render the icons inside `buildInfoContent`** — only when `canModerate` is true. The function already has access to `canModerate` (it's destructured from props near line 47).

After the existing `telegramHtml` block (around line 187):
```ts
// Host DM icons — only for moderators. Sanitize handles to prevent injection
// (handles are user-controlled strings stored in DB).
function sanitizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const stripped = raw.trim().replace(/^@/, '');
  // Telegram usernames are [A-Za-z0-9_]; anything else means a bad handle.
  if (!/^[A-Za-z0-9_]{3,40}$/.test(stripped)) return null;
  return stripped;
}

const hostTgHandles: string[] = [];
if (canModerate) {
  const primary = sanitizeHandle(event.hostTelegram);
  if (primary) hostTgHandles.push(primary);
  // Cap at 1 cohost (first with a valid handle).
  for (const raw of event.coHostTelegrams || []) {
    if (hostTgHandles.length >= 2) break;
    const h = sanitizeHandle(raw);
    if (h && !hostTgHandles.includes(h)) hostTgHandles.push(h);
  }
}

const hostTgIconsHtml = hostTgHandles
  .map(
    (h) =>
      `<a href="https://t.me/${h}" target="_blank" rel="noopener noreferrer" title="DM @${h} on Telegram" style="color:#29B6F6;display:inline-flex;align-items:center;text-decoration:none">${SEND_ICON_SVG}</a>`
  )
  .join('');
```

**3c. Inject `hostTgIconsHtml` into the action row** so the icons appear next to the existing pills/buttons in the moderator section. The current moderator `actionsHtml` (around line 192-220) prepends the status pill and RSVPs pill before the approve/reject buttons. Insert the new icons right after `${statusPillHtml}`:
```ts
actionsHtml = `
  ${statusPillHtml}
  ${hostTgIconsHtml}
  ${rsvpPillHtml}
  <button data-action="approve" ...>Approve</button>
  <button data-action="reject" ...>Reject</button>
`;
```
Do this in all three `if/else` branches (`approved`, `rejected`, default). The icons sit between the status pill and the RSVPs pill so they're discoverable but don't crowd the action buttons.

If `hostTgHandles` is empty, `hostTgIconsHtml` is `""` and the layout collapses cleanly (the parent flex container has `gap:8px` which doesn't add space around empty children).

**3d. No public-view changes.** When `canModerate` is false, the existing public layout (`linkHtml` + `telegramHtml`) is unchanged — the icons only render in the moderator `actionsHtml` branch.

## Verification

After backend deploys (see Notes), open `/map` on the preview as an underboss:

1. **Event with host + cohost telegrams set** → two send-icon links appear in the action row between the status pill and RSVPs pill. Hovering shows `DM @<handle> on Telegram`. Clicking opens `https://t.me/<handle>` in a new tab.
2. **Event with only host telegram** → one icon.
3. **Event with only a cohost telegram** (rare but possible) → one icon (the cohost's).
4. **Event with no telegram handles anywhere** → no icons, action row otherwise unchanged.
5. **Same event viewed logged-out** → no host icons (the group-chat "Telegram →" link still appears if applicable).
6. **Network tab**: the `/api/gpp/events?statuses=all` response contains `hostTelegram` and `coHostTelegrams` fields. The same endpoint hit anonymously (without bearer token, no `?statuses=all`) does NOT contain those fields.
7. **Cache headers**: moderator response has `Cache-Control: private, no-store`; anonymous response keeps `public, max-age=300`.

## Out of scope

- Adding more than one cohost icon (the API already returns an array, so this is a future frontend tweak).
- Showing the host's *name* in the InfoWindow (currently `hostName` is hardcoded to `'PizzaDAO'` — out of scope here).
- Changing the existing group-chat "Telegram →" link styling or position.
- Moderator-only filtering of the InfoWindow's approve/reject UI (already exists).
- Mobile-specific layout for the InfoWindow.

## Notes / gotchas

- **Backend deploy required before previews work.** Frontend changes alone will silently render no icons because the API response won't include the new fields. Order: merge → `cd backend && vercel --prod --scope pizza-dao` from the `rsvpizza-master-deploy` worktree → verify on prod → previews then start working.
- **Not a "7-place" DB-field add.** No migration, no Prisma schema change, no grants — `User.telegram` and `Party.coHosts` already exist and are read elsewhere.
- **CDN cache must be flipped to private when moderator data is included.** Without `Cache-Control: private, no-store` on the moderator branch, the Vercel edge could cache a moderator response and serve it to a public visitor.
- **Telegram handle sanitizer is defensive.** Handles come from user-edited DB rows. The regex `/^[A-Za-z0-9_]{3,40}$/` enforces the actual Telegram username rules and rejects any handle with characters that could break the `href` or be used for XSS. Anything that fails the regex is dropped silently — better to hide a quirky handle than to ship a broken link.
- **Inline SVG instead of importing lucide.** The InfoWindow content is a raw HTML string built via template literals, not React. The hand-rolled SVG is a literal copy of lucide's `Send` icon (24x24 viewBox, same paths) — if lucide updates the icon, this won't auto-update, but that's an acceptable trade for the InfoWindow's render path.
- The `coHosts` JSON shape on `Party` is `[{ id, name, telegram?, twitter?, instagram?, avatarUrl?, ... }]` (see `HostsManager.tsx` for the canonical shape). Defensive `Array.isArray` check is required because legacy rows may have null.
